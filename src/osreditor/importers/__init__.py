"""The geometry importer seam: the protocol, the payload, and discovery.

Import is a seam, not a feature list. A
[`GeometryImporter`][osreditor.importers.GeometryImporter] is a small protocol
— a `format_id`, a label, a cheap presence-level `sniff`, and a `load`
returning the editor-defined
[`ImportedGeometry`][osreditor.importers.ImportedGeometry] payload. Importers
register through the `osreditor.importers` entry-point group, so a converter
for any map format is an installable package that never touches editor code;
the built-in converters register through that same public group — dogfooding
the seam is what keeps the protocol honest. Imported geometry lands as ordinary
op batches built by the frontend's import dialog — undoable, revision-guarded,
immediately linted — and the backend contributes no special apply path.

Two converters ship in the wheel — `project.py` and `watabou.py`, beside this
module. Neither is imported here and neither has a private path into the
editor: both are discovered through the entry-point group, exactly as a
third-party package would be. Bundling is a distribution decision, not an
architectural one, and the bar is the spec's: a format bundles when it is
broadly useful, permissively licensed, and parseable with no new dependency.
"""

import logging
from importlib import metadata
from pathlib import Path
from typing import Protocol, runtime_checkable

from osrlib.crawl.dungeon import Edge, Position, TransitionSpec
from pydantic import BaseModel, ConfigDict, Field

__all__ = [
    "ENTRY_POINT_GROUP",
    "GeometryImporter",
    "ImportedArea",
    "ImportedGeometry",
    "ImportedLevel",
    "discover_importers",
    "repair_area_id",
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


def repair_area_id(candidate: str, used: set[str], taken: set[str]) -> tuple[str, str | None]:
    """The id an area may safely carry, plus the reason it differs from the source's own.

    `CreateArea` rejects three ids at apply — an empty one, a duplicate, and
    (in a forge-backed project, whose area keys are `<dungeon>/<level>/<key>`)
    one carrying a slash — and an import batch is atomic, so any of the three
    would 422 a whole import with no path forward. Every importer meets the
    same three, so the repair belongs to
    [`ImportedArea`][osreditor.importers.ImportedArea]'s id contract rather
    than to any one format.

    Args:
        candidate: The source's own id.
        used: The ids already assigned on this level.
        taken: Every id the source authored, so a rename never lands on one a
            later area legitimately holds.

    Returns:
        The id to use, and the reason it had to change — `None` when the
        source's own id stands.
    """
    if not candidate:
        reason = "empty id"
    elif "/" in candidate:
        reason = "'/' is not addressable in a forge-backed project"
    elif candidate in used:
        reason = f"duplicate of area {candidate!r}"
    else:
        return candidate, None
    return _next_free_key(taken | used), reason


def _next_free_key(taken: set[str]) -> str:
    """The smallest positive integer, as a string, not in `taken`."""
    candidate = 1
    while str(candidate) in taken:
        candidate += 1
    return str(candidate)


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
