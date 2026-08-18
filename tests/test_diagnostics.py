"""The validation parser: every mapped shape asserted against the installed osrlib.

Each fixture adventure triggers exactly one `validate_adventure` check, so an
upstream wording change fails here first — the same discipline as the golden
fixture. The honesty guards get their own coverage: percent-encoded ids, ids
that defeat extraction degrading the address to `None`, unrecognizable lines
landing as `validation_unclassified`, never dropped and never a wrong address.
"""

from urllib.parse import quote

import pytest
from osrlib.core.alignment import Alignment
from osrlib.core.items import Coins
from osrlib.core.tables import EncounterTable, EncounterTableRow, MonsterEncounterEntry
from osrlib.crawl.adventure import Adventure, TownSpec, validate_adventure
from osrlib.crawl.commands import GrantCoins, GrantItem, PlaceParty, SetDoorState, SpawnMonsters
from osrlib.crawl.dungeon import (
    AreaSpec,
    Direction,
    DoorSpec,
    DungeonSpec,
    Edge,
    EdgeKind,
    FeatureSpec,
    KeyedEncounter,
    KeyedMonster,
    LevelSpec,
    PartyLocation,
    TransitionSpec,
    WanderingSpec,
)
from osrlib.crawl.gates import GateSpec, HasItemCondition
from osrlib.crawl.quests import ObjectiveSpec, QuestSpec, TriggerClause
from osrlib.crawl.triggers import (
    AreaEnteredPattern,
    DungeonEnteredPattern,
    ItemAcquiredPattern,
    LevelEnteredPattern,
    MonsterDefeatedPattern,
    TownEnteredPattern,
    TriggerSpec,
)
from osrlib.data import load_equipment, load_monsters
from osrlib.errors import ContentValidationError

from osreditor.diagnostics import compute_diagnostics, parse_validation_error
from osreditor.ops import Finding
from osreditor.projects import starter_adventure

KNOWN_MONSTER = load_monsters().monsters[0].id


def level(**overrides: object) -> LevelSpec:
    values: dict[str, object] = {"number": 1, "width": 3, "height": 3, "entrance": (0, 0)}
    values.update(overrides)
    return LevelSpec.model_validate(values)


def adventure(*dungeons: DungeonSpec, town: TownSpec | None = None, **overrides: object) -> Adventure:
    return Adventure(
        name="Fixture",
        town=town if town is not None else TownSpec(name=""),
        dungeons=dungeons or (DungeonSpec(id="d", levels=(level(),)),),
        **overrides,  # type: ignore[arg-type]
    )


def feature(feature_id: str, **overrides: object) -> FeatureSpec:
    values: dict[str, object] = {"id": feature_id, "kind": "custom", "cell": (0, 0)}
    values.update(overrides)
    return FeatureSpec.model_validate(values)


def wandering_table(bad_row_monster: str) -> EncounterTable:
    rows = [
        EncounterTableRow(
            roll=roll,
            name=f"row {roll}",
            entry=MonsterEncounterEntry(monster_ids=(bad_row_monster if roll == 1 else KNOWN_MONSTER,)),
            count_fixed=1,
        )
        for roll in range(1, 21)
    ]
    return EncounterTable(id="t", label="Fixture", min_level=1, rows=tuple(rows))


def sole_finding(fixture: Adventure) -> Finding:
    with pytest.raises(ContentValidationError) as excinfo:
        validate_adventure(fixture, load_monsters(), load_equipment())
    findings = parse_validation_error(str(excinfo.value), fixture)
    assert len(findings) == 1, [finding.message for finding in findings]
    assert findings[0].source == "validation"
    return findings[0]


def restricted_alignment_case() -> tuple[str, Alignment]:
    template = next(template for template in load_monsters().monsters if len(template.alignment.options) < 3)
    pinned = next(option for option in Alignment if option not in template.alignment.options)
    return template.id, pinned


def test_bundled_monster_collision_addresses_the_template() -> None:
    shipped = load_monsters().monsters[0]
    finding = sole_finding(adventure(monsters=(shipped,)))
    assert finding.code == "bundled_monster_collision"
    assert finding.address == f"monster:{quote(shipped.id, safe='')}"


def test_bundled_monster_collision_degrades_when_the_id_does_not_resolve() -> None:
    # A collision line the document's own bundled ids cannot confirm (here the
    # message is parsed against a *different* document) degrades to the coarse
    # `monsters` scope — always true, never a lie.
    shipped = load_monsters().monsters[0]
    fixture = adventure(monsters=(shipped,))
    with pytest.raises(ContentValidationError) as excinfo:
        validate_adventure(fixture, load_monsters(), load_equipment())
    findings = parse_validation_error(str(excinfo.value), adventure())
    assert [finding.code for finding in findings] == ["bundled_monster_collision"]
    assert findings[0].address == "monsters"


