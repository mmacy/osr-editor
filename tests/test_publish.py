"""Publish to osr-web: the gate, the shape test, both modes, collisions, config growth."""

import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from osreditor.app import create_app
from osreditor.config import AppConfig, load_config, save_config


@pytest.fixture
def client() -> TestClient:
    return TestClient(create_app())


def make_checkout(tmp_path: Path, name: str = "osr-web") -> Path:
    checkout = tmp_path / name
    (checkout / "adventures").mkdir(parents=True)
    return checkout


def create_project(client: TestClient, path: Path, name: str = "Demo") -> dict:
    response = client.post("/api/projects", json={"path": str(path), "name": name})
    assert response.status_code == 201, response.text
    return response.json()


def publish(client: TestClient, project_id: str, **body: object):
    return client.post(f"/api/projects/{project_id}/publish", json=body)


def commit_op(client: TestClient, project: dict, op: dict) -> dict:
    response = client.post(f"/api/projects/{project['id']}/ops", json={"revision": project["revision"], "ops": [op]})
    assert response.status_code == 200, response.text
    project["revision"] = response.json()["revision"]
    return response.json()


def test_publish_unconfigured_answers_the_remedy(client: TestClient, tmp_path: Path) -> None:
    project = create_project(client, tmp_path / "demo.osr")
    response = publish(client, project["id"])
    assert response.status_code == 422
    body = response.json()["error"]
    assert body["code"] == "osr_web_not_configured"
    assert "checkout" in body["remedy"]


@pytest.mark.parametrize("shape", ["missing", "no-adventures"])
def test_publish_shape_test_failures(client: TestClient, tmp_path: Path, shape: str) -> None:
    project = create_project(client, tmp_path / "demo.osr")
    claimed = tmp_path / "not-a-checkout"
    if shape == "no-adventures":
        claimed.mkdir()
    response = publish(client, project["id"], checkout_path=str(claimed))
    assert response.status_code == 422
    body = response.json()["error"]
    assert body["code"] == "osr_web_checkout_invalid"
    assert "adventures/" in body["remedy"]
    # A failed shape test never saves the typed path.
    assert load_config().osr_web_checkout is None


def test_publish_symlink_mode_links_and_saves_the_checkout(client: TestClient, tmp_path: Path) -> None:
    checkout = make_checkout(tmp_path)
    project = create_project(client, tmp_path / "demo.osr")
    response = publish(client, project["id"], checkout_path=str(checkout))
    assert response.status_code == 200, response.text
    destination = checkout / "adventures" / "demo"
    assert response.json() == {"path": str(destination), "mode": "symlink"}
    assert destination.is_symlink()
    assert destination.resolve() == Path(project["path"])
    assert (destination / "adventure.json").is_file()
    # The shape test passed, so the path is saved — the next publish needs no
    # checkout_path.
    assert load_config().osr_web_checkout == str(checkout)
    again = publish(client, project["id"])
    assert again.status_code == 200


def test_a_symlink_publish_republishes_live_on_every_commit(client: TestClient, tmp_path: Path) -> None:
    checkout = make_checkout(tmp_path)
    project = create_project(client, tmp_path / "demo.osr")
    assert publish(client, project["id"], checkout_path=str(checkout)).status_code == 200
    published = checkout / "adventures" / "demo" / "adventure.json"
    before = published.read_bytes()
    commit_op(client, project, {"op": "set_adventure_field", "field": "name", "value": "Renamed"})
    after = published.read_bytes()
    assert after != before
    assert json.loads(after)["payload"]["name"] == "Renamed"


def test_publish_copy_mode_writes_a_snapshot(client: TestClient, tmp_path: Path) -> None:
    checkout = make_checkout(tmp_path)
    project = create_project(client, tmp_path / "demo.osr")
    response = publish(client, project["id"], mode="copy", checkout_path=str(checkout))
    assert response.status_code == 200, response.text
    snapshot = checkout / "adventures" / "demo.json"
    assert response.json() == {"path": str(snapshot), "mode": "copy"}
    assert snapshot.read_bytes() == (Path(project["path"]) / "adventure.json").read_bytes()
    # A snapshot does not republish live.
    commit_op(client, project, {"op": "set_adventure_field", "field": "name", "value": "Renamed"})
    assert json.loads(snapshot.read_bytes())["payload"]["name"] == "Demo"


def test_publish_name_overrides_the_project_stem(client: TestClient, tmp_path: Path) -> None:
    checkout = make_checkout(tmp_path)
    project = create_project(client, tmp_path / "demo.osr")
    response = publish(client, project["id"], name="the-mill", checkout_path=str(checkout))
    assert response.status_code == 200
    assert (checkout / "adventures" / "the-mill").is_symlink()


@pytest.mark.parametrize("name", ["", ".", "..", "a/b", "a\\b"])
def test_publish_rejects_bad_names_as_request_invalid(client: TestClient, tmp_path: Path, name: str) -> None:
    checkout = make_checkout(tmp_path)
    project = create_project(client, tmp_path / "demo.osr")
    response = publish(client, project["id"], name=name, checkout_path=str(checkout))
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "request_invalid"


