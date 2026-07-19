"""The forge bridge, the open gates, and the forge commit protocol (snapshot undo/redo)."""

import shutil
from pathlib import Path

import pytest
from osrforge.contracts.overrides import ModuleOverride, MonsterOverride, Overrides
from osrforge.contracts.run import Stage, StageStatus
from osrforge.workdir import Workdir

from osreditor.documents import ADVENTURE_ARTIFACT, DocumentService, OpenProject
from osreditor.errors import (
    ForgeOverrideInvalidError,
    ForgeWorkdirIncompleteError,
    ForgeWorkdirInvalidError,
    StaleRevisionError,
)
from osreditor.forge import OVERRIDES_ARTIFACT
from osreditor.projects import open_project
from osreditor.store import LocalProjectStore

FIXTURE = Path(__file__).parent / "fixtures" / "forge_workdir"


def copy_workdir(tmp_path: Path) -> Path:
    """Copy the committed fixture workdir to a temp directory — assembly writes, so the checkout stays clean."""
    workdir = tmp_path / "vault.forge"
    shutil.copytree(FIXTURE, workdir)
    return workdir


def fstate(project: OpenProject):
    """Return a forge project's working state, asserting it is a forge project."""
    assert project.forge is not None
    return project.forge


def open_forge(tmp_path: Path):
    """Open the fixture workdir as a forge project and return `(service, project)`."""
    service = DocumentService(LocalProjectStore())
    return service, open_project(service, copy_workdir(tmp_path))


# --- The materialization seam --------------------------------------------------


def test_materialize_is_identity_for_the_local_store(tmp_path: Path) -> None:
    workdir = copy_workdir(tmp_path)
    assert LocalProjectStore().materialize(str(workdir)) == workdir


# --- Open ----------------------------------------------------------------------


def test_open_forge_workdir_assembles(tmp_path: Path) -> None:
    _, project = open_forge(tmp_path)
    assert project.type == "forge"
    assert project.forge is not None
    assert project.adventure.name == "The Sunken Vault of Ashkar"
    # Four keyed areas across two levels.
    assert len(fstate(project).report.areas) == 4
    # dropped_fields is () — the document arrives as forge's own in-memory models.
    assert project.dropped_fields == ()
    # The overrides start empty and the sidecar defaults (no provenance).
    assert fstate(project).overrides == Overrides()
    assert project.sidecar.provenance is None


def test_open_gate_unparseable_run_json(tmp_path: Path) -> None:
    workdir = copy_workdir(tmp_path)
    (workdir / "run.json").write_text("{}", encoding="utf-8")
    with pytest.raises(ForgeWorkdirInvalidError) as excinfo:
        open_project(DocumentService(LocalProjectStore()), workdir)
    assert "run.json" in str(excinfo.value)


def test_open_gate_incomplete_monsters_stage_names_the_stage(tmp_path: Path) -> None:
    workdir = copy_workdir(tmp_path)
    handle = Workdir(workdir)
    run = handle.read_run().with_stage(Stage.MONSTERS, StageStatus(status="pending"))
    handle.write_run(run)
    with pytest.raises(ForgeWorkdirIncompleteError) as excinfo:
        open_project(DocumentService(LocalProjectStore()), workdir)
    message = str(excinfo.value)
    assert "monsters" in message
    assert "osrforge rerun monsters" in message


def test_open_gate_broken_overrides_passes_forges_message(tmp_path: Path) -> None:
    workdir = copy_workdir(tmp_path)
    # An override addressing a monster name the cache never extracted — forge's
    # loud addressing error, surfaced verbatim.
    (workdir / OVERRIDES_ARTIFACT).write_text(
        "monsters:\n  no such beast:\n    template_id: goblin\n    reason: wrong\n", encoding="utf-8"
    )
    with pytest.raises(ForgeOverrideInvalidError) as excinfo:
        open_project(DocumentService(LocalProjectStore()), workdir)
    assert "no such beast" in str(excinfo.value)


