"""Watabou One Page Dungeon (JSON): the first external geometry converter.

The format is the JSON export of [Watabou's One Page Dungeon
generator](https://watabou.itch.io/one-page-dungeon), read here under the
author's stated terms — "You can use images created by the generator as you
like: copy, modify, include in your commercial rpg adventures etc. Attribution
is appreciated, but not required." Attribution is cheap, so: the format and the
generator are Watabou's. No generator code is vendored and nothing here reaches
the network; the reader parses a local file the user exported.

Three source-shape facts drive the whole conversion:

- **A door is a cell in One Page Dungeon and an edge in osrlib.** The generator
  emits a 1×1 floor rect for every door before the door record itself, so the
  door cell stays floor and the door lands on the edge between that cell and its
  `dir` neighbour. Types 3 and 8 are not edges at all — they are the entrance
  and a level transition, the two records whose `dir` points at void.
- **Floor is not a field; connectivity is the edge set.** The floor-cell set is
  the union of `rects`; every orthogonally adjacent floor pair gets an `OPEN`
  edge, overridden to `DOOR` where a door sits. An absent edge is already a
  wall, so unkeyed corridors and junctions need no area.
- **Coordinates are entrance-relative and routinely negative.** One translation
  by `(-min_x, -min_y)` normalizes cells, entrance, and transition positions
  onto osrlib's non-negative grid. The axes already agree — both run y
  southward — so translation is the only transform.

The reader parses by key presence and never by `version` string: the eight
required keys have been stable across every shipped version, and an unknown
door type maps to an ordinary door with a note rather than a failure. Every
guess, drop, and repair lands in `ImportedLevel.notes`, which the import dialog
renders.
"""

import json
from collections import Counter
from collections.abc import Mapping, Sequence
from pathlib import Path
from typing import NamedTuple, cast

from osrlib.crawl.dungeon import (
    Direction,
    DoorSpec,
    Edge,
    EdgeKind,
    Position,
    TransitionSpec,
    edge_key,
    step,
)

from osreditor.errors import ImportSourceInvalidError
from osreditor.importers import ImportedArea, ImportedGeometry, ImportedLevel, next_free_key

__all__ = ["OPDImporter"]

_SNIFF_LIMIT = 64 * 1024
"""How far into the file the sniff reads, in bytes.

`"doors"` follows the entire `rects` array — byte 4,464 in an ordinary 147-rect
export — and moves right as rect count grows, so a small head would
false-negative on a big dungeon. Every observed export stays under 10 KB, so
this clears the key signature by an order of magnitude and still costs one short
read on a huge or binary file.
"""

_REQUIRED_KEYS = ("version", "title", "story", "rects", "doors", "notes", "columns", "water")
"""The eight keys every shipped version emits — the format's structural identity.

`ending` arrived later and is optional here for exactly that reason: the reader
identifies the format by structure, never by the `version` string.
"""

_DIRECTIONS: dict[Position, Direction] = {
    (0, -1): Direction.NORTH,
    (1, 0): Direction.EAST,
    (0, 1): Direction.SOUTH,
    (-1, 0): Direction.WEST,
}

_ENTRANCE_TYPE = 3
_TRANSITION_TYPE = 8

_OPEN = Edge(kind=EdgeKind.OPEN)
_PLAIN_DOOR = Edge(kind=EdgeKind.DOOR, door=DoorSpec())
_LOCKED_DOOR = Edge(kind=EdgeKind.DOOR, door=DoorSpec(locked=True))

_DOOR_EDGES: dict[int, Edge] = {
    0: _OPEN,  # open
    1: _PLAIN_DOOR,  # door
    2: _OPEN,  # narrow
    4: _LOCKED_DOOR,  # portcullis
    5: _PLAIN_DOOR,  # double
    6: Edge(kind=EdgeKind.DOOR, door=DoorSpec(kind="secret")),  # secret
    7: _LOCKED_DOOR,  # barred
    9: _OPEN,  # steps
}
"""The interior door types and the edge each becomes. Types 3 and 8 are boundaries, not edges."""