def test_bundled_item_collision_addresses_the_template() -> None:
    shipped = load_equipment().gear[0]
    finding = sole_finding(adventure(items=(shipped,)))
    assert finding.code == "bundled_item_collision"
    assert finding.address == f"item:{quote(shipped.id, safe='')}"


def test_bundled_item_collision_degrades_when_the_id_does_not_resolve() -> None:
    # A collision line the document's own bundled ids cannot confirm degrades
    # to the coarse `items` scope — always true, never a lie.
    shipped = load_equipment().gear[0]
    fixture = adventure(items=(shipped,))
    with pytest.raises(ContentValidationError) as excinfo:
        validate_adventure(fixture, load_monsters(), load_equipment())
    findings = parse_validation_error(str(excinfo.value), adventure())
    assert [finding.code for finding in findings] == ["bundled_item_collision"]
    assert findings[0].address == "items"


def gated_edge(item_id: str) -> Edge:
    return Edge(
        kind=EdgeKind.DOOR,
        door=DoorSpec(kind="normal", requires=GateSpec(condition=HasItemCondition(item_id=item_id))),
    )


def test_door_gate_unknown_item_addresses_the_edge() -> None:
    fixture = adventure(DungeonSpec(id="d", levels=(level(edges={"1,1:north": gated_edge("ghost-key")}),)))
    finding = sole_finding(fixture)
    assert finding.code == "door_gate_unknown_item"
    assert finding.address == "dungeon:d/level:1/edge:1,1:north"


def test_a_door_gate_line_with_no_confirmable_edge_degrades_to_unclassified() -> None:
    # The owner confirms but no edge key renders the line: the classification
    # is refused rather than guessed coarser — the dangling item id is
    # unconfirmable by definition and never becomes an address.
    fixture = adventure(DungeonSpec(id="d", levels=(level(edges={"1,1:north": gated_edge("ghost-key")}),)))
    with pytest.raises(ContentValidationError) as excinfo:
        validate_adventure(fixture, load_monsters(), load_equipment())
    findings = parse_validation_error(str(excinfo.value), adventure())
    assert [finding.code for finding in findings] == ["validation_unclassified"]
    assert findings[0].address is None


def test_transition_gate_unknown_item_addresses_the_cell() -> None:
    toll = TransitionSpec(
        kind="stairs_down",
        position=(1, 1),
        to_dungeon_id="d",
        to_level_number=1,
        to_position=(0, 0),
        to_facing=Direction.SOUTH,
        requires=GateSpec(condition=HasItemCondition(item_id="ghost-coin")),
    )
    fixture = adventure(DungeonSpec(id="d", levels=(level(transitions=(toll,)),)))
    finding = sole_finding(fixture)
    assert finding.code == "transition_gate_unknown_item"
    assert finding.address == "dungeon:d/level:1/cell:1,1"


# --- the thirteen trigger-owned shapes, enumeration-confirmed --------------------


def trigger(trigger_id: str = "t", **overrides: object) -> TriggerSpec:
    values: dict[str, object] = {"id": trigger_id, "when": TownEnteredPattern()}
    values.update(overrides)
    return TriggerSpec.model_validate(values)


def test_trigger_id_not_unique_addresses_the_trigger() -> None:
    finding = sole_finding(adventure(triggers=(trigger(), trigger())))
    assert finding.code == "trigger_id_not_unique"
    assert finding.message == "trigger 't': id is not unique"
    assert finding.address == "trigger:t"


def test_trigger_pattern_unknown_level() -> None:
    fixture = adventure(triggers=(trigger(when=LevelEnteredPattern(dungeon_id="nowhere", level_number=9)),))
    finding = sole_finding(fixture)
    assert finding.code == "trigger_pattern_unknown_level"
    assert finding.address == "trigger:t"


def test_trigger_pattern_unknown_area() -> None:
    fixture = adventure(triggers=(trigger(when=AreaEnteredPattern(dungeon_id="d", level_number=1, area_id="ghost")),))
    finding = sole_finding(fixture)
    assert finding.code == "trigger_pattern_unknown_area"
    assert finding.address == "trigger:t"


