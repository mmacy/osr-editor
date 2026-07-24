"""The prose route: fixture replay, provider gating, the 502 mapping, and no secrets.

CI never calls a live provider: every draft replays a fixture recorded through
forge's own `RecordingProvider` over a stub, so the record→replay path is exercised
end to end. A missing fixture is forge's `FixtureMissError` (a `ProviderError`),
which is exactly how a failed upstream generate maps to 502.
"""

from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from osrforge.contracts.run import TokenUsage
from osrforge.providers.base import ModelRequest, ModelResponse
from osrforge.providers.fixtures import RecordingProvider

from osreditor.aids import (
    build_area_facts,
    build_area_prose_request,
    build_hooks_facts,
    build_hooks_prose_request,
)
from osreditor.app import create_app


@pytest.fixture
def app() -> FastAPI:
    return create_app()


@pytest.fixture
def client(app: FastAPI) -> TestClient:
    return TestClient(app)


class _StubProvider:
    """A deterministic inner provider so RecordingProvider writes a real fixture."""

    def __init__(self, data: object) -> None:
        self.data = data

    def generate(self, request: ModelRequest) -> ModelResponse:
        return ModelResponse(data=self.data, usage=TokenUsage(input_tokens=111, output_tokens=42), model_id="stub-1")


def set_fixtures_provider(client: TestClient, fixtures_dir: Path) -> None:
    response = client.post("/api/provider", json={"kind": "fixtures", "fixtures_dir": str(fixtures_dir)})
    assert response.status_code == 200 and response.json()["configured"] is True


def record(app: FastAPI, fixtures_dir: Path, request: ModelRequest, data: object) -> None:
    RecordingProvider(_StubProvider(data), fixtures_dir).generate(request)


def project_with_room(client: TestClient, app: FastAPI, tmp_path: Path) -> tuple[str, object]:
    state = client.post("/api/projects", json={"path": str(tmp_path / "p.osr"), "name": "Cellar"}).json()
    pid, revision = state["id"], state["revision"]
    revision = client.post(
        f"/api/projects/{pid}/ops",
        json={
            "revision": revision,
            "ops": [
                {"op": "create_area", "dungeon_id": "dungeon-1", "level_number": 1, "area_id": "3", "cells": [[1, 1]]}
            ],
        },
    ).json()["revision"]
    adventure = app.state.service.get(pid).adventure
    return pid, adventure


class TestProseReplay:
    def test_area_prose_replays_a_recorded_fixture(self, client: TestClient, app: FastAPI, tmp_path: Path) -> None:
        pid, adventure = project_with_room(client, app, tmp_path)
        fixtures = tmp_path / "prose"
        draft = "A low, damp cellar. Fungus glows faintly along the mortar."
        record(
            app,
            fixtures,
            build_area_prose_request(build_area_facts(adventure, "dungeon-1", 1, "3")),
            {"description": draft},
        )
        set_fixtures_provider(client, fixtures)
        response = client.post(
            f"/api/projects/{pid}/aids/prose",
            json={"kind": "area", "dungeon_id": "dungeon-1", "level_number": 1, "area_id": "3"},
        )
        assert response.status_code == 200
        body = response.json()
        assert body == {
            "kind": "area",
            "description": draft,
            "usage": {"input_tokens": 111, "output_tokens": 42},
            "model_id": "stub-1",
        }

    def test_hooks_prose_replays_the_complete_list(self, client: TestClient, app: FastAPI, tmp_path: Path) -> None:
        pid, adventure = project_with_room(client, app, tmp_path)
        fixtures = tmp_path / "prose"
        hooks = ["A miller's wife offers coin for her lost ring.", "Strange lights flicker under the old mill."]
        record(app, fixtures, build_hooks_prose_request(build_hooks_facts(adventure)), {"hooks": hooks})
        set_fixtures_provider(client, fixtures)
        response = client.post(f"/api/projects/{pid}/aids/prose", json={"kind": "hooks"})
        assert response.status_code == 200
        assert response.json()["hooks"] == hooks


class TestProseGating:
    def test_unconfigured_provider_is_422(self, client: TestClient, app: FastAPI, tmp_path: Path) -> None:
        pid, _ = project_with_room(client, app, tmp_path)
        response = client.post(
            f"/api/projects/{pid}/aids/prose",
            json={"kind": "area", "dungeon_id": "dungeon-1", "level_number": 1, "area_id": "3"},
        )
        assert response.status_code == 422 and response.json()["error"]["code"] == "provider_not_configured"

    def test_a_failed_generate_is_502(self, client: TestClient, app: FastAPI, tmp_path: Path) -> None:
        pid, _ = project_with_room(client, app, tmp_path)
        empty = tmp_path / "empty-prose"
        empty.mkdir()
        set_fixtures_provider(client, empty)  # no recorded fixture → FixtureMissError
        response = client.post(
            f"/api/projects/{pid}/aids/prose",
            json={"kind": "area", "dungeon_id": "dungeon-1", "level_number": 1, "area_id": "3"},
        )
        assert response.status_code == 502 and response.json()["error"]["code"] == "provider_request_failed"

    def test_a_missing_area_is_op_target_not_found(self, client: TestClient, app: FastAPI, tmp_path: Path) -> None:
        pid, adventure = project_with_room(client, app, tmp_path)
        fixtures = tmp_path / "prose"
        # A configured provider so the target check (not the provider gate) fires.
        record(
            app,
            fixtures,
            build_area_prose_request(build_area_facts(adventure, "dungeon-1", 1, "3")),
            {"description": "x"},
        )
        set_fixtures_provider(client, fixtures)
        response = client.post(
            f"/api/projects/{pid}/aids/prose",
            json={"kind": "area", "dungeon_id": "dungeon-1", "level_number": 1, "area_id": "nope"},
        )
        assert response.status_code == 422 and response.json()["error"]["code"] == "op_target_not_found"

    def test_response_carries_no_secret(self, client: TestClient, app: FastAPI, tmp_path: Path) -> None:
        pid, adventure = project_with_room(client, app, tmp_path)
        fixtures = tmp_path / "prose"
        record(
            app,
            fixtures,
            build_area_prose_request(build_area_facts(adventure, "dungeon-1", 1, "3")),
            {"description": "x"},
        )
        set_fixtures_provider(client, fixtures)
        response = client.post(
            f"/api/projects/{pid}/aids/prose",
            json={"kind": "area", "dungeon_id": "dungeon-1", "level_number": 1, "area_id": "3"},
        )
        assert "api_key" not in response.text and "secret" not in response.text.lower()
