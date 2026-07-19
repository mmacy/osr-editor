"""Content ops through the service: apply and reject per invariant, delta pointers, atomicity."""

from pathlib import Path

import pytest
from osrlib.crawl.adventure import Adventure, TownSpec
from osrlib.crawl.dungeon import (
    AreaSpec,
    AreaTreasureSpec,
    DungeonSpec,
    FeatureSpec,
    KeyedEncounter,
    KeyedMonster,
    LevelSpec,
    TrapEffect,
    TrapSpec,
)

from osreditor.documents import DocumentService, OpenProject, dump_adventure
from osreditor.errors import OpInvariantError, OpRejectedError, OpTargetNotFoundError
from osreditor.ops import (
    AddFeature,
    AnyEditOp,
    OpBatch,
    RemoveFeature,
    SetEncounter,
    SetFeature,
    SetTrap,
    SetTreasure,
)
from osreditor.projects import open_project
from osreditor.store import LocalProjectStore

ROOM_TRAP = TrapSpec(kind="room", trigger="enter", effect=TrapEffect(damage_dice="1d6"))
TREASURE_TRAP = TrapSpec(kind="treasure", trigger="open", effect=TrapEffect(damage_dice="1d4"))
SKELETONS = KeyedEncounter(monsters=(KeyedMonster(template_id="skeleton", count_dice="1d6"),))


def area(**overrides: object) -> AreaSpec:
    values: dict[str, object] = {"id": "1", "cells": ((1, 1),)}
    values.update(overrides)
    return AreaSpec.model_validate(values)


def level(**overrides: object) -> LevelSpec:
    values: dict[str, object] = {"number": 1, "width": 3, "height": 3, "entrance": (0, 0), "areas": (area(),)}
    values.update(overrides)
    return LevelSpec.model_validate(values)


def feature(**overrides: object) -> FeatureSpec:
    values: dict[str, object] = {"id": "feature-1", "kind": "custom", "cell": (1, 1)}
    values.update(overrides)
    return FeatureSpec.model_validate(values)


@pytest.fixture
def service() -> DocumentService:
    return DocumentService(LocalProjectStore())


def make_project(service: DocumentService, tmp_path: Path, *levels: LevelSpec) -> OpenProject:
    adventure = Adventure(
        name="Fixture",
        town=TownSpec(name=""),
        dungeons=(DungeonSpec(id="d", levels=levels or (level(),)),),
    )
    project_dir = tmp_path / "fixture.osr"
    service.store.write_artifact(str(project_dir), "adventure.json", dump_adventure(adventure))
    return open_project(service, project_dir)


def commit(service: DocumentService, project: OpenProject, *ops: AnyEditOp):
    return service.apply_batch(project, OpBatch(revision=project.revision, ops=ops))


def reject(service: DocumentService, project: OpenProject, error: type[Exception], *ops: AnyEditOp) -> Exception:
    before = project.adventure
    with pytest.raises(error) as excinfo:
        commit(service, project, *ops)
    assert project.adventure is before
    assert project.revision == "r1"
    return excinfo.value


def the_area(project: OpenProject, index: int = 0) -> AreaSpec:
    return project.adventure.dungeons[0].levels[0].areas[index]


def the_level(project: OpenProject) -> LevelSpec:
    return project.adventure.dungeons[0].levels[0]


# --- encounter ---


def test_set_encounter_applies_with_the_indexed_area_pointer(service: DocumentService, tmp_path: Path) -> None:
    project = make_project(service, tmp_path)
    result = commit(service, project, SetEncounter(dungeon_id="d", level_number=1, area_id="1", encounter=SKELETONS))
    assert the_area(project).encounter == SKELETONS
    assert result.delta[0].path == "/dungeons/0/levels/0/areas/0"


def test_set_encounter_replaces_and_clears(service: DocumentService, tmp_path: Path) -> None:
    project = make_project(service, tmp_path, level(areas=(area(encounter=SKELETONS),)))
    replacement = KeyedEncounter(monsters=(KeyedMonster(template_id="orc", count_fixed=4),), aware=True)
    commit(service, project, SetEncounter(dungeon_id="d", level_number=1, area_id="1", encounter=replacement))
    assert the_area(project).encounter == replacement
    commit(service, project, SetEncounter(dungeon_id="d", level_number=1, area_id="1", encounter=None))
    assert the_area(project).encounter is None


def test_set_encounter_admits_a_dangling_template_id(service: DocumentService, tmp_path: Path) -> None:
    project = make_project(service, tmp_path)
    dangling = KeyedEncounter(monsters=(KeyedMonster(template_id="no-such-monster", count_fixed=1),))
    result = commit(service, project, SetEncounter(dungeon_id="d", level_number=1, area_id="1", encounter=dangling))
    assert the_area(project).encounter == dangling
    assert "encounter_unknown_monster" in [finding.code for finding in result.diagnostics.validation]