def test_trigger_pattern_unknown_dungeon() -> None:
    fixture = adventure(triggers=(trigger(when=DungeonEnteredPattern(dungeon_id="nowhere")),))
    finding = sole_finding(fixture)
    assert finding.code == "trigger_pattern_unknown_dungeon"
    assert finding.address == "trigger:t"


def test_trigger_pattern_unknown_item() -> None:
    fixture = adventure(triggers=(trigger(when=ItemAcquiredPattern(item_id="ghost")),))
    finding = sole_finding(fixture)
    assert finding.code == "trigger_pattern_unknown_item"
    assert finding.message == "trigger 't': pattern references unknown item 'ghost'"
    assert finding.address == "trigger:t"


def test_trigger_pattern_unknown_monster() -> None:
    fixture = adventure(triggers=(trigger(when=MonsterDefeatedPattern(template_id="ghost")),))
    finding = sole_finding(fixture)
    assert finding.code == "trigger_pattern_unknown_monster"
    assert finding.address == "trigger:t"


def test_trigger_condition_unknown_item() -> None:
    fixture = adventure(triggers=(trigger(conditions=(HasItemCondition(item_id="ghost"),)),))
    finding = sole_finding(fixture)
    assert finding.code == "trigger_condition_unknown_item"
    assert finding.address == "trigger:t"


def test_trigger_selector_violation() -> None:
    fixture = adventure(triggers=(trigger(consequences=(GrantCoins(character_id="c-1", coins=Coins(gp=1)),)),))
    finding = sole_finding(fixture)
    assert finding.code == "trigger_selector_violation"
    assert finding.message == (
        "trigger 't': consequence 0 names character 'c-1'; an authored consequence addresses '@party' or '@first'"
    )
    assert finding.address == "trigger:t"


def test_trigger_consequence_unknown_item() -> None:
    fixture = adventure(triggers=(trigger(consequences=(GrantItem(character_id="@party", item_id="ghost"),)),))
    finding = sole_finding(fixture)
    assert finding.code == "trigger_consequence_unknown_item"
    assert finding.address == "trigger:t"


def test_trigger_consequence_unknown_monster() -> None:
    fixture = adventure(
        triggers=(trigger(consequences=(SpawnMonsters(template_id="ghost", count_fixed=1, distance_feet=30),)),)
    )
    finding = sole_finding(fixture)
    assert finding.code == "trigger_consequence_unknown_monster"
    assert finding.address == "trigger:t"


def test_trigger_consequence_unknown_level() -> None:
    fixture = adventure(
        triggers=(
            trigger(
                consequences=(
                    SetDoorState(dungeon_id="nowhere", level_number=9, x=0, y=0, direction=Direction.NORTH, open=True),
                )
            ),
        )
    )
    finding = sole_finding(fixture)
    assert finding.code == "trigger_consequence_unknown_level"
    assert finding.address == "trigger:t"


def test_trigger_consequence_no_door() -> None:
    fixture = adventure(
        triggers=(
            trigger(
                consequences=(
                    SetDoorState(dungeon_id="d", level_number=1, x=1, y=1, direction=Direction.NORTH, open=True),
                )
            ),
        )
    )
    finding = sole_finding(fixture)
    assert finding.code == "trigger_consequence_no_door"
    assert finding.message == "trigger 't': consequence 0 names no door at (1, 1) north"
    assert finding.address == "trigger:t"


def test_trigger_consequence_out_of_bounds() -> None:
    placement = PlaceParty(
        location=PartyLocation(kind="dungeon", dungeon_id="d", level_number=1, position=(9, 9), facing=Direction.NORTH)
    )
    fixture = adventure(triggers=(trigger(consequences=(placement,)),))
    finding = sole_finding(fixture)
    assert finding.code == "trigger_consequence_out_of_bounds"
    assert finding.address == "trigger:t"


def test_a_confirmed_shape_with_an_unconfirmed_id_degrades_to_the_triggers_scope() -> None:
    # The line is parsed against a document without the trigger: the shape
    # still matches whole-line, the owner confirms against nothing, and the
    # address degrades to the bare `triggers` scope — always true, never a lie.
    fixture = adventure(triggers=(trigger(when=ItemAcquiredPattern(item_id="ghost")),))
    with pytest.raises(ContentValidationError) as excinfo:
        validate_adventure(fixture, load_monsters(), load_equipment())
    findings = parse_validation_error(str(excinfo.value), adventure())
    assert [finding.code for finding in findings] == ["trigger_pattern_unknown_item"]
    assert findings[0].address == "triggers"