_DOOR_NAMES: dict[int, str] = {
    0: "opening",
    1: "door",
    2: "narrow opening",
    3: "boundary door",
    4: "portcullis",
    5: "double door",
    6: "secret door",
    7: "barred door",
    8: "level transition",
    9: "flight of steps",
}

_MAPPING_NOTES: dict[int, str] = {
    4: "imported {count} portcullis door(s) as locked doors: the editor's door model has no portcullis, so the "
    "winch and the see-through grate are lost",
    5: "imported {count} double door(s) as ordinary doors: the editor's door model has no leaf count",
    7: "imported {count} barred door(s) as locked doors: the editor's door model cannot say which side the bar is on",
    9: "imported {count} flight(s) of steps as plain openings: the editor's grid has no intra-level elevation",
}
"""The door types whose mapping loses something the editor cannot say — one counted note each."""

_FABRICATED_DUNGEON_ID = ""
_FABRICATED_LEVEL_NUMBER = 2
_FABRICATED_POSITION: Position = (0, 0)
"""The pinned destination a type-8 transition carries.

`TransitionSpec` requires a whole destination and the source has data for none
of it — not even the level number, which the dialog chooses after load. The
empty dungeon id matches no dungeon the editor can create, so the dialog's
resolution test fails by construction rather than by luck, and the author
resolves or drops the stair before publish.
"""


class OPDImporter:
    """Watabou's One Page Dungeon JSON export, converted onto the editor's grid.

    Nominative naming: `format_id` and `label` describe the format
    interoperated with, never a feature of the editor.
    """

    format_id = "watabou-opd"
    label = "Watabou One Page Dungeon (JSON)"

    def sniff(self, path: Path) -> bool:
        """Report whether the path is a `.json` file carrying the One Page Dungeon key signature.

        Presence-level and bounded, per the protocol's contract: one short read
        of at most 64 KB, and never a parse.

        Args:
            path: The absolute source path.

        Returns:
            True when the shape matches.
        """
        if path.suffix.lower() != ".json" or not path.is_file():
            return False
        try:
            with path.open("rb") as handle:
                head = handle.read(_SNIFF_LIMIT)
        except OSError:
            return False
        return b'"rects"' in head and b'"doors"' in head

    def load(self, path: Path) -> ImportedGeometry:
        """Read one export and convert it to a single level of editor geometry.

        Args:
            path: The absolute source path.

        Returns:
            The geometry: the export's title and story offered for adoption,
            and its one level — One Page Dungeon is single-level by
            construction.

        Raises:
            ImportSourceInvalidError: If the path is unreadable, is not JSON, is
                not a JSON object, is missing a required key, carries a
                non-array `rects` or `doors`, or describes no floor at all.
        """
        try:
            raw = path.read_bytes()
        except OSError as error:
            raise ImportSourceInvalidError(f"cannot read {path}: {error}") from error
        try:
            document: object = json.loads(raw)
        except ValueError as error:
            raise ImportSourceInvalidError(f"{path} is not valid JSON: {error}") from error
        data = _mapping(document)
        if data is None:
            raise ImportSourceInvalidError(f"{path} is not a One Page Dungeon export: the document is not an object")
        missing = [key for key in _REQUIRED_KEYS if key not in data]
        if missing:
            raise ImportSourceInvalidError(
                f"{path} is not a One Page Dungeon export: it is missing {', '.join(missing)}"
            )
        return _convert(path, data)


def _mapping(value: object) -> Mapping[str, object] | None:
    """A source object, or None for anything else — JSON object keys are strings by construction."""
    return cast(Mapping[str, object], value) if isinstance(value, Mapping) else None


def _array(value: object) -> Sequence[object] | None:
    """A source array, or None for anything else."""
    return cast(Sequence[object], value) if isinstance(value, list) else None


def _as_int(value: object) -> int | None:
    """The source's integers, tolerant of JSON's float spelling; None for anything else."""
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value
    if isinstance(value, float) and value.is_integer():
        return int(value)
    return None


def _as_number(value: object) -> float | None:
    """A note position's coordinate — room centres are half-integers; None for anything else."""
    if isinstance(value, bool):
        return None
    if isinstance(value, int | float):
        return float(value)
    return None


