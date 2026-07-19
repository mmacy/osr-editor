"""Override-level edits: monster remaps, stat-block patches, exclusivity, reason and entry edits."""

import shutil
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from osrforge.contracts.stages import StatBlocks
from osrforge.workdir import Workdir

from osreditor.app import create_app
from osreditor.documents import DocumentService, OpenProject
from osreditor.errors import ForgeOverrideInvalidError, OpTargetNotFoundError, StaleRevisionError
from osreditor.forge_edits import (
    RemoveEntry,
    RemoveMonsterRemap,
    RemoveTemplatePatch,
    SetMonsterRemap,
    SetReason,
    SetTemplatePatch,
    StatBlockPatch,
)
from osreditor.projects import open_project
from osreditor.store import LocalProjectStore

FIXTURE = Path(__file__).parent / "fixtures" / "forge_workdir"


def fstate(project: OpenProject):
    assert project.forge is not None
    return project.forge


def open_forge(tmp_path: Path):
    workdir = tmp_path / "vault.forge"
    shutil.copytree(FIXTURE, workdir)
    service = DocumentService(LocalProjectStore())
    return service, open_project(service, workdir)


def apply(service, project, *edits):
    return service.apply_forge_edits(project, project.revision, tuple(edits))


# --- Monster remaps ------------------------------------------------------------


def test_set_monster_remap_applies_with_auto_reason(tmp_path: Path) -> None:
    service, project = open_forge(tmp_path)
    apply(service, project, SetMonsterRemap(name="Drowned One", template_id="hobgoblin"))
    # The key normalizes (casefold + whitespace collapse).
    entry = fstate(project).overrides.monsters["drowned one"]
    assert entry.template_id == "hobgoblin"
    assert entry.reason == "remapped to hobgoblin"
    assert "monsters:drowned one" in project.sidecar.auto_reasons


def test_remove_monster_remap(tmp_path: Path) -> None:
    service, project = open_forge(tmp_path)
    apply(service, project, SetMonsterRemap(name="drowned one", template_id="hobgoblin"))
    apply(service, project, RemoveMonsterRemap(name="drowned one"))
    assert "drowned one" not in fstate(project).overrides.monsters
    assert "monsters:drowned one" not in project.sidecar.auto_reasons


def test_remap_on_unknown_name_fails_at_commit(tmp_path: Path) -> None:
    service, project = open_forge(tmp_path)
    before = project.revision
    with pytest.raises(ForgeOverrideInvalidError) as excinfo:
        apply(service, project, SetMonsterRemap(name="no such beast", template_id="goblin"))
    # Forge's loud addressing error surfaces verbatim, and the commit is undone.
    assert "no such beast" in str(excinfo.value)
    assert project.revision == before
    assert fstate(project).overrides.monsters == {}


# --- Stat-block patches --------------------------------------------------------


def test_set_template_patch_applies(tmp_path: Path) -> None:
    service, project = open_forge(tmp_path)
    apply(service, project, SetTemplatePatch(name="vault warden", patch=StatBlockPatch(ac="2", hit_dice="5")))
    entry = fstate(project).overrides.monster_templates["vault warden"]
    assert entry.ac == "2" and entry.hit_dice == "5"
    assert entry.reason == "printed stat block corrected for vault warden"


def test_remove_template_patch(tmp_path: Path) -> None:
    service, project = open_forge(tmp_path)
    apply(service, project, SetTemplatePatch(name="vault warden", patch=StatBlockPatch(ac="2")))
    apply(service, project, RemoveTemplatePatch(name="vault warden"))
    assert "vault warden" not in fstate(project).overrides.monster_templates


def test_template_patch_under_custom_monsters_off_surfaces_forges_remedy(tmp_path: Path) -> None:
    service, project = open_forge(tmp_path)
    # Rewrite the stat-block cache to the `off` echo — a template override cannot
    # take effect, and forge says so verbatim.
    workdir = Workdir(Path(project.path))
    workdir.statblocks_json.write_text(StatBlocks(custom_monsters="off").model_dump_json(indent=2), encoding="utf-8")
    with pytest.raises(ForgeOverrideInvalidError) as excinfo:
        apply(service, project, SetTemplatePatch(name="drowned one", patch=StatBlockPatch(ac="6", hit_dice="1")))
    assert "custom_monsters" in str(excinfo.value)