def test_a_hostile_trigger_id_still_classifies_by_enumeration() -> None:
    # An id embedding another shape's rendered text cannot defeat the
    # resolver: the true id renders its own prefix exactly, and the
    # uniqueness tail matches the true remainder.
    hostile = "x': pattern references unknown item 'g"
    fixture = adventure(triggers=(trigger(hostile), trigger(hostile)))
    finding = sole_finding(fixture)
    assert finding.code == "trigger_id_not_unique"
    assert finding.address == f"trigger:{quote(hostile, safe='')}"


def test_a_dungeon_id_opening_with_trigger_text_keeps_its_true_shape() -> None:
    # A dungeon id opening with "trigger '…'" renders owner-scoped lines that
    # look trigger-owned; the owner-confirmed classifiers run first and claim
    # the line by enumeration.
    hostile = "trigger 'ghost'"
    finding = sole_finding(adventure(DungeonSpec(id=hostile, levels=(level(entrance=(9, 9)),))))
    assert finding.code == "entrance_out_of_bounds"
    assert finding.address == f"dungeon:{quote(hostile, safe='')}/level:1"


# --- the thirteen quest-owned shapes, two-level enumeration-confirmed ------------


def clause(**overrides: object) -> TriggerClause:
    values: dict[str, object] = {"pattern": TownEnteredPattern()}
    values.update(overrides)
    return TriggerClause.model_validate(values)


def objective(objective_id: str = "find", **overrides: object) -> ObjectiveSpec:
    values: dict[str, object] = {"id": objective_id, "when": clause()}
    values.update(overrides)
    return ObjectiveSpec.model_validate(values)


def quest(quest_id: str = "q", **overrides: object) -> QuestSpec:
    values: dict[str, object] = {"id": quest_id, "name": "The quest", "objectives": (objective(),)}
    values.update(overrides)
    return QuestSpec.model_validate(values)


def test_quest_id_not_unique_addresses_the_quest() -> None:
    finding = sole_finding(adventure(quests=(quest(), quest())))
    assert finding.code == "quest_id_not_unique"
    assert finding.message == "quest 'q': id is not unique"
    assert finding.address == "quest:q"


def test_quest_pattern_unknown_level_at_the_activation_site() -> None:
    fixture = adventure(
        quests=(quest(activation=clause(pattern=LevelEnteredPattern(dungeon_id="nowhere", level_number=9))),)
    )
    finding = sole_finding(fixture)
    assert finding.code == "quest_pattern_unknown_level"
    assert finding.message == "quest 'q': pattern references unknown 'nowhere' level 9"
    assert finding.address == "quest:q"


def test_quest_pattern_unknown_area_at_the_objective_site() -> None:
    completing = clause(pattern=AreaEnteredPattern(dungeon_id="d", level_number=1, area_id="ghost"))
    fixture = adventure(quests=(quest(objectives=(objective(when=completing),)),))
    finding = sole_finding(fixture)
    assert finding.code == "quest_pattern_unknown_area"
    assert finding.message == "quest 'q' objective 'find': pattern references unknown area 'ghost' on 'd' level 1"
    assert finding.address == "quest:q"


def test_quest_pattern_unknown_dungeon() -> None:
    fixture = adventure(quests=(quest(activation=clause(pattern=DungeonEnteredPattern(dungeon_id="nowhere"))),))
    finding = sole_finding(fixture)
    assert finding.code == "quest_pattern_unknown_dungeon"
    assert finding.address == "quest:q"


def test_quest_pattern_unknown_item_at_the_objective_site() -> None:
    fixture = adventure(
        quests=(quest(objectives=(objective(when=clause(pattern=ItemAcquiredPattern(item_id="ghost"))),)),)
    )
    finding = sole_finding(fixture)
    assert finding.code == "quest_pattern_unknown_item"
    assert finding.message == "quest 'q' objective 'find': pattern references unknown item 'ghost'"
    assert finding.address == "quest:q"


def test_quest_pattern_unknown_monster_at_the_reveal_site() -> None:
    hidden = objective(hidden=True, reveal_when=clause(pattern=MonsterDefeatedPattern(template_id="ghost")))
    fixture = adventure(quests=(quest(objectives=(hidden,)),))
    finding = sole_finding(fixture)
    assert finding.code == "quest_pattern_unknown_monster"
    assert finding.message == "quest 'q' objective 'find' reveal: pattern references unknown monster 'ghost'"
    assert finding.address == "quest:q"


def test_quest_condition_unknown_item() -> None:
    fixture = adventure(quests=(quest(activation=clause(conditions=(HasItemCondition(item_id="ghost"),))),))
    finding = sole_finding(fixture)
    assert finding.code == "quest_condition_unknown_item"
    assert finding.address == "quest:q"


