"""The app surface: routes, error envelopes, the auth seam, launch plumbing, the static mount."""

import json
from importlib import metadata
from pathlib import Path

import pytest
from fastapi.dependencies.models import Dependant
from fastapi.routing import APIRoute, iter_route_contexts
from fastapi.testclient import TestClient
from osrlib.versioning import SCHEMA_VERSION, engine_version

import osreditor.app
from osreditor.app import create_app, get_current_user, main
from osreditor.documents import canonical_json_bytes, dump_adventure, load_adventure
from osreditor.projects import starter_adventure
from test_projects import make_forge_workdir


@pytest.fixture
def client() -> TestClient:
    return TestClient(create_app())


def create_project(client: TestClient, path: Path, name: str = "Demo") -> dict:
    response = client.post("/api/projects", json={"path": str(path), "name": name})
    assert response.status_code == 201, response.text
    return response.json()


def test_status_reports_editor_and_engine_versions(client: TestClient) -> None:
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


def test_create_returns_full_project_state(client: TestClient, tmp_path: Path) -> None:
    state = create_project(client, tmp_path / "demo.osr", name="The mill")
    assert state["revision"] == "r1"
    assert state["type"] == "native"
    assert state["path"] == str(tmp_path / "demo.osr")
    assert state["document"]["name"] == "The mill"
    assert state["diagnostics"] == {"validation": [], "lint": []}
    assert state["dropped_fields"] == []
    assert state["can_undo"] is False and state["can_redo"] is False


def test_create_in_a_non_empty_directory_answers_409(client: TestClient, tmp_path: Path) -> None:
    (tmp_path / "occupied").mkdir()
    (tmp_path / "occupied" / "file.txt").write_text("here first", encoding="utf-8")
    response = client.post("/api/projects", json={"path": str(tmp_path / "occupied"), "name": "Demo"})
    assert response.status_code == 409
    body = response.json()["error"]
    assert body["code"] == "project_dir_not_empty"
    assert body["remedy"]


def test_relative_path_answers_the_envelope(client: TestClient) -> None:
    response = client.post("/api/projects/open", json={"path": "relative/project"})
    assert response.status_code == 422
    body = response.json()["error"]
    assert body["code"] == "request_invalid"
    assert body["details"]["errors"]


def test_open_missing_path_answers_404(client: TestClient, tmp_path: Path) -> None:
    response = client.post("/api/projects/open", json={"path": str(tmp_path / "never")})
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "project_path_not_found"


def test_open_non_project_answers_422(client: TestClient, tmp_path: Path) -> None:
    response = client.post("/api/projects/open", json={"path": str(tmp_path)})
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "not_a_project"


def test_open_forge_workdir_answers_project_type_unsupported(client: TestClient, tmp_path: Path) -> None:
    workdir = tmp_path / "demo.forge"
    make_forge_workdir(workdir)
    response = client.post("/api/projects/open", json={"path": str(workdir)})
    assert response.status_code == 422
    body = response.json()["error"]
    assert body["code"] == "project_type_unsupported"
    assert "workdir" in body["message"]
    assert "later release" in body["remedy"]


def _write_document(path: Path, **envelope_changes: object) -> None:
    document = json.loads(dump_adventure(starter_adventure("Doctored")))
    document.update(envelope_changes)
    path.mkdir(parents=True, exist_ok=True)
    (path / "adventure.json").write_bytes(canonical_json_bytes(document))


def test_open_newer_schema_answers_schema_version_newer(client: TestClient, tmp_path: Path) -> None:
    project_dir = tmp_path / "newer.osr"
    _write_document(project_dir, schema_version=SCHEMA_VERSION + 1)
    response = client.post("/api/projects/open", json={"path": str(project_dir)})
    assert response.status_code == 409
    body = response.json()["error"]
    assert body["code"] == "schema_version_newer"
    assert "osrlib" in body["remedy"]


