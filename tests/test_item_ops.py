"""Bundled item-template ops through the service: the collision matrix, the rename cascade, gate values.

The monster suite's scaffold over the four far smaller item models, plus the
phase 15 backend truths that ride the same ops surface: gate-carrying
`set_edges`/`add_transition` values, the now-live room-trap `open` trigger,
and `SetLevelField`.
"""

from pathlib import Path

import pytest
from osrlib.core.items import GearTemplate, ItemTemplate, WeaponTemplate
from osrlib.crawl.adventure import Adventure, TownSpec
from osrlib.crawl.dungeon import (
    AreaSpec,
    Direction,
    DoorSpec,
    DungeonSpec,
    Edge,
    EdgeKind,
    FeatureSpec,
    LevelSpec,
    TransitionSpec,
    TrapEffect,
    TrapSpec,
)
from osrlib.crawl.gates import GateSpec, HasItemCondition
from osrlib.crawl.narrative import NarrativeBlock
from osrlib.crawl.quests import ObjectiveSpec, QuestSpec, TriggerClause
from osrlib.crawl.triggers import ItemAcquiredPattern, TriggerSpec
from osrlib.data import load_equipment, load_magic_items
from pydantic import ValidationError

from osreditor.documents import DocumentService, OpenProject, dump_adventure
from osreditor.errors import OpInvariantError, OpTargetNotFoundError
from osreditor.ops import (
    AddItemTemplate,
    AddTransition,
    AnyEditOp,
    OpBatch,
    RemoveItemTemplate,
    SetEdges,
    SetItemTemplate,
    SetLevelField,
    SetTrap,
)
from osreditor.projects import open_project
from osreditor.sidecar import SetNote
from osreditor.store import LocalProjectStore

SHIPPED_EQUIPMENT_ID = load_equipment().gear[0].id
SHIPPED_MAGIC_ID = load_magic_items().items[0].id


def gear(**overrides: object) -> GearTemplate:
    values: dict[str, object] = {"id": "brass-key", "name": "Brass key", "cost_gp": 0}
    values.update(overrides)
    return GearTemplate.model_validate(values)


def weapon(**overrides: object) -> WeaponTemplate:
    values: dict[str, object] = {
        "id": "dull-blade",
        "name": "Dull blade",
        "cost_gp": 0,
        "weight_coins": 0,
        "damage": "1d6",
        "qualities": ("melee",),
    }
    values.update(overrides)
    return WeaponTemplate.model_validate(values)


def gate(item_id: str = "brass-key", consumes: bool = False) -> GateSpec:
    return GateSpec(
        condition=HasItemCondition(item_id=item_id, consumes=consumes),
        narrative=NarrativeBlock(refusal="The lock refuses.", success="The key turns."),
    )


def gated_door(item_id: str = "brass-key") -> Edge:
    return Edge(kind=EdgeKind.DOOR, door=DoorSpec(kind="normal", requires=gate(item_id)))


def make_level(**overrides: object) -> LevelSpec:
    values: dict[str, object] = {
        "number": 1,
        "width": 3,
        "height": 3,
        "entrance": (0, 0),
        "areas": (AreaSpec(id="1", cells=((1, 1),)),),
    }
    values.update(overrides)
    return LevelSpec.model_validate(values)


@pytest.fixture
def service() -> DocumentService:
    return DocumentService(LocalProjectStore())