def _as_text(value: object) -> str:
    """A source string, or empty for anything else — prose the reader will not invent."""
    return value if isinstance(value, str) else ""


def _rect(entry: object) -> tuple[int, int, int, int, bool] | None:
    """One rect as `(x, y, w, h, rotunda)` in source coordinates, or None when unreadable."""
    record = _mapping(entry)
    if record is None:
        return None
    x, y, w, h = (_as_int(record.get(key)) for key in ("x", "y", "w", "h"))
    if x is None or y is None or w is None or h is None or w < 1 or h < 1:
        return None
    return x, y, w, h, bool(record.get("rotunda"))


def _door(entry: object) -> tuple[Position, Direction, int] | None:
    """One door as `(cell, direction, type)` in source coordinates, or None when unreadable."""
    record = _mapping(entry)
    if record is None:
        return None
    vector = _mapping(record.get("dir"))
    x, y = _as_int(record.get("x")), _as_int(record.get("y"))
    kind = _as_int(record.get("type"))
    if x is None or y is None or kind is None or vector is None:
        return None
    dx, dy = _as_int(vector.get("x")), _as_int(vector.get("y"))
    if dx is None or dy is None:
        return None
    direction = _DIRECTIONS.get((dx, dy))
    if direction is None:
        return None
    return (x, y), direction, kind


def _note(entry: object) -> tuple[str, str, tuple[float, float]] | None:
    """One keyed note as `(ref, text, position)` in source coordinates, or None when unreadable."""
    record = _mapping(entry)
    if record is None:
        return None
    position = _mapping(record.get("pos"))
    if position is None:
        return None
    x, y = _as_number(position.get("x")), _as_number(position.get("y"))
    if x is None or y is None:
        return None
    return _as_text(record.get("ref")), _as_text(record.get("text")), (x, y)


def _convert(path: Path, data: Mapping[str, object]) -> ImportedGeometry:
    """Convert one parsed export, noting every guess, drop, and repair."""
    source_rects, source_doors = _array(data["rects"]), _array(data["doors"])
    if source_rects is None or source_doors is None:
        raise ImportSourceInvalidError(f"{path} is not a One Page Dungeon export: rects and doors must be arrays")

    rect_notes: list[str] = []
    rects: list[tuple[int, int, int, int]] = []
    rotundas = 0
    for index, entry in enumerate(source_rects):
        parsed = _rect(entry)
        if parsed is None:
            rect_notes.append(f"dropped rects[{index}]: not a rectangle with integer x, y and w, h of at least 1")
            continue
        x, y, w, h, rotunda = parsed
        rects.append((x, y, w, h))
        if rotunda:
            rotundas += 1
    if rotundas:
        rect_notes.append(
            f"imported {rotundas} round room(s) as their bounding square of floor cells: the editor's grid has "
            "square cells and no circle vocabulary"
        )

    source_floor = {(x + i, y + j) for x, y, w, h in rects for j in range(h) for i in range(w)}
    if not source_floor:
        raise ImportSourceInvalidError(f"{path} describes no floor: its rects array covers no cell")

    origin = (-min(x for x, _ in source_floor), -min(y for _, y in source_floor))
    width = max(x for x, _ in source_floor) + origin[0] + 1
    height = max(y for _, y in source_floor) + origin[1] + 1
    floor = {_shift(cell, origin) for cell in source_floor}

    edges = _open_edges(floor)
    doors = _read_doors(source_doors, floor, origin)
    edges.update(doors.edges)
    source_notes = _array(data["notes"])
    areas, area_notes = _read_areas(source_notes or (), rects, origin)
    if source_notes is None:
        area_notes.insert(0, "ignored the 'notes' entry: it is not an array, so no room came in keyed")

    title, story = _as_text(data["title"]), _as_text(data["story"])
    notes = [
        f"converted from a One Page Dungeon export stamped version {_as_text(data['version'])!r}",
        f"normalized the entrance-relative source grid onto {width}×{height} cells: the source's (0, 0) is the "
        f"editor's {origin}, and every position below is the editor's",
        *rect_notes,
        *doors.notes,
        *area_notes,
        *_dropped_features(data),
    ]
    level = ImportedLevel(
        label=title or "One Page Dungeon",
        width=width,
        height=height,
        edges=edges,
        areas=areas,
        entrance=doors.entrance,
        transitions=doors.transitions,
        notes=tuple(notes),
    )
    return ImportedGeometry(title=title or None, description=story or None, levels=(level,))


