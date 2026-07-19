"""The geometry importer seam: the protocol, the payload, discovery, and import-from-project.

Import is a seam, not a feature list. A
[`GeometryImporter`][osreditor.importers.GeometryImporter] is a small protocol
— a `format_id`, a label, a cheap presence-level `sniff`, and a `load`
returning the editor-defined
[`ImportedGeometry`][osreditor.importers.ImportedGeometry] payload. Importers
register through the `osreditor.importers` entry-point group, so a converter
for any map format is an installable package that never touches editor code;
the built-in import-from-project importer is itself the first implementation,
registered through that same group — dogfooding the seam is what keeps the
protocol honest. Imported geometry lands as ordinary op batches built by the
frontend's import dialog — undoable, revision-guarded, immediately linted —
and the backend contributes no special apply path.

Phase 2's dialog ignores `title`/`description` — adoption UX belongs with a
converter whose sources carry meaningful metadata (Watabou); the payload is
complete now so that converter is an installable package, not an editor change.
"""

import logging
from importlib import metadata
from pathlib import Path
from typing import Protocol, runtime_checkable

from osrlib.crawl.dungeon import Edge, EdgeKind, LevelSpec, Position, TransitionSpec
from pydantic import BaseModel, ConfigDict, Field

from osreditor.documents import ADVENTURE_ARTIFACT, canonical_edge_cells, load_adventure
from osreditor.errors import ImportSourceInvalidError

__all__ = [
    "ENTRY_POINT_GROUP",
    "GeometryImporter",
    "ImportedArea",
    "ImportedGeometry",
    "ImportedLevel",
    "ProjectImporter",
    "discover_importers",
]

logger = logging.getLogger(__name__)

ENTRY_POINT_GROUP = "osreditor.importers"


class ImportedArea(BaseModel):
    """One keyed area an importer offers: identity plus its cell cluster."""

    model_config = ConfigDict(frozen=True)

    id: str
    name: str = ""
    description: str = ""
    cells: tuple[Position, ...] = Field(min_length=1)


class ImportedLevel(BaseModel):
    """One level of imported geometry, normalized to what the op vocabulary admits.

    `label` is the source-side display name (which level of which source this
    was). `edges` carries canonical keys only — the importer owns
    normalization. `notes` is the importer flagging what it guessed, dropped,
    or repaired, rendered in the import dialog.
    """

    model_config = ConfigDict(frozen=True)

    label: str
    width: int = Field(ge=1)
    height: int = Field(ge=1)
    edges: dict[str, Edge] = {}
    areas: tuple[ImportedArea, ...] = ()
    entrance: Position | None = None
    transitions: tuple[TransitionSpec, ...] = ()
    notes: tuple[str, ...] = ()


class ImportedGeometry(BaseModel):
    """An importer's whole answer: optional adoptable metadata plus one or more levels."""

    model_config = ConfigDict(frozen=True)

    title: str | None = None
    description: str | None = None
    levels: tuple[ImportedLevel, ...] = Field(min_length=1)


@runtime_checkable
class GeometryImporter(Protocol):
    """A geometry importer: format identity, a cheap sniff, and a load.

    `sniff` is presence-level and never loads — it answers "does this path
    look like my format". `load` produces the payload or raises
    [`ImportSourceInvalidError`][osreditor.errors.ImportSourceInvalidError]
    with a human message on anything unloadable.
    """

    format_id: str
    label: str

    def sniff(self, path: Path) -> bool:
        """Report whether the path looks like this importer's format.

        Args:
            path: The absolute source path.

        Returns:
            True when the format is recognized at presence level.
        """
        ...

    def load(self, path: Path) -> ImportedGeometry:
        """Load geometry from the source path.

        Args:
            path: The absolute source path.

        Returns:
            The imported geometry, normalized to what the op vocabulary admits.

        Raises:
            ImportSourceInvalidError: On anything unloadable, with a human
                message.
        """
        ...


def discover_importers() -> dict[str, GeometryImporter]:
    """Build the importer registry from the `osreditor.importers` entry-point group.

    Each entry point is a zero-arg callable returning an importer instance. A
    broken entry point logs a warning and is skipped — a third-party package
    must never break boot — and a duplicate `format_id` keeps the first
    registration, so no package can shadow another's format.

    Returns:
        The registry, keyed by `format_id`, in entry-point order.
    """
    importers: dict[str, GeometryImporter] = {}
    for entry in metadata.entry_points(group=ENTRY_POINT_GROUP):
        try:
            importer = entry.load()()
        except Exception:
            logger.warning("geometry importer entry point %r failed to load; skipping", entry.name, exc_info=True)
            continue
        if not isinstance(importer, GeometryImporter):
            logger.warning("entry point %r did not produce a GeometryImporter; skipping", entry.name)
            continue
        if importer.format_id in importers:
            logger.warning(
                "entry point %r duplicates importer format %r; keeping the first registration",
                entry.name,
                importer.format_id,
            )
            continue
        importers[importer.format_id] = importer
    return importers


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


def _next_free_key(taken: set[str]) -> str:
    """The smallest positive integer, as a string, not in `taken` — the shared next-free-key rule."""
    candidate = 1
    while str(candidate) in taken:
        candidate += 1
    return str(candidate)


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
        area_id = area.id
        if not area_id or area_id in used:
            area_id = _next_free_key(taken | used)
            reason = "empty id" if not area.id else f"duplicate of area {area.id!r}"
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