def test_open_wrong_kind_answers_document_invalid(client: TestClient, tmp_path: Path) -> None:
    project_dir = tmp_path / "wrong.osr"
    _write_document(project_dir, kind="save")
    # Shape detection sees adventure.json; the load failure itself surfaces,
    # never a "not a project" verdict.
    response = client.post("/api/projects/open", json={"path": str(project_dir)})
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "document_invalid"


def test_open_invalid_payload_answers_payload_invalid(client: TestClient, tmp_path: Path) -> None:
    project_dir = tmp_path / "invalid.osr"
    document = json.loads(dump_adventure(starter_adventure("Broken")))
    document["payload"]["dungeons"] = []
    project_dir.mkdir()
    (project_dir / "adventure.json").write_bytes(canonical_json_bytes(document))
    response = client.post("/api/projects/open", json={"path": str(project_dir)})
    assert response.status_code == 422
    body = response.json()["error"]
    assert body["code"] == "payload_invalid"
    assert body["details"]["errors"][0]["path"] == "/dungeons"


def test_open_twice_returns_the_same_project_id(client: TestClient, tmp_path: Path) -> None:
    state = create_project(client, tmp_path / "demo.osr")
    reopened = client.post("/api/projects/open", json={"path": str(tmp_path / "demo.osr")})
    assert reopened.status_code == 200
    assert reopened.json()["id"] == state["id"]


def test_get_project_round_trips_state(client: TestClient, tmp_path: Path) -> None:
    state = create_project(client, tmp_path / "demo.osr")
    response = client.get(f"/api/projects/{state['id']}")
    assert response.status_code == 200
    assert response.json() == state


def test_unknown_project_id_answers_404(client: TestClient) -> None:
    response = client.get("/api/projects/feedfacedeadbeef")
    assert response.status_code == 404
    body = response.json()["error"]
    assert body["code"] == "unknown_project"
    assert body["remedy"]


def test_ops_commit_and_stale_revision(client: TestClient, tmp_path: Path) -> None:
    state = create_project(client, tmp_path / "demo.osr")
    batch = {
        "revision": "r1",
        "ops": [{"op": "set_adventure_field", "field": "name", "value": "Renamed"}],
    }
    committed = client.post(f"/api/projects/{state['id']}/ops", json=batch)
    assert committed.status_code == 200
    result = committed.json()
    assert result["revision"] == "r2"
    assert result["delta"] == [{"path": "/name", "value": "Renamed"}]
    assert result["can_undo"] is True

    stale = client.post(f"/api/projects/{state['id']}/ops", json=batch)
    assert stale.status_code == 409
    body = stale.json()["error"]
    assert body["code"] == "stale_revision"
    assert body["details"] == {"current_revision": "r2"}


def test_op_target_not_found_answers_422(client: TestClient, tmp_path: Path) -> None:
    state = create_project(client, tmp_path / "demo.osr")
    batch = {
        "revision": "r1",
        "ops": [{"op": "set_wandering", "dungeon_id": "nope", "level_number": 1, "wandering": {}}],
    }
    response = client.post(f"/api/projects/{state['id']}/ops", json=batch)
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "op_target_not_found"


def test_undo_redo_routes(client: TestClient, tmp_path: Path) -> None:
    state = create_project(client, tmp_path / "demo.osr")
    client.post(
        f"/api/projects/{state['id']}/ops",
        json={"revision": "r1", "ops": [{"op": "set_adventure_field", "field": "name", "value": "Renamed"}]},
    )
    undone = client.post(f"/api/projects/{state['id']}/undo")
    assert undone.status_code == 200
    assert undone.json()["revision"] == "r3"
    assert undone.json()["delta"][0]["path"] == ""
    redone = client.post(f"/api/projects/{state['id']}/redo")
    assert redone.status_code == 200
    assert redone.json()["can_redo"] is False

    empty = client.post(f"/api/projects/{state['id']}/redo")
    assert empty.status_code == 409
    assert empty.json()["error"]["code"] == "nothing_to_redo"


