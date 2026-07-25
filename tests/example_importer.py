"""A complete, tested geometry importer — the teaching example the docs site excerpts.

This module exists for the "writing a geometry importer" reference guide:
`docs/reference/writing-a-geometry-importer.md` excerpts it through named
snippet sections, and `tests/test_importers.py` imports and exercises it, so
the documented code cannot drift from code that passes. It is deliberately not
`test_`-prefixed — pytest never collects it directly.

The format is invented for the lesson, but the contract is the real one every
importer meets: a bounded, presence-level `sniff`; a `load` that raises
`ImportSourceInvalidError` with a human message on anything unloadable; a
payload normalized to what the op vocabulary admits (open edges between floor
cells — an absent edge is already a wall); and a note for every judgment call
the conversion made, rendered by the import dialog before anything commits.

The field map format, one character per cell:

- `#` is rock, `.` is floor.
- `@` is the level entrance, on floor.
- `1`–`9` are keyed floor cells; the cells sharing a digit form that keyed area.
- Anything else is a symbol this reader predates: treated as rock, with a note.
"""

from pathlib import Path

from osrlib.crawl.dungeon import Direction, Edge, EdgeKind, Position, edge_key, step

from osreditor.errors import ImportSourceInvalidError
from osreditor.importers import ImportedArea, ImportedGeometry, ImportedLevel

_OPEN = Edge(kind=EdgeKind.OPEN)

_SNIFF_LIMIT = 4 * 1024
"""How far into the file the sniff reads, in bytes — one short read, never a parse."""

_FLOOR = ".@123456789"
_ALPHABET = frozenset(_FLOOR + "#")


# --8<-- [start:identity-and-sniff]
class FieldMapImporter:
    """Plain-text field maps, one character per cell: `#` rock, `.` floor, `@` entrance, `1`–`9` keyed areas."""

    format_id = "fieldmap"
    label = "Field map (plain text)"

    def sniff(self, path: Path) -> bool:
        """Report whether the path looks like a field map, at presence level.

        Bounded, per the protocol's contract: the extension, then one short
        read of at most 4 KB checked against the format's alphabet — never a
        full read and never a parse. A sniff that loads punishes every probe
        of a big file; the load route is where real work happens.

        Args:
            path: The absolute source path.

        Returns:
            True when the shape matches.
        """
        if path.suffix != ".fieldmap" or not path.is_file():
            return False
        try:
            with path.open("rb") as handle:
                head = handle.read(_SNIFF_LIMIT)
        except OSError:
            return False
        try:
            text = head.decode("utf-8")
        except UnicodeDecodeError:
            return False
        return any(symbol in _FLOOR for symbol in text)

    # --8<-- [end:identity-and-sniff]

    # --8<-- [start:load]
    def load(self, path: Path) -> ImportedGeometry:
        """Read one field map and convert it to a single level of editor geometry.

        Args:
            path: The absolute source path.

        Returns:
            The geometry: one level, labeled with the file's stem. A field map
            carries no title or story, so neither is offered for adoption.

        Raises:
            ImportSourceInvalidError: If the path is unreadable, is not UTF-8
                text, or describes no floor at all — always with a message a
                person can act on, because the import dialog shows it verbatim.
        """
        try:
            text = path.read_text(encoding="utf-8")
        except OSError as error:
            raise ImportSourceInvalidError(f"cannot read {path}: {error}") from error
        except UnicodeDecodeError as error:
            raise ImportSourceInvalidError(f"{path} is not UTF-8 text: {error}") from error
        rows = text.splitlines()
        level = _convert(path, rows)
        return ImportedGeometry(levels=(level,))

    # --8<-- [end:load]


# --8<-- [start:convert]
def _convert(path: Path, rows: list[str]) -> ImportedLevel:
    """Walk the grid once, producing the payload and a note for every judgment call."""
    floor: set[Position] = set()
    keyed: dict[str, list[Position]] = {}
    entrance: Position | None = None
    notes: list[str] = []
    unknown: dict[str, int] = {}

    for y, row in enumerate(rows):
        for x, symbol in enumerate(row):
            if symbol == "#":
                continue
            if symbol not in _ALPHABET:
                # A judgment call, not a failure: the format may have grown a
                # symbol this reader predates, and one counted note beats a
                # refusal — the author sees exactly what was guessed.
                unknown[symbol] = unknown.get(symbol, 0) + 1
                continue
            floor.add((x, y))
            if symbol == "@":
                if entrance is None:
                    entrance = (x, y)
                else:
                    notes.append(
                        f"kept the entrance at {entrance} and imported the '@' at {(x, y)} as ordinary floor: "
                        "a level carries one entrance"
                    )
            elif symbol != ".":
                keyed.setdefault(symbol, []).append((x, y))

    if not floor:
        raise ImportSourceInvalidError(f"{path} describes no floor: every cell is rock")
    for symbol in sorted(unknown):
        notes.append(f"treated {unknown[symbol]} {symbol!r} cell(s) as rock: this reader predates the symbol")
    if entrance is None:
        notes.append("no entrance: the map marks no '@', so the level imports without one — place it by hand")

    # Connectivity is the edge set: one OPEN edge per orthogonally adjacent
    # floor pair, canonical keys only. An absent edge is already a wall, so
    # nothing is authored for a floor cell's rock neighbours.
    edges: dict[str, Edge] = {}
    for cell in sorted(floor, key=lambda cell: (cell[1], cell[0])):
        for direction in (Direction.EAST, Direction.SOUTH):
            if step(cell, direction) in floor:
                edges[edge_key(cell, direction)] = _OPEN

    areas = tuple(
        ImportedArea(id=symbol, cells=tuple(cells)) for symbol, cells in sorted(keyed.items(), key=lambda kv: kv[0])
    )
    return ImportedLevel(
        label=path.stem,
        width=max(len(row) for row in rows),
        height=len(rows),
        edges=edges,
        areas=areas,
        entrance=entrance,
        transitions=(),
        notes=tuple(notes),
    )


# --8<-- [end:convert]