# --- trap ---


def test_set_trap_applies_and_clears(service: DocumentService, tmp_path: Path) -> None:
    project = make_project(service, tmp_path)
    result = commit(service, project, SetTrap(dungeon_id="d", level_number=1, area_id="1", trap=ROOM_TRAP))
    assert the_area(project).trap == ROOM_TRAP
    assert result.delta[0].path == "/dungeons/0/levels/0/areas/0"
    commit(service, project, SetTrap(dungeon_id="d", level_number=1, area_id="1", trap=None))
    assert the_area(project).trap is None


def test_a_wrong_kind_trap_is_op_rejected_by_the_revalidation_backstop(
    service: DocumentService, tmp_path: Path
) -> None:
    project = make_project(service, tmp_path)
    error = reject(
        service,
        project,
        OpRejectedError,
        SetTrap(dungeon_id="d", level_number=1, area_id="1", trap=TREASURE_TRAP),
    )
    assert isinstance(error, OpRejectedError)
    assert any("non-room trap" in entry["message"] for entry in error.errors)


# --- treasure ---


def test_set_treasure_letters_unguarded_and_clear(service: DocumentService, tmp_path: Path) -> None:
    project = make_project(service, tmp_path)
    by_letters = AreaTreasureSpec(letters=("A", "C"))
    result = commit(service, project, SetTreasure(dungeon_id="d", level_number=1, area_id="1", treasure=by_letters))
    assert the_area(project).treasure == by_letters
    assert result.delta[0].path == "/dungeons/0/levels/0/areas/0"
    unguarded = AreaTreasureSpec(unguarded=True)
    commit(service, project, SetTreasure(dungeon_id="d", level_number=1, area_id="1", treasure=unguarded))
    assert the_area(project).treasure == unguarded
    commit(service, project, SetTreasure(dungeon_id="d", level_number=1, area_id="1", treasure=None))
    assert the_area(project).treasure is None


@pytest.mark.parametrize(
    "op",
    [
        SetEncounter(dungeon_id="x", level_number=1, area_id="1", encounter=None),
        SetTrap(dungeon_id="d", level_number=9, area_id="1", trap=None),
        SetTreasure(dungeon_id="d", level_number=1, area_id="9", treasure=None),
    ],
)
def test_area_content_ops_answer_targeting_misses(service: DocumentService, tmp_path: Path, op: AnyEditOp) -> None:
    project = make_project(service, tmp_path)
    reject(service, project, OpTargetNotFoundError, op)


# --- features: add ---


def test_add_feature_to_an_area(service: DocumentService, tmp_path: Path) -> None:
    project = make_project(service, tmp_path)
    cache = feature(id="feature-1", kind="treasure_cache", coins={"gp": 100}, trap=TREASURE_TRAP)
    result = commit(service, project, AddFeature(dungeon_id="d", level_number=1, area_id="1", feature=cache))
    assert the_area(project).features == (cache,)
    assert result.delta[0].path == "/dungeons/0/levels/0/areas/0"


def test_add_feature_to_the_level_itself(service: DocumentService, tmp_path: Path) -> None:
    project = make_project(service, tmp_path)
    trick = feature(id="trick-1", kind="construction_trick", cell=(0, 1))
    result = commit(service, project, AddFeature(dungeon_id="d", level_number=1, area_id=None, feature=trick))
    assert the_level(project).features == (trick,)
    assert result.delta[0].path == "/dungeons/0/levels/0/features"


def test_add_feature_admits_cell_none_at_level_scope(service: DocumentService, tmp_path: Path) -> None:
    project = make_project(service, tmp_path)
    result = commit(
        service, project, AddFeature(dungeon_id="d", level_number=1, area_id=None, feature=feature(cell=None))
    )
    assert the_level(project).features[0].cell is None
    assert "feature_needs_cell" in [finding.code for finding in result.diagnostics.validation]


def test_add_feature_rejects_an_empty_id(service: DocumentService, tmp_path: Path) -> None:
    project = make_project(service, tmp_path)
    error = reject(
        service,
        project,
        OpInvariantError,
        AddFeature(dungeon_id="d", level_number=1, area_id="1", feature=feature(id="")),
    )
    assert "non-empty" in str(error)


def test_add_feature_rejects_the_reserved_pile_id(service: DocumentService, tmp_path: Path) -> None:
    project = make_project(service, tmp_path)
    error = reject(
        service,
        project,
        OpInvariantError,
        AddFeature(dungeon_id="d", level_number=1, area_id=None, feature=feature(id="pile")),
    )
    assert "reserved" in str(error)


