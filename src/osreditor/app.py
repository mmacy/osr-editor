"""The FastAPI app: routes, the auth seam, the error envelope, and the CLI entry point.

Every `/api` route resolves its caller through the single auth dependency
([`get_current_user`][osreditor.app.get_current_user]), whose shipped
implementation returns the local user unconditionally. The seam exists so a
hosted future changes one function, not every handler; no other code assumes
there is exactly one user, and a route-introspection test enforces the seam.

Error responses share one structured envelope ([`ApiError`][osreditor.app.ApiError]):
a stable snake_case `code`, a `message`, and optional `remedy` and `details`.
Typed osrlib and osr-forge errors map to it through exception handlers; each
later phase maps the errors its routes can raise. Phase 0 pins the first
mapping — osrlib's `SaveVersionError`, a newer-schema document, answered 409
(osr-web's precedent) with the upgrade remedy attached.
"""

import argparse
import threading
import webbrowser
from collections.abc import Sequence
from importlib import metadata
from pathlib import Path
from typing import Annotated

import uvicorn
from fastapi import APIRouter, Depends, FastAPI, Request
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from osrlib.errors import SaveVersionError
from osrlib.versioning import SCHEMA_VERSION, engine_version
from pydantic import BaseModel, ConfigDict

__all__ = [
    "ApiError",
    "ApiErrorDetail",
    "CurrentUser",
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


def _save_version_error_handler(request: Request, error: Exception) -> JSONResponse:
    """Map osrlib's `SaveVersionError` (a newer-schema document) to the envelope."""
    return _error_response(
        409,
        "schema_version_newer",
        str(error),
        remedy="This document was written by a newer osrlib. Upgrade osrlib, then reopen it.",
    )


def create_app() -> FastAPI:
    """Build the FastAPI app: API routes, error handlers, then the static mount.

    Returns:
        The configured application.
    """
    app = FastAPI(title="osr-editor", version=_editor_version())
    app.add_exception_handler(SaveVersionError, _save_version_error_handler)
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
    parser.add_argument("--port", type=int, default=DEFAULT_PORT, help=f"port to serve on (default {DEFAULT_PORT})")
    parser.add_argument("--no-browser", action="store_true", help="do not open the browser")
    args = parser.parse_args(argv)
    if not args.no_browser:
        timer = threading.Timer(0.5, webbrowser.open, args=(f"http://127.0.0.1:{args.port}/",))
        timer.daemon = True
        timer.start()
    uvicorn.run(create_app(), host="127.0.0.1", port=args.port)
