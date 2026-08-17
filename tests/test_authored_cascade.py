"""Cascade completion over the authored layer: every re-keying op rewrites trigger and quest reference sites.

The committed fixtures grow trigger and quest content with the phases that can
author them (16-17); until then these suites build authored-layer adventures
in-test, exercising every site kind `validate_adventure` walks — a trigger's
`when`, `conditions`, and `consequences`; a quest's `activation`, each
objective's `when` and `reveal_when`, and its `rewards`.
"""

from pathlib import Path

import pytest
from osrlib.crawl.adventure import Adventure, TownSpec
from osrlib.crawl.commands import GrantItem, PlaceParty, SetDoorState, SpawnMonsters
from osrlib.crawl.dungeon import AreaSpec, Direction, DungeonSpec, LevelSpec, PartyLocation
from osrlib.crawl.gates import HasItemCondition
from osrlib.crawl.quests import ObjectiveSpec, QuestSpec, TriggerClause
from osrlib.crawl.triggers import (
    AreaEnteredPattern,
    DungeonEnteredPattern,
    FlagSetPattern,
    ItemAcquiredPattern,
    LevelEnteredPattern,
    MonsterDefeatedPattern,
    TriggerSpec,
)

from osreditor.documents import DocumentService, OpenProject, dump_adventure
from osreditor.ops import AnyEditOp, OpBatch, RenameDungeon, RenumberLevel, SetAreaField, SetMonsterTemplate
from osreditor.projects import open_project
from osreditor.store import LocalProjectStore
from test_monster_ops import template


def make_level(number: int = 1) -> LevelSpec:
    return LevelSpec(
        number=number,
        width=3,
        height=3,
        entrance=(0, 0) if number == 1 else None,
        areas=(AreaSpec(id="1", cells=((1, 1),)),),
    )


def authored_adventure() -> Adventure:
    """An adventure carrying every authored-layer reference-site kind, plus untouched controls."""
    return Adventure(
        name="Fixture",
        town=TownSpec(name=""),
        dungeons=(
            DungeonSpec(id="d", levels=(make_level(1), make_level(2))),
            DungeonSpec(id="other", levels=(make_level(1),)),
            DungeonSpec(id="quiet", levels=(make_level(1),)),
        ),
        monsters=(template(), template(id="bespoke-2")),
        triggers=(
            TriggerSpec(
                id="site-sweep",
                when=AreaEnteredPattern(dungeon_id="d", level_number=1, area_id="1"),
                conditions=(HasItemCondition(item_id="torch"),),
                consequences=(
                    SetDoorState(dungeon_id="d", level_number=1, x=1, y=1, direction=Direction.NORTH, open=True),
                    PlaceParty(
                        location=PartyLocation(
                            kind="dungeon",
                            dungeon_id="d",
                            level_number=1,
                            position=(0, 0),
                            facing=Direction.NORTH,
                        )
                    ),
                    SpawnMonsters(template_id="bespoke-1", count_fixed=1, distance_feet=30),
                    GrantItem(character_id="@first", item_id="torch"),
                ),
            ),
            TriggerSpec(id="level-watch", when=LevelEnteredPattern(dungeon_id="d", level_number=1)),
            TriggerSpec(id="dungeon-watch", when=DungeonEnteredPattern(dungeon_id="d")),
            TriggerSpec(id="boss-watch", when=MonsterDefeatedPattern(template_id="bespoke-1")),
            TriggerSpec(id="key-watch", when=ItemAcquiredPattern(item_id="torch")),
            TriggerSpec(id="flag-watch", when=FlagSetPattern(key="lever")),
            TriggerSpec(id="other-watch", when=LevelEnteredPattern(dungeon_id="other", level_number=1)),
        ),
        quests=(
            QuestSpec(
                id="the-errand",
                name="The errand",
                activation=TriggerClause(pattern=DungeonEnteredPattern(dungeon_id="d")),
                objectives=(
                    ObjectiveSpec(
                        id="reach",
                        when=TriggerClause(
                            pattern=AreaEnteredPattern(dungeon_id="d", level_number=1, area_id="1"),
                            conditions=(HasItemCondition(item_id="torch"),),
                        ),
                    ),
                    ObjectiveSpec(
                        id="descend",
                        hidden=True,
                        when=TriggerClause(pattern=LevelEnteredPattern(dungeon_id="d", level_number=2)),
                        reveal_when=TriggerClause(pattern=MonsterDefeatedPattern(template_id="bespoke-1")),
                    ),
                ),
                rewards=(
                    GrantItem(character_id="@party", item_id="torch"),
                    SpawnMonsters(template_id="bespoke-1", count_fixed=1, distance_feet=30),
                ),
            ),
        ),
    )


@pytest.fixture
def service() -> DocumentService:
    return DocumentService(LocalProjectStore())


@pytest.fixture
def project(service: DocumentService, tmp_path: Path) -> OpenProject:
    project_dir = tmp_path / "fixture.osr"
    service.store.write_artifact(str(project_dir), "adventure.json", dump_adventure(authored_adventure()))
    return open_project(service, project_dir)


def commit(service: DocumentService, project: OpenProject, *ops: AnyEditOp):
    return service.apply_batch(project, OpBatch(revision=project.revision, ops=ops))