def test_quest_selector_violation() -> None:
    fixture = adventure(quests=(quest(rewards=(GrantCoins(character_id="c-1", coins=Coins(gp=1)),)),))
    finding = sole_finding(fixture)
    assert finding.code == "quest_selector_violation"
    assert finding.message == (
        "quest 'q': reward 0 names character 'c-1'; an authored consequence addresses '@party' or '@first'"
    )
    assert finding.address == "quest:q"


def test_quest_reward_unknown_item() -> None:
    fixture = adventure(quests=(quest(rewards=(GrantItem(character_id="@party", item_id="ghost"),)),))
    finding = sole_finding(fixture)
    assert finding.code == "quest_reward_unknown_item"
    assert finding.message == "quest 'q': reward 0 references unknown item 'ghost'"
    assert finding.address == "quest:q"


def test_quest_reward_unknown_monster() -> None:
    fixture = adventure(quests=(quest(rewards=(SpawnMonsters(template_id="ghost", count_fixed=1, distance_feet=30),)),))
    finding = sole_finding(fixture)
    assert finding.code == "quest_reward_unknown_monster"
    assert finding.address == "quest:q"


def test_quest_reward_unknown_level() -> None:
    fixture = adventure(
        quests=(
            quest(
                rewards=(
                    SetDoorState(dungeon_id="nowhere", level_number=9, x=0, y=0, direction=Direction.NORTH, open=True),
                )
            ),
        )
    )
    finding = sole_finding(fixture)
    assert finding.code == "quest_reward_unknown_level"
    assert finding.address == "quest:q"


def test_quest_reward_no_door() -> None:
    fixture = adventure(
        quests=(
            quest(
                rewards=(SetDoorState(dungeon_id="d", level_number=1, x=1, y=1, direction=Direction.NORTH, open=True),)
            ),
        )
    )
    finding = sole_finding(fixture)
    assert finding.code == "quest_reward_no_door"
    assert finding.message == "quest 'q': reward 0 names no door at (1, 1) north"
    assert finding.address == "quest:q"


def test_quest_reward_out_of_bounds() -> None:
    placement = PlaceParty(
        location=PartyLocation(kind="dungeon", dungeon_id="d", level_number=1, position=(9, 9), facing=Direction.NORTH)
    )
    fixture = adventure(quests=(quest(rewards=(placement,)),))
    finding = sole_finding(fixture)
    assert finding.code == "quest_reward_out_of_bounds"
    assert finding.address == "quest:q"


def test_a_confirmed_shape_with_an_unconfirmed_id_degrades_to_the_quests_scope() -> None:
    # The line is parsed against a document without the quest: the shape
    # still matches whole-line, the owner confirms against nothing, and the
    # address degrades to the bare `quests` scope — always true, never a lie.
    fixture = adventure(
        quests=(quest(objectives=(objective(when=clause(pattern=ItemAcquiredPattern(item_id="ghost"))),)),)
    )
    with pytest.raises(ContentValidationError) as excinfo:
        validate_adventure(fixture, load_monsters(), load_equipment())
    findings = parse_validation_error(str(excinfo.value), adventure())
    assert [finding.code for finding in findings] == ["quest_pattern_unknown_item"]
    assert findings[0].address == "quests"


def test_an_objective_site_confirms_only_against_the_owning_quests_objectives() -> None:
    # The two-level rule: quest 'q' renders the line but its objectives lack
    # 'find', and quest 'other' — which has a 'find' objective — cannot render
    # a `quest 'q'` prefix. Neither confirms, so the shape degrades to the
    # bare scope rather than navigating to the wrong quest.
    emitting = adventure(
        quests=(quest(objectives=(objective(when=clause(pattern=ItemAcquiredPattern(item_id="ghost"))),)),)
    )
    with pytest.raises(ContentValidationError) as excinfo:
        validate_adventure(emitting, load_monsters(), load_equipment())
    receiving = adventure(
        quests=(
            quest(objectives=(objective("elsewhere"),)),
            quest("other", objectives=(objective("find"),)),
        )
    )
    findings = parse_validation_error(str(excinfo.value), receiving)
    assert [finding.code for finding in findings] == ["quest_pattern_unknown_item"]
    assert findings[0].address == "quests"


