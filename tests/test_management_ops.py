"""Dungeon and level management ops: invariants, cascades, the no-reorder rule, resize offenders."""

from pathlib import Path

import pytest
from osrlib.crawl.adventure import Adventure, TownSpec
from osrlib.crawl.dungeon import (
    AreaSpec,
    Direction,
    DungeonSpec,
    Edge,
    EdgeKind,
    FeatureSpec,
    LevelSpec,
    TransitionSpec,
)

from osreditor.documents import DocumentService, OpenProject, dump_adventure
from osreditor.errors import OpInvariantError, OpTargetNotFoundError
from osreditor.ops import (
    AddDungeon,
    AddLevel,
    AnyEditOp,
    OpBatch,
    RemoveDungeon,
    RemoveLevel,
    RenameDungeon,
    RenumberLevel,
    ResizeLevel,
    SetDungeonField,
)
from osreditor.projects import open_project
from osreditor.store import LocalProjectStore

OPEN = Edge(kind=EdgeKind.OPEN)


def level(number: int = 1, **overrides: object) -> LevelSpec:
    values: dict[str, object] = {"number": number, "width": 3, "height": 3}
    values.update(overrides)
    return LevelSpec.model_validate(values)


def stairs(position: tuple[int, int], to: tuple[str, int], **overrides: object) -> TransitionSpec:
    values: dict[str, object] = {
        "kind": "stairs_down",
        "position": position,
        "to_dungeon_id": to[0],
        "to_level_number": to[1],
        "to_position": (0, 0),
        "to_facing": Direction.NORTH,
    }
    values.update(overrides)
    return TransitionSpec.model_validate(values)


@pytest.fixture
def service() -> DocumentService:
    return DocumentService(LocalProjectStore())


