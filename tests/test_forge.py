"""The forge bridge and the forge-backed open: gates, commit protocol, snapshot undo/redo."""

import json
from pathlib import Path

import pytest
from osrforge.contracts.run import RunMeta, Stage, StageStatus

from osreditor.documents import DocumentService, OpenProject
from osreditor.errors import (
    ForgeOverrideInvalidError,
    ForgeWorkdirIncompleteError,
    ForgeWorkdirInvalidError,
    StaleRevisionError,
)
from osreditor.ops import OpBatch
from osreditor.projects import open_project
from osreditor.store import LocalProjectStore, ProjectStore


def open_forge(workdir: Path) -> tuple[DocumentService, OpenProject]:
    service = DocumentService(LocalProjectStore())
    return service, open_project(service, workdir)


def batch(project: OpenProject, *ops: dict) -> OpBatch:
    return OpBatch.model_validate({"revision": project.revision, "ops": list(ops)})


def describe_op(value: str = "Corrected against the printed page.") -> dict:
    return {
        "op": "set_area_field",
        "dungeon_id": "millstone-warrens",
        "level_number": 1,
        "area_id": "2",
        "field": "description",
        "value": value,
    }


# --- the open gates -----------------------------------------------------------


def test_open_assembles_and_carries_the_forge_state(forge_workdir: Path) -> None:
    _, project = open_forge(forge_workdir)
    assert project.type == "forge"
    assert project.forge is not None
    assert project.forge.workdir == forge_workdir.resolve()
    assert project.forge.report.monsters.unresolved == ("rat king",)
    assert project.forge.run.stages[Stage.ASSEMBLE].status == "completed"
    assert project.forge.overrides_bytes == b""
    assert project.dropped_fields == ()
    # The assembled artifacts exist — forge's own writes.
    assert (forge_workdir / "adventure.json").is_file()
    assert (forge_workdir / "report.json").is_file()
    assert (forge_workdir / "previews" / "millstone-warrens.1.svg").is_file()


def test_open_gate_names_the_first_incomplete_stage(forge_workdir: Path) -> None:
    run = RunMeta.model_validate_json((forge_workdir / "run.json").read_text())
    broken = run.with_stage(Stage.CONTENT, StageStatus(status="failed", error="boom"))
    (forge_workdir / "run.json").write_text(broken.model_dump_json(), encoding="utf-8")
    with pytest.raises(ForgeWorkdirIncompleteError) as excinfo:
        open_forge(forge_workdir)
    assert "content" in str(excinfo.value)
    assert "failed" in str(excinfo.value)


def test_open_gate_rejects_unparseable_run_json(forge_workdir: Path) -> None:
    (forge_workdir / "run.json").write_text("{not json", encoding="utf-8")
    with pytest.raises(ForgeWorkdirInvalidError) as excinfo:
        open_forge(forge_workdir)
    assert "run.json" in str(excinfo.value)


def test_open_gate_surfaces_a_broken_overrides_file_verbatim(forge_workdir: Path) -> None:
    (forge_workdir / "overrides.yaml").write_text(
        "monsters:\n  never extracted:\n    template_id: goblin\n    reason: wrong\n",
        encoding="utf-8",
    )
    with pytest.raises(ForgeOverrideInvalidError) as excinfo:
        open_forge(forge_workdir)
    # Forge's own message names the entry and lists the cache's unresolved names.
    assert "never extracted" in str(excinfo.value)
    assert "rat king" in str(excinfo.value)


def test_open_gate_rejects_duplicate_yaml_keys(forge_workdir: Path) -> None:
    (forge_workdir / "overrides.yaml").write_text(
        "areas:\n  millstone-warrens/1/2:\n    description: one\n    reason: r\n"
        "  millstone-warrens/1/2:\n    description: two\n    reason: r\n",
        encoding="utf-8",
    )
    with pytest.raises(ForgeOverrideInvalidError) as excinfo:
        open_forge(forge_workdir)
    assert "duplicate key" in str(excinfo.value)


