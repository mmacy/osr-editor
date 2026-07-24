"""The FastAPI app: routes, the auth seam, the error envelope, and the CLI entry point.

Every `/api` route resolves its caller through the single auth dependency
([`get_current_user`][osreditor.app.get_current_user]), whose shipped
implementation returns the local user unconditionally. The seam exists so a
hosted future changes one function, not every handler; no other code assumes
there is exactly one user, and a route-introspection test enforces the seam.

Error responses share one structured envelope ([`ApiError`][osreditor.app.ApiError]):
a stable snake_case `code`, a `message`, and optional `remedy` and `details`.
Typed osrlib, osr-forge, and osr-editor errors map to it through exception
handlers; each phase maps the errors its routes can raise. Phase 1 maps the
project, ops, and load-time errors — including the pinned 409 `stale_revision`
body carrying `details.current_revision`.
"""

import argparse
import threading
import webbrowser
from collections.abc import Callable, Sequence
from importlib import metadata
from pathlib import Path
from typing import Annotated

import uvicorn
from fastapi import APIRouter, Depends, FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from osrlib.core.monsters import MonsterTemplate
from osrlib.crawl.adventure import Adventure
from osrlib.errors import ContentValidationError, SaveVersionError
from osrlib.versioning import SCHEMA_VERSION, engine_version
from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator

from osreditor.catalogs import (
    EncounterTableCatalogResponse,
    EquipmentCatalogResponse,
    MonsterCatalogResponse,
    TreasureTypeCatalogResponse,
    catalog_monster,
    encounter_table_catalog,
    equipment_catalog,
    monster_catalog,
    treasure_type_catalog,
)
from osreditor.config import RecentEntry, load_config, record_recent, save_config
from osreditor.documents import DocumentService, OpenProject, dump_adventure, forge_state_model, json_pointer
from osreditor.errors import (
    ArtifactNotFoundError,
    CatalogMonsterNotFoundError,
    DocumentPayloadInvalidError,
    ForgeOverrideInvalidError,
    ForgePageNotFoundError,
    ForgeRerunInvalidError,
    ForgeWorkdirIncompleteError,
    ForgeWorkdirInvalidError,
    ImporterNotFoundError,
    ImportSourceInvalidError,
    InvalidProjectError,
    OpInvariantError,
    OpRejectedError,
    OpTargetNotFoundError,
    OpUnsupportedForgeError,
    OsrWebCheckoutInvalidError,
    OsrWebNotConfiguredError,
    ProjectExistsError,
    ProjectNotForgeError,
    ProjectNotFoundError,
    ProjectPathNotFoundError,
    PublishBlockedError,
    PublishDestinationExistsError,
    RedoStackEmptyError,
    StaleRevisionError,
    UndoStackEmptyError,
)
from osreditor.importers import GeometryImporter, ImportedGeometry, discover_importers
from osreditor.ops import Diagnostics, ForgeState, OpBatch, OpBatchResult
from osreditor.overrides import AnyOverrideEdit, apply_override_edits
from osreditor.projects import create_native_project, detach_project, open_project, utc_now_iso
from osreditor.publish import PublishMode, PublishResult, check_osr_web_checkout, publish_adventure
from osreditor.sidecar import AnySidecarPatch, EditorSidecar
from osreditor.store import LocalProjectStore, atomic_write_bytes

__all__ = [
    "ApiError",
    "ApiErrorDetail",
    "CreateProjectRequest",
    "CurrentUser",
    "ExportRequest",
    "ExportResult",
    "ImporterInfo",
    "ImporterListResponse",
    "ImporterPathRequest",
    "OpenProjectRequest",
    "ProjectListResponse",
    "ProjectState",
    "PublishRequest",
    "RecentProject",
    "SniffResult",
    "StatusResponse",
    "User",
    "create_app",
    "get_current_user",
    "main",
]

DEFAULT_PORT = 8630
_STATIC_DIR = Path(__file__).parent / "static"


class User(BaseModel):
    """The authenticated caller of an API route."""

    model_config = ConfigDict(frozen=True)

    id: str


_LOCAL_USER = User(id="local")


def get_current_user() -> User:
    """Resolve the calling user — the single auth seam.

    The shipped implementation returns the local user unconditionally; a hosted
    future swaps this one function.

    Returns:
        The local user.
    """
    return _LOCAL_USER


CurrentUser = Annotated[User, Depends(get_current_user)]
"""The auth dependency every `/api` route declares."""


class StatusResponse(BaseModel):
    """The editor's identity and the engine it is running against."""

    model_config = ConfigDict(frozen=True)

    editor_version: str
    engine_version: str
    schema_version: int