def make_project(
    service: DocumentService, tmp_path: Path, *dungeons: DungeonSpec, town: TownSpec | None = None
) -> OpenProject:
    adventure = Adventure(
        name="Fixture",
        town=town if town is not None else TownSpec(name=""),
        dungeons=dungeons or (DungeonSpec(id="d", levels=(level(entrance=(0, 0)),)),),
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
    return excinfo.value


def test_add_dungeon_scaffolds_a_valid_dungeon(service: DocumentService, tmp_path: Path) -> None:
    project = make_project(service, tmp_path)
    result = commit(service, project, AddDungeon(dungeon_id="d2", name="The vaults", width=20, height=10))
    added = project.adventure.dungeon("d2")
    scaffold = added.levels[0]
    assert (added.name, scaffold.number, scaffold.width, scaffold.height) == ("The vaults", 1, 20, 10)
    assert scaffold.entrance == (0, 0)
    # Valid from birth — the entrance tool moves what exists.
    assert result.diagnostics.validation == ()
    assert result.delta[0].path == "/dungeons"


def test_add_dungeon_rejects_a_duplicate_id(service: DocumentService, tmp_path: Path) -> None:
    project = make_project(service, tmp_path)
    reject(service, project, OpInvariantError, AddDungeon(dungeon_id="d", width=10, height=10))


def test_set_dungeon_field_sets_the_name(service: DocumentService, tmp_path: Path) -> None:
    project = make_project(service, tmp_path)
    result = commit(service, project, SetDungeonField(dungeon_id="d", field="name", value="The caves"))
    assert project.adventure.dungeon("d").name == "The caves"
    assert result.delta[0].path == "/dungeons/0/name"


def test_rename_dungeon_cascades_everywhere(service: DocumentService, tmp_path: Path) -> None:
    dungeons = (
        DungeonSpec(id="a", levels=(level(entrance=(0, 0), transitions=(stairs((1, 1), ("b", 1)),)),)),
        DungeonSpec(id="b", levels=(level(entrance=(0, 0), transitions=(stairs((2, 2), ("b", 1)),)),)),
    )
    town = TownSpec(name="", travel_turns={"a": 1, "b": 2})
    project = make_project(service, tmp_path, *dungeons, town=town)
    result = commit(service, project, RenameDungeon(old_id="b", new_id="vaults"))
    assert [dungeon.id for dungeon in project.adventure.dungeons] == ["a", "vaults"]
    # Every reference follows: the cross-dungeon transition, the dungeon's own
    # self-transition, and the travel key in place, order preserved.
    assert project.adventure.dungeon("a").levels[0].transitions[0].to_dungeon_id == "vaults"
    assert project.adventure.dungeon("vaults").levels[0].transitions[0].to_dungeon_id == "vaults"
    assert project.adventure.town.travel_turns == {"a": 1, "vaults": 2}
    assert list(project.adventure.town.travel_turns) == ["a", "vaults"]
    assert result.delta[0].path == ""
    assert result.diagnostics.validation == ()


def test_rename_dungeon_drops_a_dangling_travel_entry_named_new_id(service: DocumentService, tmp_path: Path) -> None:
    # A dangling travel entry may already carry new_id (legal — it referenced
    # no dungeon until now). The cascade drops it: one dungeon, one entry, the
    # renamed key's authored cost, at the old key's position.
    dungeons = (
        DungeonSpec(id="b", levels=(level(entrance=(0, 0)),)),
        DungeonSpec(id="c", levels=(level(entrance=(0, 0)),)),
    )
    town = TownSpec(name="", travel_turns={"x": 5, "b": 2, "c": 9})
    project = make_project(service, tmp_path, *dungeons, town=town)
    commit(service, project, RenameDungeon(old_id="b", new_id="x"))
    assert project.adventure.town.travel_turns == {"x": 2, "c": 9}
    assert list(project.adventure.town.travel_turns) == ["x", "c"]


def test_rename_dungeon_rejects_empty_and_taken_ids(service: DocumentService, tmp_path: Path) -> None:
    dungeons = (
        DungeonSpec(id="a", levels=(level(entrance=(0, 0)),)),
        DungeonSpec(id="b", levels=(level(entrance=(0, 0)),)),
    )
    project = make_project(service, tmp_path, *dungeons)
    reject(service, project, OpInvariantError, RenameDungeon(old_id="a", new_id=""))
    reject(service, project, OpInvariantError, RenameDungeon(old_id="a", new_id="b"))
    reject(service, project, OpTargetNotFoundError, RenameDungeon(old_id="nope", new_id="c"))


def test_remove_dungeon_never_cascades(service: DocumentService, tmp_path: Path) -> None:
    dungeons = (
        DungeonSpec(id="a", levels=(level(entrance=(0, 0), transitions=(stairs((1, 1), ("b", 1)),)),)),
        DungeonSpec(id="b", levels=(level(entrance=(0, 0)),)),
    )
    town = TownSpec(name="", travel_turns={"b": 2})
    project = make_project(service, tmp_path, *dungeons, town=town)
    result = commit(service, project, RemoveDungeon(dungeon_id="b"))
    assert [dungeon.id for dungeon in project.adventure.dungeons] == ["a"]
    # The dangling travel entry and inbound transition are honest diagnostics,
    # never silent edits of other subtrees.
    assert project.adventure.town.travel_turns == {"b": 2}
    codes = [finding.code for finding in result.diagnostics.validation]
    assert "travel_unknown_dungeon" in codes
    assert "transition_target_unknown" in codes
    assert result.delta[0].path == "/dungeons"


def test_remove_dungeon_rejects_the_last_one(service: DocumentService, tmp_path: Path) -> None:
    project = make_project(service, tmp_path)
    reject(service, project, OpInvariantError, RemoveDungeon(dungeon_id="d"))


def test_add_level_appends_and_carries_no_entrance(service: DocumentService, tmp_path: Path) -> None:
    project = make_project(service, tmp_path)
    result = commit(service, project, AddLevel(dungeon_id="d", number=2, width=10, height=10))
    added = project.adventure.dungeon("d").level(2)
    assert added.entrance is None
    assert [lvl.number for lvl in project.adventure.dungeon("d").levels] == [1, 2]
    assert result.delta[0].path == "/dungeons/0"


def test_add_level_inserts_at_ascending_position(service: DocumentService, tmp_path: Path) -> None:
    dungeon = DungeonSpec(id="d", levels=(level(1, entrance=(0, 0)), level(3)))
    project = make_project(service, tmp_path, dungeon)
    commit(service, project, AddLevel(dungeon_id="d", number=2, width=5, height=5))
    assert [lvl.number for lvl in project.adventure.dungeon("d").levels] == [1, 2, 3]


def test_add_level_never_reorders_foreign_order(service: DocumentService, tmp_path: Path) -> None:
    # Stored order is rules-visible (first entrance-bearing level seeds play),
    # so a foreign non-ascending tuple survives with only the insertion applied.
    dungeon = DungeonSpec(id="d", levels=(level(3, entrance=(0, 0)), level(1)))
    project = make_project(service, tmp_path, dungeon)
    commit(service, project, AddLevel(dungeon_id="d", number=2, width=5, height=5))
    assert [lvl.number for lvl in project.adventure.dungeon("d").levels] == [2, 3, 1]


def test_add_level_rejects_a_duplicate_number(service: DocumentService, tmp_path: Path) -> None:
    project = make_project(service, tmp_path)
    reject(service, project, OpInvariantError, AddLevel(dungeon_id="d", number=1, width=5, height=5))


def test_renumber_level_cascades_without_reordering(service: DocumentService, tmp_path: Path) -> None:
    dungeon = DungeonSpec(
        id="d",
        levels=(
            level(2),
            level(1, entrance=(0, 0), transitions=(stairs((1, 1), ("d", 2)),)),
        ),
    )
    project = make_project(service, tmp_path, dungeon)
    result = commit(service, project, RenumberLevel(dungeon_id="d", old_number=2, new_number=5))
    # The tuple stays where it sits; only the number and its references change.
    assert [lvl.number for lvl in project.adventure.dungeon("d").levels] == [5, 1]
    assert project.adventure.dungeon("d").level(1).transitions[0].to_level_number == 5
    assert result.delta[0].path == "/dungeons/0"


def test_renumber_level_cascade_across_dungeons_widens_the_delta(service: DocumentService, tmp_path: Path) -> None:
    dungeons = (
        DungeonSpec(id="a", levels=(level(entrance=(0, 0), transitions=(stairs((1, 1), ("b", 1)),)),)),
        DungeonSpec(id="b", levels=(level(entrance=(0, 0)),)),
    )
    project = make_project(service, tmp_path, *dungeons)
    result = commit(service, project, RenumberLevel(dungeon_id="b", old_number=1, new_number=2))
    assert project.adventure.dungeon("a").levels[0].transitions[0].to_level_number == 2
    # A cross-dungeon retarget makes the precise pointer dishonest — the delta
    # honestly widens to the whole document.
    assert result.delta[0].path == ""


def test_renumber_level_rejects_a_taken_number(service: DocumentService, tmp_path: Path) -> None:
    dungeon = DungeonSpec(id="d", levels=(level(1, entrance=(0, 0)), level(2)))
    project = make_project(service, tmp_path, dungeon)
    reject(service, project, OpInvariantError, RenumberLevel(dungeon_id="d", old_number=2, new_number=1))


def test_remove_level_leaves_inbound_transitions_dangling(service: DocumentService, tmp_path: Path) -> None:
    dungeon = DungeonSpec(
        id="d",
        levels=(level(1, entrance=(0, 0), transitions=(stairs((1, 1), ("d", 2)),)), level(2)),
    )
    project = make_project(service, tmp_path, dungeon)
    result = commit(service, project, RemoveLevel(dungeon_id="d", level_number=2))
    assert [lvl.number for lvl in project.adventure.dungeon("d").levels] == [1]
    assert "transition_target_unknown" in [finding.code for finding in result.diagnostics.validation]
    assert result.delta[0].path == "/dungeons/0"


def test_remove_level_rejects_the_last_one(service: DocumentService, tmp_path: Path) -> None:
    project = make_project(service, tmp_path)
    reject(service, project, OpInvariantError, RemoveLevel(dungeon_id="d", level_number=1))


def test_resize_level_grows_and_shrinks_clean_grids(service: DocumentService, tmp_path: Path) -> None:
    project = make_project(service, tmp_path)
    result = commit(service, project, ResizeLevel(dungeon_id="d", level_number=1, width=10, height=8))
    resized = project.adventure.dungeon("d").level(1)
    assert (resized.width, resized.height) == (10, 8)
    assert result.delta[0].path == "/dungeons/0"
    commit(service, project, ResizeLevel(dungeon_id="d", level_number=1, width=2, height=2))
    assert project.adventure.dungeon("d").level(1).width == 2


def test_resize_level_rejects_listing_every_offender(service: DocumentService, tmp_path: Path) -> None:
    fixture = level(
        1,
        width=5,
        height=5,
        entrance=(4, 4),
        areas=(
            AreaSpec(id="1", cells=((0, 0), (4, 0)), features=(FeatureSpec(id="urn", kind="custom", cell=(4, 0)),)),
            AreaSpec(id="2", cells=((1, 1),)),
        ),
        features=(FeatureSpec(id="well", kind="custom", cell=(0, 4)),),
        transitions=(stairs((3, 3), ("d", 2)),),
    )
    project = make_project(service, tmp_path, DungeonSpec(id="d", levels=(fixture,)))
    error = reject(service, project, OpInvariantError, ResizeLevel(dungeon_id="d", level_number=1, width=3, height=3))
    assert isinstance(error, OpInvariantError)
    assert error.offenders is not None
    by_address = {offender["address"]: offender["message"] for offender in error.offenders}
    assert by_address == {
        "dungeon:d/level:1/area:1": "area '1' has 1 cell(s) outside the new bounds, e.g. (4, 0)",
        "dungeon:d/level:1/cell:4,0": "feature 'urn' sits at (4, 0), outside the new bounds",
        "dungeon:d/level:1/cell:0,4": "feature 'well' sits at (0, 4), outside the new bounds",
        "dungeon:d/level:1/cell:3,3": "stairs_down at (3, 3) is outside the new bounds",
        "dungeon:d/level:1/cell:4,4": "the entrance at (4, 4) is outside the new bounds",
    }
    # Area 2 is fully inside the new bounds and is not an offender.


def test_resize_level_ignores_transitions_targeting_the_shrunk_level(service: DocumentService, tmp_path: Path) -> None:
    # A transition elsewhere targeting a now-out-of-bounds cell here is the
    # dangling-reference rule's territory, not an offender.
    dungeons = (
        DungeonSpec(
            id="a", levels=(level(entrance=(0, 0), transitions=(stairs((0, 0), ("b", 1), to_position=(2, 2)),)),)
        ),
        DungeonSpec(id="b", levels=(level(entrance=(0, 0)),)),
    )
    project = make_project(service, tmp_path, *dungeons)
    result = commit(service, project, ResizeLevel(dungeon_id="b", level_number=1, width=2, height=2))
    assert "transition_target_cell_out_of_bounds" in [finding.code for finding in result.diagnostics.validation]


def test_resize_level_prunes_stranded_edges_but_keeps_foreign_junk(service: DocumentService, tmp_path: Path) -> None:
    edges = {
        "1,0:west": OPEN,  # incident (1,0)/(0,0) — survives the shrink
        "2,2:north": OPEN,  # incident (2,2)/(2,1) — stranded, pruned
        "bogus": OPEN,  # no computable cells; stays (deletable, lint-flagged)
    }
    project = make_project(service, tmp_path, DungeonSpec(id="d", levels=(level(entrance=(0, 0), edges=edges),)))
    commit(service, project, ResizeLevel(dungeon_id="d", level_number=1, width=2, height=2))
    assert project.adventure.dungeon("d").level(1).edges == {"1,0:west": OPEN, "bogus": OPEN}