def test_add_feature_rejects_a_duplicate_id_across_scopes(service: DocumentService, tmp_path: Path) -> None:
    # The uniqueness scope spans the level's own features and every area's, so
    # a level-scope id blocks an area-scope add of the same id.
    project = make_project(service, tmp_path, level(features=(feature(id="taken", cell=(0, 0)),)))
    error = reject(
        service,
        project,
        OpInvariantError,
        AddFeature(dungeon_id="d", level_number=1, area_id="1", feature=feature(id="taken")),
    )
    assert "already has a feature 'taken'" in str(error)


def test_add_feature_rejects_an_out_of_bounds_cell(service: DocumentService, tmp_path: Path) -> None:
    project = make_project(service, tmp_path)
    reject(
        service,
        project,
        OpInvariantError,
        AddFeature(dungeon_id="d", level_number=1, area_id="1", feature=feature(cell=(9, 9))),
    )


def test_add_feature_answers_targeting_misses(service: DocumentService, tmp_path: Path) -> None:
    project = make_project(service, tmp_path)
    reject(
        service,
        project,
        OpTargetNotFoundError,
        AddFeature(dungeon_id="d", level_number=1, area_id="no-such-area", feature=feature()),
    )


# --- features: set ---


def test_set_feature_replaces_whole_value(service: DocumentService, tmp_path: Path) -> None:
    project = make_project(service, tmp_path, level(areas=(area(features=(feature(),)),)))
    replacement = feature(kind="treasure_cache", description="A locked chest.", coins={"gp": 250})
    result = commit(
        service,
        project,
        SetFeature(dungeon_id="d", level_number=1, area_id="1", feature_id="feature-1", feature=replacement),
    )
    assert the_area(project).features == (replacement,)
    assert result.delta[0].path == "/dungeons/0/levels/0/areas/0"


def test_set_feature_renames(service: DocumentService, tmp_path: Path) -> None:
    project = make_project(service, tmp_path, level(features=(feature(cell=(0, 0)),)))
    renamed = feature(id="alcove", cell=(0, 0))
    result = commit(
        service,
        project,
        SetFeature(dungeon_id="d", level_number=1, area_id=None, feature_id="feature-1", feature=renamed),
    )
    assert the_level(project).features == (renamed,)
    assert result.delta[0].path == "/dungeons/0/levels/0/features"


@pytest.mark.parametrize("bad_id", ["", "pile", "taken"])
def test_set_feature_rename_falls_under_the_add_id_rules(service: DocumentService, tmp_path: Path, bad_id: str) -> None:
    project = make_project(
        service,
        tmp_path,
        level(areas=(area(features=(feature(id="editable"), feature(id="taken"))),)),
    )
    reject(
        service,
        project,
        OpInvariantError,
        SetFeature(dungeon_id="d", level_number=1, area_id="1", feature_id="editable", feature=feature(id=bad_id)),
    )


def test_set_feature_rejects_a_changed_out_of_bounds_cell(service: DocumentService, tmp_path: Path) -> None:
    project = make_project(service, tmp_path, level(areas=(area(features=(feature(),)),)))
    reject(
        service,
        project,
        OpInvariantError,
        SetFeature(dungeon_id="d", level_number=1, area_id="1", feature_id="feature-1", feature=feature(cell=(9, 9))),
    )


def test_set_feature_carries_an_unchanged_foreign_out_of_bounds_cell(service: DocumentService, tmp_path: Path) -> None:
    # Editing any other field of a foreign feature with an out-of-bounds cell
    # never locks: the unchanged cell passes through and stays a diagnostic.
    project = make_project(service, tmp_path, level(areas=(area(features=(feature(cell=(9, 9)),)),)))
    result = commit(
        service,
        project,
        SetFeature(
            dungeon_id="d",
            level_number=1,
            area_id="1",
            feature_id="feature-1",
            feature=feature(cell=(9, 9), description="Edited."),
        ),
    )
    assert the_area(project).features[0].description == "Edited."
    assert the_area(project).features[0].cell == (9, 9)
    assert "feature_cell_out_of_bounds" in [finding.code for finding in result.diagnostics.validation]


def test_set_feature_carries_an_unchanged_foreign_pile_id(service: DocumentService, tmp_path: Path) -> None:
    # An unchanged id is not a rename, so a foreign 'pile' feature stays
    # editable and its reserved-id finding stays navigable.
    project = make_project(service, tmp_path, level(areas=(area(features=(feature(id="pile"),)),)))
    result = commit(
        service,
        project,
        SetFeature(
            dungeon_id="d",
            level_number=1,
            area_id="1",
            feature_id="pile",
            feature=feature(id="pile", description="Edited."),
        ),
    )
    assert the_area(project).features[0].description == "Edited."
    assert "feature_id_reserved" in [finding.code for finding in result.diagnostics.validation]