class ApiErrorDetail(BaseModel):
    """The structured error payload: code, message, and optional remedy and details."""

    model_config = ConfigDict(frozen=True)

    code: str
    message: str
    remedy: str | None = None
    details: dict[str, object] | None = None


class ApiError(BaseModel):
    """The error envelope every API error response carries."""

    model_config = ConfigDict(frozen=True)

    error: ApiErrorDetail


class _AbsolutePathRequest(BaseModel):
    """Shared shape for requests naming a filesystem path: absolute, always."""

    model_config = ConfigDict(frozen=True)

    path: str

    @field_validator("path")
    @classmethod
    def _path_must_be_absolute(cls, value: str) -> str:
        if not Path(value).is_absolute():
            raise ValueError(f"path must be absolute, got {value!r}")
        return value


class CreateProjectRequest(_AbsolutePathRequest):
    """A new native project: where to put it and what to call the adventure."""

    name: str


class OpenProjectRequest(_AbsolutePathRequest):
    """An open-by-path request."""


class ExportRequest(_AbsolutePathRequest):
    """An export destination: an absolute file path of the user's choosing."""


class ExportResult(BaseModel):
    """Where the stamped document was written."""

    model_config = ConfigDict(frozen=True)

    path: str


class ImporterPathRequest(_AbsolutePathRequest):
    """An importer source path: absolute, read-only, local — the same honestly-local posture as export."""


class ImporterInfo(BaseModel):
    """One registered geometry importer's identity."""

    model_config = ConfigDict(frozen=True)

    format_id: str
    label: str


class ImporterListResponse(BaseModel):
    """The registered importers, in registry order."""

    model_config = ConfigDict(frozen=True)

    importers: tuple[ImporterInfo, ...]


class SniffResult(BaseModel):
    """Which registered importers recognize a source path."""

    model_config = ConfigDict(frozen=True)

    format_ids: tuple[str, ...]


class PublishRequest(BaseModel):
    """A publish request: the mode, plus optional name, overwrite, and first-use checkout path.

    `name` defaults server-side to the project directory's stem; when provided
    it must be a plain path component — path separators and the `.`/`..` forms
    surface as `request_invalid`, the phase 1 amendment's channel. There is no
    settings screen: `checkout_path` rides on the request when the dialog
    collects it, and the backend saves it once the shape test passes.
    """

    model_config = ConfigDict(frozen=True)

    mode: PublishMode = "symlink"
    name: str | None = None
    overwrite: bool = False
    checkout_path: str | None = None

    @field_validator("name")
    @classmethod
    def _name_must_be_a_plain_entry(cls, value: str | None) -> str | None:
        if value is None:
            return value
        if not value:
            raise ValueError("name must be non-empty")
        if value in (".", ".."):
            raise ValueError(f"name must not be {value!r}")
        if "/" in value or "\\" in value:
            raise ValueError("name must not contain path separators")
        return value

    @field_validator("checkout_path")
    @classmethod
    def _checkout_path_must_be_absolute(cls, value: str | None) -> str | None:
        if value is not None and not Path(value).is_absolute():
            raise ValueError(f"checkout_path must be absolute, got {value!r}")
        return value


class ForgeOverridesRequest(BaseModel):
    """A batch of override-level edits, computed against a named revision."""

    model_config = ConfigDict(frozen=True)

    revision: str
    edits: tuple[AnyOverrideEdit, ...] = Field(min_length=1)


class ForgeRerunRequest(BaseModel):
    """Assemble-stage rerun knobs — assembly-owned only in phase 5 (forge's guard is the backstop)."""

    model_config = ConfigDict(frozen=True)

    settings: dict[str, object] = {}


class DetachRequest(_AbsolutePathRequest):
    """The detach destination: a new native project directory."""


class SidecarPatchRequest(BaseModel):
    """A batch of sidecar patches — applied and saved atomically, deliberately not revision-guarded."""

    model_config = ConfigDict(frozen=True)

    patches: tuple[AnySidecarPatch, ...] = Field(min_length=1)


class RecentProject(BaseModel):
    """One recents entry, probed at read time.

    `missing` marks an entry whose path has vanished rather than silently
    dropping it — the user deleted or moved the directory; say so.
    """

    model_config = ConfigDict(frozen=True)

    path: str
    name: str
    type: str
    last_opened_at: str
    missing: bool


class ProjectListResponse(BaseModel):
    """The home screen's data: probed recents plus the CLI's launch path."""

    model_config = ConfigDict(frozen=True)

    recents: tuple[RecentProject, ...]
    open_at_launch: str | None


