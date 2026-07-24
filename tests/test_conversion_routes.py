"""The conversion API: creation guards, the recovery lookup, the busy matrix, adoption, previews, provider routes.

The worker is recorded rather than threaded, so every test drives the runner
explicitly and nothing sleeps: `spawn` is replaced with a recorder the tests
drain when they want the work to happen.
"""

import shutil
from collections.abc import Callable, Iterator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

import osreditor.app
from osreditor.app import create_app
from osreditor.conversions import STAGE_ORDER, ConversionSession
from osreditor.providers import API_KEY_ENV, DEPLOYMENT_ENV, ENDPOINT_ENV


class SpawnRecorder:
    """Stands in for the daemon thread: records the runner, and runs it on demand."""

    def __init__(self) -> None:
        self.calls: list[tuple[Callable[..., None], ConversionSession, tuple[object, ...]]] = []

    def __call__(self, runner: Callable[..., None], session: ConversionSession, *args: object) -> None:
        self.calls.append((runner, session, args))

    def drain(self) -> None:
        pending, self.calls = self.calls, []
        for runner, session, args in pending:
            runner(session, *args)


@pytest.fixture
def spawn(monkeypatch: pytest.MonkeyPatch) -> SpawnRecorder:
    recorder = SpawnRecorder()
    monkeypatch.setattr(osreditor.app, "spawn", recorder)
    return recorder


@pytest.fixture
def client(spawn: SpawnRecorder) -> Iterator[TestClient]:
    with TestClient(create_app()) as test_client:
        yield test_client


@pytest.fixture
def fixtures_provider(client: TestClient, minimod_fixtures: Path) -> None:
    """Point the session at forge's `FixtureProvider` — typed API surface, exactly as the e2e suite does."""
    response = client.post("/api/provider", json={"kind": "fixtures", "fixtures_dir": str(minimod_fixtures)})
    assert response.status_code == 200, response.text
    assert response.json()["configured"] is True


def create_pdf(client: TestClient, pdf: Path, workdir: Path, **extra: object) -> tuple[int, dict]:
    response = client.post(
        "/api/conversions",
        json={"kind": "pdf", "pdf_path": str(pdf), "workdir_path": str(workdir), **extra},
    )
    return response.status_code, response.json()


def create_workdir(client: TestClient, workdir: Path) -> tuple[int, dict]:
    response = client.post("/api/conversions", json={"kind": "workdir", "workdir_path": str(workdir)})
    return response.status_code, response.json()


def open_project(client: TestClient, path: Path) -> dict:
    response = client.post("/api/projects/open", json={"path": str(path)})
    assert response.status_code == 200, response.text
    return response.json()


def convert(client: TestClient, spawn: SpawnRecorder, workdir: Path) -> dict:
    """Drive a warm workdir through the chain to completion."""
    status, session = create_workdir(client, workdir)
    assert status == 201, session
    response = client.post(f"/api/conversions/{session['id']}/run", json={"stage": "survey"})
    assert response.status_code == 200, response.text
    spawn.drain()
    return client.get(f"/api/conversions/{session['id']}").json()


# --- the provider routes ------------------------------------------------------


