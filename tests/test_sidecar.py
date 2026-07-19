"""The sidecar: additive defaults, the patch route, the note cascade with undo/redo, review persistence."""

import json
import shutil
from pathlib import Path

from fastapi.testclient import TestClient

from osreditor.app import create_app
from osreditor.documents import DocumentService
from osreditor.forge_edits import SetMonsterRemap
from osreditor.ops import CreateArea, OpBatch, RemoveArea, RenameDungeon, RenumberLevel, SetAreaField
from osreditor.projects import create_native_project, open_project
from osreditor.sidecar import (
    SIDECAR_ARTIFACT,
    DismissFlag,
    SetNote,
    UndismissFlag,
    read_sidecar,
)
from osreditor.store import LocalProjectStore

FORGE_FIXTURE = Path(__file__).parent / "fixtures" / "forge_workdir"
DUN = "dungeon-1"


def native(tmp_path: Path):
    service = DocumentService(LocalProjectStore())
    path = tmp_path / "demo.osr"
    create_native_project(service.store, str(path), "Demo")
    return service, open_project(service, path)


def area_note_setup(service, project) -> str:
    """Create area a1 with a note, returning its address."""
    service.apply_batch(
        project,
        OpBatch(
            revision=project.revision, ops=(CreateArea(dungeon_id=DUN, level_number=1, area_id="a1", cells=((0, 0),)),)
        ),
    )
    address = f"dungeon:{DUN}/level:1/area:a1"
    service.apply_sidecar_patch(project, (SetNote(address=address, note="Trapped floor."),))
    return address


# --- Additive defaults ---------------------------------------------------------


def test_old_sidecar_reads_clean(tmp_path: Path) -> None:
    # A phase-1 sidecar carries only schema_version + provenance; the phase 5
    # fields default empty.
    store = LocalProjectStore()
    project = str(tmp_path / "old.osr")
    (tmp_path / "old.osr").mkdir()
    store.write_artifact(
        project,
        SIDECAR_ARTIFACT,
        json.dumps(
            {"schema_version": 1, "provenance": {"created_by": "old", "osrlib_version": "1.0", "created_at": "t"}}
        ).encode(),
    )
    sidecar = read_sidecar(store, project)
    assert sidecar.provenance is not None
    assert sidecar.view_state.active_dungeon_id is None
    assert sidecar.notes == {} and sidecar.review == () and sidecar.auto_reasons == ()


# --- The patch route -----------------------------------------------------------


def test_patch_route_sets_and_removes_notes(tmp_path: Path) -> None:
    client = TestClient(create_app())
    state = client.post("/api/projects", json={"path": str(tmp_path / "demo.osr"), "name": "Demo"}).json()
    address = "dungeon:dungeon-1/level:1"
    response = client.post(
        f"/api/projects/{state['id']}/sidecar",
        json={"patches": [{"patch": "set_note", "address": address, "note": "A cold level."}]},
    )
    assert response.status_code == 200
    assert response.json()["sidecar"]["notes"][address] == "A cold level."
    # An empty note clears it.
    cleared = client.post(
        f"/api/projects/{state['id']}/sidecar",
        json={"patches": [{"patch": "set_note", "address": address, "note": ""}]},
    )
    assert cleared.json()["sidecar"]["notes"] == {}


def test_patch_route_dismiss_and_undismiss(tmp_path: Path) -> None:
    service, project = native(tmp_path)
    service.apply_sidecar_patch(project, (DismissFlag(address="", flag="low_confidence:town name unstated"),))
    assert len(project.sidecar.review) == 1
    # Dismissing again is idempotent.
    service.apply_sidecar_patch(project, (DismissFlag(address="", flag="low_confidence:town name unstated"),))
    assert len(project.sidecar.review) == 1
    service.apply_sidecar_patch(project, (UndismissFlag(address="", flag="low_confidence:town name unstated"),))
    assert project.sidecar.review == ()


def test_sidecar_patch_is_not_revision_guarded(tmp_path: Path) -> None:
    service, project = native(tmp_path)
    # A note lands regardless of the document revision — annotation state is
    # single-user, last-write-wins.
    service.apply_batch(
        project,
        OpBatch(
            revision=project.revision, ops=(CreateArea(dungeon_id=DUN, level_number=1, area_id="a1", cells=((0, 0),)),)
        ),
    )
    service.apply_sidecar_patch(project, (SetNote(address="dungeon:dungeon-1/level:1/area:a1", note="Note."),))
    assert project.sidecar.notes == {"dungeon:dungeon-1/level:1/area:a1": "Note."}


# --- The note cascade ----------------------------------------------------------


