"""The stocking route: determinism, the 409 discipline, one-undo-step, and seed lifecycle.

Seeds ride the typed sidecar patch route (`set_stocking_seed`) so the goldens are
deterministic and byte-stable — identical seed and action sequence yield identical
documents. The blank rooms are created first (the starter project has none), then
stocked.
"""

from pathlib import Path

import pytest
import yaml
from fastapi.testclient import TestClient

from osreditor.app import create_app


@pytest.fixture
def client() -> TestClient:
    return TestClient(create_app())


def new_project(client: TestClient, tmp_path: Path, name: str = "demo") -> dict:
    state = client.post("/api/projects", json={"path": str(tmp_path / f"{name}.osr"), "name": "Demo"})
    assert state.status_code == 201
    return state.json()


def set_seed(client: TestClient, pid: str, seed: str = "42") -> None:
    response = client.post(
        f"/api/projects/{pid}/sidecar",
        json={"patches": [{"action": "set_stocking_seed", "master_seed": seed}]},
    )
    assert response.status_code == 200


def make_blank_areas(client: TestClient, pid: str, revision: str, ids: list[str]) -> str:
    ops = [
        {"op": "create_area", "dungeon_id": "dungeon-1", "level_number": 1, "area_id": area_id, "cells": [[index, 0]]}
        for index, area_id in enumerate(ids)
    ]
    response = client.post(f"/api/projects/{pid}/ops", json={"revision": revision, "ops": ops})
    assert response.status_code == 200
    return response.json()["revision"]


def stock(client: TestClient, pid: str, revision: str, area_id: str | None = None):
    return client.post(
        f"/api/projects/{pid}/aids/stock",
        json={"revision": revision, "dungeon_id": "dungeon-1", "level_number": 1, "area_id": area_id},
    )


def document_bytes(client: TestClient, pid: str) -> dict:
    return client.get(f"/api/projects/{pid}").json()["document"]


class TestStockingDeterminism:
    def test_sweep_stocks_every_unstocked_area_in_key_order(self, client: TestClient, tmp_path: Path) -> None:
        state = new_project(client, tmp_path)
        set_seed(client, state["id"])
        revision = make_blank_areas(client, state["id"], state["revision"], ["1", "2", "3"])
        response = stock(client, state["id"], revision)
        assert response.status_code == 200
        rolls = response.json()["rolls"]
        assert [roll["area_id"] for roll in rolls] == ["1", "2", "3"]  # key order
        # Seed 42 is pinned: area 1 rolls empty-with-unguarded-treasure, 2 and 3 roll monsters.
        assert rolls[0]["contents"] == "empty" and rolls[0]["treasure_present"] is True
        assert rolls[0]["summary"] == ["unguarded"]
        assert rolls[1]["contents"] == "monster" and rolls[2]["contents"] == "monster"
        assert response.json()["result"] is not None  # ops rolled → a real batch

    def test_identical_seed_and_actions_yield_byte_identical_documents(
        self, client: TestClient, tmp_path: Path
    ) -> None:
        docs = []
        for name in ("a", "b"):
            state = new_project(client, tmp_path, name)
            set_seed(client, state["id"], "12345")
            revision = make_blank_areas(client, state["id"], state["revision"], ["1", "2", "3", "4"])
            stock(client, state["id"], revision)
            docs.append(document_bytes(client, state["id"]))
        assert docs[0] == docs[1]

    def test_single_room_roll_targets_only_that_area(self, client: TestClient, tmp_path: Path) -> None:
        state = new_project(client, tmp_path)
        set_seed(client, state["id"])
        revision = make_blank_areas(client, state["id"], state["revision"], ["1", "2"])
        response = stock(client, state["id"], revision, area_id="2")
        assert response.status_code == 200
        rolls = response.json()["rolls"]
        assert len(rolls) == 1 and rolls[0]["area_id"] == "2"


class TestStockingDiscipline:
    def test_rolling_a_stocked_area_is_409(self, client: TestClient, tmp_path: Path) -> None:
        state = new_project(client, tmp_path)
        set_seed(client, state["id"])
        revision = make_blank_areas(client, state["id"], state["revision"], ["1"])
        # Give area 1 a description so it is stocked.
        described = client.post(
            f"/api/projects/{state['id']}/ops",
            json={
                "revision": revision,
                "ops": [
                    {
                        "op": "set_area_field",
                        "dungeon_id": "dungeon-1",
                        "level_number": 1,
                        "area_id": "1",
                        "field": "description",
                        "value": "A described room.",
                    }
                ],
            },
        ).json()["revision"]
        response = stock(client, state["id"], described, area_id="1")
        assert response.status_code == 409
        assert response.json()["error"]["code"] == "aid_target_stocked"

    def test_empty_sweep_is_a_no_op_with_no_revision_bump(self, client: TestClient, tmp_path: Path) -> None:
        state = new_project(client, tmp_path)
        set_seed(client, state["id"])
        # No areas at all → zero targets.
        response = stock(client, state["id"], state["revision"])
        assert response.status_code == 200
        assert response.json() == {"rolls": [], "result": None}
        assert document_bytes(client, state["id"])  # unchanged, still loads
        assert client.get(f"/api/projects/{state['id']}").json()["revision"] == state["revision"]

    def test_stale_revision_is_refused_and_consumes_no_seed_state(self, client: TestClient, tmp_path: Path) -> None:
        state = new_project(client, tmp_path)
        revision = make_blank_areas(client, state["id"], state["revision"], ["1"])
        # A stale revision (the pre-area-creation one) is refused before any die.
        response = stock(client, state["id"], state["revision"], area_id="1")
        assert response.status_code == 409 and response.json()["error"]["code"] == "stale_revision"
        # No master seed was minted — the mechanical refusal touched no seed state.
        sidecar = client.get(f"/api/projects/{state['id']}").json()["sidecar"]
        assert sidecar["stocking"] == {"master_seed": None, "streams": {}}
        # The real revision still stocks.
        assert stock(client, state["id"], revision, area_id="1").status_code == 200

    def test_a_sweep_is_one_undo_step(self, client: TestClient, tmp_path: Path) -> None:
        state = new_project(client, tmp_path)
        set_seed(client, state["id"])
        revision = make_blank_areas(client, state["id"], state["revision"], ["1", "2", "3"])
        before = document_bytes(client, state["id"])
        stock(client, state["id"], revision)
        after = document_bytes(client, state["id"])
        assert after != before  # content landed
        undo = client.post(f"/api/projects/{state['id']}/undo")
        assert undo.status_code == 200
        assert document_bytes(client, state["id"]) == before  # one undo reverts the whole sweep


