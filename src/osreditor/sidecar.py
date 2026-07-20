"""The `editor.json` sidecar: models, load, and the artifact name.

The sidecar is editor-only data beside the deliverable — provenance, view
state, per-entity author notes, forge review marks, and the machine-draft
reason ledger. It lives in its own module because both the project layer
(create, open, detach) and the document service (the note cascade, the forge
commit protocol's `auto_reasons`) consume it, and the service must not import
the project layer.
"""

import json

from pydantic import BaseModel, ConfigDict, ValidationError

from osreditor.errors import ArtifactNotFoundError, DocumentPayloadInvalidError
from osreditor.store import ProjectStore

__all__ = [
    "SIDECAR_ARTIFACT",
    "SIDECAR_SCHEMA_VERSION",
    "EditorSidecar",
    "ReviewMark",
    "SidecarProvenance",
    "ViewState",
    "ZoomPan",
    "load_sidecar",
]

SIDECAR_ARTIFACT = "editor.json"
SIDECAR_SCHEMA_VERSION = 1


class SidecarProvenance(BaseModel):
    """Who created the project and against which engine — written once at create.

    `source_workdir` and `osrforge_version` are the detach record: the workdir
    a detached project came from and the forge version (from the workdir's
    `RunMeta`) that converted it. Additive and optional — a created-from-scratch
    project has no conversion to record.
    """

    model_config = ConfigDict(frozen=True)

    created_by: str
    osrlib_version: str
    created_at: str
    source_workdir: str | None = None
    osrforge_version: str | None = None


class ZoomPan(BaseModel):
    """One level's persisted camera: zoom factor plus pan offset in canvas pixels."""

    model_config = ConfigDict(frozen=True)

    zoom: float
    pan_x: float
    pan_y: float


class ViewState(BaseModel):
    """Where a session left off: the active level, per-level cameras, the review queue's selected row.

    `zoom_pan` is keyed by the level address (the diagnostics address grammar);
    `review_selection` is the selected review row's address, `""` for the
    module-scope row, `None` when no row is selected. Writes coalesce on the
    frontend — navigation transitions, never per pointer frame.
    """

    model_config = ConfigDict(frozen=True)

    active_dungeon_id: str | None = None
    active_level_number: int | None = None
    zoom_pan: dict[str, ZoomPan] = {}
    review_selection: str | None = None


class ReviewMark(BaseModel):
    """One dismissed review flag: the area address (`""` for module scope) and the exact flag string.

    Keyed by the exact flag string so a mark survives re-assembly for as long
    as the flag it answered does, and goes dormant with the flag when a
    correction clears it. Forge-only; the report's flags have no native
    counterpart.
    """

    model_config = ConfigDict(frozen=True)

    address: str
    flag: str


class EditorSidecar(BaseModel):
    """The `editor.json` envelope: editor-only data beside the deliverable.

    The envelope is a shipped contract, additive-only within its schema
    version. Phase 1 wrote only provenance; phase 5 grows `view_state`,
    per-entity `notes`, forge `review` marks, and `auto_reasons` — absent
    fields default empty, so every existing sidecar and every foreign project
    reads clean. `provenance` is optional (an additive relaxation: a required
    field made optional never breaks an existing reader) because a foreign
    project the editor merely opens has no provenance to claim; its first note
    persists a sidecar with `provenance=None`, honest about what the editor
    did and didn't author.

    Open tolerates a missing sidecar (foreign native projects open fine); the
    file is written on the first sidecar-bearing write, never at open. `notes`
    is keyed by the diagnostics address grammar and exists for both project
    types; `review` and `auto_reasons` are forge-only — `auto_reasons` holds
    the kind-qualified override-entry keys whose reason is still a machine
    draft, and rides the forge undo stack with the `overrides.yaml` snapshot
    (derived state of the same commit).
    """

    model_config = ConfigDict(frozen=True)

    schema_version: int = SIDECAR_SCHEMA_VERSION
    provenance: SidecarProvenance | None = None
    view_state: ViewState = ViewState()
    notes: dict[str, str] = {}
    review: tuple[ReviewMark, ...] = ()
    auto_reasons: tuple[str, ...] = ()


def load_sidecar(store: ProjectStore, project_id: str) -> EditorSidecar:
    """Load a project's sidecar; a missing file is the empty sidecar.

    A malformed sidecar fails the open rather than silently starting empty:
    the sidecar holds author notes — user data, not a convenience cache — and
    the first sidecar-bearing write would otherwise destroy whatever the
    malformed file held.

    Args:
        store: The store to read through.
        project_id: The project to read.

    Returns:
        The parsed sidecar, or `EditorSidecar()` when the project has none.

    Raises:
        DocumentPayloadInvalidError: If `editor.json` exists but does not
            parse as the sidecar contract.
    """
    try:
        data = store.read_artifact(project_id, SIDECAR_ARTIFACT)
    except ArtifactNotFoundError:
        return EditorSidecar()
    try:
        return EditorSidecar.model_validate(json.loads(data))
    except (ValueError, ValidationError) as error:
        raise DocumentPayloadInvalidError(
            f"the editor sidecar ({SIDECAR_ARTIFACT}) is malformed: {error}",
            errors=[{"path": "", "message": str(error)}],
        ) from error
