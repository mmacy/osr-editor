"""Import-from-project: the built-in importer over another project's `adventure.json`.

The seam's first implementation and its dogfooding case — it registers through
the public `osreditor.importers` entry-point group exactly as a third-party
converter does.
"""

from pathlib import Path

from osrlib.crawl.dungeon import Edge, EdgeKind, LevelSpec, Position, TransitionSpec

from osreditor.documents import ADVENTURE_ARTIFACT, canonical_edge_cells, load_adventure
from osreditor.errors import ImportSourceInvalidError
from osreditor.importers import ImportedArea, ImportedGeometry, ImportedLevel, repair_area_id

__all__ = ["ProjectImporter"]


class ProjectImporter:
    """Import-from-project: every level of another project's `adventure.json`.

    A forge workdir also sniffs true — its assembled root document is loadable,
    and importing geometry from a draft is legitimate. Load normalizes the
    payload to what the op vocabulary admits, and every drop or repair lands in
    `notes` — a validation-dirty source is a legitimate import source, and a
    payload the dialog's batch cannot commit would 422 the whole import with no
    path forward.
    """

    format_id = "project"
    label = "osr-editor project"

    def sniff(self, path: Path) -> bool:
        """Report whether the directory contains an `adventure.json`.

        Args:
            path: The absolute source directory.

        Returns:
            True when the shape matches.
        """
        return (path / ADVENTURE_ARTIFACT).is_file()

    def load(self, path: Path) -> ImportedGeometry:
        """Load and normalize every level of the source project's document.

        Args:
            path: The absolute source directory.

        Returns:
            The geometry: title and description from the source adventure,
            every level of every dungeon labeled `"<dungeon-id> level <n>"`.

        Raises:
            ImportSourceInvalidError: If the path holds no readable, loadable
                adventure document.
        """
        source = path / ADVENTURE_ARTIFACT
        try:
            data = source.read_bytes()
        except OSError as error:
            raise ImportSourceInvalidError(f"cannot read {source}: {error}") from error
        try:
            adventure = load_adventure(data)
        except Exception as error:
            raise ImportSourceInvalidError(f"{source} is not a loadable adventure document: {error}") from error
        levels = tuple(
            _imported_level(f"{dungeon.id} level {level.number}", level)
            for dungeon in adventure.dungeons
            for level in dungeon.levels
        )
        return ImportedGeometry(title=adventure.name, description=adventure.description, levels=levels)


def _imported_level(label: str, level: LevelSpec) -> ImportedLevel:
    """Normalize one source level to what the op vocabulary admits, noting every drop or repair."""
    notes: list[str] = []

    def in_bounds(cell: Position) -> bool:
        return 0 <= cell[0] < level.width and 0 <= cell[1] < level.height

    edges: dict[str, Edge] = {}
    for key, edge in level.edges.items():
        incident = canonical_edge_cells(key)
        if incident is None:
            notes.append(f"dropped edge entry {key!r}: not osrlib's canonical form, so it is never consulted")
            continue
        if not all(in_bounds(cell) for cell in incident):
            notes.append(f"dropped edge entry {key!r}: it references an out-of-bounds cell")
            continue
        if edge.kind is EdgeKind.WALL:
            notes.append(f"dropped edge entry {key!r}: an explicit wall entry — an absent edge is already a wall")
            continue
        edges[key] = edge

    # A rename never lands on an id a later area legitimately holds: the
    # candidate pool spans every authored id plus every id already assigned.
    taken = {area.id for area in level.areas}
    used: set[str] = set()
    areas: list[ImportedArea] = []
    for area in level.areas:
        cells = tuple(cell for cell in area.cells if in_bounds(cell))
        dropped = len(area.cells) - len(cells)
        if not cells:
            notes.append(f"dropped area {area.id!r}: every cell is out of bounds")
            continue
        if dropped:
            notes.append(f"dropped {dropped} out-of-bounds cell(s) from area {area.id!r}")
        area_id, reason = repair_area_id(area.id, used, taken)
        if reason is not None:
            notes.append(f"renamed area {area.id!r} to {area_id!r} ({reason}); geometry preserved")
        used.add(area_id)
        areas.append(ImportedArea(id=area_id, name=area.name, description=area.description, cells=cells))

    entrance = level.entrance
    if entrance is not None and not in_bounds(entrance):
        notes.append(f"dropped the entrance at {entrance}: out of bounds")
        entrance = None

    transitions: list[TransitionSpec] = []
    occupied: set[Position] = set()
    for transition in level.transitions:
        if not in_bounds(transition.position):
            # The target may dangle — that stays, per the op's own rule; only
            # an out-of-bounds *source* is undrawable and unaddable.
            notes.append(f"dropped the {transition.kind} at {transition.position}: its source cell is out of bounds")
            continue
        if transition.position in occupied:
            notes.append(
                f"dropped the {transition.kind} at {transition.position}: a transition already occupies the cell "
                "(osrlib resolves the first match)"
            )
            continue
        occupied.add(transition.position)
        transitions.append(transition)

    return ImportedLevel(
        label=label,
        width=level.width,
        height=level.height,
        edges=edges,
        areas=tuple(areas),
        entrance=entrance,
        transitions=tuple(transitions),
        notes=tuple(notes),
    )
