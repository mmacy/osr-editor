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


BESPOKE_TEMPLATE = {
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
"""One bundled template, valid whole — the monster-rename cascades' shared subject."""


def test_monster_template_rename_cascades_the_template_note(tmp_path: Path) -> None:
    template = BESPOKE_TEMPLATE
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


# --- the stocking seed and its cascade parity with notes ---------------------


def plant_stream(service: DocumentService, project: OpenProject, address: str, state: str, inc: str) -> None:
    """Plant one advanced stocking-stream snapshot at an address, the way a stock roll would leave it."""
    from osreditor.sidecar import StockingState, StreamState

    streams = {**project.sidecar.stocking.streams, address: StreamState(state=state, inc=inc)}
    project.sidecar = project.sidecar.model_copy(update={"stocking": StockingState(streams=streams)})
    service.persist_sidecar(project)


def plant_copy(service: DocumentService, project: OpenProject, address: str, entry_id: str = "e-1") -> None:
    """Record one copy at an address, the way a library drop would."""
    from osreditor.sidecar import RecordCopy

    service.apply_sidecar_patch(
        project, (RecordCopy(address=address, pack_identity="/packs/mill.osr", pack_entry_id=entry_id),)
    )


def addressed_keys(project: OpenProject) -> tuple[set[str], set[str], set[str]]:
    """The three addressed maps' key sets — the parity assertions' currency."""
    return (
        set(project.sidecar.notes),
        set(project.sidecar.stocking.streams),
        set(project.sidecar.copies),
    )


def make_area(service: DocumentService, project: OpenProject, area_id: str) -> None:
    service.apply_batch(
        project,
        batch(
            project,
            {"op": "create_area", "dungeon_id": "dungeon-1", "level_number": 1, "area_id": area_id, "cells": [[1, 1]]},
        ),
    )


def test_stream_state_round_trips_128_bit_values_as_decimal_strings() -> None:
    from osreditor.sidecar import StreamState

    # A 128-bit PCG state well above 2^53 — lossless only because it is a string.
    big = str((1 << 127) + 12345)
    value = StreamState.model_validate(StreamState(state=big, inc="3").model_dump())
    assert value.state == big and int(value.state) == (1 << 127) + 12345


def test_set_stocking_seed_sets_the_master_and_clears_streams(tmp_path: Path) -> None:
    from osreditor.sidecar import SetStockingSeed

    service, project = open_native(tmp_path)
    plant_stream(service, project, "dungeon:dungeon-1/level:1/area:7", state="1", inc="3")
    service.apply_sidecar_patch(project, (SetStockingSeed(master_seed="12345678901234567890"),))
    assert project.sidecar.stocking.master_seed == "12345678901234567890"
    assert project.sidecar.stocking.streams == {}


def test_addressed_maps_cascade_key_for_key_on_area_rekey(tmp_path: Path) -> None:
    service, project = open_native(tmp_path)
    make_area(service, project, "7")
    addr = "dungeon:dungeon-1/level:1/area:7"
    set_note(service, project, addr, "The bone room.")
    plant_stream(service, project, addr, state="42", inc="99")
    plant_copy(service, project, addr)
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
    moved = "dungeon:dungeon-1/level:1/area:7a"
    assert addressed_keys(project) == ({moved}, {moved}, {moved})
    # The key followed the re-key; the stream state and the copy records never moved.
    assert project.sidecar.stocking.streams[moved].state == "42"
    assert project.sidecar.copies[moved][0].pack_entry_id == "e-1"
    # Undo and redo keep the three maps key-for-key identical.
    service.undo(project)
    assert addressed_keys(project) == ({addr}, {addr}, {addr})
    assert project.sidecar.stocking.streams[addr].state == "42"
    assert project.sidecar.copies[addr][0].pack_entry_id == "e-1"
    service.redo(project)
    assert addressed_keys(project) == ({moved}, {moved}, {moved})


def test_addressed_maps_cascade_on_dungeon_rename_and_level_renumber(tmp_path: Path) -> None:
    service, project = open_native(tmp_path)
    make_area(service, project, "7")
    addr = "dungeon:dungeon-1/level:1/area:7"
    set_note(service, project, addr, "note")
    plant_stream(service, project, addr, state="7", inc="9")
    plant_copy(service, project, addr)
    service.apply_batch(project, batch(project, {"op": "rename_dungeon", "old_id": "dungeon-1", "new_id": "vaults"}))
    after_rename = "dungeon:vaults/level:1/area:7"
    assert addressed_keys(project) == ({after_rename}, {after_rename}, {after_rename})
    service.apply_batch(
        project, batch(project, {"op": "renumber_level", "dungeon_id": "vaults", "old_number": 1, "new_number": 3})
    )
    after_renumber = "dungeon:vaults/level:3/area:7"
    assert addressed_keys(project) == ({after_renumber}, {after_renumber}, {after_renumber})
    # Parity holds through undo/redo of both re-keying ops, and the stream state
    # never rewinds — only the key follows history.
    service.undo(project)  # undo the renumber
    assert addressed_keys(project) == ({after_rename}, {after_rename}, {after_rename})
    service.undo(project)  # undo the rename
    assert addressed_keys(project) == ({addr}, {addr}, {addr})
    assert project.sidecar.stocking.streams[addr].state == "7"
    service.redo(project)
    service.redo(project)
    assert addressed_keys(project) == ({after_renumber}, {after_renumber}, {after_renumber})
    assert project.sidecar.stocking.streams[after_renumber].state == "7"
    assert project.sidecar.copies[after_renumber][0].pack_identity == "/packs/mill.osr"


def test_a_monster_rename_cascades_no_copy_keys(tmp_path: Path) -> None:
    # Copy records key on area and level addresses; the monster segment kind is
    # phase 12's (template adoption). A monster template rename moves the
    # monster-keyed note and must leave the area-keyed copy records alone.
    service, project = open_native(tmp_path)
    make_area(service, project, "7")
    service.apply_batch(project, batch(project, {"op": "add_monster_template", "template": BESPOKE_TEMPLATE}))
    plant_copy(service, project, "dungeon:dungeon-1/level:1/area:7")
    set_note(service, project, "monster:bespoke-1", "Ours.")
    service.apply_batch(
        project,
        batch(
            project,
            {
                "op": "set_monster_template",
                "template_id": "bespoke-1",
                "template": {**BESPOKE_TEMPLATE, "id": "renamed"},
            },
        ),
    )
    assert project.sidecar.notes == {"monster:renamed": "Ours."}
    assert set(project.sidecar.copies) == {"dungeon:dungeon-1/level:1/area:7"}
    service.undo(project)
    assert project.sidecar.notes == {"monster:bespoke-1": "Ours."}
    assert set(project.sidecar.copies) == {"dungeon:dungeon-1/level:1/area:7"}


def test_a_map_with_only_one_key_populated_still_cascades(tmp_path: Path) -> None:
    # The maps are keyed independently; a stocked room the author never annotated
    # still remaps — the guard must not skip when only one map has the key.
    service, project = open_native(tmp_path)
    make_area(service, project, "7")
    plant_stream(service, project, "dungeon:dungeon-1/level:1/area:7", state="5", inc="7")
    service.apply_batch(project, batch(project, {"op": "rename_dungeon", "old_id": "dungeon-1", "new_id": "vaults"}))
    assert set(project.sidecar.stocking.streams) == {"dungeon:vaults/level:1/area:7"}
    assert project.sidecar.notes == {}
    service.apply_batch(project, batch(project, {"op": "rename_dungeon", "old_id": "vaults", "new_id": "deeps"}))
    assert set(project.sidecar.stocking.streams) == {"dungeon:deeps/level:1/area:7"}


def test_a_copy_with_no_paired_note_or_stream_still_cascades(tmp_path: Path) -> None:
    service, project = open_native(tmp_path)
    make_area(service, project, "7")
    plant_copy(service, project, "dungeon:dungeon-1/level:1/area:7")
    service.apply_batch(project, batch(project, {"op": "rename_dungeon", "old_id": "dungeon-1", "new_id": "vaults"}))
    assert set(project.sidecar.copies) == {"dungeon:vaults/level:1/area:7"}
    assert project.sidecar.notes == {} and project.sidecar.stocking.streams == {}


# --- the copies map and the stash patches ------------------------------------


def test_record_copy_appends_and_dedupes(tmp_path: Path) -> None:
    from osreditor.sidecar import RecordCopy

    service, project = open_native(tmp_path)
    addr = "dungeon:dungeon-1/level:1/area:7"
    plant_copy(service, project, addr, entry_id="e-1")
    plant_copy(service, project, addr, entry_id="e-1")
    plant_copy(service, project, addr, entry_id="e-2")
    service.apply_sidecar_patch(project, (RecordCopy(address=addr, pack_identity="stash-1", pack_entry_id="e-1"),))
    records = project.sidecar.copies[addr]
    # The identical triple never doubles; a differing entry or identity appends.
    assert [(record.pack_identity, record.pack_entry_id) for record in records] == [
        ("/packs/mill.osr", "e-1"),
        ("/packs/mill.osr", "e-2"),
        ("stash-1", "e-1"),
    ]


def test_copy_records_go_dormant_on_area_removal_and_survive_undo(tmp_path: Path) -> None:
    service, project = open_native(tmp_path)
    make_area(service, project, "7")
    addr = "dungeon:dungeon-1/level:1/area:7"
    plant_copy(service, project, addr)
    service.apply_batch(
        project, batch(project, {"op": "remove_area", "dungeon_id": "dungeon-1", "level_number": 1, "area_id": "7"})
    )
    # RemoveArea leaves the record dormant — the notes rule; undoing the drop
    # (or the removal) never unearns the badge.
    assert set(project.sidecar.copies) == {addr}
    service.undo(project)
    assert set(project.sidecar.copies) == {addr}


def test_remove_stash_pack_removes_and_tolerates_the_absent(tmp_path: Path) -> None:
    from osreditor.library import stash_level
    from osreditor.sidecar import RemoveStashPack

    service, project = open_native(tmp_path)
    stash_level(service, project, project.revision, "dungeon-1", 1)
    assert [pack.pack_id for pack in project.sidecar.stash] == ["stash-1"]
    service.apply_sidecar_patch(project, (RemoveStashPack(pack_id="stash-1"),))
    assert project.sidecar.stash == ()
    # The unguarded channel's tolerance: removing the absent is a no-op.
    service.apply_sidecar_patch(project, (RemoveStashPack(pack_id="stash-1"),))
    assert project.sidecar.stash == ()


def test_a_sidecar_carrying_stash_content_is_byte_stable(tmp_path: Path) -> None:
    from osreditor.documents import canonical_json_bytes
    from osreditor.library import stash_level
    from osreditor.sidecar import load_sidecar

    service, project = open_native(tmp_path)
    make_area(service, project, "7")
    plant_copy(service, project, "dungeon:dungeon-1/level:1/area:7")
    stash_level(service, project, project.revision, "dungeon-1", 1)
    written = (project.path / "editor.json").read_bytes()
    reloaded = load_sidecar(service.store, str(project.path))
    assert canonical_json_bytes(reloaded.model_dump(mode="json")) == written
