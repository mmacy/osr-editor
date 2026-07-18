"""The app skeleton: status shape, the auth seam, the error envelope, the static mount."""

from importlib import metadata
from pathlib import Path

import pytest
from fastapi.dependencies.models import Dependant
from fastapi.routing import APIRoute, iter_route_contexts
from fastapi.testclient import TestClient
from osrlib.errors import SaveVersionError
from osrlib.versioning import SCHEMA_VERSION, engine_version

import osreditor.app
from osreditor.app import CurrentUser, create_app, get_current_user


def test_status_reports_editor_and_engine_versions() -> None:
    client = TestClient(create_app())
    response = client.get("/api/status")
    assert response.status_code == 200
    assert response.json() == {
        "editor_version": metadata.version("osr-editor"),
        "engine_version": engine_version(),
        "schema_version": SCHEMA_VERSION,
    }


def _resolves_current_user(dependant: Dependant) -> bool:
    if dependant.call is get_current_user:
        return True
    return any(_resolves_current_user(dependency) for dependency in dependant.dependencies)


def test_every_api_route_resolves_the_auth_dependency() -> None:
    # iter_route_contexts flattens FastAPI's lazily included routers, so the walk
    # sees every effective route the app will actually serve.
    app = create_app()
    api_routes = [
        context
        for context in iter_route_contexts(app.routes)
        if isinstance(context.original_route, APIRoute) and (context.path or "").startswith("/api")
    ]
    assert api_routes, "the app must expose /api routes"
    for context in api_routes:
        assert _resolves_current_user(context.dependant), f"{context.path} does not resolve get_current_user"


def test_mapped_osrlib_error_answers_in_the_envelope() -> None:
    app = create_app()

    # No shipped phase 0 route loads documents, so a throwaway route drives the
    # real handler wiring through the TestClient.
    @app.get("/api/throwaway")
    def throwaway(user: CurrentUser) -> None:
        raise SaveVersionError("document schema_version 99 is newer than the supported 2")

    response = TestClient(app).get("/api/throwaway")
    assert response.status_code == 409
    body = response.json()
    assert body["error"]["code"] == "schema_version_newer"
    assert "newer" in body["error"]["message"]
    assert "osrlib" in body["error"]["remedy"]
    assert body["error"]["details"] is None


def test_static_mount_serves_the_built_frontend(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    (tmp_path / "index.html").write_text("<!doctype html><title>osr-editor</title>", encoding="utf-8")
    monkeypatch.setattr(osreditor.app, "_STATIC_DIR", tmp_path)
    response = TestClient(create_app()).get("/")
    assert response.status_code == 200
    assert "osr-editor" in response.text


def test_backend_without_a_built_frontend_still_serves_api(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(osreditor.app, "_STATIC_DIR", tmp_path / "never-built")
    client = TestClient(create_app())
    assert client.get("/api/status").status_code == 200
    assert client.get("/").status_code == 404