def test_a_shared_objective_id_still_confirms_the_owning_quest() -> None:
    # Two quests may share an objective id (osrlib scopes uniqueness per
    # quest); only the emitting quest's rendered prefix opens the line.
    dangling = objective("shared", when=clause(pattern=ItemAcquiredPattern(item_id="ghost")))
    fixture = adventure(
        quests=(
            quest("a", objectives=(dangling,)),
            quest("b", objectives=(objective("shared"),)),
        )
    )
    finding = sole_finding(fixture)
    assert finding.code == "quest_pattern_unknown_item"
    assert finding.address == "quest:a"


def test_a_hostile_quest_id_still_classifies_by_enumeration() -> None:
    # An id embedding an objective site's rendered text cannot defeat the
    # resolver: the true id renders its own prefix exactly, and the
    # uniqueness tail matches the true remainder.
    hostile = "x' objective 'o"
    fixture = adventure(quests=(quest(hostile), quest(hostile)))
    finding = sole_finding(fixture)
    assert finding.code == "quest_id_not_unique"
    assert finding.address == f"quest:{quote(hostile, safe='')}"


def test_a_trigger_id_opening_with_quest_text_keeps_its_true_shape() -> None:
    # A trigger id crafted to read as quest grammar still classifies as a
    # trigger: the trigger classifier runs first and confirms by enumeration,
    # and no quest render can produce a line opening `trigger `.
    hostile = "quest 'evil'"
    fixture = adventure(triggers=(trigger(hostile), trigger(hostile)))
    finding = sole_finding(fixture)
    assert finding.code == "trigger_id_not_unique"
    assert finding.address == f"trigger:{quote(hostile, safe='')}"


def test_a_quest_id_opening_with_trigger_text_keeps_its_true_shape() -> None:
    # The reverse forgery: a quest id reading as trigger grammar renders
    # `quest "trigger 'evil'": …`, which no start-anchored trigger shape
    # matches — the quest classifier claims it by enumeration.
    hostile = "trigger 'evil'"
    fixture = adventure(quests=(quest(hostile), quest(hostile)))
    finding = sole_finding(fixture)
    assert finding.code == "quest_id_not_unique"
    assert finding.address == f"quest:{quote(hostile, safe='')}"


def test_travel_unknown_dungeon() -> None:
    finding = sole_finding(adventure(town=TownSpec(name="", travel_turns={"nowhere": 1})))
    assert finding.code == "travel_unknown_dungeon"
    assert finding.address == "town"


def test_entrance_missing() -> None:
    finding = sole_finding(adventure(DungeonSpec(id="d", levels=(level(entrance=None),))))
    assert finding.code == "entrance_missing"
    assert finding.address == "dungeon:d"


def test_entrance_out_of_bounds() -> None:
    finding = sole_finding(adventure(DungeonSpec(id="d", levels=(level(entrance=(9, 9)),))))
    assert finding.code == "entrance_out_of_bounds"
    assert finding.address == "dungeon:d/level:1"


def test_feature_id_conflict() -> None:
    fixture = adventure(
        DungeonSpec(id="d", levels=(level(features=(feature("f", cell=(0, 0)), feature("f", cell=(1, 1)))),))
    )
    finding = sole_finding(fixture)
    assert finding.code == "feature_id_conflict"
    assert finding.address == "dungeon:d/level:1"


def test_feature_id_reserved() -> None:
    finding = sole_finding(adventure(DungeonSpec(id="d", levels=(level(features=(feature("pile"),)),))))
    assert finding.code == "feature_id_reserved"
    assert finding.address == "dungeon:d/level:1"


def test_area_id_conflict() -> None:
    areas = (
        AreaSpec(id="1", cells=((0, 0),)),
        AreaSpec(id="1", cells=((1, 1),)),
    )
    finding = sole_finding(adventure(DungeonSpec(id="d", levels=(level(areas=areas),))))
    assert finding.code == "area_id_conflict"
    assert finding.address == "dungeon:d/level:1"


def test_area_cell_out_of_bounds() -> None:
    areas = (AreaSpec(id="7", cells=((9, 9),)),)
    finding = sole_finding(adventure(DungeonSpec(id="d", levels=(level(areas=areas),))))
    assert finding.code == "area_cell_out_of_bounds"
    assert finding.address == "dungeon:d/level:1/area:7"


def test_encounter_unknown_monster() -> None:
    areas = (
        AreaSpec(
            id="1",
            cells=((0, 0),),
            encounter=KeyedEncounter(monsters=(KeyedMonster(template_id="no-such-monster", count_fixed=1),)),
        ),
    )
    finding = sole_finding(adventure(DungeonSpec(id="d", levels=(level(areas=areas),))))
    assert finding.code == "encounter_unknown_monster"
    assert finding.address == "dungeon:d/level:1/area:1"