def test_set_feature_rebinds_a_changed_cell_to_none(service: DocumentService, tmp_path: Path) -> None:
    project = make_project(service, tmp_path, level(areas=(area(features=(feature(),)),)))
    commit(
        service,
        project,
        SetFeature(dungeon_id="d", level_number=1, area_id="1", feature_id="feature-1", feature=feature(cell=None)),
    )
    assert the_area(project).features[0].cell is None


def test_set_feature_resolves_first_match_over_a_foreign_duplicate_pair(
    service: DocumentService, tmp_path: Path
) -> None:
    twin_a = feature(description="first")
    twin_b = feature(description="second")
    project = make_project(service, tmp_path, level(areas=(area(features=(twin_a, twin_b)),)))
    commit(
        service,
        project,
        SetFeature(
            dungeon_id="d",
            level_number=1,
            area_id="1",
            feature_id="feature-1",
            feature=feature(description="edited"),
        ),
    )
    assert [entry.description for entry in the_area(project).features] == ["edited", "second"]


def test_set_feature_answers_an_unknown_feature_id(service: DocumentService, tmp_path: Path) -> None:
    project = make_project(service, tmp_path)
    reject(
        service,
        project,
        OpTargetNotFoundError,
        SetFeature(dungeon_id="d", level_number=1, area_id="1", feature_id="no-such-feature", feature=feature()),
    )


# --- features: remove ---


def test_remove_feature_at_both_scopes(service: DocumentService, tmp_path: Path) -> None:
    project = make_project(
        service,
        tmp_path,
        level(features=(feature(id="level-scope", cell=(0, 0)),), areas=(area(features=(feature(),)),)),
    )
    result = commit(
        service, project, RemoveFeature(dungeon_id="d", level_number=1, area_id="1", feature_id="feature-1")
    )
    assert the_area(project).features == ()
    assert result.delta[0].path == "/dungeons/0/levels/0/areas/0"
    result = commit(
        service, project, RemoveFeature(dungeon_id="d", level_number=1, area_id=None, feature_id="level-scope")
    )
    assert the_level(project).features == ()
    assert result.delta[0].path == "/dungeons/0/levels/0/features"


def test_remove_feature_resolves_first_match_over_a_foreign_duplicate_pair(
    service: DocumentService, tmp_path: Path
) -> None:
    twin_a = feature(description="first")
    twin_b = feature(description="second")
    project = make_project(service, tmp_path, level(areas=(area(features=(twin_a, twin_b)),)))
    commit(service, project, RemoveFeature(dungeon_id="d", level_number=1, area_id="1", feature_id="feature-1"))
    assert [entry.description for entry in the_area(project).features] == ["second"]


def test_remove_feature_answers_targeting_misses(service: DocumentService, tmp_path: Path) -> None:
    project = make_project(service, tmp_path)
    reject(
        service,
        project,
        OpTargetNotFoundError,
        RemoveFeature(dungeon_id="d", level_number=1, area_id=None, feature_id="no-such-feature"),
    )
    reject(
        service,
        project,
        OpTargetNotFoundError,
        RemoveFeature(dungeon_id="d", level_number=1, area_id="no-such-area", feature_id="feature-1"),
    )


# --- moves and atomicity ---


def test_moving_a_feature_between_containers_is_one_batch_one_undo_step(
    service: DocumentService, tmp_path: Path
) -> None:
    moved = feature(cell=(1, 1))
    project = make_project(service, tmp_path, level(areas=(area(features=(moved,)),)))
    result = commit(
        service,
        project,
        RemoveFeature(dungeon_id="d", level_number=1, area_id="1", feature_id="feature-1"),
        AddFeature(dungeon_id="d", level_number=1, area_id=None, feature=moved),
    )
    assert the_area(project).features == ()
    assert the_level(project).features == (moved,)
    assert result.can_undo
    service.undo(project)
    assert the_area(project).features == (moved,)
    assert the_level(project).features == ()


def test_a_mixed_content_batch_is_atomic(service: DocumentService, tmp_path: Path) -> None:
    project = make_project(service, tmp_path, level(features=(feature(id="taken", cell=(0, 0)),)))
    before = project.adventure
    with pytest.raises(OpInvariantError):
        commit(
            service,
            project,
            SetEncounter(dungeon_id="d", level_number=1, area_id="1", encounter=SKELETONS),
            AddFeature(dungeon_id="d", level_number=1, area_id="1", feature=feature(id="taken")),
        )
    assert project.adventure is before
    assert service.store.read_artifact(str(project.path), "adventure.json") == dump_adventure(before)
