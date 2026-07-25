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

The converters that ship in the wheel live beside this module:
[`ProjectImporter`][osreditor.importers.project.ProjectImporter] for another
editor project and [`OPDImporter`][osreditor.importers.watabou.OPDImporter] for
Watabou's One Page Dungeon JSON. Nothing here knows either format — a bundled
converter is one that met the bar (broadly useful, permissively licensed,
parseable with no new dependency), not one with a private path into the editor.
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
    "next_free_key",
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


def next_free_key(taken: set[str]) -> str:
    """The smallest positive integer, as a string, not in `taken`.

    Every importer needs the same repair: `CreateArea` rejects a duplicate or
    empty `area_id` at apply and the batch is atomic, so a payload carrying two
    areas with one id would 422 the whole import with no path forward. The rule
    belongs to [`ImportedArea`][osreditor.importers.ImportedArea]'s id
    contract, not to any one format.

    Args:
        taken: Every id already spoken for — authored and assigned both, so a
            rename never lands on an id a later area legitimately holds.

    Returns:
        The next free key.
    """
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