def _shift(cell: Position, origin: Position) -> Position:
    """Translate one source cell onto the editor's non-negative grid."""
    return cell[0] + origin[0], cell[1] + origin[1]


def _open_edges(floor: set[Position]) -> dict[str, Edge]:
    """One `OPEN` edge per orthogonally adjacent floor pair, in row-major scan order.

    Connectivity is the whole of it: an absent edge is already a wall, so no
    entry is authored for a floor cell's void neighbours.
    """
    edges: dict[str, Edge] = {}
    for cell in sorted(floor, key=lambda cell: (cell[1], cell[0])):
        for direction in (Direction.EAST, Direction.SOUTH):
            if step(cell, direction) in floor:
                edges[edge_key(cell, direction)] = _OPEN
    return edges


class _DoorPass(NamedTuple):
    """What the door pass produced: edge overrides, the entrance, transitions, and notes."""

    edges: dict[str, Edge]
    entrance: Position | None
    transitions: tuple[TransitionSpec, ...]
    notes: tuple[str, ...]


def _read_doors(entries: Sequence[object], floor: set[Position], origin: Position) -> _DoorPass:
    """Resolve every door record onto an edge, the entrance, or a transition."""
    edges: dict[str, Edge] = {}
    entrance: Position | None = None
    notes: list[str] = []
    transitions: list[TransitionSpec] = []
    mapped: Counter[int] = Counter()
    unknown: Counter[int] = Counter()
    claimed_cells: set[Position] = set()
    claimed_edges: set[str] = set()
    occupied: set[Position] = set()
    origin_door_seen = False

    for index, entry in enumerate(entries):
        parsed = _door(entry)
        if parsed is None:
            notes.append(f"dropped doors[{index}]: it carries no readable x, y, dir and type")
            continue
        source_cell, direction, kind = parsed
        cell = _shift(source_cell, origin)
        name = _DOOR_NAMES.get(kind, f"type-{kind} door")

        if kind == _ENTRANCE_TYPE:
            if source_cell == (0, 0) and not origin_door_seen:
                origin_door_seen = True
                if cell in floor:
                    entrance = cell
                else:
                    notes.append(f"dropped the entrance at {cell}: the source's origin door sits on no floor cell")
            else:
                notes.append(
                    f"noted a second boundary door at {cell}: the editor's level carries one entrance, so place "
                    "any other way in by hand"
                )
            continue

        if cell not in floor:
            notes.append(f"dropped the {name} at {cell}: its own cell is not floor, so it joins nothing")
            continue

        if kind == _TRANSITION_TYPE:
            if cell in occupied:
                notes.append(f"dropped the {name} at {cell}: a transition already occupies the cell")
                continue
            occupied.add(cell)
            transitions.append(
                TransitionSpec(
                    kind="stairs_down",
                    position=cell,
                    to_dungeon_id=_FABRICATED_DUNGEON_ID,
                    to_level_number=_FABRICATED_LEVEL_NUMBER,
                    to_position=_FABRICATED_POSITION,
                    to_facing=direction,
                )
            )
            notes.append(
                f"the stairs down at {cell} carry a fabricated destination (dungeon "
                f"{_FABRICATED_DUNGEON_ID!r}, level {_FABRICATED_LEVEL_NUMBER}, cell {_FABRICATED_POSITION}, "
                f"facing {direction.value}): One Page Dungeon records none, so resolve it against a real level "
                "or drop it before publishing"
            )
            continue

        ahead = step(cell, direction)
        if ahead not in floor:
            notes.append(f"dropped the {name} at {cell}: it opens onto {ahead}, which is not floor")
            continue
        if cell in claimed_cells:
            notes.append(f"dropped the {name} at {cell}: a door already occupies the cell, and the first wins")
            continue
        key = edge_key(cell, direction)
        if key in claimed_edges:
            notes.append(f"dropped the {name} at {cell}: a door already holds the {key!r} edge, and the first wins")
            continue

        claimed_cells.add(cell)
        claimed_edges.add(key)
        edge = _DOOR_EDGES.get(kind)
        if edge is None:
            unknown[kind] += 1
            edge = _PLAIN_DOOR
        elif kind in _MAPPING_NOTES:
            mapped[kind] += 1
        edges[key] = edge

    for kind in sorted(mapped):
        notes.append(_MAPPING_NOTES[kind].format(count=mapped[kind]))
    for kind in sorted(unknown):
        notes.append(
            f"imported {unknown[kind]} door(s) of unrecognized type {kind} as ordinary doors: the format has "
            "grown a type this reader predates"
        )
    if entrance is None and not origin_door_seen:
        notes.append(
            "no entrance: the export carries no boundary door at the source origin, so the level imports without "
            "one — place it by hand"
        )

    return _DoorPass(edges=edges, entrance=entrance, transitions=tuple(transitions), notes=tuple(notes))