def test_open_gate_maps_a_missing_stage_cache_to_workdir_invalid(forge_workdir: Path) -> None:
    (forge_workdir / "stages" / "survey.json").unlink()
    with pytest.raises(ForgeWorkdirInvalidError) as excinfo:
        open_forge(forge_workdir)
    assert "survey" in str(excinfo.value)


def test_open_reflects_a_hand_edited_overrides_file(forge_workdir: Path) -> None:
    # Assemble-on-open freshness: the artifacts on disk may be stale against a
    # hand-edited overrides.yaml, so open rebuilds rather than trusting them.
    (forge_workdir / "overrides.yaml").write_text(
        "module:\n  name: The Renamed Warrens\n  reason: hand-corrected title\n",
        encoding="utf-8",
    )
    _, project = open_forge(forge_workdir)
    assert project.adventure.name == "The Renamed Warrens"
    assert project.forge is not None
    assert project.forge.overrides.module is not None
    assert project.forge.overrides.module.reason == "hand-corrected title"


# --- the materialize seam -----------------------------------------------------


def test_local_store_materialize_is_the_identity(tmp_path: Path) -> None:
    store = LocalProjectStore()
    assert store.materialize(str(tmp_path)) == tmp_path


def test_materialize_is_part_of_the_store_protocol() -> None:
    assert isinstance(LocalProjectStore(), ProjectStore)

    class WithoutMaterialize:
        def project_exists(self, project_id: str) -> bool:
            return False

        def list_artifacts(self, project_id: str) -> list[str]:
            return []

        def read_artifact(self, project_id: str, name: str) -> bytes:
            return b""

        def write_artifact(self, project_id: str, name: str, data: bytes) -> None:
            return None

    assert not isinstance(WithoutMaterialize(), ProjectStore)


# --- the commit protocol ------------------------------------------------------


def test_commit_writes_overrides_reassembles_and_refreshes(forge_workdir: Path) -> None:
    service, project = open_forge(forge_workdir)
    assert project.forge is not None
    report_before = project.forge.report
    result = service.apply_batch(project, batch(project, describe_op()))
    assert result.revision == "r2"
    assert result.forge is not None
    # The overrides file holds the entry; the assembled document reflects it.
    text = (forge_workdir / "overrides.yaml").read_text()
    assert "millstone-warrens/1/2" in text
    assert project.adventure.dungeons[0].levels[0].areas[1].description == "Corrected against the printed page."
    # The report refreshed: the area records the overridden field.
    record = next(r for r in result.forge.report.areas if r.id == "millstone-warrens/1/2")
    assert "description" in record.overridden
    assert report_before is not result.forge.report
    # The delta is whole-document — an assembly can move anything.
    assert [change.path for change in result.delta] == [""]


def test_commit_is_revision_guarded(forge_workdir: Path) -> None:
    service, project = open_forge(forge_workdir)
    stale = OpBatch.model_validate({"revision": "r0", "ops": [describe_op()]})
    with pytest.raises(StaleRevisionError):
        service.apply_batch(project, stale)


def test_editor_never_writes_forge_artifacts_itself(forge_workdir: Path) -> None:
    # The reproducibility invariant, behaviorally: after a session of edits,
    # forge's own assemble() over the workdir reproduces the session's
    # artifacts byte for byte — the editor added corrections, never hand-edits.
    from osrforge import assemble

    service, project = open_forge(forge_workdir)
    service.apply_batch(project, batch(project, describe_op()))
    service.apply_batch(
        project,
        batch(
            project,
            {
                "op": "set_town_field",
                "field": "services",
                "value": ["The Wheelhouse inn", "Ferro's smithy", "Maro's chandlery"],
            },
        ),
    )
    adventure_bytes = (forge_workdir / "adventure.json").read_bytes()
    report_bytes = (forge_workdir / "report.json").read_bytes()
    preview_bytes = (forge_workdir / "previews" / "millstone-warrens.1.svg").read_bytes()
    assemble(forge_workdir)
    assert (forge_workdir / "adventure.json").read_bytes() == adventure_bytes
    assert (forge_workdir / "report.json").read_bytes() == report_bytes
    assert (forge_workdir / "previews" / "millstone-warrens.1.svg").read_bytes() == preview_bytes