class ProjectState(BaseModel):
    """One open project's full state: the document, revision, and diagnostics.

    The full document rides on open/get only; batches answer with deltas.
    `forge` carries the review state for forge-backed projects (`None` for
    native); `sidecar` is always answered — an in-memory empty sidecar for a
    project with none on disk.
    """

    model_config = ConfigDict(frozen=True)

    id: str
    path: str
    type: str
    document: Adventure
    revision: str
    diagnostics: Diagnostics
    dropped_fields: tuple[str, ...]
    can_undo: bool
    can_redo: bool
    forge: ForgeState | None = None
    sidecar: EditorSidecar = EditorSidecar()


def _error_response(
    status_code: int, code: str, message: str, *, remedy: str | None = None, details: dict[str, object] | None = None
) -> JSONResponse:
    """Build a structured error response in the pinned envelope.

    Args:
        status_code: The HTTP status.
        code: The stable snake_case error code.
        message: What went wrong.
        remedy: What the user can do about it, when there is a known remedy.
        details: Structured data a client can act on (e.g. the current revision
            on a `stale_revision` rejection).

    Returns:
        The JSON response carrying an [`ApiError`][osreditor.app.ApiError] body.
    """
    body = ApiError(error=ApiErrorDetail(code=code, message=message, remedy=remedy, details=details))
    return JSONResponse(status_code=status_code, content=body.model_dump(mode="json"))


router = APIRouter()


def _service(request: Request) -> DocumentService:
    return request.app.state.service


def _project_state(project: OpenProject) -> ProjectState:
    with project.lock:
        return ProjectState(
            id=project.id,
            path=str(project.path),
            type=project.type,
            document=project.adventure,
            revision=project.revision,
            diagnostics=project.diagnostics,
            dropped_fields=project.dropped_fields,
            can_undo=bool(project.undo_stack),
            can_redo=bool(project.redo_stack),
            forge=forge_state_model(project),
            sidecar=project.sidecar,
        )


def _record_recent(project: OpenProject) -> None:
    """Push the just-opened project to the front of the recents list."""
    entry = RecentEntry(
        path=str(project.path),
        name=project.adventure.name,
        type=project.type,
        last_opened_at=utc_now_iso(),
    )
    save_config(record_recent(load_config(), entry))


@router.get("/api/status")
def get_status(user: CurrentUser) -> StatusResponse:
    """Report the editor and engine versions the backend is running.

    Args:
        user: The authenticated caller.

    Returns:
        The editor version, engine version, and schema version.
    """
    return StatusResponse(
        editor_version=_editor_version(),
        engine_version=engine_version(),
        schema_version=SCHEMA_VERSION,
    )


@router.get("/api/projects")
def list_projects(request: Request, user: CurrentUser) -> ProjectListResponse:
    """Report the probed recents list and the CLI's launch path.

    Args:
        request: The current request (carries the app state).
        user: The authenticated caller.

    Returns:
        The recents, most recent first, each probed for existence; plus the
        `PATH` the CLI was launched with, for the frontend to act on once per
        page load.
    """
    store = _service(request).store
    recents = tuple(
        RecentProject(
            path=entry.path,
            name=entry.name,
            type=entry.type,
            last_opened_at=entry.last_opened_at,
            missing=not store.project_exists(entry.path),
        )
        for entry in load_config().recents
    )
    return ProjectListResponse(recents=recents, open_at_launch=request.app.state.open_at_launch)


@router.post("/api/projects", status_code=201)
def create_project(request: Request, body: CreateProjectRequest, user: CurrentUser) -> ProjectState:
    """Create a native project and open it.

    Args:
        request: The current request (carries the app state).
        body: The absolute destination directory and the adventure name.
        user: The authenticated caller.

    Returns:
        The new project's full state.
    """
    service = _service(request)
    resolved = Path(body.path).resolve()
    create_native_project(service.store, str(resolved), body.name)
    project = open_project(service, resolved)
    _record_recent(project)
    return _project_state(project)


@router.post("/api/projects/open")
def open_project_by_path(request: Request, body: OpenProjectRequest, user: CurrentUser) -> ProjectState:
    """Open a project by path.

    Args:
        request: The current request (carries the app state).
        body: The absolute project directory path.
        user: The authenticated caller.

    Returns:
        The project's full state — the same project id for the same resolved
        path, however many tabs open it.
    """
    project = open_project(_service(request), Path(body.path))
    _record_recent(project)
    return _project_state(project)


@router.get("/api/projects/{project_id}")
def get_project(request: Request, project_id: str, user: CurrentUser) -> ProjectState:
    """Report one open project's full state.

    Args:
        request: The current request (carries the app state).
        project_id: The server-minted project id.
        user: The authenticated caller.

    Returns:
        The project's full state.
    """
    return _project_state(_service(request).get(project_id))