def test_area_rekey_cascades_the_note_with_undo_redo(tmp_path: Path) -> None:
    service, project = native(tmp_path)
    old = area_note_setup(service, project)
    new = f"dungeon:{DUN}/level:1/area:a2"
    service.apply_batch(
        project,
        OpBatch(
            revision=project.revision,
            ops=(SetAreaField(dungeon_id=DUN, level_number=1, area_id="a1", field="id", value="a2"),),
        ),
    )
    assert project.sidecar.notes == {new: "Trapped floor."}
    service.undo(project)
    assert project.sidecar.notes == {old: "Trapped floor."}
    service.redo(project)
    assert project.sidecar.notes == {new: "Trapped floor."}


def test_rename_dungeon_cascades_the_note(tmp_path: Path) -> None:
    service, project = native(tmp_path)
    area_note_setup(service, project)
    service.apply_batch(project, OpBatch(revision=project.revision, ops=(RenameDungeon(old_id=DUN, new_id="crypt"),)))
    assert project.sidecar.notes == {"dungeon:crypt/level:1/area:a1": "Trapped floor."}
    service.undo(project)
    assert project.sidecar.notes == {f"dungeon:{DUN}/level:1/area:a1": "Trapped floor."}


def test_renumber_level_cascades_the_note(tmp_path: Path) -> None:
    service, project = native(tmp_path)
    area_note_setup(service, project)
    service.apply_batch(
        project, OpBatch(revision=project.revision, ops=(RenumberLevel(dungeon_id=DUN, old_number=1, new_number=4),))
    )
    assert project.sidecar.notes == {f"dungeon:{DUN}/level:4/area:a1": "Trapped floor."}


def test_remove_area_leaves_the_note_dormant_and_undo_restores_it(tmp_path: Path) -> None:
    service, project = native(tmp_path)
    address = area_note_setup(service, project)
    service.apply_batch(
        project, OpBatch(revision=project.revision, ops=(RemoveArea(dungeon_id=DUN, level_number=1, area_id="a1"),))
    )
    # The note is dormant (unrendered) but not lost — RemoveArea does not cascade.
    assert project.sidecar.notes == {address: "Trapped floor."}
    service.undo(project)
    # The area returns and the note is live again.
    assert project.sidecar.notes == {address: "Trapped floor."}


def test_cascade_onto_a_dormant_note_lets_the_live_entity_win(tmp_path: Path) -> None:
    service, project = native(tmp_path)
    # a1 has a note; a2 has a dormant note (its area removed).
    service.apply_batch(
        project,
        OpBatch(
            revision=project.revision,
            ops=(
                CreateArea(dungeon_id=DUN, level_number=1, area_id="a1", cells=((0, 0),)),
                CreateArea(dungeon_id=DUN, level_number=1, area_id="a2", cells=((1, 0),)),
            ),
        ),
    )
    service.apply_sidecar_patch(
        project,
        (
            SetNote(address=f"dungeon:{DUN}/level:1/area:a1", note="Live note."),
            SetNote(address=f"dungeon:{DUN}/level:1/area:a2", note="Dormant note."),
        ),
    )
    service.apply_batch(
        project, OpBatch(revision=project.revision, ops=(RemoveArea(dungeon_id=DUN, level_number=1, area_id="a2"),))
    )
    # Re-key a1 -> a2; the live note overwrites the dormant one.
    service.apply_batch(
        project,
        OpBatch(
            revision=project.revision,
            ops=(SetAreaField(dungeon_id=DUN, level_number=1, area_id="a1", field="id", value="a2"),),
        ),
    )
    assert project.sidecar.notes == {f"dungeon:{DUN}/level:1/area:a2": "Live note."}


# --- Review-mark persistence across re-assembly -------------------------------


def test_review_marks_persist_across_reassembly(tmp_path: Path) -> None:
    workdir = tmp_path / "vault.forge"
    shutil.copytree(FORGE_FIXTURE, workdir)
    service = DocumentService(LocalProjectStore())
    project = open_project(service, workdir)
    flag = "low_confidence:town name unstated"
    service.apply_sidecar_patch(project, (DismissFlag(address="", flag=flag),))
    # A forge commit re-assembles; the sidecar (and its review marks) is untouched.
    service.apply_forge_edits(
        project, project.revision, (SetMonsterRemap(name="drowned one", template_id="hobgoblin"),)
    )
    assert any(mark.flag == flag for mark in project.sidecar.review)
    # And it survives a reopen.
    service.close(project)
    reopened = open_project(service, workdir)
    assert any(mark.flag == flag for mark in reopened.sidecar.review)