def test_encounter_alignment_invalid() -> None:
    template_id, pinned = restricted_alignment_case()
    areas = (
        AreaSpec(
            id="1",
            cells=((0, 0),),
            encounter=KeyedEncounter(
                monsters=(KeyedMonster(template_id=template_id, count_fixed=1),), alignment=pinned
            ),
        ),
    )
    finding = sole_finding(adventure(DungeonSpec(id="d", levels=(level(areas=areas),))))
    assert finding.code == "encounter_alignment_invalid"
    assert finding.address == "dungeon:d/level:1/area:1"


def test_feature_unknown_item() -> None:
    features = (feature("cache", kind="treasure_cache", item_ids=("no-such-item",)),)
    finding = sole_finding(adventure(DungeonSpec(id="d", levels=(level(features=features),))))
    assert finding.code == "feature_unknown_item"
    assert finding.address == "dungeon:d/level:1"


def test_feature_unknown_magic_item() -> None:
    features = (feature("cache", kind="treasure_cache", magic_item_ids=("no-such-item",)),)
    finding = sole_finding(adventure(DungeonSpec(id="d", levels=(level(features=features),))))
    assert finding.code == "feature_unknown_magic_item"
    assert finding.address == "dungeon:d/level:1"


def test_feature_cell_out_of_bounds() -> None:
    finding = sole_finding(adventure(DungeonSpec(id="d", levels=(level(features=(feature("f", cell=(9, 9)),)),))))
    assert finding.code == "feature_cell_out_of_bounds"
    assert finding.address == "dungeon:d/level:1"


def test_feature_needs_cell() -> None:
    finding = sole_finding(adventure(DungeonSpec(id="d", levels=(level(features=(feature("f", cell=None),)),))))
    assert finding.code == "feature_needs_cell"
    assert finding.address == "dungeon:d/level:1"


def test_wandering_unknown_monster() -> None:
    wandering = WanderingSpec(table=wandering_table("no-such-monster"))
    finding = sole_finding(adventure(DungeonSpec(id="d", levels=(level(wandering=wandering),))))
    assert finding.code == "wandering_unknown_monster"
    assert finding.address == "dungeon:d/level:1"


def transition(**overrides: object) -> TransitionSpec:
    values: dict[str, object] = {
        "kind": "stairs_down",
        "position": (0, 0),
        "to_dungeon_id": "d",
        "to_level_number": 1,
        "to_position": (0, 0),
        "to_facing": Direction.NORTH,
    }
    values.update(overrides)
    return TransitionSpec.model_validate(values)


def test_transition_out_of_bounds() -> None:
    fixture = adventure(DungeonSpec(id="d", levels=(level(transitions=(transition(position=(9, 9)),)),)))
    finding = sole_finding(fixture)
    assert finding.code == "transition_out_of_bounds"
    assert finding.address == "dungeon:d/level:1"


def test_transition_target_unknown() -> None:
    fixture = adventure(DungeonSpec(id="d", levels=(level(transitions=(transition(to_dungeon_id="nowhere"),)),)))
    finding = sole_finding(fixture)
    assert finding.code == "transition_target_unknown"
    assert finding.address == "dungeon:d/level:1"


def test_transition_target_cell_out_of_bounds() -> None:
    fixture = adventure(DungeonSpec(id="d", levels=(level(transitions=(transition(to_position=(9, 9)),)),)))
    finding = sole_finding(fixture)
    assert finding.code == "transition_target_cell_out_of_bounds"
    assert finding.address == "dungeon:d/level:1"


def test_addresses_percent_encode_hostile_ids() -> None:
    finding = sole_finding(adventure(DungeonSpec(id="deep caves", levels=(level(entrance=(9, 9)),))))
    assert finding.address == "dungeon:deep%20caves/level:1"


def test_id_containing_level_still_resolves() -> None:
    # An id embedding " level " cannot defeat the enumeration resolver: the
    # document's own (dungeon, level) pairs are rendered as osrlib renders
    # them, and only the true pair reproduces the line.
    finding = sole_finding(adventure(DungeonSpec(id="x level 9", levels=(level(entrance=(9, 9)),))))
    assert finding.code == "entrance_out_of_bounds"
    assert finding.address == "dungeon:x%20level%209/level:1"


def test_empty_dungeon_id_resolves_honestly() -> None:
    # Even an empty dungeon id confirms by enumeration — the address carries
    # the empty encoded value rather than degrading.
    finding = sole_finding(adventure(DungeonSpec(id="", levels=(level(entrance=(9, 9)),))))
    assert finding.code == "entrance_out_of_bounds"
    assert finding.address == "dungeon:/level:1"