@router.post("/api/projects/{project_id}/ops")
def post_ops(request: Request, project_id: str, batch: OpBatch, user: CurrentUser) -> OpBatchResult:
    """Apply one atomic op batch at a named revision.

    Args:
        request: The current request (carries the app state).
        project_id: The server-minted project id.
        batch: The ops and the revision they were computed against.
        user: The authenticated caller.

    Returns:
        The new revision, the coalesced changed-subtree delta, and refreshed
        diagnostics.
    """
    service = _service(request)
    return service.apply_batch(service.get(project_id), batch)


@router.post("/api/projects/{project_id}/undo")
def post_undo(request: Request, project_id: str, user: CurrentUser) -> OpBatchResult:
    """Revert the latest commit.

    Args:
        request: The current request (carries the app state).
        project_id: The server-minted project id.
        user: The authenticated caller.

    Returns:
        The result, carrying the whole-document delta.
    """
    service = _service(request)
    return service.undo(service.get(project_id))


@router.post("/api/projects/{project_id}/redo")
def post_redo(request: Request, project_id: str, user: CurrentUser) -> OpBatchResult:
    """Re-apply the latest undone commit.

    Args:
        request: The current request (carries the app state).
        project_id: The server-minted project id.
        user: The authenticated caller.

    Returns:
        The result, carrying the whole-document delta.
    """
    service = _service(request)
    return service.redo(service.get(project_id))


def _require_forge(project: OpenProject) -> None:
    if project.forge is None:
        raise ProjectNotForgeError(f"project {project.id} is not forge-backed")


@router.post("/api/projects/{project_id}/forge/overrides")
def post_forge_overrides(
    request: Request, project_id: str, body: ForgeOverridesRequest, user: CurrentUser
) -> OpBatchResult:
    """Apply a batch of override-level edits through the forge commit protocol.

    Monster remaps, printed-notation stat-block patches, reason editing, and
    entry removal — the corrections that address extracted names or the
    overrides file itself rather than the document. One atomic batch, one undo
    step; forge's cache-membership checks are the honest backstop, surfaced
    verbatim on failure with the snapshot restored.

    Args:
        request: The current request (carries the app state).
        project_id: The server-minted project id.
        body: The edits and the revision they were computed against.
        user: The authenticated caller.

    Returns:
        The envelope with the whole-document delta and refreshed forge state.
    """
    service = _service(request)
    project = service.get(project_id)
    _require_forge(project)
    with project.lock:
        forge = project.forge
        assert forge is not None
        translation = apply_override_edits(body.edits, forge.overrides, frozenset(project.sidecar.auto_reasons))
    return service.commit_forge_translation(project, body.revision, translation)


@router.post("/api/projects/{project_id}/forge/check")
def post_forge_check(request: Request, project_id: str, user: CurrentUser) -> OpBatchResult:
    """Run forge's on-demand playability check and refresh the forge tier.

    Args:
        request: The current request (carries the app state).
        project_id: The server-minted project id.
        user: The authenticated caller.

    Returns:
        The envelope — same revision (the document is unchanged), refreshed
        forge tier and `checked` state.
    """
    service = _service(request)
    project = service.get(project_id)
    _require_forge(project)
    return service.apply_check(project)


@router.post("/api/projects/{project_id}/forge/rerun")
def post_forge_rerun(request: Request, project_id: str, body: ForgeRerunRequest, user: CurrentUser) -> OpBatchResult:
    """Re-run the assemble stage with optional assembly-owned knob updates.

    Args:
        request: The current request (carries the app state).
        project_id: The server-minted project id.
        body: The knob updates (empty for a plain re-assembly).
        user: The authenticated caller.

    Returns:
        The envelope with the whole-document delta and refreshed forge state.
    """
    service = _service(request)
    project = service.get(project_id)
    _require_forge(project)
    try:
        return service.apply_rerun(project, body.settings)
    except ValidationError as error:
        # Forge's own settings validation: an unknown knob or a bad value is a
        # malformed request, answered in the one envelope.
        raise RequestValidationError(error.errors()) from error


@router.post("/api/projects/{project_id}/forge/detach")
def post_forge_detach(request: Request, project_id: str, body: DetachRequest, user: CurrentUser) -> ProjectState:
    """Detach: write the assembled document as a new native project and open it.

    Args:
        request: The current request (carries the app state).
        project_id: The server-minted project id.
        body: The new native project directory, absolute.
        user: The authenticated caller.

    Returns:
        The new native project's full state; the workdir is untouched and
        drops from the open registry.
    """
    service = _service(request)
    project = service.get(project_id)
    _require_forge(project)
    detached = detach_project(service, project, Path(body.path))
    _record_recent(detached)
    return _project_state(detached)


_PAGE_MEDIA_TYPE = "image/png"
_PREVIEW_MEDIA_TYPE = "image/svg+xml"