def test_rename_dungeon_rewrites_every_authored_site(service: DocumentService, project: OpenProject) -> None:
    result = commit(service, project, RenameDungeon(old_id="d", new_id="warrens"))
    document = project.adventure
    sweep = document.triggers[0]
    assert isinstance(sweep.when, AreaEnteredPattern) and sweep.when.dungeon_id == "warrens"
    door_write, placement = sweep.consequences[0], sweep.consequences[1]
    assert isinstance(door_write, SetDoorState) and door_write.dungeon_id == "warrens"
    assert isinstance(placement, PlaceParty) and placement.location.dungeon_id == "warrens"
    assert isinstance(document.triggers[1].when, LevelEnteredPattern)
    assert document.triggers[1].when.dungeon_id == "warrens"
    assert isinstance(document.triggers[2].when, DungeonEnteredPattern)
    assert document.triggers[2].when.dungeon_id == "warrens"
    quest = document.quests[0]
    assert quest.activation is not None
    assert isinstance(quest.activation.pattern, DungeonEnteredPattern)
    assert quest.activation.pattern.dungeon_id == "warrens"
    assert isinstance(quest.objectives[0].when.pattern, AreaEnteredPattern)
    assert quest.objectives[0].when.pattern.dungeon_id == "warrens"
    assert isinstance(quest.objectives[1].when.pattern, LevelEnteredPattern)
    assert quest.objectives[1].when.pattern.dungeon_id == "warrens"
    # Sites scoped to the other dungeon stay put; the delta is whole-document.
    assert isinstance(document.triggers[6].when, LevelEnteredPattern)
    assert document.triggers[6].when.dungeon_id == "other"
    assert result.delta[0].path == ""


def test_renumber_level_rewrites_scoped_sites_only(service: DocumentService, project: OpenProject) -> None:
    result = commit(service, project, RenumberLevel(dungeon_id="d", old_number=1, new_number=3))
    document = project.adventure
    sweep = document.triggers[0]
    assert isinstance(sweep.when, AreaEnteredPattern) and sweep.when.level_number == 3
    door_write, placement = sweep.consequences[0], sweep.consequences[1]
    assert isinstance(door_write, SetDoorState) and door_write.level_number == 3
    assert isinstance(placement, PlaceParty) and placement.location.level_number == 3
    assert isinstance(document.triggers[1].when, LevelEnteredPattern)
    assert document.triggers[1].when.level_number == 3
    # The dungeon pattern carries no level; level 2's objective and the other
    # dungeon's watch stay put.
    assert isinstance(document.quests[0].objectives[1].when.pattern, LevelEnteredPattern)
    assert document.quests[0].objectives[1].when.pattern.level_number == 2
    assert isinstance(document.triggers[6].when, LevelEnteredPattern)
    assert document.triggers[6].when.level_number == 1
    assert result.delta[0].path == ""


def test_renumber_level_without_authored_sites_keeps_precise_pointer(
    service: DocumentService, project: OpenProject
) -> None:
    result = commit(service, project, RenumberLevel(dungeon_id="quiet", old_number=1, new_number=2))
    assert result.delta[0].path == "/dungeons/2"


def test_area_rename_rewrites_area_patterns(service: DocumentService, project: OpenProject) -> None:
    result = commit(
        service, project, SetAreaField(dungeon_id="d", level_number=1, area_id="1", field="id", value="crypt")
    )
    document = project.adventure
    assert isinstance(document.triggers[0].when, AreaEnteredPattern)
    assert document.triggers[0].when.area_id == "crypt"
    assert isinstance(document.quests[0].objectives[0].when.pattern, AreaEnteredPattern)
    assert document.quests[0].objectives[0].when.pattern.area_id == "crypt"
    assert result.delta[0].path == ""
    # The same rename on the other dungeon's area "1" touches nothing authored:
    # the pointer stays the areas subtree.
    result = commit(
        service, project, SetAreaField(dungeon_id="other", level_number=1, area_id="1", field="id", value="crypt")
    )
    assert result.delta[0].path == "/dungeons/1/levels/0/areas"


def test_monster_rename_rewrites_patterns_and_spawns(service: DocumentService, project: OpenProject) -> None:
    commit(
        service,
        project,
        SetMonsterTemplate(template_id="bespoke-1", template=template(id="renamed-horror")),
    )
    document = project.adventure
    sweep = document.triggers[0]
    spawn = sweep.consequences[2]
    assert isinstance(spawn, SpawnMonsters) and spawn.template_id == "renamed-horror"
    assert isinstance(document.triggers[3].when, MonsterDefeatedPattern)
    assert document.triggers[3].when.template_id == "renamed-horror"
    reveal = document.quests[0].objectives[1].reveal_when
    assert reveal is not None
    assert isinstance(reveal.pattern, MonsterDefeatedPattern)
    assert reveal.pattern.template_id == "renamed-horror"
    reward_spawn = document.quests[0].rewards[1]
    assert isinstance(reward_spawn, SpawnMonsters) and reward_spawn.template_id == "renamed-horror"


def test_cascade_round_trips_through_undo_and_redo(service: DocumentService, project: OpenProject) -> None:
    original = project.adventure
    commit(service, project, RenameDungeon(old_id="d", new_id="warrens"))
    renamed = project.adventure
    service.undo(project)
    assert project.adventure.model_dump() == original.model_dump()
    service.redo(project)
    assert project.adventure.model_dump() == renamed.model_dump()
    assert isinstance(project.adventure.triggers[2].when, DungeonEnteredPattern)
    assert project.adventure.triggers[2].when.dungeon_id == "warrens"
