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
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from osrlib.crawl.adventure import Adventure
from osrlib.errors import ContentValidationError, SaveVersionError
from osrlib.versioning import SCHEMA_VERSION, engine_version
from pydantic import BaseModel, ConfigDict, ValidationError, field_validator

from osreditor.config import RecentEntry, load_config, record_recent, save_config
from osreditor.documents import DocumentService, OpenProject, dump_adventure, json_pointer
from osreditor.errors import (
    InvalidProjectError,
    OpRejectedError,
    OpTargetNotFoundError,
    ProjectExistsError,
    ProjectNotFoundError,
    ProjectPathNotFoundError,
    ProjectTypeUnsupportedError,
    RedoStackEmptyError,
    StaleRevisionError,
    UndoStackEmptyError,
)
from osreditor.ops import Diagnostics, OpBatch, OpBatchResult
from osreditor.projects import create_native_project, open_project, utc_now_iso
from osreditor.store import LocalProjectStore, atomic_write_bytes

__all__ = [
    "ApiError",
    "ApiErrorDetail",
    "CreateProjectRequest",
    "CurrentUser",
    "ExportRequest",
    "ExportResult",
    "OpenProjectRequest",
    "ProjectListResponse",
    "ProjectState",
    "RecentProject",
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
    project = _service(request).get(project_id)
    with project.lock:
        data = dump_adventure(project.adventure)
    atomic_write_bytes(Path(body.path), data)
    return ExportResult(path=body.path)


def _details_none(error: Exception) -> dict[str, object] | None:
    return None


def _details_stale_revision(error: Exception) -> dict[str, object] | None:
    assert isinstance(error, StaleRevisionError)
    return {"current_revision": error.current_revision}


def _details_op_rejected(error: Exception) -> dict[str, object] | None:
    assert isinstance(error, OpRejectedError)
    return {"errors": error.errors}


_MAX_REPORTED_LOCATIONS = 10


def _details_payload_invalid(error: Exception) -> dict[str, object] | None:
    assert isinstance(error, ValidationError)
    reported = [
        {"path": json_pointer(detail["loc"]), "message": detail["msg"]}
        for detail in error.errors()[:_MAX_REPORTED_LOCATIONS]
    ]
    return {"errors": reported}


_UPGRADE_REMEDY = "This document was written by a newer osrlib. Upgrade osrlib, then reopen it."

# Every typed error a phase 1 route can raise, mapped to the envelope:
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
    ProjectTypeUnsupportedError: (
        422,
        "project_type_unsupported",
        "Forge-backed review arrives in a later release.",
        _details_none,
    ),
    ProjectExistsError: (409, "project_dir_not_empty", "Choose a new or empty directory.", _details_none),
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
    ContentValidationError: (422, "document_invalid", None, _details_none),
    ValidationError: (422, "payload_invalid", _UPGRADE_REMEDY, _details_payload_invalid),
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
