"""Sidecar machinery: additive defaults, the patch route, the note cascade, dismissal persistence."""

import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from osreditor.app import create_app
from osreditor.documents import DocumentService, OpenProject
from osreditor.ops import OpBatch
from osreditor.projects import create_native_project, open_project
from osreditor.sidecar import EditorSidecar
from osreditor.store import LocalProjectStore


@pytest.fixture
def client() -> TestClient:
    return TestClient(create_app())


def open_native(tmp_path: Path, name: str = "Demo") -> tuple[DocumentService, OpenProject]:
    service = DocumentService(LocalProjectStore())
    project_dir = tmp_path / "demo.osr"
    create_native_project(service.store, str(project_dir), name)
    return service, open_project(service, project_dir)


def batch(project: OpenProject, *ops: dict) -> OpBatch:
    return OpBatch.model_validate({"revision": project.revision, "ops": list(ops)})


def set_note(service: DocumentService, project: OpenProject, address: str, text: str) -> None:
    from osreditor.sidecar import SetNote

    service.apply_sidecar_patch(project, (SetNote(address=address, text=text),))


# --- additive schema ----------------------------------------------------------


def test_a_phase_one_sidecar_reads_clean() -> None:
    # The exact shape phase 1 wrote: schema_version + provenance only.
    sidecar = EditorSidecar.model_validate(
        {
            "schema_version": 1,
            "provenance": {"created_by": "osr-editor 0.0.1", "osrlib_version": "1.2.0", "created_at": "2026-01-01"},
        }
    )
    assert sidecar.view_state.active_dungeon_id is None
    assert sidecar.notes == {}
    assert sidecar.review == ()
    assert sidecar.auto_reasons == ()


def test_a_provenance_free_sidecar_is_constructible() -> None:
    # A foreign project the editor merely opens has no provenance to claim.
    assert EditorSidecar().provenance is None


def test_a_foreign_projects_first_note_persists_a_provenance_free_sidecar(tmp_path: Path) -> None:
    _, project = open_native(tmp_path)
    (project.path / "editor.json").unlink()  # make the project foreign
    service2 = DocumentService(LocalProjectStore())
    reopened = open_project(service2, project.path)
    assert reopened.sidecar.provenance is None
    set_note(service2, reopened, "town", "The ford floods in spring.")
    written = json.loads((project.path / "editor.json").read_text())
    assert written["provenance"] is None
    assert written["notes"] == {"town": "The ford floods in spring."}


def test_open_does_not_write_a_missing_sidecar(tmp_path: Path) -> None:
    _, project = open_native(tmp_path)
    (project.path / "editor.json").unlink()
    reopened = open_project(DocumentService(LocalProjectStore()), project.path)
    assert reopened.sidecar == EditorSidecar()
    assert not (project.path / "editor.json").exists()


# --- the patch route ----------------------------------------------------------


def test_patch_route_applies_and_answers_the_new_state(client: TestClient, tmp_path: Path) -> None:
    state = client.post("/api/projects", json={"path": str(tmp_path / "demo.osr"), "name": "Demo"}).json()
    response = client.post(
        f"/api/projects/{state['id']}/sidecar",
        json={
            "patches": [
                {"action": "set_note", "address": "dungeon:dungeon-1/level:1", "text": "Start here."},
                {
                    "action": "set_view_state",
                    "view_state": {
                        "active_dungeon_id": "dungeon-1",
                        "active_level_number": 1,
                        "zoom_pan": {"dungeon:dungeon-1/level:1": {"zoom": 1.5, "pan_x": 10, "pan_y": -4}},
                        "review_selection": None,
                    },
                },
            ]
        },
    )
    assert response.status_code == 200
    body = response.json()
    assert body["notes"] == {"dungeon:dungeon-1/level:1": "Start here."}
    assert body["view_state"]["zoom_pan"]["dungeon:dungeon-1/level:1"]["zoom"] == 1.5
    # Persisted atomically; a later GET carries it.
    assert client.get(f"/api/projects/{state['id']}").json()["sidecar"]["notes"] == body["notes"]
    written = json.loads((tmp_path / "demo.osr" / "editor.json").read_text())
    assert written["notes"] == body["notes"]


def test_remove_note_and_undismiss_are_tolerant_no_ops(client: TestClient, tmp_path: Path) -> None:
    state = client.post("/api/projects", json={"path": str(tmp_path / "demo.osr"), "name": "Demo"}).json()
    response = client.post(
        f"/api/projects/{state['id']}/sidecar",
        json={
            "patches": [
                {"action": "remove_note", "address": "town"},
                {"action": "undismiss_flag", "address": "", "flag": "low_confidence"},
            ]
        },
    )
    assert response.status_code == 200