def test_undo_with_nothing_to_undo_answers_409(client: TestClient, tmp_path: Path) -> None:
    state = create_project(client, tmp_path / "demo.osr")
    response = client.post(f"/api/projects/{state['id']}/undo")
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "nothing_to_undo"


def test_validation_reacts_live_over_the_api(client: TestClient, tmp_path: Path) -> None:
    state = create_project(client, tmp_path / "demo.osr")
    broken = client.post(
        f"/api/projects/{state['id']}/ops",
        json={
            "revision": "r1",
            "ops": [{"op": "set_town_field", "field": "travel_turns", "value": {"no-such-dungeon": 2}}],
        },
    )
    findings = broken.json()["diagnostics"]["validation"]
    assert [finding["code"] for finding in findings] == ["travel_unknown_dungeon"]
    assert findings[0]["address"] == "town"
    fixed = client.post(
        f"/api/projects/{state['id']}/ops",
        json={
            "revision": "r2",
            "ops": [{"op": "set_town_field", "field": "travel_turns", "value": {"dungeon-1": 2}}],
        },
    )
    assert fixed.json()["diagnostics"]["validation"] == []


def test_export_writes_a_document_osr_web_lists(client: TestClient, tmp_path: Path) -> None:
    state = create_project(client, tmp_path / "demo.osr")
    destination = tmp_path / "exports" / "demo-adventure.json"
    response = client.post(f"/api/projects/{state['id']}/export", json={"path": str(destination)})
    assert response.status_code == 200
    assert response.json() == {"path": str(destination)}
    data = destination.read_bytes()
    # osr-web's listing gate: parsed JSON object with top-level kind == "adventure".
    document = json.loads(data)
    assert isinstance(document, dict)
    assert document["kind"] == "adventure"
    # The playable bar: the full load round-trip.
    assert load_adventure(data).name == "Demo"


def test_export_overwrites_an_existing_file(client: TestClient, tmp_path: Path) -> None:
    state = create_project(client, tmp_path / "demo.osr")
    destination = tmp_path / "out.json"
    destination.write_text("stale", encoding="utf-8")
    client.post(f"/api/projects/{state['id']}/export", json={"path": str(destination)})
    assert json.loads(destination.read_bytes())["kind"] == "adventure"


def test_recents_list_and_missing_probe(client: TestClient, tmp_path: Path) -> None:
    create_project(client, tmp_path / "first.osr", name="First")
    create_project(client, tmp_path / "second.osr", name="Second")
    listed = client.get("/api/projects").json()
    assert [entry["name"] for entry in listed["recents"]] == ["Second", "First"]
    assert all(entry["missing"] is False for entry in listed["recents"])
    assert listed["open_at_launch"] is None

    (tmp_path / "first.osr" / "adventure.json").unlink()
    (tmp_path / "first.osr" / "editor.json").unlink()
    (tmp_path / "first.osr").rmdir()
    probed = client.get("/api/projects").json()
    assert [entry["missing"] for entry in probed["recents"]] == [False, True]


def test_reopening_moves_a_recent_to_the_front(client: TestClient, tmp_path: Path) -> None:
    create_project(client, tmp_path / "first.osr", name="First")
    create_project(client, tmp_path / "second.osr", name="Second")
    client.post("/api/projects/open", json={"path": str(tmp_path / "first.osr")})
    listed = client.get("/api/projects").json()
    assert [entry["name"] for entry in listed["recents"]] == ["First", "Second"]


def test_open_at_launch_is_carried(tmp_path: Path) -> None:
    client = TestClient(create_app(open_at_launch=tmp_path / "demo.osr"))
    assert client.get("/api/projects").json()["open_at_launch"] == str(tmp_path / "demo.osr")


def test_cli_fails_fast_on_a_nonexistent_path(tmp_path: Path, capsys: pytest.CaptureFixture[str]) -> None:
    with pytest.raises(SystemExit) as excinfo:
        main([str(tmp_path / "never"), "--no-browser"])
    assert excinfo.value.code == 2
    assert "no directory at" in capsys.readouterr().err


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