@router.get("/api/projects/{project_id}/forge/pages/{page_number}")
def get_forge_page(request: Request, project_id: str, page_number: int, user: CurrentUser) -> Response:
    """Serve one workdir page render through the store.

    Args:
        request: The current request (carries the app state).
        project_id: The server-minted project id.
        page_number: The 1-based page number.
        user: The authenticated caller.

    Returns:
        The PNG bytes.
    """
    service = _service(request)
    project = service.get(project_id)
    _require_forge(project)
    if page_number < 1:
        raise ForgePageNotFoundError(f"the workdir has no page render {page_number}")
    try:
        data = service.store.read_artifact(str(project.path), f"pages/{page_number:04d}.png")
    except ArtifactNotFoundError as error:
        # A licensed subset or lean workdir is normal — the pane renders the
        # absence, never an error toast.
        raise ForgePageNotFoundError(f"the workdir has no page render {page_number}") from error
    return Response(content=data, media_type=_PAGE_MEDIA_TYPE)


@router.get("/api/projects/{project_id}/forge/previews/{dungeon_id}/{level_number}")
def get_forge_preview(
    request: Request, project_id: str, dungeon_id: str, level_number: int, user: CurrentUser
) -> Response:
    """Serve one level's SVG preview through the store.

    Args:
        request: The current request (carries the app state).
        project_id: The server-minted project id.
        dungeon_id: The dungeon id (forge's canonical slug).
        level_number: The 1-based level number.
        user: The authenticated caller.

    Returns:
        The SVG bytes — forge's own rendering of the corrected plan.
    """
    service = _service(request)
    project = service.get(project_id)
    _require_forge(project)
    if not dungeon_id or "/" in dungeon_id or "\\" in dungeon_id or dungeon_id in (".", ".."):
        raise ForgePageNotFoundError(f"the workdir has no preview for dungeon {dungeon_id!r}")
    try:
        data = service.store.read_artifact(str(project.path), f"previews/{dungeon_id}.{level_number}.svg")
    except ArtifactNotFoundError as error:
        raise ForgePageNotFoundError(f"the workdir has no preview for {dungeon_id} level {level_number}") from error
    return Response(content=data, media_type=_PREVIEW_MEDIA_TYPE)


@router.post("/api/projects/{project_id}/sidecar")
def post_sidecar_patch(
    request: Request, project_id: str, body: SidecarPatchRequest, user: CurrentUser
) -> EditorSidecar:
    """Apply typed sidecar patches — view state, notes, review marks — atomically.

    Args:
        request: The current request (carries the app state).
        project_id: The server-minted project id.
        body: The patches, in order.
        user: The authenticated caller.

    Returns:
        The new sidecar state.
    """
    service = _service(request)
    return service.apply_sidecar_patch(service.get(project_id), body.patches)


@router.post("/api/projects/{project_id}/export")
def export_project(request: Request, project_id: str, body: ExportRequest, user: CurrentUser) -> ExportResult:
    """Write the current document's stamped bytes to a user-chosen path.

    Export never gates on validation — that gate belongs to publish (phase 3);
    export is "write the stamped JSON anywhere". Overwriting an existing file is
    an explicit, user-invoked act on a user-chosen destination — the licensing
    rule's named exception. The write is direct rather than through the
    `ProjectStore` because the destination is an arbitrary user filesystem path
    outside any project, which is not what the store seam abstracts; a hosted
    future replaces this one handler with a download response.

    Args:
        request: The current request (carries the app state).
        project_id: The server-minted project id.
        body: The absolute destination file path.
        user: The authenticated caller.

    Returns:
        The written path.
    """
    service = _service(request)
    project = service.get(project_id)
    with project.lock:
        data = _document_bytes(service, project)
    atomic_write_bytes(Path(body.path), data)
    return ExportResult(path=body.path)


def _document_bytes(service: DocumentService, project: OpenProject) -> bytes:
    """The current document's stamped bytes — forge's verbatim, the editor's canonical.

    A workdir's `adventure.json` is forge's byte contract (stamped,
    byte-stable); re-serializing it through the editor's canonical serializer
    would claim authorship of bytes forge owns. Callers hold the project lock.
    """
    if project.forge is not None:
        return service.store.read_artifact(str(project.path), "adventure.json")
    return dump_adventure(project.adventure)


