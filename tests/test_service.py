"""The document service: batch application, atomicity, revisions, undo/redo, persistence, deltas."""

import threading
from pathlib import Path

import pytest
from osrlib.crawl.adventure import Adventure, TownSpec
from osrlib.crawl.dungeon import DungeonSpec, LevelSpec, WanderingSpec

import osreditor.documents
from osreditor.documents import DocumentService, OpenProject, dump_adventure
from osreditor.errors import (
    OpRejectedError,
    OpTargetNotFoundError,
    ProjectNotFoundError,
    RedoStackEmptyError,
    StaleRevisionError,
    UndoStackEmptyError,
)
from osreditor.ops import OpBatch, SetAdventureField, SetTownField, SetWandering, SubtreeChange
from osreditor.projects import create_native_project, open_project
from osreditor.store import LocalProjectStore


@pytest.fixture
def service() -> DocumentService:
    return DocumentService(LocalProjectStore())


@pytest.fixture
def project(service: DocumentService, tmp_path: Path) -> OpenProject:
    project_dir = tmp_path / "demo.osr"
    create_native_project(service.store, str(project_dir), "Demo")
    return open_project(service, project_dir)


def batch(project: OpenProject, *ops: SetAdventureField | SetTownField | SetWandering) -> OpBatch:
    return OpBatch(revision=project.revision, ops=ops)


def test_registry_get_unknown_id_raises(service: DocumentService) -> None:
    with pytest.raises(ProjectNotFoundError):
        service.get("feedfacedeadbeef")


def test_registry_get_returns_the_open_project(service: DocumentService, project: OpenProject) -> None:
    assert service.get(project.id) is project


def test_apply_set_adventure_field(service: DocumentService, project: OpenProject) -> None:
    result = service.apply_batch(project, batch(project, SetAdventureField(field="name", value="Renamed")))
    assert project.adventure.name == "Renamed"
    assert result.revision == "r2"
    assert result.delta == (SubtreeChange(path="/name", value="Renamed"),)
    assert result.can_undo and not result.can_redo


def test_apply_hooks_and_town_in_one_batch(service: DocumentService, project: OpenProject) -> None:
    result = service.apply_batch(
        project,
        batch(
            project,
            SetAdventureField(field="hooks", value=("A rumor",)),
            SetTownField(field="name", value="Dusthollow"),
        ),
    )
    assert [change.path for change in result.delta] == ["/hooks", "/town"]
    assert result.delta[0].value == ["A rumor"]
    assert result.delta[1].value == {"name": "Dusthollow", "description": "", "services": [], "travel_turns": {}}


def test_delta_coalesces_repeated_subtrees(service: DocumentService, project: OpenProject) -> None:
    result = service.apply_batch(
        project,
        batch(
            project,
            SetTownField(field="name", value="First"),
            SetTownField(field="description", value="Second"),
        ),
    )
    assert [change.path for change in result.delta] == ["/town"]
    assert result.delta[0].value == {"name": "First", "description": "Second", "services": [], "travel_turns": {}}


def test_set_wandering_resolves_indices(service: DocumentService, tmp_path: Path) -> None:
    level = LevelSpec(number=1, width=3, height=3, entrance=(0, 0))
    adventure = Adventure(
        name="Two dungeons",
        town=TownSpec(name=""),
        dungeons=(
            DungeonSpec(id="first", levels=(level,)),
            DungeonSpec(id="second", levels=(level, LevelSpec(number=2, width=3, height=3))),
        ),
    )
    project_dir = tmp_path / "two.osr"
    service.store.write_artifact(str(project_dir), "adventure.json", dump_adventure(adventure))
    project = open_project(service, project_dir)
    wandering = WanderingSpec(chance_in_six=3, interval_turns=1)
    result = service.apply_batch(
        project, batch(project, SetWandering(dungeon_id="second", level_number=2, wandering=wandering))
    )
    assert result.delta[0].path == "/dungeons/1/levels/1/wandering"
    assert result.delta[0].value == {"chance_in_six": 3, "interval_turns": 1, "table": None}
    assert project.adventure.dungeon("second").level(2).wandering == wandering


@pytest.mark.parametrize(
    "op",
    [
        SetWandering(dungeon_id="nope", level_number=1, wandering=WanderingSpec()),
        SetWandering(dungeon_id="dungeon-1", level_number=9, wandering=WanderingSpec()),
    ],
)
def test_unknown_wandering_target_is_rejected(service: DocumentService, project: OpenProject, op: SetWandering) -> None:
    with pytest.raises(OpTargetNotFoundError):
        service.apply_batch(project, batch(project, op))
    assert project.revision == "r1"


def test_batch_atomicity_discards_earlier_ops(service: DocumentService, project: OpenProject) -> None:
    before = project.adventure
    with pytest.raises(OpTargetNotFoundError):
        service.apply_batch(
            project,
            batch(
                project,
                SetAdventureField(field="name", value="Should not stick"),
                SetWandering(dungeon_id="nope", level_number=1, wandering=WanderingSpec()),
            ),
        )
    assert project.adventure is before
    assert project.revision == "r1"
    assert not project.undo_stack
    data = service.store.read_artifact(str(project.path), "adventure.json")
    assert data == dump_adventure(before)