def test_dismissal_marks_round_trip(client: TestClient, forge_workdir: Path) -> None:
    state = client.post("/api/projects/open", json={"path": str(forge_workdir)}).json()
    flag = "connection_ambiguous:no target stated"
    response = client.post(
        f"/api/projects/{state['id']}/sidecar",
        json={"patches": [{"action": "dismiss_flag", "address": "millstone-warrens/1/1", "flag": flag}]},
    )
    assert response.json()["review"] == [{"address": "millstone-warrens/1/1", "flag": flag}]
    response = client.post(
        f"/api/projects/{state['id']}/sidecar",
        json={"patches": [{"action": "undismiss_flag", "address": "millstone-warrens/1/1", "flag": flag}]},
    )
    assert response.json()["review"] == []


def test_dismissal_marks_persist_across_reassembly(client: TestClient, forge_workdir: Path) -> None:
    state = client.post("/api/projects/open", json={"path": str(forge_workdir)}).json()
    flag = "connection_ambiguous:no target stated"
    client.post(
        f"/api/projects/{state['id']}/sidecar",
        json={"patches": [{"action": "dismiss_flag", "address": "millstone-warrens/1/1", "flag": flag}]},
    )
    # A document commit re-assembles; the mark is keyed by the exact flag
    # string, so it survives for as long as the flag it answered does.
    response = client.post(
        f"/api/projects/{state['id']}/ops",
        json={
            "revision": state["revision"],
            "ops": [
                {
                    "op": "set_area_field",
                    "dungeon_id": "millstone-warrens",
                    "level_number": 1,
                    "area_id": "2",
                    "field": "description",
                    "value": "Corrected.",
                }
            ],
        },
    )
    assert response.status_code == 200
    sidecar = client.get(f"/api/projects/{state['id']}").json()["sidecar"]
    assert sidecar["review"] == [{"address": "millstone-warrens/1/1", "flag": flag}]


# --- the note cascade and undo interplay -------------------------------------


def test_rename_dungeon_cascades_notes_in_the_same_commit(tmp_path: Path) -> None:
    service, project = open_native(tmp_path)
    set_note(service, project, "dungeon:dungeon-1", "The vaults.")
    set_note(service, project, "dungeon:dungeon-1/level:1", "Start here.")
    set_note(service, project, "town", "Untouched.")
    service.apply_batch(project, batch(project, {"op": "rename_dungeon", "old_id": "dungeon-1", "new_id": "vaults"}))
    assert project.sidecar.notes == {
        "dungeon:vaults": "The vaults.",
        "dungeon:vaults/level:1": "Start here.",
        "town": "Untouched.",
    }
    written = json.loads((project.path / "editor.json").read_text())
    assert written["notes"] == project.sidecar.notes


def test_undo_replays_the_remap_inversely_and_redo_forward(tmp_path: Path) -> None:
    service, project = open_native(tmp_path)
    set_note(service, project, "dungeon:dungeon-1/level:1", "Start here.")
    service.apply_batch(
        project, batch(project, {"op": "renumber_level", "dungeon_id": "dungeon-1", "old_number": 1, "new_number": 3})
    )
    assert "dungeon:dungeon-1/level:3" in project.sidecar.notes
    service.undo(project)
    assert project.sidecar.notes == {"dungeon:dungeon-1/level:1": "Start here."}
    service.redo(project)
    assert project.sidecar.notes == {"dungeon:dungeon-1/level:3": "Start here."}


def test_note_content_never_rides_the_document_stack(tmp_path: Path) -> None:
    service, project = open_native(tmp_path)
    set_note(service, project, "dungeon:dungeon-1/level:1", "Original.")
    service.apply_batch(
        project, batch(project, {"op": "renumber_level", "dungeon_id": "dungeon-1", "old_number": 1, "new_number": 3})
    )
    # An annotation edit after the commit...
    set_note(service, project, "dungeon:dungeon-1/level:3", "Edited after the renumber.")
    service.undo(project)
    # ...moves with the inverse remap, never reverting to "Original.".
    assert project.sidecar.notes == {"dungeon:dungeon-1/level:1": "Edited after the renumber."}