def test_failed_commit_restores_the_snapshot(forge_workdir: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    import osreditor.documents

    service, project = open_forge(forge_workdir)
    service.apply_batch(project, batch(project, describe_op()))
    assert project.forge is not None
    bytes_before = project.forge.overrides_bytes
    auto_before = project.sidecar.auto_reasons
    revision_before = project.revision
    adventure_before = (forge_workdir / "adventure.json").read_bytes()

    def explode(path: Path) -> object:
        raise ForgeOverrideInvalidError("injected assembly failure")

    monkeypatch.setattr(osreditor.documents, "assemble_workdir", explode)
    with pytest.raises(ForgeOverrideInvalidError):
        service.apply_batch(project, batch(project, describe_op("Another correction.")))
    # The snapshot restored: bytes, ledger, revision, and artifacts unchanged.
    assert (forge_workdir / "overrides.yaml").read_bytes() == bytes_before
    assert project.forge.overrides_bytes == bytes_before
    assert project.sidecar.auto_reasons == auto_before
    assert project.revision == revision_before
    assert (forge_workdir / "adventure.json").read_bytes() == adventure_before


def test_undo_and_redo_restore_snapshot_pairs_exactly(forge_workdir: Path) -> None:
    service, project = open_forge(forge_workdir)
    original_description = project.adventure.dungeons[0].levels[0].areas[1].description
    service.apply_batch(project, batch(project, describe_op()))
    overrides_after = (forge_workdir / "overrides.yaml").read_bytes()
    auto_after = project.sidecar.auto_reasons
    adventure_after = (forge_workdir / "adventure.json").read_bytes()

    result = service.undo(project)
    assert project.adventure.dungeons[0].levels[0].areas[1].description == original_description
    assert (forge_workdir / "overrides.yaml").read_bytes() == b""
    assert project.sidecar.auto_reasons == ()
    assert result.can_redo and not result.can_undo
    assert result.forge is not None

    result = service.redo(project)
    # Exact re-derivation: the restored pair reproduces the artifacts byte for byte.
    assert (forge_workdir / "overrides.yaml").read_bytes() == overrides_after
    assert project.sidecar.auto_reasons == auto_after
    assert (forge_workdir / "adventure.json").read_bytes() == adventure_after
    assert result.can_undo and not result.can_redo


def test_open_never_writes_stays_scoped_to_native(tmp_path: Path) -> None:
    # The native half of the invariant lives in test_projects; this pins the
    # scoping decision: a forge open legitimately rewrites derived artifacts
    # (forge's own writes), so the invariant must not be asserted for it.
    from osreditor.projects import create_native_project

    service = DocumentService(LocalProjectStore())
    project_dir = tmp_path / "demo.osr"
    create_native_project(service.store, str(project_dir), "Demo")
    before = {path: path.stat().st_mtime_ns for path in project_dir.iterdir()}
    open_project(service, project_dir)
    after = {path: path.stat().st_mtime_ns for path in project_dir.iterdir()}
    assert after == before


def test_forge_state_rides_project_state(forge_workdir: Path) -> None:
    from osreditor.documents import forge_state_model

    _, project = open_forge(forge_workdir)
    state = forge_state_model(project)
    assert state is not None
    assert state.checked is False
    assert state.run.page_count == 2
    assert json.loads(state.report.model_dump_json())["monsters"]["unresolved"] == ["rat king"]