@router.post("/api/projects/{project_id}/publish")
def publish_project(request: Request, project_id: str, body: PublishRequest, user: CurrentUser) -> PublishResult:
    """Publish the current document into an osr-web checkout's `adventures/` directory.

    Publish gates on validation and only validation: the tier is recomputed on
    every commit, so the check reads fresh state, and lint never blocks
    server-side — the frontend confirms when lint findings exist, because
    secret-only access is sometimes the point. The checkout path is validated
    and saved to config before the destination attempt, so a later collision
    never costs the user their typed path. Honestly local, like export: a
    symlink into a user checkout is the single-user posture, and a hosted
    future replaces this one handler.

    Args:
        request: The current request (carries the app state).
        project_id: The server-minted project id.
        body: The mode, plus optional name, overwrite, and checkout path.
        user: The authenticated caller.

    Returns:
        The published path and mode.
    """
    service = _service(request)
    project = service.get(project_id)
    config = load_config()
    checkout_value = body.checkout_path or config.osr_web_checkout
    if checkout_value is None:
        raise OsrWebNotConfiguredError("no osr-web checkout is configured")
    checkout = Path(checkout_value)
    check_osr_web_checkout(checkout)
    if body.checkout_path is not None and body.checkout_path != config.osr_web_checkout:
        save_config(config.model_copy(update={"osr_web_checkout": body.checkout_path}))
    name = body.name if body.name is not None else project.path.stem
    with project.lock:
        findings = project.diagnostics.validation
        if findings:
            raise PublishBlockedError(
                "the document has validation findings; publish requires a clean validation tier",
                findings=[finding.model_dump(mode="json") for finding in findings],
            )
        document = _document_bytes(service, project)
    return publish_adventure(
        checkout=checkout,
        project_path=project.path,
        document=document,
        name=name,
        mode=body.mode,
        overwrite=body.overwrite,
    )


@router.get("/api/catalogs/monsters")
def get_monster_catalog(user: CurrentUser) -> MonsterCatalogResponse:
    """Report the shipped monster catalog as picker summaries.

    Args:
        user: The authenticated caller.

    Returns:
        Every shipped monster, in shipped order.
    """
    return monster_catalog()


@router.get("/api/catalogs/monsters/{monster_id}")
def get_catalog_monster(monster_id: str, user: CurrentUser) -> MonsterTemplate:
    """Report one shipped monster's full stat block — the clone-and-modify source.

    Args:
        monster_id: The shipped monster id.
        user: The authenticated caller.

    Returns:
        The full template, verbatim from the shipped data.
    """
    return catalog_monster(monster_id)


@router.get("/api/catalogs/equipment")
def get_equipment_catalog(user: CurrentUser) -> EquipmentCatalogResponse:
    """Report the pickable equipment items.

    Args:
        user: The authenticated caller.

    Returns:
        Every item across the four id-addressable lists, in list order.
    """
    return equipment_catalog()


@router.get("/api/catalogs/treasure-types")
def get_treasure_type_catalog(user: CurrentUser) -> TreasureTypeCatalogResponse:
    """Report the shipped treasure types.

    Args:
        user: The authenticated caller.

    Returns:
        Every treasure-type letter with its section.
    """
    return treasure_type_catalog()


@router.get("/api/catalogs/encounter-tables")
def get_encounter_table_catalog(user: CurrentUser) -> EncounterTableCatalogResponse:
    """Report the six compiled dungeon encounter tables.

    Args:
        user: The authenticated caller.

    Returns:
        The compiled tables, verbatim — the wandering-table editor seeds from
        the level's band table.
    """
    return encounter_table_catalog()


def _importers(request: Request) -> dict[str, GeometryImporter]:
    registry: dict[str, GeometryImporter] = request.app.state.importers
    return registry


def _safe_sniff(importer: GeometryImporter, path: Path) -> bool:
    """Probe one importer defensively — a third-party sniff that raises is a non-match, never a 500."""
    try:
        return bool(importer.sniff(path))
    except Exception:
        return False


@router.get("/api/importers")
def list_importers(request: Request, user: CurrentUser) -> ImporterListResponse:
    """Report the registered geometry importers.

    Args:
        request: The current request (carries the app state).
        user: The authenticated caller.

    Returns:
        Every importer discovered through the `osreditor.importers` entry-point
        group, in registry order.
    """
    return ImporterListResponse(
        importers=tuple(
            ImporterInfo(format_id=importer.format_id, label=importer.label)
            for importer in _importers(request).values()
        )
    )


@router.post("/api/importers/sniff")
def sniff_importers(request: Request, body: ImporterPathRequest, user: CurrentUser) -> SniffResult:
    """Probe a source path against every registered importer.

    Sniff never errors: a nonexistent or unrecognized path answers an empty
    match list — presence-level probing has nothing to throw — and the dialog
    renders zero matches as an inline message.

    Args:
        request: The current request (carries the app state).
        body: The absolute source path.
        user: The authenticated caller.

    Returns:
        The format ids that recognize the path.
    """
    path = Path(body.path)
    return SniffResult(
        format_ids=tuple(
            format_id for format_id, importer in _importers(request).items() if _safe_sniff(importer, path)
        )
    )