# --- Exclusivity ---------------------------------------------------------------


def test_remap_deletes_a_prior_template_patch(tmp_path: Path) -> None:
    service, project = open_forge(tmp_path)
    apply(service, project, SetTemplatePatch(name="drowned one", patch=StatBlockPatch(ac="6", hit_dice="1")))
    apply(service, project, SetMonsterRemap(name="drowned one", template_id="hobgoblin"))
    overrides = fstate(project).overrides
    assert "drowned one" in overrides.monsters
    assert "drowned one" not in overrides.monster_templates


def test_template_patch_deletes_a_prior_remap(tmp_path: Path) -> None:
    service, project = open_forge(tmp_path)
    apply(service, project, SetMonsterRemap(name="drowned one", template_id="hobgoblin"))
    apply(service, project, SetTemplatePatch(name="drowned one", patch=StatBlockPatch(ac="6", hit_dice="1")))
    overrides = fstate(project).overrides
    assert "drowned one" not in overrides.monsters
    assert "drowned one" in overrides.monster_templates


# --- Reason and entry edits ----------------------------------------------------


def test_set_reason_marks_human_composed(tmp_path: Path) -> None:
    service, project = open_forge(tmp_path)
    apply(service, project, SetMonsterRemap(name="drowned one", template_id="hobgoblin"))
    assert "monsters:drowned one" in project.sidecar.auto_reasons
    apply(service, project, SetReason(kind="monsters", key="drowned one", reason="A deliberate choice."))
    assert fstate(project).overrides.monsters["drowned one"].reason == "A deliberate choice."
    assert "monsters:drowned one" not in project.sidecar.auto_reasons


def test_set_reason_on_missing_entry_is_a_target_miss(tmp_path: Path) -> None:
    service, project = open_forge(tmp_path)
    with pytest.raises(OpTargetNotFoundError):
        apply(service, project, SetReason(kind="monsters", key="nobody", reason="x"))


def test_remove_entry(tmp_path: Path) -> None:
    service, project = open_forge(tmp_path)
    apply(service, project, SetMonsterRemap(name="drowned one", template_id="hobgoblin"))
    apply(service, project, RemoveEntry(kind="monsters", key="drowned one"))
    assert "drowned one" not in fstate(project).overrides.monsters


def test_each_edit_is_one_undo_step(tmp_path: Path) -> None:
    service, project = open_forge(tmp_path)
    apply(service, project, SetMonsterRemap(name="drowned one", template_id="hobgoblin"))
    apply(service, project, SetMonsterRemap(name="vault warden", template_id="skeleton"))
    assert len(fstate(project).overrides.monsters) == 2
    service.undo(project)
    assert len(fstate(project).overrides.monsters) == 1
    service.undo(project)
    assert len(fstate(project).overrides.monsters) == 0


def test_stale_revision_rejects(tmp_path: Path) -> None:
    service, project = open_forge(tmp_path)
    apply(service, project, SetMonsterRemap(name="drowned one", template_id="hobgoblin"))
    with pytest.raises(StaleRevisionError):
        service.apply_forge_edits(project, "r1", (SetMonsterRemap(name="vault warden", template_id="skeleton"),))


# --- The route -----------------------------------------------------------------


def test_route_applies_and_guards_native(tmp_path: Path) -> None:
    client = TestClient(create_app())
    workdir = tmp_path / "vault.forge"
    shutil.copytree(FIXTURE, workdir)
    opened = client.post("/api/projects/open", json={"path": str(workdir)}).json()
    body = {
        "revision": opened["revision"],
        "edits": [{"edit": "set_monster_remap", "name": "drowned one", "template_id": "hobgoblin"}],
    }
    response = client.post(f"/api/projects/{opened['id']}/forge/overrides", json=body)
    assert response.status_code == 200
    assert response.json()["forge"]["overrides"]["monsters"]["drowned one"]["template_id"] == "hobgoblin"

    # The same route on a native project is guarded.
    native = client.post("/api/projects", json={"path": str(tmp_path / "native.osr"), "name": "N"}).json()
    guarded = client.post(f"/api/projects/{native['id']}/forge/overrides", json=body)
    assert guarded.status_code == 422
    assert guarded.json()["error"]["code"] == "not_a_forge_project"