def test_quoted_area_id_resolves_via_its_repr() -> None:
    # An area id with an embedded quote repr-renders with double quotes; the
    # resolver renders candidates exactly as osrlib reprs them, so it still
    # confirms and addresses the true area.
    areas = (AreaSpec(id="it's 7", cells=((9, 9),)),)
    finding = sole_finding(adventure(DungeonSpec(id="d", levels=(level(areas=areas),))))
    assert finding.code == "area_cell_out_of_bounds"
    assert finding.address == "dungeon:d/level:1/area:it%27s%207"


def test_a_planted_decoy_area_never_steals_the_address() -> None:
    # The double-planted counterexample: a monster id embedding the message's
    # own separator text, plus a decoy area whose id matches a naive greedy
    # regex split. The repr-rendered candidate check pins the true area; the
    # decoy's repr (quote-flipped by its embedded quote) can never render the
    # line.
    decoy_id = "1' references unknown monster \"m"
    areas = (
        AreaSpec(
            id="1",
            cells=((0, 0),),
            encounter=KeyedEncounter(
                monsters=(KeyedMonster(template_id="m' references unknown monster 'x", count_fixed=1),)
            ),
        ),
        AreaSpec(id=decoy_id, cells=((1, 1),)),
    )
    finding = sole_finding(adventure(DungeonSpec(id="d", levels=(level(areas=areas),))))
    assert finding.code == "encounter_unknown_monster"
    assert finding.address == "dungeon:d/level:1/area:1"


def test_a_newline_id_degrades_to_unclassified_fragments() -> None:
    # An id embedding a newline splits its own message line; neither fragment
    # confirms against the document, so both degrade to unclassified — a less
    # navigable finding, never a wrong code or address.
    fixture = adventure(DungeonSpec(id="bad\nid", levels=(level(entrance=(9, 9)),)))
    with pytest.raises(ContentValidationError) as excinfo:
        validate_adventure(fixture, load_monsters(), load_equipment())
    findings = parse_validation_error(str(excinfo.value), fixture)
    assert len(findings) == 2
    assert all(finding.code == "validation_unclassified" for finding in findings)
    assert all(finding.address is None for finding in findings)


def test_a_cross_shape_forgery_classifies_by_the_true_shape() -> None:
    # A dungeon id embedding another dungeon's full rendered owner prefix plus
    # an area-shape opening ("d level 1: area 'evil'") makes the earlier
    # area-cell shape's tail match under the wrong owner — but its area cannot
    # be confirmed, the shape refuses, and the line falls through to its true
    # shape with the true owner.
    hostile = "d level 1: area 'evil'"
    fixture = adventure(
        DungeonSpec(id="d", levels=(level(),)),
        DungeonSpec(id=hostile, levels=(level(number=2, features=(feature("f", cell=(9, 9)),)),)),
    )
    finding = sole_finding(fixture)
    assert finding.code == "feature_cell_out_of_bounds"
    assert finding.address == f"dungeon:{quote(hostile, safe='')}/level:2"


def test_a_hostile_id_faking_a_static_shape_still_classifies_by_its_owner() -> None:
    # A dungeon id opening with a static shape's text ("town travel names
    # unknown dungeon '…") would fool a first-match static pattern; the
    # owner-confirmed shapes run first and claim the line by enumeration.
    hostile = "town travel names unknown dungeon 'evil"
    finding = sole_finding(adventure(DungeonSpec(id=hostile, levels=(level(entrance=(9, 9)),))))
    assert finding.code == "entrance_out_of_bounds"
    assert finding.address == f"dungeon:{quote(hostile, safe='')}/level:1"


def test_unrecognized_line_is_never_dropped() -> None:
    fixture = starter_adventure("Fixture")
    findings = parse_validation_error("adventure validation failed:\nsomething novel osrlib now says", fixture)
    assert findings == (
        Finding(
            source="validation",
            code="validation_unclassified",
            severity="error",
            message="something novel osrlib now says",
            address=None,
        ),
    )


def test_message_is_the_line_verbatim() -> None:
    finding = sole_finding(adventure(town=TownSpec(name="", travel_turns={"nowhere": 1})))
    assert finding.message == "town travel names unknown dungeon 'nowhere'"


def test_clean_adventure_yields_empty_diagnostics() -> None:
    diagnostics = compute_diagnostics(starter_adventure("Fresh"))
    assert diagnostics.validation == ()
    assert diagnostics.lint == ()