class TestSeedLifecycle:
    def test_seed_minted_once_then_reused(self, client: TestClient, tmp_path: Path) -> None:
        state = new_project(client, tmp_path)
        revision = make_blank_areas(client, state["id"], state["revision"], ["1", "2"])
        # No seed set: the first roll mints one and persists it.
        first = stock(client, state["id"], revision, area_id="1")
        revision = first.json()["result"]["revision"] if first.json()["result"] else revision
        minted = client.get(f"/api/projects/{state['id']}").json()["sidecar"]["stocking"]["master_seed"]
        assert minted is not None
        # A second roll reuses the same master seed and advances only its own stream.
        stock(client, state["id"], revision, area_id="2")
        stocking = client.get(f"/api/projects/{state['id']}").json()["sidecar"]["stocking"]
        assert stocking["master_seed"] == minted
        assert set(stocking["streams"]) == {
            "dungeon:dungeon-1/level:1/area:1",
            "dungeon:dungeon-1/level:1/area:2",
        }

    def test_undo_does_not_rewind_the_dice(self, client: TestClient, tmp_path: Path) -> None:
        state = new_project(client, tmp_path)
        set_seed(client, state["id"])
        revision = make_blank_areas(client, state["id"], state["revision"], ["1"])
        first = stock(client, state["id"], revision, area_id="1")
        first_area = _area(document_bytes(client, state["id"]), "1")
        assert first.json()["result"] is not None
        client.post(f"/api/projects/{state['id']}/undo")
        # After undo the room is blank again, but the stream stayed advanced —
        # re-rolling honestly yields new content, never a replay of the first roll.
        current = client.get(f"/api/projects/{state['id']}").json()["revision"]
        stock(client, state["id"], current, area_id="1")
        second_area = _area(document_bytes(client, state["id"]), "1")
        assert _content(second_area) != _content(first_area)


class TestForgeStocking:
    def test_stocking_translates_to_override_entries(self, client: TestClient, forge_workdir: Path) -> None:
        state = client.post("/api/projects/open", json={"path": str(forge_workdir)}).json()
        assert state["type"] == "forge"
        pid = state["id"]
        dungeon = state["document"]["dungeons"][0]
        dungeon_id, level_number = dungeon["id"], dungeon["levels"][0]["number"]
        # A fresh blank area (its geometry rides an override), then stock it.
        revision = client.post(
            f"/api/projects/{pid}/ops",
            json={
                "revision": state["revision"],
                "ops": [
                    {
                        "op": "create_area",
                        "dungeon_id": dungeon_id,
                        "level_number": level_number,
                        "area_id": "99",
                        "cells": [[0, 0]],
                    }
                ],
            },
        ).json()["revision"]
        # Seed 5 rolls a monster encounter for this area address.
        set_seed(client, pid, "5")
        response = client.post(
            f"/api/projects/{pid}/aids/stock",
            json={"revision": revision, "dungeon_id": dungeon_id, "level_number": level_number, "area_id": "99"},
        )
        assert response.status_code == 200
        assert response.json()["rolls"][0]["contents"] == "monster"
        # The encounter landed as an overrides.yaml area entry with a reason, hoard included.
        overrides = yaml.safe_load((forge_workdir / "overrides.yaml").read_text())
        entry = overrides["areas"][f"{dungeon_id}/{level_number}/99"]
        assert entry["encounter"]["monsters"][0]["template_id"] == "dwarf_monster"
        assert entry["encounter"]["hoard"] is False
        assert entry["reason"]
        # The assembled document reflects the stocked encounter, and the editor wrote no
        # adventure.json of its own — the workdir's is forge's stamped output.
        after = client.get(f"/api/projects/{pid}").json()["document"]
        area = next(a for a in after["dungeons"][0]["levels"][0]["areas"] if a["id"] == "99")
        assert area["encounter"]["monsters"][0]["template_id"] == "dwarf_monster"


def _area(document: dict, area_id: str) -> dict:
    for area in document["dungeons"][0]["levels"][0]["areas"]:
        if area["id"] == area_id:
            return area
    raise AssertionError(f"no area {area_id!r}")


def _content(area: dict) -> tuple:
    return (area.get("encounter"), area.get("trap"), area.get("treasure"))