def test_provider_status_reports_the_environment_it_detects(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv(ENDPOINT_ENV, "https://env.example.invalid/")
    monkeypatch.setenv(DEPLOYMENT_ENV, "env-deployment")
    monkeypatch.delenv(API_KEY_ENV, raising=False)
    body = client.get("/api/provider").json()
    assert body["kind"] == "foundry"
    assert body["endpoint"] == {"value": "https://env.example.invalid/", "source": "env"}
    assert body["deployment"] == {"value": "env-deployment", "source": "env"}
    assert body["api_key_present"] is False
    assert body["api_key_source"] is None


def test_session_settings_win_per_field_and_an_explicit_null_clears(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv(ENDPOINT_ENV, "https://env.example.invalid/")
    monkeypatch.setenv(DEPLOYMENT_ENV, "env-deployment")
    body = client.post("/api/provider", json={"deployment": "session-deployment", "api_key": "secret"}).json()
    assert body["deployment"] == {"value": "session-deployment", "source": "session"}
    assert body["endpoint"]["source"] == "env"
    assert body["api_key_present"] is True and body["api_key_source"] == "session"

    cleared = client.post("/api/provider", json={"deployment": None}).json()
    assert cleared["deployment"] == {"value": "env-deployment", "source": "env"}
    # The unmentioned key stayed set.
    assert cleared["api_key_present"] is True


def test_no_response_ever_carries_the_key_and_none_of_it_reaches_disk(
    client: TestClient, isolated_config: Path, tmp_path: Path
) -> None:
    # Something must already be on disk for "byte-identical" to mean anything.
    created = client.post("/api/projects", json={"path": str(tmp_path / "demo.osr"), "name": "Demo"})
    assert created.status_code == 201, created.text
    before = isolated_config.read_bytes()

    response = client.post(
        "/api/provider",
        json={"endpoint": "https://secret.example.invalid/", "deployment": "d", "api_key": "super-secret"},
    )
    assert response.status_code == 200
    assert "super-secret" not in response.text
    assert "api_key" not in response.json()
    assert isolated_config.read_bytes() == before


def test_running_without_a_provider_is_a_typed_refusal(
    client: TestClient, warm_workdir: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    for name in (ENDPOINT_ENV, DEPLOYMENT_ENV, API_KEY_ENV):
        monkeypatch.delenv(name, raising=False)
    status, session = create_workdir(client, warm_workdir)
    assert status == 201
    response = client.post(f"/api/conversions/{session['id']}/run", json={"stage": "survey"})
    assert response.status_code == 422
    error = response.json()["error"]
    assert error["code"] == "provider_not_configured"
    assert [entry["field"] for entry in error["details"]["missing"]] == ["endpoint", "deployment"]
    # Nothing spawned: the session is untouched.
    assert client.get(f"/api/conversions/{session['id']}").json()["state"] == "ready"


# --- creation and the destination guard --------------------------------------


def test_creating_a_pdf_conversion_answers_estimating_then_estimated(
    client: TestClient, spawn: SpawnRecorder, minimod_pdf: Path, tmp_path: Path
) -> None:
    status, body = create_pdf(client, minimod_pdf, tmp_path / "minimod.forge")
    assert status == 201, body
    assert body["state"] == "estimating"
    assert body["kind"] == "pdf"
    assert body["estimate"] is None

    spawn.drain()
    polled = client.get(f"/api/conversions/{body['id']}").json()
    assert polled["state"] == "estimated"
    assert polled["estimate"]["page_count"] == 5
    assert polled["estimate"]["usd"] > 0


def test_the_existing_workdir_handshake_reports_whether_it_completed(
    client: TestClient, minimod_pdf: Path, forge_workdir: Path
) -> None:
    status, body = create_pdf(client, minimod_pdf, forge_workdir)
    assert status == 409
    assert body["error"]["code"] == "conversion_destination_exists"
    assert body["error"]["details"] == {"completed": True}

    allowed, _ = create_pdf(client, minimod_pdf, forge_workdir, allow_existing=True)
    assert allowed == 201


def test_an_occupied_directory_and_a_file_answer_their_own_codes(
    client: TestClient, minimod_pdf: Path, tmp_path: Path
) -> None:
    occupied = tmp_path / "notes"
    occupied.mkdir()
    (occupied / "thesis.txt").write_text("mine", encoding="utf-8")
    status, body = create_pdf(client, minimod_pdf, occupied)
    assert (status, body["error"]["code"]) == (409, "project_dir_not_empty")

    target = tmp_path / "notes.txt"
    target.write_text("mine", encoding="utf-8")
    status, body = create_pdf(client, minimod_pdf, target)
    assert (status, body["error"]["code"]) == (422, "conversion_destination_invalid")


def test_a_relative_path_and_a_missing_source_are_malformed_requests(client: TestClient, tmp_path: Path) -> None:
    relative = client.post(
        "/api/conversions", json={"kind": "pdf", "pdf_path": "module.pdf", "workdir_path": str(tmp_path / "a.forge")}
    )
    assert (relative.status_code, relative.json()["error"]["code"]) == (422, "request_invalid")
    sourceless = client.post("/api/conversions", json={"kind": "pdf", "workdir_path": str(tmp_path / "a.forge")})
    assert (sourceless.status_code, sourceless.json()["error"]["code"]) == (422, "request_invalid")


def test_a_workdir_session_needs_a_workdir(client: TestClient, tmp_path: Path) -> None:
    plain = tmp_path / "plain"
    plain.mkdir()
    status, body = create_workdir(client, plain)
    assert (status, body["error"]["code"]) == (422, "forge_workdir_invalid")


def test_creating_a_workdir_session_twice_returns_the_same_session(client: TestClient, warm_workdir: Path) -> None:
    _, first = create_workdir(client, warm_workdir)
    _, second = create_workdir(client, warm_workdir)
    assert first["id"] == second["id"]
    assert first["state"] == "ready"


# --- exclusivity and recovery -------------------------------------------------


def test_an_active_session_blocks_a_second_conversion_and_the_open(
    client: TestClient, fixtures_provider: None, warm_workdir: Path, minimod_pdf: Path
) -> None:
    _, session = create_workdir(client, warm_workdir)
    assert client.post(f"/api/conversions/{session['id']}/run", json={"stage": "survey"}).status_code == 200

    blocked = create_pdf(client, minimod_pdf, warm_workdir)
    assert (blocked[0], blocked[1]["error"]["code"]) == (409, "conversion_in_progress")

    opened = client.post("/api/projects/open", json={"path": str(warm_workdir)})
    assert (opened.status_code, opened.json()["error"]["code"]) == (409, "conversion_in_progress")


def test_the_recovery_lookup_answers_the_path_and_404s_when_there_is_none(
    client: TestClient, warm_workdir: Path, tmp_path: Path
) -> None:
    missing = client.get("/api/conversions", params={"workdir": str(warm_workdir)})
    assert (missing.status_code, missing.json()["error"]["code"]) == (404, "unknown_conversion")

    _, session = create_workdir(client, warm_workdir)
    found = client.get("/api/conversions", params={"workdir": str(warm_workdir)})
    assert found.status_code == 200
    assert found.json()["id"] == session["id"]


def test_an_unknown_conversion_id_carries_the_restart_remedy(client: TestClient) -> None:
    response = client.get("/api/conversions/nope")
    assert response.status_code == 404
    error = response.json()["error"]
    assert error["code"] == "unknown_conversion"
    assert error["remedy"] is not None and "reopen the workdir" in error["remedy"]


def test_a_pdf_conversion_over_an_open_project_names_the_pipeline_panel(
    client: TestClient, spawn: SpawnRecorder, warm_workdir: Path, minimod_pdf: Path, fixtures_provider: None
) -> None:
    convert(client, spawn, warm_workdir)
    open_project(client, warm_workdir)
    status, body = create_pdf(client, minimod_pdf, warm_workdir)
    assert (status, body["error"]["code"]) == (409, "workdir_open_as_project")
    assert "pipeline panel" in body["error"]["remedy"]


# --- the incomplete-workdir open ---------------------------------------------


def test_a_warm_workdir_opens_into_the_pipeline_view_rather_than_a_dead_end(
    client: TestClient, warm_workdir: Path
) -> None:
    response = client.post("/api/projects/open", json={"path": str(warm_workdir)})
    assert response.status_code == 422
    error = response.json()["error"]
    assert error["code"] == "forge_workdir_incomplete"
    assert error["message"].startswith("the workdir's survey stage is pending")
    assert error["remedy"] == "Open the workdir to resume the conversion in the pipeline view."


# --- the chain through the API -----------------------------------------------


def test_the_chain_runs_to_completion_and_the_workdir_then_opens_into_review(
    client: TestClient, spawn: SpawnRecorder, warm_workdir: Path, fixtures_provider: None
) -> None:
    final = convert(client, spawn, warm_workdir)
    assert final["state"] == "completed"
    assert [row["stage"] for row in final["stages"]] == [
        "preprocess",
        "survey",
        "content",
        "monsters",
        "geometry",
        "assemble",
    ]
    assert all(row["status"]["status"] == "completed" for row in final["stages"])

    project = open_project(client, warm_workdir)
    assert project["type"] == "forge"
    assert project["document"]["name"] == "The Root Cellar of Old Wenna"


def test_a_non_runnable_stage_is_refused_with_forges_own_reading(client: TestClient, warm_workdir: Path) -> None:
    _, session = create_workdir(client, warm_workdir)
    response = client.post(f"/api/conversions/{session['id']}/run", json={"stage": "geometry"})
    assert (response.status_code, response.json()["error"]["code"]) == (422, "forge_rerun_invalid")


def test_an_upstream_knob_is_refused_before_anything_spawns(
    client: TestClient, spawn: SpawnRecorder, warm_workdir: Path, fixtures_provider: None
) -> None:
    _, session = create_workdir(client, warm_workdir)
    response = client.post(
        f"/api/conversions/{session['id']}/run", json={"stage": "monsters", "settings": {"render_dpi": 300}}
    )
    assert (response.status_code, response.json()["error"]["code"]) == (422, "forge_rerun_invalid")
    assert spawn.calls == []
    assert client.get(f"/api/conversions/{session['id']}").json()["state"] == "ready"


def test_an_unknown_knob_is_a_malformed_request(
    client: TestClient, warm_workdir: Path, fixtures_provider: None
) -> None:
    _, session = create_workdir(client, warm_workdir)
    response = client.post(
        f"/api/conversions/{session['id']}/run", json={"stage": "survey", "settings": {"not_a_knob": 1}}
    )
    assert (response.status_code, response.json()["error"]["code"]) == (422, "request_invalid")


def test_running_a_running_session_is_refused(client: TestClient, warm_workdir: Path, fixtures_provider: None) -> None:
    _, session = create_workdir(client, warm_workdir)
    assert client.post(f"/api/conversions/{session['id']}/run", json={"stage": "survey"}).status_code == 200
    again = client.post(f"/api/conversions/{session['id']}/run", json={"stage": "survey"})
    assert (again.status_code, again.json()["error"]["code"]) == (409, "conversion_state_invalid")


def test_cancelling_a_running_session_answers_the_session(
    client: TestClient, warm_workdir: Path, fixtures_provider: None
) -> None:
    _, session = create_workdir(client, warm_workdir)
    client.post(f"/api/conversions/{session['id']}/run", json={"stage": "survey"})
    cancelled = client.post(f"/api/conversions/{session['id']}/cancel")
    assert cancelled.status_code == 200
    # The flag is raised; the state moves when the chain reaches its boundary.
    assert cancelled.json()["state"] == "running"


# --- bound sessions -----------------------------------------------------------


@pytest.fixture
def bound(client: TestClient, spawn: SpawnRecorder, warm_workdir: Path, fixtures_provider: None) -> tuple[dict, dict]:
    """A converted workdir, opened as a project, with a bound workdir session over it."""
    convert(client, spawn, warm_workdir)
    project = open_project(client, warm_workdir)
    _, session = create_workdir(client, warm_workdir)
    assert session["project_id"] == project["id"]
    return project, session


def test_a_bound_monsters_rerun_is_adopted_by_the_open_project(
    client: TestClient, spawn: SpawnRecorder, bound: tuple[dict, dict]
) -> None:
    project, session = bound
    assert project["forge"]["checked"] is False
    client.post(f"/api/projects/{project['id']}/forge/check")
    assert client.get(f"/api/projects/{project['id']}").json()["forge"]["checked"] is True

    response = client.post(f"/api/conversions/{session['id']}/run", json={"stage": "monsters"})
    assert response.status_code == 200, response.text
    spawn.drain()
    assert client.get(f"/api/conversions/{session['id']}").json()["state"] == "completed"

    after = client.get(f"/api/projects/{project['id']}").json()
    assert after["revision"] != project["revision"]
    assert after["forge"]["checked"] is False
    assert after["forge"]["report"]["module"]["title"] == "The Root Cellar of Old Wenna"


def test_the_undo_history_survives_a_bound_rerun(
    client: TestClient, spawn: SpawnRecorder, bound: tuple[dict, dict]
) -> None:
    project, session = bound
    original_description = project["document"]["description"]
    edit = client.post(
        f"/api/projects/{project['id']}/ops",
        json={
            "revision": project["revision"],
            "ops": [
                {
                    "op": "set_adventure_field",
                    "field": "description",
                    "value": "A corrected blurb.",
                }
            ],
        },
    )
    assert edit.status_code == 200, edit.text
    assert client.get(f"/api/projects/{project['id']}").json()["can_undo"] is True

    client.post(f"/api/conversions/{session['id']}/run", json={"stage": "monsters"})
    spawn.drain()

    # A rerun is not an undo step; the correction is still undoable, and undo
    # replays it against the freshly written caches.
    state = client.get(f"/api/projects/{project['id']}").json()
    assert state["can_undo"] is True
    assert state["document"]["description"] == "A corrected blurb."
    undone = client.post(f"/api/projects/{project['id']}/undo")
    assert undone.status_code == 200, undone.text
    restored = client.get(f"/api/projects/{project['id']}").json()["document"]["description"]
    assert restored == original_description
    assert restored != "A corrected blurb."


def test_assemble_on_a_bound_session_points_at_the_synchronous_route(
    client: TestClient, bound: tuple[dict, dict]
) -> None:
    _, session = bound
    response = client.post(f"/api/conversions/{session['id']}/run", json={"stage": "assemble"})
    assert (response.status_code, response.json()["error"]["code"]) == (409, "conversion_state_invalid")
    assert "forge/rerun" in response.json()["error"]["message"]


BLOCKED_WHILE_BUSY: tuple[tuple[str, str, dict], ...] = (
    ("post", "ops", {"revision": "r2", "ops": [{"op": "set_adventure_field", "field": "description", "value": "x"}]}),
    ("post", "undo", {}),
    ("post", "redo", {}),
    ("post", "forge/check", {}),
    ("post", "forge/rerun", {"settings": {}}),
    ("post", "forge/overrides", {"revision": "r2", "edits": [{"edit": "remove_entry", "kind": "areas", "key": "x"}]}),
    ("post", "forge/detach", {"path": "/tmp/detached.osr"}),
    ("post", "export", {"path": "/tmp/exported.json"}),
    ("post", "publish", {"mode": "copy"}),
)


@pytest.mark.parametrize(("method", "suffix", "payload"), BLOCKED_WHILE_BUSY)
def test_every_workdir_touching_project_route_refuses_while_the_chain_runs(
    client: TestClient, bound: tuple[dict, dict], method: str, suffix: str, payload: dict
) -> None:
    project, session = bound
    assert client.post(f"/api/conversions/{session['id']}/run", json={"stage": "monsters"}).status_code == 200
    response = client.request(method.upper(), f"/api/projects/{project['id']}/{suffix}", json=payload)
    assert response.status_code == 409, response.text
    assert response.json()["error"]["code"] == "conversion_in_progress"


def test_sidecar_patches_stay_legal_while_the_chain_runs(client: TestClient, bound: tuple[dict, dict]) -> None:
    project, session = bound
    client.post(f"/api/conversions/{session['id']}/run", json={"stage": "monsters"})
    response = client.post(
        f"/api/projects/{project['id']}/sidecar",
        json={"patches": [{"action": "set_note", "address": "adventure", "text": "annotation, not the workdir"}]},
    )
    assert response.status_code == 200, response.text


def test_a_bound_session_can_be_reattached_by_the_lookup_after_a_reload(
    client: TestClient, bound: tuple[dict, dict], warm_workdir: Path
) -> None:
    project, session = bound
    client.post(f"/api/conversions/{session['id']}/run", json={"stage": "monsters"})
    found = client.get("/api/conversions", params={"workdir": str(warm_workdir)}).json()
    assert found["id"] == session["id"]
    assert found["state"] == "running"
    assert found["project_id"] == project["id"]


# --- previews -----------------------------------------------------------------


def test_previews_are_gated_on_the_caches_they_are_rendered_from(
    client: TestClient, spawn: SpawnRecorder, warm_workdir: Path, fixtures_provider: None
) -> None:
    _, session = create_workdir(client, warm_workdir)
    early = client.post(f"/api/conversions/{session['id']}/previews")
    assert (early.status_code, early.json()["error"]["code"]) == (409, "conversion_state_invalid")
    assert "survey stage is pending" in early.json()["error"]["message"]

    # The pre-assemble state — survey and content cached, assembly impossible —
    # is proven in test_conversions.py, where a stage boundary can be held. Here
    # the route's own gate and its writes are what is under test.
    client.post(f"/api/conversions/{session['id']}/run", json={"stage": "survey"})
    spawn.drain()
    shutil.rmtree(warm_workdir / "previews")

    written = client.post(f"/api/conversions/{session['id']}/previews")
    assert written.status_code == 200, written.text
    levels = written.json()["levels"]
    assert levels == [{"dungeon_id": "the-root-cellar-of-old-wenna", "level_number": 1}]
    assert (warm_workdir / "previews" / "the-root-cellar-of-old-wenna.1.svg").is_file()


def test_a_regenerated_preview_serves_and_a_miss_404s(
    client: TestClient, spawn: SpawnRecorder, warm_workdir: Path, fixtures_provider: None
) -> None:
    session = convert(client, spawn, warm_workdir)
    served = client.get(f"/api/conversions/{session['id']}/previews/the-root-cellar-of-old-wenna/1")
    assert served.status_code == 200
    assert served.headers["content-type"] == "image/svg+xml"
    assert served.content.startswith(b"<svg")

    missing = client.get(f"/api/conversions/{session['id']}/previews/the-root-cellar-of-old-wenna/9")
    assert (missing.status_code, missing.json()["error"]["code"]) == (404, "forge_page_not_found")


def test_previews_are_refused_while_the_chain_runs(
    client: TestClient, warm_workdir: Path, fixtures_provider: None
) -> None:
    _, session = create_workdir(client, warm_workdir)
    client.post(f"/api/conversions/{session['id']}/run", json={"stage": "survey"})
    response = client.post(f"/api/conversions/{session['id']}/previews")
    assert (response.status_code, response.json()["error"]["code"]) == (409, "conversion_state_invalid")


def test_a_conversion_state_carries_every_field_the_progress_view_renders(
    client: TestClient, spawn: SpawnRecorder, minimod_pdf: Path, tmp_path: Path
) -> None:
    _, body = create_pdf(client, minimod_pdf, tmp_path / "minimod.forge")
    spawn.drain()
    state = client.get(f"/api/conversions/{body['id']}").json()
    assert set(state) == {
        "id",
        "kind",
        "state",
        "workdir_path",
        "pdf_path",
        "estimate",
        "stages",
        "error",
        "project_id",
    }
    assert state["pdf_path"] == str(minimod_pdf)
    assert state["workdir_path"] == str(tmp_path / "minimod.forge")
    assert state["project_id"] is None
    assert [row["stage"] for row in state["stages"]] == [stage.value for stage in STAGE_ORDER]


# --- run-time binding ---------------------------------------------------------


def test_a_session_binds_to_the_project_at_its_path_on_every_run(
    client: TestClient, spawn: SpawnRecorder, warm_workdir: Path, fixtures_provider: None
) -> None:
    # The mainline flow after a conversion: the *pdf* session that just ran is
    # still this workdir's session when the finished conversion is opened, and
    # the pipeline panel reuses it. A session that ran unbound would complete
    # on disk and adopt nothing, leaving the open project showing a document
    # the workdir no longer holds.
    session = convert(client, spawn, warm_workdir)
    assert session["project_id"] is None
    project = open_project(client, warm_workdir)

    started = client.post(f"/api/conversions/{session['id']}/run", json={"stage": "monsters"})
    assert started.status_code == 200, started.text
    assert started.json()["project_id"] == project["id"]
    spawn.drain()

    after = client.get(f"/api/projects/{project['id']}").json()
    assert after["revision"] != project["revision"]
    assert after["forge"]["checked"] is False


def test_a_session_unbinds_when_its_project_closes(
    client: TestClient, spawn: SpawnRecorder, warm_workdir: Path, fixtures_provider: None, tmp_path: Path
) -> None:
    session = convert(client, spawn, warm_workdir)
    project = open_project(client, warm_workdir)
    client.post(f"/api/conversions/{session['id']}/run", json={"stage": "monsters"})
    spawn.drain()
    assert client.get(f"/api/conversions/{session['id']}").json()["project_id"] == project["id"]

    # Detach drops the workdir from the open registry; the next run must not
    # keep claiming a project id nothing answers to.
    detached = client.post(f"/api/projects/{project['id']}/forge/detach", json={"path": str(tmp_path / "native.osr")})
    assert detached.status_code == 200, detached.text
    rerun = client.post(f"/api/conversions/{session['id']}/run", json={"stage": "monsters"})
    assert rerun.status_code == 200, rerun.text
    assert rerun.json()["project_id"] is None


def test_the_bound_assemble_refusal_follows_the_run_time_binding(
    client: TestClient, spawn: SpawnRecorder, warm_workdir: Path, fixtures_provider: None
) -> None:
    session = convert(client, spawn, warm_workdir)
    # Unbound: assemble is a legal resume on the conversion screen.
    assert client.post(f"/api/conversions/{session['id']}/run", json={"stage": "assemble"}).status_code == 200
    spawn.drain()
    # Bound: it points at the synchronous route instead.
    open_project(client, warm_workdir)
    refused = client.post(f"/api/conversions/{session['id']}/run", json={"stage": "assemble"})
    assert (refused.status_code, refused.json()["error"]["code"]) == (409, "conversion_state_invalid")


def test_the_editors_own_failed_estimate_residue_can_be_superseded(
    client: TestClient, spawn: SpawnRecorder, encrypted_pdf: Path, minimod_pdf: Path, tmp_path: Path
) -> None:
    destination = tmp_path / "oops.forge"
    status, body = create_pdf(client, encrypted_pdf, destination)
    assert status == 201
    spawn.drain()
    assert client.get(f"/api/conversions/{body['id']}").json()["state"] == "failed"
    # Forge copied source.pdf in before it opened the PDF.
    assert (destination / "source.pdf").is_file()
    assert not (destination / "run.json").exists()

    # Retrying the right file into the prefilled destination confirms rather
    # than dead-ending on "somebody's content".
    again, error = create_pdf(client, minimod_pdf, destination)
    assert (again, error["error"]["code"]) == (409, "conversion_destination_exists")
    assert error["error"]["details"] == {"completed": False}
    retried, _ = create_pdf(client, minimod_pdf, destination, allow_existing=True)
    assert retried == 201
    spawn.drain()
    assert client.get("/api/conversions", params={"workdir": str(destination)}).json()["state"] == "estimated"