def make_project(
    service: DocumentService,
    tmp_path: Path,
    *levels: LevelSpec,
    items: tuple[ItemTemplate, ...] = (),
    triggers: tuple[TriggerSpec, ...] = (),
    quests: tuple[QuestSpec, ...] = (),
) -> OpenProject:
    adventure = Adventure(
        name="Fixture",
        town=TownSpec(name=""),
        dungeons=(DungeonSpec(id="d", levels=levels or (make_level(),)),),
        items=items,
        triggers=triggers,
        quests=quests,
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


# --- add / replace / remove ------------------------------------------------------


def test_add_appends_in_authored_order_with_the_items_pointer(service: DocumentService, tmp_path: Path) -> None:
    project = make_project(service, tmp_path, items=(gear(id="first"),))
    result = commit(service, project, AddItemTemplate(template=gear(id="second")))
    assert [entry.id for entry in project.adventure.items] == ["first", "second"]
    assert result.delta[0].path == "/items"


def test_set_replaces_whole_value_with_the_items_pointer(service: DocumentService, tmp_path: Path) -> None:
    project = make_project(service, tmp_path, items=(gear(),))
    replacement = gear(name="Iron key", cost_gp=5)
    result = commit(service, project, SetItemTemplate(item_id="brass-key", template=replacement))
    assert project.adventure.items == (replacement,)
    assert result.delta[0].path == "/items"


def test_set_targets_the_first_match_among_foreign_duplicates(service: DocumentService, tmp_path: Path) -> None:
    project = make_project(service, tmp_path, items=(gear(name="First"), gear(name="Second")))
    commit(service, project, SetItemTemplate(item_id="brass-key", template=gear(name="Edited")))
    assert [entry.name for entry in project.adventure.items] == ["Edited", "Second"]


def test_remove_drops_the_template_first_match(service: DocumentService, tmp_path: Path) -> None:
    project = make_project(service, tmp_path, items=(gear(name="First"), gear(name="Second")))
    result = commit(service, project, RemoveItemTemplate(item_id="brass-key"))
    assert [entry.name for entry in project.adventure.items] == ["Second"]
    assert result.delta[0].path == "/items"


def test_unknown_targets_are_targeting_misses(service: DocumentService, tmp_path: Path) -> None:
    project = make_project(service, tmp_path)
    reject(service, project, OpTargetNotFoundError, SetItemTemplate(item_id="ghost", template=gear(id="ghost")))
    reject(service, project, OpTargetNotFoundError, RemoveItemTemplate(item_id="ghost"))


def test_remove_admits_dangling_references_as_diagnostics(service: DocumentService, tmp_path: Path) -> None:
    cache = FeatureSpec(id="cache-1", kind="treasure_cache", cell=(1, 1), item_ids=("brass-key",))
    area = AreaSpec(id="1", cells=((1, 1),), features=(cache,))
    project = make_project(service, tmp_path, make_level(areas=(area,)), items=(gear(),))
    result = commit(service, project, RemoveItemTemplate(item_id="brass-key"))
    assert "feature_unknown_item" in [finding.code for finding in result.diagnostics.validation]


def test_an_added_template_satisfies_a_dangling_cache_reference(service: DocumentService, tmp_path: Path) -> None:
    # The `encounter_unknown_monster` behavior: the finding clears the moment
    # the named id joins the bundle, because osrlib resolves cache ids against
    # the effective catalog.
    cache = FeatureSpec(id="cache-1", kind="treasure_cache", cell=(1, 1), item_ids=("brass-key",))
    area = AreaSpec(id="1", cells=((1, 1),), features=(cache,))
    project = make_project(service, tmp_path, make_level(areas=(area,)))
    assert "feature_unknown_item" in [finding.code for finding in project.diagnostics.validation]
    result = commit(service, project, AddItemTemplate(template=gear()))
    assert result.diagnostics.validation == ()


def test_atomicity_a_failing_op_rejects_the_whole_batch(service: DocumentService, tmp_path: Path) -> None:
    project = make_project(service, tmp_path)
    reject(
        service,
        project,
        OpInvariantError,
        AddItemTemplate(template=gear(id="fine")),
        AddItemTemplate(template=gear(id=SHIPPED_EQUIPMENT_ID)),
    )
    assert project.adventure.items == ()


# --- the collision matrix --------------------------------------------------------


def test_add_rejects_a_shipped_equipment_collision(service: DocumentService, tmp_path: Path) -> None:
    project = make_project(service, tmp_path)
    error = reject(service, project, OpInvariantError, AddItemTemplate(template=gear(id=SHIPPED_EQUIPMENT_ID)))
    assert "collides with the shipped catalog" in str(error)


def test_add_rejects_a_shipped_magic_collision(service: DocumentService, tmp_path: Path) -> None:
    # The stricter item rule: the collision domain is the union of shipped
    # equipment, shipped magic, and the bundle — exactly the seen-set
    # osrlib's _effective_equipment seeds.
    project = make_project(service, tmp_path)
    error = reject(service, project, OpInvariantError, AddItemTemplate(template=gear(id=SHIPPED_MAGIC_ID)))
    assert "collides with the shipped catalog" in str(error)


def test_add_rejects_a_bundled_collision(service: DocumentService, tmp_path: Path) -> None:
    project = make_project(service, tmp_path, items=(gear(),))
    error = reject(service, project, OpInvariantError, AddItemTemplate(template=weapon(id="brass-key")))
    assert "already bundles" in str(error)


def test_add_rejects_an_empty_id(service: DocumentService, tmp_path: Path) -> None:
    project = make_project(service, tmp_path)
    error = reject(service, project, OpInvariantError, AddItemTemplate(template=gear(id="")))
    assert "non-empty" in str(error)


@pytest.mark.parametrize("taken_id", [SHIPPED_EQUIPMENT_ID, SHIPPED_MAGIC_ID, "taken"])
def test_rename_falls_under_the_add_id_rules(service: DocumentService, tmp_path: Path, taken_id: str) -> None:
    project = make_project(service, tmp_path, items=(gear(id="editable"), gear(id="taken")))
    reject(service, project, OpInvariantError, SetItemTemplate(item_id="editable", template=gear(id=taken_id)))


def test_a_foreign_colliding_templates_unchanged_id_carries_through(service: DocumentService, tmp_path: Path) -> None:
    # The invariant is "no op ever introduces a collision", not "no colliding
    # document may be edited": the unchanged id never rejects, other fields
    # edit cleanly, and the finding stays a navigable diagnostic.
    project = make_project(service, tmp_path, items=(gear(id=SHIPPED_EQUIPMENT_ID),))
    result = commit(
        service,
        project,
        SetItemTemplate(item_id=SHIPPED_EQUIPMENT_ID, template=gear(id=SHIPPED_EQUIPMENT_ID, name="Edited.")),
    )
    first = project.adventure.items[0]
    assert first.name == "Edited."
    assert "bundled_item_collision" in [finding.code for finding in result.diagnostics.validation]


def test_a_rename_away_from_a_collision_clears_the_finding(service: DocumentService, tmp_path: Path) -> None:
    project = make_project(service, tmp_path, items=(gear(id=SHIPPED_EQUIPMENT_ID),))
    result = commit(service, project, SetItemTemplate(item_id=SHIPPED_EQUIPMENT_ID, template=gear(id="now-free")))
    assert project.adventure.items[0].id == "now-free"
    assert result.diagnostics.validation == ()


# --- the rename cascade ----------------------------------------------------------


def cascade_project(service: DocumentService, tmp_path: Path) -> OpenProject:
    """A project referencing 'brass-key' from every site kind the cascade covers."""
    cache = FeatureSpec(id="cache-1", kind="treasure_cache", cell=(1, 1), item_ids=("brass-key",))
    level_cache = FeatureSpec(id="cache-2", kind="treasure_cache", cell=(0, 1), item_ids=("brass-key", "brass-key"))
    area = AreaSpec(id="1", cells=((1, 1),), features=(cache,))
    toll = TransitionSpec(
        kind="stairs_down",
        position=(2, 2),
        to_dungeon_id="d",
        to_level_number=2,
        to_position=(0, 0),
        to_facing=Direction.SOUTH,
        requires=gate(consumes=True),
    )
    level = make_level(
        areas=(area,),
        features=(level_cache,),
        edges={"1,1:north": gated_door()},
        transitions=(toll,),
    )
    trigger = TriggerSpec(
        id="key-watch",
        when=ItemAcquiredPattern(item_id="brass-key"),
        conditions=(HasItemCondition(item_id="brass-key"),),
    )
    quest = QuestSpec(
        id="the-key",
        name="The key",
        objectives=(ObjectiveSpec(id="find", when=TriggerClause(pattern=ItemAcquiredPattern(item_id="brass-key"))),),
    )
    second = make_level(number=2, entrance=None, areas=())
    return make_project(service, tmp_path, level, second, items=(gear(),), triggers=(trigger,), quests=(quest,))


def test_rename_cascades_caches_gates_and_authored_sites(service: DocumentService, tmp_path: Path) -> None:
    project = cascade_project(service, tmp_path)
    result = commit(service, project, SetItemTemplate(item_id="brass-key", template=gear(id="iron-key")))
    assert result.delta[0].path == ""
    level = project.adventure.dungeons[0].levels[0]
    assert level.areas[0].features[0].item_ids == ("iron-key",)
    assert level.features[0].item_ids == ("iron-key", "iron-key")
    door = level.edges["1,1:north"].door
    assert door is not None and door.requires is not None
    assert isinstance(door.requires.condition, HasItemCondition)
    assert door.requires.condition.item_id == "iron-key"
    # The gate's narrative rides untouched through the cascade.
    assert door.requires.narrative is not None and door.requires.narrative.refusal == "The lock refuses."
    toll = level.transitions[0].requires
    assert toll is not None and isinstance(toll.condition, HasItemCondition)
    assert toll.condition.item_id == "iron-key"
    assert toll.condition.consumes is True
    trigger = project.adventure.triggers[0]
    assert isinstance(trigger.when, ItemAcquiredPattern) and trigger.when.item_id == "iron-key"
    condition = trigger.conditions[0]
    assert isinstance(condition, HasItemCondition) and condition.item_id == "iron-key"
    objective_pattern = project.adventure.quests[0].objectives[0].when.pattern
    assert isinstance(objective_pattern, ItemAcquiredPattern) and objective_pattern.item_id == "iron-key"
    assert result.diagnostics.validation == ()


def test_rename_is_one_undo_step_notes_included(service: DocumentService, tmp_path: Path) -> None:
    project = cascade_project(service, tmp_path)
    service.apply_sidecar_patch(project, (SetNote(address="item:brass-key", text="Ours."),))
    commit(service, project, SetItemTemplate(item_id="brass-key", template=gear(id="iron-key")))
    assert project.sidecar.notes == {"item:iron-key": "Ours."}
    service.undo(project)
    assert project.adventure.items[0].id == "brass-key"
    door = project.adventure.dungeons[0].levels[0].edges["1,1:north"].door
    assert door is not None and door.requires is not None
    assert isinstance(door.requires.condition, HasItemCondition)
    assert door.requires.condition.item_id == "brass-key"
    assert project.sidecar.notes == {"item:brass-key": "Ours."}
    service.redo(project)
    assert project.adventure.items[0].id == "iron-key"
    assert project.sidecar.notes == {"item:iron-key": "Ours."}


# --- gate values on the existing ops ---------------------------------------------


def test_a_gated_door_applies_and_round_trips(service: DocumentService, tmp_path: Path) -> None:
    project = make_project(service, tmp_path, items=(gear(),))
    commit(service, project, SetEdges(dungeon_id="d", level_number=1, edges={"1,1:north": gated_door()}))
    reopened_service = DocumentService(LocalProjectStore())
    reopened = open_project(reopened_service, project.path)
    door = reopened.adventure.dungeons[0].levels[0].edges["1,1:north"].door
    assert door is not None and door.requires is not None
    assert isinstance(door.requires.condition, HasItemCondition)
    assert door.requires.condition.item_id == "brass-key"
    assert door.requires.narrative is not None and door.requires.narrative.success == "The key turns."


def test_a_gated_transition_applies_with_diagnostics_on_a_dangling_id(service: DocumentService, tmp_path: Path) -> None:
    toll = TransitionSpec(
        kind="stairs_down",
        position=(2, 2),
        to_dungeon_id="d",
        to_level_number=1,
        to_position=(0, 0),
        to_facing=Direction.SOUTH,
        requires=gate(item_id="unminted-coin", consumes=True),
    )
    project = make_project(service, tmp_path)
    result = commit(service, project, AddTransition(dungeon_id="d", level_number=1, transition=toll))
    assert "transition_gate_unknown_item" in [finding.code for finding in result.diagnostics.validation]


def test_a_room_trap_carrying_open_applies_cleanly(service: DocumentService, tmp_path: Path) -> None:
    # Item 3's backend truth: under osrlib 1.6 the open trigger is live on
    # room traps — a door of the area springs it — so the value commits with
    # no rejection and no finding.
    project = make_project(service, tmp_path)
    trap = TrapSpec(kind="room", trigger="open", effect=TrapEffect(damage_dice="1d6"))
    result = commit(
        service,
        project,
        SetTrap(dungeon_id="d", level_number=1, area_id="1", trap=trap),
    )
    stored = project.adventure.dungeons[0].levels[0].areas[0].trap
    assert stored is not None and stored.trigger == "open"
    assert result.diagnostics.validation == ()


def test_a_treasure_trap_carrying_enter_is_unrepresentable_at_parse() -> None:
    # The narrowing half of the schema-3 change: TrapSpec rejects the dead
    # treasure/enter combination at parse, so no editor batch can carry it —
    # only a foreign schema-2 document can, and it fails open with the model
    # validator's message (osrlib owns migrations; the adventure kind has none).
    with pytest.raises(ValidationError):
        SetTrap.model_validate(
            {
                "op": "set_trap",
                "dungeon_id": "d",
                "level_number": 1,
                "area_id": "1",
                "trap": {"kind": "treasure", "trigger": "enter", "effect": {}},
            }
        )


# --- SetLevelField ---------------------------------------------------------------


def test_set_level_field_answers_the_precise_guidance_pointer(service: DocumentService, tmp_path: Path) -> None:
    project = make_project(service, tmp_path)
    result = commit(
        service,
        project,
        SetLevelField(dungeon_id="d", level_number=1, field="guidance", value="Slow, dripping dread."),
    )
    assert project.adventure.dungeons[0].levels[0].guidance == "Slow, dripping dread."
    assert result.delta[0].path == "/dungeons/0/levels/0/guidance"
    assert result.delta[0].value == "Slow, dripping dread."


def test_set_level_field_misses_are_targeting_misses(service: DocumentService, tmp_path: Path) -> None:
    project = make_project(service, tmp_path)
    reject(
        service,
        project,
        OpTargetNotFoundError,
        SetLevelField(dungeon_id="d", level_number=9, field="guidance", value="…"),
    )