def test_monster_template_rename_cascades_the_template_note(tmp_path: Path) -> None:
    template = {
        "id": "bespoke-1",
        "name": "Bespoke horror",
        "page": "",
        "ac": 9,
        "ac_ascending": 10,
        "hit_dice": {"count": 1, "die": 8},
        "attacks": [{"attacks": [{"name": "weapon", "by_weapon": True}]}],
        "thac0": 19,
        "attack_bonus": 0,
        "movement": [{"rate_feet": 120, "encounter_rate_feet": 40}],
        "saves": {"values": {"death": 12, "wands": 13, "paralysis": 14, "breath": 15, "spells": 16}, "save_as": "1"},
        "morale": 7,
        "alignment": {"options": ["neutral"]},
        "xp": 10,
        "number_appearing": {"dungeon": {"dice": "1d6"}, "lair": {"dice": "1d6"}},
    }
    service, project = open_native(tmp_path)
    service.apply_batch(project, batch(project, {"op": "add_monster_template", "template": template}))
    set_note(service, project, "monster:bespoke-1", "Ours.")
    service.apply_batch(
        project,
        batch(
            project,
            {"op": "set_monster_template", "template_id": "bespoke-1", "template": {**template, "id": "renamed"}},
        ),
    )
    assert project.sidecar.notes == {"monster:renamed": "Ours."}
    service.undo(project)
    assert project.sidecar.notes == {"monster:bespoke-1": "Ours."}
    service.redo(project)
    assert project.sidecar.notes == {"monster:renamed": "Ours."}


def test_area_rekey_cascades_the_area_note(tmp_path: Path) -> None:
    service, project = open_native(tmp_path)
    service.apply_batch(
        project,
        batch(
            project,
            {"op": "create_area", "dungeon_id": "dungeon-1", "level_number": 1, "area_id": "7", "cells": [[1, 1]]},
        ),
    )
    set_note(service, project, "dungeon:dungeon-1/level:1/area:7", "The bone room.")
    service.apply_batch(
        project,
        batch(
            project,
            {
                "op": "set_area_field",
                "dungeon_id": "dungeon-1",
                "level_number": 1,
                "area_id": "7",
                "field": "id",
                "value": "7a",
            },
        ),
    )
    assert project.sidecar.notes == {"dungeon:dungeon-1/level:1/area:7a": "The bone room."}


def test_removed_areas_note_lies_dormant_and_returns_with_undo(tmp_path: Path) -> None:
    service, project = open_native(tmp_path)
    service.apply_batch(
        project,
        batch(
            project,
            {"op": "create_area", "dungeon_id": "dungeon-1", "level_number": 1, "area_id": "7", "cells": [[1, 1]]},
        ),
    )
    set_note(service, project, "dungeon:dungeon-1/level:1/area:7", "The bone room.")
    service.apply_batch(
        project, batch(project, {"op": "remove_area", "dungeon_id": "dungeon-1", "level_number": 1, "area_id": "7"})
    )
    # RemoveArea leaves the note dormant — no silent loss.
    assert project.sidecar.notes == {"dungeon:dungeon-1/level:1/area:7": "The bone room."}
    service.undo(project)
    assert any(area.id == "7" for area in project.adventure.dungeons[0].levels[0].areas)
    assert project.sidecar.notes == {"dungeon:dungeon-1/level:1/area:7": "The bone room."}


def test_a_cascade_landing_on_a_dormant_note_overwrites_it(tmp_path: Path) -> None:
    service, project = open_native(tmp_path)
    service.apply_batch(
        project,
        batch(
            project,
            {"op": "create_area", "dungeon_id": "dungeon-1", "level_number": 1, "area_id": "7", "cells": [[1, 1]]},
            {"op": "create_area", "dungeon_id": "dungeon-1", "level_number": 1, "area_id": "8", "cells": [[2, 2]]},
        ),
    )
    set_note(service, project, "dungeon:dungeon-1/level:1/area:7", "Dormant soon.")
    set_note(service, project, "dungeon:dungeon-1/level:1/area:8", "The live note.")
    service.apply_batch(
        project, batch(project, {"op": "remove_area", "dungeon_id": "dungeon-1", "level_number": 1, "area_id": "7"})
    )
    service.apply_batch(
        project,
        batch(
            project,
            {
                "op": "set_area_field",
                "dungeon_id": "dungeon-1",
                "level_number": 1,
                "area_id": "8",
                "field": "id",
                "value": "7",
            },
        ),
    )
    # The live entity's note wins — pinned as acceptable for dormant addresses.
    assert project.sidecar.notes == {"dungeon:dungeon-1/level:1/area:7": "The live note."}