def test_publish_blocked_by_validation_findings(client: TestClient, tmp_path: Path) -> None:
    checkout = make_checkout(tmp_path)
    project = create_project(client, tmp_path / "demo.osr")
    commit_op(client, project, {"op": "set_town_field", "field": "travel_turns", "value": {"nowhere": 3}})
    response = publish(client, project["id"], checkout_path=str(checkout))
    assert response.status_code == 409
    body = response.json()["error"]
    assert body["code"] == "publish_blocked"
    codes = [finding["code"] for finding in body["details"]["findings"]]
    assert codes == ["travel_unknown_dungeon"]
    assert not (checkout / "adventures" / "demo").exists()
    # The blocking answer still saved the shape-tested path — a later gate
    # failure never costs the user their typed path.
    assert load_config().osr_web_checkout == str(checkout)


def test_lint_warnings_never_block_server_side(client: TestClient, tmp_path: Path) -> None:
    checkout = make_checkout(tmp_path)
    project = create_project(client, tmp_path / "demo.osr")
    result = commit_op(
        client,
        project,
        {
            "op": "create_area",
            "dungeon_id": "dungeon-1",
            "level_number": 1,
            "area_id": "1",
            "cells": [[0, 0]],
        },
    )
    result = commit_op(
        client,
        project,
        {
            "op": "create_area",
            "dungeon_id": "dungeon-1",
            "level_number": 1,
            "area_id": "2",
            "cells": [[0, 0]],
        },
    )
    assert "area_overlap" in [finding["code"] for finding in result["diagnostics"]["lint"]]
    assert publish(client, project["id"], checkout_path=str(checkout)).status_code == 200


def test_collision_answers_publish_destination_exists(client: TestClient, tmp_path: Path) -> None:
    checkout = make_checkout(tmp_path)
    project = create_project(client, tmp_path / "demo.osr")
    assert publish(client, project["id"], checkout_path=str(checkout)).status_code == 200
    response = publish(client, project["id"], mode="copy")
    assert response.status_code == 409
    body = response.json()["error"]
    assert body["code"] == "publish_destination_exists"
    assert "overwrite" in body["remedy"]


def test_a_mode_switch_overwrite_clears_both_candidate_forms(client: TestClient, tmp_path: Path) -> None:
    checkout = make_checkout(tmp_path)
    project = create_project(client, tmp_path / "demo.osr")
    dir_form = checkout / "adventures" / "demo"
    file_form = checkout / "adventures" / "demo.json"
    assert publish(client, project["id"], checkout_path=str(checkout)).status_code == 200
    # symlink → copy: the symlink must not survive beside the snapshot, or
    # osr-web's scan lists a stale twin the moment their bytes diverge.
    assert publish(client, project["id"], mode="copy", overwrite=True).status_code == 200
    assert not dir_form.is_symlink() and not dir_form.exists()
    assert file_form.is_file()
    # copy → symlink: the snapshot must not survive beside the live entry.
    assert publish(client, project["id"], mode="symlink", overwrite=True).status_code == 200
    assert dir_form.is_symlink()
    assert not file_form.exists()


def test_republishing_symlink_onto_its_own_link_is_idempotent(client: TestClient, tmp_path: Path) -> None:
    checkout = make_checkout(tmp_path)
    project = create_project(client, tmp_path / "demo.osr")
    assert publish(client, project["id"], checkout_path=str(checkout)).status_code == 200
    # No overwrite flag needed: the link already resolves to this project.
    response = publish(client, project["id"])
    assert response.status_code == 200
    assert (checkout / "adventures" / "demo").resolve() == Path(project["path"])


def test_overwrite_never_removes_a_real_directory(client: TestClient, tmp_path: Path) -> None:
    checkout = make_checkout(tmp_path)
    project = create_project(client, tmp_path / "demo.osr")
    occupant = checkout / "adventures" / "demo"
    occupant.mkdir()
    (occupant / "adventure.json").write_text("{}")
    response = publish(client, project["id"], overwrite=True, checkout_path=str(checkout))
    assert response.status_code == 409
    body = response.json()["error"]
    assert body["code"] == "publish_destination_exists"
    assert str(occupant) in body["message"]
    assert (occupant / "adventure.json").read_text() == "{}"


def test_overwrite_replaces_a_foreign_file(client: TestClient, tmp_path: Path) -> None:
    checkout = make_checkout(tmp_path)
    project = create_project(client, tmp_path / "demo.osr")
    occupant = checkout / "adventures" / "demo.json"
    occupant.write_text("{}")
    assert publish(client, project["id"], mode="copy", checkout_path=str(checkout)).status_code == 409
    assert publish(client, project["id"], mode="copy", overwrite=True).status_code == 200
    assert json.loads(occupant.read_bytes())["kind"] == "adventure"


def test_publish_writes_nothing_inside_the_project(client: TestClient, tmp_path: Path) -> None:
    checkout = make_checkout(tmp_path)
    project = create_project(client, tmp_path / "demo.osr")
    before = sorted(path.name for path in Path(project["path"]).iterdir())
    assert publish(client, project["id"], checkout_path=str(checkout)).status_code == 200
    assert sorted(path.name for path in Path(project["path"]).iterdir()) == before


def test_config_grows_the_checkout_key_additively(tmp_path: Path) -> None:
    target = tmp_path / "config.json"
    assert AppConfig().osr_web_checkout is None
    save_config(AppConfig(osr_web_checkout="/somewhere/osr-web"), target)
    assert load_config(target).osr_web_checkout == "/somewhere/osr-web"
    # A pre-phase-3 config file (no key) still loads — additive schema.
    target.write_text('{"schema_version": 1, "recents": []}')
    assert load_config(target).osr_web_checkout is None
