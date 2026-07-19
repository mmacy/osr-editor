"""The `editor.json` sidecar: editor-only data beside the deliverable.

The sidecar is a shipped contract, additive-only within its schema version. It
lives in its own module — not `projects.py` — so the forge commit protocol in
`documents.py` can persist it without importing the higher project layer.

Phase 1 wrote only provenance. Phase 5 grows the envelope with view state,
per-entity author notes, forge review marks, and the machine-draft reason set —
every field additive and defaulted empty, so every existing sidecar and every
foreign project reads clean. `provenance` becomes optional: a foreign project the
editor merely opens has none to claim, and the server still answers a sidecar for
it (an in-memory default). The file is written on the first sidecar-bearing
write, never at open.
"""

from pydantic import BaseModel, ConfigDict

from osreditor.errors import ArtifactNotFoundError
from osreditor.serialize import canonical_json_bytes
from osreditor.store import ProjectStore

__all__ = [
    "SIDECAR_ARTIFACT",
    "SIDECAR_SCHEMA_VERSION",
    "EditorSidecar",
    "LevelViewState",
    "ReviewMark",
    "SidecarProvenance",
    "ViewState",
    "read_sidecar",
    "write_sidecar",
]

SIDECAR_ARTIFACT = "editor.json"
SIDECAR_SCHEMA_VERSION = 1


class SidecarProvenance(BaseModel):
    """Who created the project and against which engine — written once at create.

    `source_workdir` and `osrforge_version` are additive: a native project
    detached from a forge workdir records where it came from and the forge
    version that assembled it. A project created natively leaves both `None`.
    """

    model_config = ConfigDict(frozen=True)

    created_by: str
    osrlib_version: str
    created_at: str
    source_workdir: str | None = None
    osrforge_version: str | None = None


class LevelViewState(BaseModel):
    """One level's remembered zoom and pan, keyed by its level address."""

    model_config = ConfigDict(frozen=True)

    zoom: float = 1.0
    pan_x: float = 0.0
    pan_y: float = 0.0


class ViewState(BaseModel):
    """Where a correction session left off: active level, per-level view, selected review row.

    Writes coalesce on navigation transitions, never per pointer frame — the
    surface that finally earns the sidecar's view writes is resuming correction
    work across sessions.
    """

    model_config = ConfigDict(frozen=True)

    active_dungeon_id: str | None = None
    active_level_number: int | None = None
    levels: dict[str, LevelViewState] = {}
    selected_review_row: str | None = None


class ReviewMark(BaseModel):
    """One dismissed review flag: the address it sits at and the exact flag string.

    Keyed by the exact flag string so a mark survives re-assembly for as long as
    the flag it answered does, and goes dormant with the flag when a correction
    clears it. `address` is `""` for a module-scope flag.
    """

    model_config = ConfigDict(frozen=True)

    address: str
    flag: str


class EditorSidecar(BaseModel):
    """The `editor.json` envelope: editor-only data beside the deliverable.

    Native create writes provenance; open never rewrites an existing sidecar,
    and the first sidecar-bearing write persists one honestly recording what the
    editor did and didn't author (a foreign project's first note persists a
    sidecar with `provenance=None`).
    """

    model_config = ConfigDict(frozen=True)

    schema_version: int = SIDECAR_SCHEMA_VERSION
    provenance: SidecarProvenance | None = None
    view_state: ViewState = ViewState()
    notes: dict[str, str] = {}
    review: tuple[ReviewMark, ...] = ()
    auto_reasons: tuple[str, ...] = ()


def read_sidecar(store: ProjectStore, project_id: str) -> EditorSidecar:
    """Read a project's sidecar, or an empty in-memory one when there is none on disk.

    The server always answers a sidecar: a project with no `editor.json` (a
    foreign native project, a fresh forge workdir) reads as a default
    `EditorSidecar` — provenance `None`, every field empty. A malformed sidecar
    is not silently reset here (unlike the config cache): the sidecar is project
    data, so a parse failure propagates rather than discarding notes.

    Args:
        store: The store to read through.
        project_id: The project to read.

    Returns:
        The parsed sidecar, or a default one when absent.
    """
    try:
        data = store.read_artifact(project_id, SIDECAR_ARTIFACT)
    except ArtifactNotFoundError:
        return EditorSidecar()
    return EditorSidecar.model_validate_json(data)


def write_sidecar(store: ProjectStore, project_id: str, sidecar: EditorSidecar) -> None:
    """Write a project's sidecar in the canonical byte format.

    Args:
        store: The store to write through.
        project_id: The project to write into.
        sidecar: The sidecar to persist.
    """
    store.write_artifact(project_id, SIDECAR_ARTIFACT, canonical_json_bytes(sidecar.model_dump(mode="json")))