@router.post("/api/importers/{format_id}/load")
def load_geometry(request: Request, format_id: str, body: ImporterPathRequest, user: CurrentUser) -> ImportedGeometry:
    """Load geometry from a source path through one importer.

    Import needs no apply route: the loaded geometry crosses to the frontend,
    and the import dialog turns the user's choices into one ordinary op batch
    through `POST /projects/{id}/ops` — undoable, revision-guarded,
    immediately linted.

    Args:
        request: The current request (carries the app state).
        format_id: The importer to load through.
        body: The absolute source path.
        user: The authenticated caller.

    Returns:
        The imported geometry, normalized to what the op vocabulary admits.
    """
    importer = _importers(request).get(format_id)
    if importer is None:
        raise ImporterNotFoundError(f"no registered geometry importer has format id {format_id!r}")
    return importer.load(Path(body.path))


def _details_none(error: Exception) -> dict[str, object] | None:
    return None


def _details_stale_revision(error: Exception) -> dict[str, object] | None:
    assert isinstance(error, StaleRevisionError)
    return {"current_revision": error.current_revision}


def _details_op_rejected(error: Exception) -> dict[str, object] | None:
    assert isinstance(error, OpRejectedError)
    return {"errors": error.errors}


def _details_op_invariant(error: Exception) -> dict[str, object] | None:
    assert isinstance(error, OpInvariantError)
    if error.offenders is None:
        return None
    return {"offenders": error.offenders}


def _details_op_unsupported_forge(error: Exception) -> dict[str, object] | None:
    assert isinstance(error, OpUnsupportedForgeError)
    return {"op": error.op, "address": error.address}


_MAX_REPORTED_LOCATIONS = 10


def _details_payload_invalid(error: Exception) -> dict[str, object] | None:
    assert isinstance(error, DocumentPayloadInvalidError)
    return {"errors": error.errors}


def _details_publish_blocked(error: Exception) -> dict[str, object] | None:
    assert isinstance(error, PublishBlockedError)
    return {"findings": error.findings}


_UPGRADE_REMEDY = "This document was written by a newer osrlib. Upgrade osrlib, then reopen it."

# Every typed error a route can raise, mapped to the envelope:
# (status, code, remedy, details builder).
_ERROR_MAPPINGS: dict[type[Exception], tuple[int, str, str | None, Callable[[Exception], dict[str, object] | None]]] = {
    SaveVersionError: (409, "schema_version_newer", _UPGRADE_REMEDY, _details_none),
    ProjectNotFoundError: (
        404,
        "unknown_project",
        "The editor restarted; return to the home screen and reopen the project.",
        _details_none,
    ),
    ProjectPathNotFoundError: (404, "project_path_not_found", None, _details_none),
    InvalidProjectError: (422, "not_a_project", None, _details_none),
    ProjectExistsError: (409, "project_dir_not_empty", "Choose a new or empty directory.", _details_none),
    ForgeWorkdirInvalidError: (
        422,
        "forge_workdir_invalid",
        "A forge workdir is a directory whose run.json parses as forge's RunMeta with intact stage caches; "
        "repair it with osr-forge, then reopen.",
        _details_none,
    ),
    ForgeWorkdirIncompleteError: (
        422,
        "forge_workdir_incomplete",
        "Complete the conversion from the CLI (osrforge rerun <stage>), then reopen.",
        _details_none,
    ),
    ForgeOverrideInvalidError: (
        422,
        "forge_override_invalid",
        "The overrides file is the human-readable record; repair the named entry by hand, then retry.",
        _details_none,
    ),
    ForgeRerunInvalidError: (422, "forge_rerun_invalid", None, _details_none),
    OpUnsupportedForgeError: (
        422,
        "op_unsupported_forge",
        "This edit has no override kind. Detach to a native project to make it, or cancel.",
        _details_op_unsupported_forge,
    ),
    ForgePageNotFoundError: (404, "forge_page_not_found", None, _details_none),
    ProjectNotForgeError: (422, "project_not_forge", None, _details_none),
    StaleRevisionError: (
        409,
        "stale_revision",
        "The document changed in another tab; the editor resyncs automatically.",
        _details_stale_revision,
    ),
    UndoStackEmptyError: (409, "nothing_to_undo", None, _details_none),
    RedoStackEmptyError: (409, "nothing_to_redo", None, _details_none),
    OpRejectedError: (422, "op_rejected", None, _details_op_rejected),
    OpTargetNotFoundError: (422, "op_target_not_found", None, _details_none),
    OpInvariantError: (422, "op_invariant", None, _details_op_invariant),
    CatalogMonsterNotFoundError: (
        404,
        "catalog_monster_not_found",
        "The shipped ids are the GET /api/catalogs/monsters list; bundled templates live in the document itself.",
        _details_none,
    ),
    ImporterNotFoundError: (404, "importer_not_found", None, _details_none),
    ImportSourceInvalidError: (422, "import_source_invalid", None, _details_none),
    OsrWebNotConfiguredError: (
        422,
        "osr_web_not_configured",
        "Provide the path to your osr-web checkout in the publish dialog.",
        _details_none,
    ),
    OsrWebCheckoutInvalidError: (
        422,
        "osr_web_checkout_invalid",
        "An osr-web checkout is a directory containing an adventures/ directory.",
        _details_none,
    ),
    PublishBlockedError: (
        409,
        "publish_blocked",
        "Fix the validation findings, then publish again.",
        _details_publish_blocked,
    ),
    PublishDestinationExistsError: (
        409,
        "publish_destination_exists",
        "Choose another name, or publish again with overwrite.",
        _details_none,
    ),
    ContentValidationError: (422, "document_invalid", None, _details_none),
    DocumentPayloadInvalidError: (
        422,
        "payload_invalid",
        "The document may have been written by a newer osrlib or edited by hand. "
        "Upgrade osrlib or repair the document, then reopen it.",
        _details_payload_invalid,
    ),
}