def _read_areas(
    entries: Sequence[object], rects: Sequence[tuple[int, int, int, int]], origin: Position
) -> tuple[tuple[ImportedArea, ...], list[str]]:
    """Key each note's containing rect as an area, by `ref` and never by array position.

    `getNotes()` builds `symb` from the note's array index but `sortRooms`
    orders the array by path cost from the entrance, so the two disagree in
    every real export — the serialized `ref` is the room's name and the array
    position is nothing.
    """
    notes: list[str] = []
    areas: list[ImportedArea] = []
    parsed = [_note(entry) for entry in entries]
    taken = {record[0] for record in parsed if record is not None}
    claimed: dict[int, str] = {}
    used: set[str] = set()

    for index, record in enumerate(parsed):
        if record is None:
            notes.append(f"dropped notes[{index}]: it carries no readable pos")
            continue
        ref, text, position = record
        rect_index = _rect_containing(rects, position)
        if rect_index is None:
            landing = (position[0] + origin[0], position[1] + origin[1])
            notes.append(f"dropped note {ref!r}: its position {landing} lands in no room rectangle")
            continue
        if rect_index in claimed:
            notes.append(f"dropped note {ref!r}: its room is already keyed as area {claimed[rect_index]!r}")
            continue
        area_id = ref
        if not area_id or area_id in used:
            area_id = next_free_key(taken | used)
            reason = "empty ref" if not ref else f"duplicate of area {ref!r}"
            notes.append(f"renamed area {ref!r} to {area_id!r} ({reason}); geometry preserved")
        used.add(area_id)
        claimed[rect_index] = area_id
        x, y, w, h = rects[rect_index]
        cells = tuple(_shift((x + i, y + j), origin) for j in range(h) for i in range(w))
        areas.append(ImportedArea(id=area_id, name="", description=text, cells=cells))

    return tuple(areas), notes


def _rect_containing(rects: Sequence[tuple[int, int, int, int]], position: tuple[float, float]) -> int | None:
    """The index of the first rect whose half-open span contains `position`, or None."""
    px, py = position
    for index, (x, y, w, h) in enumerate(rects):
        if x <= px < x + w and y <= py < y + h:
            return index
    return None


def _dropped_features(data: Mapping[str, object]) -> list[str]:
    """One counted note per source feature the geometry payload has no room for.

    `ImportedArea` carries an id, a name, a description, and cells; features are
    content ops the payload deliberately does not reach. Wiring columns and
    water to phase 3's feature vocabulary would grow the payload into content —
    a `GeometryImporter` redesign, not an importer.
    """
    notes: list[str] = []
    columns = len(_array(data["columns"]) or ())
    if columns:
        notes.append(
            f"dropped {columns} column(s): the import payload carries geometry only, so add them as features by hand"
        )
    water = len(_array(data["water"]) or ())
    if water:
        notes.append(
            f"dropped {water} water cell(s): the import payload carries geometry only, so add them as features by hand"
        )
    ending = _as_text(data.get("ending"))
    if ending:
        notes.append(f"dropped the export's ending line ({ending!r}): the editor has no model for it")
    return notes