@pytest.mark.filterwarnings("ignore::UserWarning")  # serializing the corrupted candidate warns, by design
def test_revalidation_rejects_what_op_validation_cannot_see(
    service: DocumentService, project: OpenProject, monkeypatch: pytest.MonkeyPatch
) -> None:
    # No phase 1 op can produce a model-invalid document through its own typed
    # surface, but the round-trip re-validation is the single enforcement point
    # for every future op too — prove it catches a corrupted candidate.
    def corrupting_apply(adventure: Adventure, op: object) -> tuple[Adventure, str]:
        return adventure.model_copy(update={"name": 123}), "/name"

    monkeypatch.setattr(osreditor.documents, "_apply_op", corrupting_apply)
    with pytest.raises(OpRejectedError) as excinfo:
        service.apply_batch(project, batch(project, SetAdventureField(field="name", value="ignored")))
    assert excinfo.value.errors == [{"path": "/name", "message": "Input should be a valid string"}]
    assert project.revision == "r1"


def test_stale_revision_is_rejected_with_the_current_revision(service: DocumentService, project: OpenProject) -> None:
    service.apply_batch(project, batch(project, SetAdventureField(field="name", value="Renamed")))
    stale = OpBatch(revision="r1", ops=(SetAdventureField(field="name", value="Conflicting"),))
    with pytest.raises(StaleRevisionError) as excinfo:
        service.apply_batch(project, stale)
    assert excinfo.value.current_revision == "r2"
    assert project.adventure.name == "Renamed"


def test_undo_redo_round_trip(service: DocumentService, project: OpenProject) -> None:
    original = project.adventure
    service.apply_batch(project, batch(project, SetAdventureField(field="name", value="Renamed")))
    undone = service.undo(project)
    assert project.adventure == original
    assert undone.revision == "r3"
    assert undone.delta[0].path == ""
    assert not undone.can_undo and undone.can_redo
    redone = service.redo(project)
    assert project.adventure.name == "Renamed"
    assert redone.revision == "r4"
    assert redone.can_undo and not redone.can_redo


def test_empty_stacks_raise(service: DocumentService, project: OpenProject) -> None:
    with pytest.raises(UndoStackEmptyError):
        service.undo(project)
    with pytest.raises(RedoStackEmptyError):
        service.redo(project)


def test_commit_clears_the_redo_stack(service: DocumentService, project: OpenProject) -> None:
    service.apply_batch(project, batch(project, SetAdventureField(field="name", value="First")))
    service.undo(project)
    assert project.redo_stack
    service.apply_batch(project, batch(project, SetAdventureField(field="name", value="Second")))
    assert not project.redo_stack


def test_undo_stack_is_bounded_evicting_the_oldest(
    service: DocumentService, project: OpenProject, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(osreditor.documents, "MAX_UNDO_DEPTH", 3)
    for n in range(5):
        service.apply_batch(project, batch(project, SetAdventureField(field="name", value=f"Name {n}")))
    assert len(project.undo_stack) == 3
    for _ in range(3):
        service.undo(project)
    assert project.adventure.name == "Name 1"
    with pytest.raises(UndoStackEmptyError):
        service.undo(project)


def test_every_commit_undo_and_redo_persists(service: DocumentService, project: OpenProject) -> None:
    path = str(project.path)

    def on_disk() -> bytes:
        return service.store.read_artifact(path, "adventure.json")

    service.apply_batch(project, batch(project, SetAdventureField(field="name", value="Renamed")))
    assert on_disk() == dump_adventure(project.adventure)
    service.undo(project)
    assert on_disk() == dump_adventure(project.adventure)
    service.redo(project)
    assert on_disk() == dump_adventure(project.adventure)


def test_diagnostics_react_to_commits(service: DocumentService, project: OpenProject) -> None:
    broken = service.apply_batch(
        project, batch(project, SetTownField(field="travel_turns", value={"no-such-dungeon": 2}))
    )
    assert [finding.code for finding in broken.diagnostics.validation] == ["travel_unknown_dungeon"]
    fixed = service.apply_batch(project, batch(project, SetTownField(field="travel_turns", value={"dungeon-1": 2})))
    assert fixed.diagnostics.validation == ()


def test_concurrent_batches_serialize_without_corruption(service: DocumentService, project: OpenProject) -> None:
    commits_per_thread = 20
    failures: list[Exception] = []

    def hammer(label: str) -> None:
        done = 0
        while done < commits_per_thread:
            attempt = OpBatch(
                revision=project.revision,
                ops=(SetAdventureField(field="name", value=f"{label} {done}"),),
            )
            try:
                service.apply_batch(project, attempt)
            except StaleRevisionError:
                continue
            except Exception as error:
                failures.append(error)
                return
            done += 1

    threads = [threading.Thread(target=hammer, args=(name,)) for name in ("alpha", "beta")]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()
    assert not failures
    assert project.revision == f"r{1 + 2 * commits_per_thread}"
    data = service.store.read_artifact(str(project.path), "adventure.json")
    assert data == dump_adventure(project.adventure)