def _make_handler(
    status: int, code: str, remedy: str | None, details: Callable[[Exception], dict[str, object] | None]
) -> Callable[[Request, Exception], JSONResponse]:
    def handle(request: Request, error: Exception) -> JSONResponse:
        return _error_response(status, code, str(error), remedy=remedy, details=details(error))

    return handle


def _request_validation_error_handler(request: Request, error: Exception) -> JSONResponse:
    """Map FastAPI's request-validation rejections into the one envelope.

    The frontend parses one error envelope generically, so even a malformed
    request (a relative path in an open dialog) answers in it.
    """
    assert isinstance(error, RequestValidationError)
    reported = [
        {"path": json_pointer(detail.get("loc", ())), "message": str(detail.get("msg", ""))}
        for detail in error.errors()[:_MAX_REPORTED_LOCATIONS]
    ]
    return _error_response(422, "request_invalid", "the request is malformed", details={"errors": reported})


def create_app(open_at_launch: Path | None = None) -> FastAPI:
    """Build the FastAPI app: state, API routes, error handlers, then the static mount.

    Args:
        open_at_launch: The CLI's `PATH` argument, already resolved; carried on
            `GET /api/projects` for the frontend to act on once per page load.

    Returns:
        The configured application.
    """
    app = FastAPI(title="osr-editor", version=_editor_version())
    # The registry lives on app.state, not module globals: phase 0 chose an app
    # factory, and tests must not leak open projects across app instances.
    app.state.service = DocumentService(LocalProjectStore())
    app.state.open_at_launch = str(open_at_launch) if open_at_launch is not None else None
    # The importer registry is built once per app: discovery walks installed
    # entry points, which cannot change under a running process.
    app.state.importers = discover_importers()
    for error_type, (status, code, remedy, details) in _ERROR_MAPPINGS.items():
        app.add_exception_handler(error_type, _make_handler(status, code, remedy, details))
    app.add_exception_handler(RequestValidationError, _request_validation_error_handler)
    app.include_router(router)
    # Mounted last so API routes always win; guarded so a dev backend without a
    # built frontend still boots and serves /api.
    if _STATIC_DIR.is_dir():
        app.mount("/", StaticFiles(directory=_STATIC_DIR, html=True), name="static")
    return app


def _editor_version() -> str:
    """Return the installed osr-editor package version.

    Returns:
        The version string from package metadata.
    """
    return metadata.version("osr-editor")


def main(argv: Sequence[str] | None = None) -> None:
    """Run the editor: serve on localhost and open the browser to the served page.

    Args:
        argv: Command-line arguments; `None` reads `sys.argv`.
    """
    parser = argparse.ArgumentParser(prog="osr-editor", description="Author osrlib adventure modules in your browser.")
    parser.add_argument("path", nargs="?", type=Path, default=None, metavar="PATH", help="project directory to open")
    parser.add_argument("--port", type=int, default=DEFAULT_PORT, help=f"port to serve on (default {DEFAULT_PORT})")
    parser.add_argument("--no-browser", action="store_true", help="do not open the browser")
    args = parser.parse_args(argv)
    open_at_launch: Path | None = None
    if args.path is not None:
        if not args.path.is_dir():
            parser.error(f"no directory at {args.path}")
        open_at_launch = args.path.resolve()
    if not args.no_browser:
        timer = threading.Timer(0.5, webbrowser.open, args=(f"http://127.0.0.1:{args.port}/",))
        timer.daemon = True
        timer.start()
    uvicorn.run(create_app(open_at_launch=open_at_launch), host="127.0.0.1", port=args.port)