def test_open_reflects_a_hand_edited_overrides_file(tmp_path: Path) -> None:
    workdir = copy_workdir(tmp_path)
    (workdir / OVERRIDES_ARTIFACT).write_text(
        "module:\n  description: A hand-authored pitch.\n  reason: corrected against p. 1\n", encoding="utf-8"
    )
    project = open_project(DocumentService(LocalProjectStore()), workdir)
    assert project.adventure.description == "A hand-authored pitch."


def test_open_writes_forge_artifacts(tmp_path: Path) -> None:
    # Forge open re-assembles — the write is forge's own (adventure.json,
    # report.json, previews), never the editor's; the open-never-writes invariant
    # is scoped to native projects.
    workdir = copy_workdir(tmp_path)
    open_project(DocumentService(LocalProjectStore()), workdir)
    assert (workdir / ADVENTURE_ARTIFACT).is_file()
    assert (workdir / "report.json").is_file()
    assert sorted(p.name for p in (workdir / "previews").glob("*.svg")) == [
        "sunken-vault.1.svg",
        "sunken-vault.2.svg",
    ]


# --- The forge commit protocol -------------------------------------------------


def _module_override(description: str) -> Overrides:
    return Overrides(module=ModuleOverride(description=description, reason="corrected against p. 1"))


def test_commit_writes_overrides_and_refreshes(tmp_path: Path) -> None:
    service, project = open_forge(tmp_path)
    result = service.commit_forge_overrides(
        project, project.revision, _module_override("A corrected pitch."), ("module",)
    )
    assert project.adventure.description == "A corrected pitch."
    assert project.revision == "r2"
    assert result.forge is not None
    assert result.forge.overrides.module is not None
    assert project.sidecar.auto_reasons == ("module",)
    # The overrides.yaml on disk is the reviewable record, normalized.
    text = (Path(project.path) / OVERRIDES_ARTIFACT).read_text()
    assert "description: A corrected pitch." in text
    assert "reason: corrected against p. 1" in text


def test_commit_failure_restores_bytes_and_revision(tmp_path: Path) -> None:
    service, project = open_forge(tmp_path)
    before_revision = project.revision
    before_bytes = (
        (Path(project.path) / OVERRIDES_ARTIFACT).read_bytes()
        if (Path(project.path) / OVERRIDES_ARTIFACT).is_file()
        else b""
    )
    before_adventure = project.adventure.model_dump()
    # A remap on a name the cache never extracted — forge rejects it at assembly,
    # before any artifact write.
    bad = Overrides(monsters={"no such beast": MonsterOverride(template_id="goblin", reason="wrong")})
    with pytest.raises(ForgeOverrideInvalidError):
        service.commit_forge_overrides(project, project.revision, bad, ("monsters:no such beast",))
    # The workdir and the in-memory state are untouched.
    assert project.revision == before_revision
    assert project.adventure.model_dump() == before_adventure
    after_bytes = (
        (Path(project.path) / OVERRIDES_ARTIFACT).read_bytes()
        if (Path(project.path) / OVERRIDES_ARTIFACT).is_file()
        else b""
    )
    assert after_bytes == before_bytes
    assert project.sidecar.auto_reasons == ()


def test_undo_redo_restore_exactly(tmp_path: Path) -> None:
    service, project = open_forge(tmp_path)
    original = project.adventure.description
    service.commit_forge_overrides(project, project.revision, _module_override("Edited."), ("module",))
    assert project.adventure.description == "Edited."

    undo = service.undo(project)
    assert project.adventure.description == original
    assert (Path(project.path) / OVERRIDES_ARTIFACT).read_bytes() == b""
    assert project.sidecar.auto_reasons == ()
    assert undo.can_undo is False and undo.can_redo is True

    redo = service.redo(project)
    assert project.adventure.description == "Edited."
    assert project.sidecar.auto_reasons == ("module",)
    assert redo.can_undo is True and redo.can_redo is False


def test_stale_revision_is_a_409(tmp_path: Path) -> None:
    service, project = open_forge(tmp_path)
    service.commit_forge_overrides(project, project.revision, _module_override("First."), ("module",))
    with pytest.raises(StaleRevisionError):
        service.commit_forge_overrides(project, "r1", _module_override("Second."), ("module",))
