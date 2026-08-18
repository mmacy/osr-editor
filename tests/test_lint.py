"""The structural lint: every check's semantics, messages, ordering, and the torture fixture."""

import json
import time
from pathlib import Path

from osrlib.core.items import Coins, GearTemplate
from osrlib.crawl.adventure import Adventure, TownSpec, validate_adventure
from osrlib.crawl.commands import AwardXP, GrantCoins, GrantItem, SetFlag, SpawnMonsters
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
    TransitionSpec,
)
from osrlib.crawl.gates import FlagEqualsCondition, GateSpec, HasItemCondition
from osrlib.crawl.quests import ObjectiveSpec, QuestSpec, TriggerClause
from osrlib.crawl.triggers import AreaEnteredPattern, FlagSetPattern, TownEnteredPattern, TriggerSpec
from osrlib.data import load_equipment, load_monsters

from osreditor.diagnostics import compute_diagnostics
from osreditor.documents import canonical_json_bytes, dump_adventure, load_adventure
from osreditor.lint import SEVERITY, lint_adventure
from osreditor.ops import Finding

TORTURE_PATH = Path(__file__).parent / "fixtures" / "torture_geometry.json"

OPEN = Edge(kind=EdgeKind.OPEN)


def door(**overrides: object) -> Edge:
    return Edge(kind=EdgeKind.DOOR, door=DoorSpec.model_validate(overrides))


def level(number: int = 1, **overrides: object) -> LevelSpec:
    values: dict[str, object] = {"number": number, "width": 4, "height": 4, "entrance": (0, 0)}
    values.update(overrides)
    return LevelSpec.model_validate(values)


def adventure(*dungeons: DungeonSpec) -> Adventure:
    return Adventure(
        name="Lint fixture",
        town=TownSpec(name=""),
        dungeons=dungeons or (DungeonSpec(id="d", levels=(level(),)),),
    )


def transition(**overrides: object) -> TransitionSpec:
    values: dict[str, object] = {
        "kind": "stairs_down",
        "position": (0, 0),
        "to_dungeon_id": "d",
        "to_level_number": 2,
        "to_position": (0, 0),
        "to_facing": Direction.NORTH,
    }
    values.update(overrides)
    return TransitionSpec.model_validate(values)


def build_torture_adventure() -> Adventure:
    """Build the committed doors-and-transitions torture fixture.

    An original, editor-buildable two-level geometry exercising every door
    state (normal, secret, stuck, locked, starts-open), a paired stairs flight,
    a one-way chute, a secret-only shrine, an orphan corridor stub, and an
    overlapping-area pair. It lints clean except where it is built to fail —
    the pinned findings are asserted in
    `test_torture_fixture_lints_exactly_as_built`. The doctored non-canonical
    edge key lives in a test-local variant only, never the committed bytes.
    """
    level_one = LevelSpec(
        number=1,
        width=8,
        height=6,
        entrance=(0, 0),
        edges={
            "1,0:west": OPEN,
            "2,0:west": OPEN,
            "3,0:west": door(),
            "4,0:west": OPEN,
            "5,0:west": OPEN,
            "6,0:west": OPEN,
            "7,0:west": OPEN,
            "1,1:north": door(kind="secret"),
            "2,1:west": OPEN,
            "3,1:north": door(starts_open=True),
            "4,1:north": door(stuck=True),
            "5,1:west": door(locked=True),
            "4,2:north": OPEN,
            "4,3:north": OPEN,
            "5,3:west": OPEN,
            "5,4:north": OPEN,
            "6,4:west": OPEN,
            "1,5:west": OPEN,
        },
        areas=(
            AreaSpec(
                id="1", name="Guardroom", description="Cold braziers and a knucklebone table.", cells=((1, 0), (2, 0))
            ),
            AreaSpec(id="2", name="Storeroom", description="Racks of stiffened hides.", cells=((4, 1),)),
            AreaSpec(id="3", name="Locked vault", description="The tanner's strongbox room.", cells=((5, 1),)),
            AreaSpec(
                id="4", name="Hidden shrine", description="A niche behind the guardroom wall.", cells=((1, 1), (2, 1))
            ),
            AreaSpec(id="5", name="Flooded cellar", description="Ankle-deep run-off.", cells=((5, 3), (5, 4))),
            AreaSpec(
                id="6",
                name="Silt bench",
                description="A mud shelf sharing the cellar's low corner.",
                cells=((5, 4), (6, 4)),
            ),
        ),
        transitions=(
            TransitionSpec(
                kind="stairs_down",
                position=(7, 0),
                to_dungeon_id="tannery-vaults",
                to_level_number=2,
                to_position=(0, 0),
                to_facing=Direction.SOUTH,
            ),
            TransitionSpec(
                kind="chute",
                position=(5, 1),
                to_dungeon_id="tannery-vaults",
                to_level_number=2,
                to_position=(3, 2),
                to_facing=Direction.NORTH,
            ),
        ),
    )
    level_two = LevelSpec(
        number=2,
        width=6,
        height=4,
        edges={
            "1,0:west": OPEN,
            "1,1:north": OPEN,
            "4,2:west": OPEN,
        },
        areas=(AreaSpec(id="1", name="Tanning pits", description="Sunken vats, long dry.", cells=((1, 0), (1, 1))),),
        transitions=(
            TransitionSpec(
                kind="stairs_up",
                position=(0, 0),
                to_dungeon_id="tannery-vaults",
                to_level_number=1,
                to_position=(7, 0),
                to_facing=Direction.EAST,
            ),
        ),
    )
    return Adventure(
        name="The tannery vaults",
        description="The doors-and-transitions torture case: every door state, a stairs pair, a one-way chute.",
        town=TownSpec(name="Wattle-on-Sludge", travel_turns={"tannery-vaults": 3}),
        dungeons=(DungeonSpec(id="tannery-vaults", name="The tannery vaults", levels=(level_one, level_two)),),
    )


def codes(findings: tuple[Finding, ...]) -> list[str]:
    return [finding.code for finding in findings]


def test_severity_table_matches_forge() -> None:
    assert SEVERITY == {
        "edge_invalid": "error",
        "area_unreachable": "error",
        "orphan_cell": "warning",
        "secret_only_access": "warning",
        "transition_unpaired": "warning",
        "area_overlap": "warning",
        "flag_read_no_writer": "warning",
        "trigger_cycle": "warning",
        "trigger_spawn_collision": "warning",
        "quest_reward_unpriced": "warning",
        "key_not_placed": "warning",
    }


def test_every_finding_carries_lint_source_and_its_pinned_severity() -> None:
    fixture = build_torture_adventure()
    for finding in lint_adventure(fixture):
        assert finding.source == "lint"
        assert finding.severity == SEVERITY[finding.code]


def test_edge_invalid_malformed_key() -> None:
    fixture = adventure(DungeonSpec(id="d", levels=(level(edges={"bogus": OPEN}),)))
    finding = lint_adventure(fixture)[0]
    assert finding.code == "edge_invalid"
    assert finding.severity == "error"
    assert finding.message == "edge key 'bogus' is malformed — expected 'x,y:side'"
    assert finding.address == "dungeon:d/level:1"


def test_edge_invalid_non_canonical_key() -> None:
    fixture = adventure(DungeonSpec(id="d", levels=(level(edges={"0,1:south": OPEN}),)))
    finding = lint_adventure(fixture)[0]
    assert finding.code == "edge_invalid"
    assert finding.message == "edge key '0,1:south' is never consulted — osrlib's canonical form is '0,2:north'"


def test_edge_invalid_out_of_bounds_incident_cell() -> None:
    fixture = adventure(DungeonSpec(id="d", levels=(level(edges={"0,0:north": OPEN}),)))
    finding = lint_adventure(fixture)[0]
    assert finding.code == "edge_invalid"
    assert finding.message == "edge key '0,0:north' references the out-of-bounds cell (0, -1)"


def test_area_unreachable_when_sealed() -> None:
    fixture = adventure(DungeonSpec(id="d", levels=(level(areas=(AreaSpec(id="7", cells=((2, 2),)),)),)))
    finding = lint_adventure(fixture)[0]
    assert finding.code == "area_unreachable"
    assert finding.severity == "error"
    assert finding.message == "no path from any entrance reaches this area"
    assert finding.address == "dungeon:d/level:1/area:7"


def test_reachability_seeds_the_first_entrance_bearing_level_only() -> None:
    # An override-authored second entrance must not manufacture phantom
    # reachability — osrlib's EnterDungeon lands on the first entrance-bearing
    # level in stored order, and the BFS seeds exactly that expression.
    first = level(1, areas=(AreaSpec(id="1", cells=((0, 0),)),))
    second = level(2, areas=(AreaSpec(id="1", cells=((0, 0),)),))
    fixture = adventure(DungeonSpec(id="d", levels=(first, second)))
    assert codes(lint_adventure(fixture)) == ["area_unreachable"]
    assert lint_adventure(fixture)[0].address == "dungeon:d/level:2/area:1"


def test_an_out_of_bounds_entrance_seeds_nothing() -> None:
    fixture = adventure(
        DungeonSpec(id="d", levels=(level(entrance=(9, 9), areas=(AreaSpec(id="1", cells=((0, 0),)),)),))
    )
    assert "area_unreachable" in codes(lint_adventure(fixture))


def test_doors_in_any_state_are_passable_inclusively() -> None:
    # Stuck and locked doors are passable in both flavors — only secrecy hides
    # a door from the non-secret graph.
    edges = {"1,0:west": door(stuck=True), "2,0:west": door(locked=True), "3,0:west": door(starts_open=True)}
    fixture = adventure(DungeonSpec(id="d", levels=(level(edges=edges, areas=(AreaSpec(id="1", cells=((3, 0),)),)),)))
    assert lint_adventure(fixture) == ()


def test_reachability_is_gate_blind_by_the_specs_decision() -> None:
    # _passable reads edge kinds, never `requires`: a room behind a gated door
    # is reachable — the gate is play-time state, not geometry — so it is not
    # area_unreachable.
    gated = door(
        kind="normal",
        requires={"condition": {"condition_type": "has_item", "item_id": "brass-key"}},
    )
    fixture = adventure(
        DungeonSpec(id="d", levels=(level(edges={"1,0:west": gated}, areas=(AreaSpec(id="1", cells=((1, 0),)),)),))
    )
    assert lint_adventure(fixture) == ()


def test_directed_transitions_extend_reachability() -> None:
    levels = (
        level(1, transitions=(transition(),)),
        level(2, entrance=None, areas=(AreaSpec(id="1", cells=((0, 0),)),)),
    )
    fixture = adventure(DungeonSpec(id="d", levels=levels))
    # The stairs are unpaired (a warning), but the area they land beside is
    # reachable — transitions are directed edges into levels that exist.
    assert codes(lint_adventure(fixture)) == ["transition_unpaired"]


def test_a_transition_into_a_missing_level_extends_nothing() -> None:
    levels = (level(1, transitions=(transition(to_level_number=9),)),)
    fixture = adventure(DungeonSpec(id="d", levels=levels))
    assert codes(lint_adventure(fixture)) == ["transition_unpaired"]


def test_orphan_cell_requires_a_non_wall_edge() -> None:
    # (2,2)-(3,2) are joined to each other but to nothing else: both flagged.
    # Every other blank bounding-box cell stays silent.
    fixture = adventure(DungeonSpec(id="d", levels=(level(edges={"3,2:west": OPEN}),)))
    findings = lint_adventure(fixture)
    assert codes(findings) == ["orphan_cell", "orphan_cell"]
    assert findings[0].message == "cell (2, 2) renders as corridor but no path reaches it"
    assert findings[0].severity == "warning"
    assert findings[0].address == "dungeon:d/level:1/cell:2,2"
    assert findings[1].address == "dungeon:d/level:1/cell:3,2"


def test_orphan_scan_is_y_outer() -> None:
    # Two stubs, one at (3,0) and one at (0,3): row order wins, not column.
    fixture = adventure(DungeonSpec(id="d", levels=(level(edges={"3,0:west": OPEN, "0,3:north": OPEN}),)))
    addresses = [finding.address for finding in lint_adventure(fixture)]
    assert addresses == [
        "dungeon:d/level:1/cell:2,0",
        "dungeon:d/level:1/cell:3,0",
        "dungeon:d/level:1/cell:0,2",
        "dungeon:d/level:1/cell:0,3",
    ]


def test_secret_only_access() -> None:
    edges = {"1,0:west": door(kind="secret")}
    fixture = adventure(DungeonSpec(id="d", levels=(level(edges=edges, areas=(AreaSpec(id="1", cells=((1, 0),)),)),)))
    finding = lint_adventure(fixture)[0]
    assert finding.code == "secret_only_access"
    assert finding.severity == "warning"
    assert finding.message == "every path into this area passes through a secret door"
    assert finding.address == "dungeon:d/level:1/area:1"


def test_an_open_second_route_clears_secret_only_access() -> None:
    edges = {"1,0:west": door(kind="secret"), "1,1:north": OPEN, "1,1:west": OPEN, "0,1:north": OPEN}
    fixture = adventure(DungeonSpec(id="d", levels=(level(edges=edges, areas=(AreaSpec(id="1", cells=((1, 0),)),)),)))
    assert lint_adventure(fixture) == ()


def test_transition_unpaired_stairs_message_mirrors_forge() -> None:
    fixture = adventure(DungeonSpec(id="d", levels=(level(1, transitions=(transition(),)), level(2, entrance=None))))
    finding = lint_adventure(fixture)[0]
    assert finding.code == "transition_unpaired"
    assert finding.severity == "warning"
    assert finding.message == "stairs_down at (0, 0) has no transition back from d/2 (0, 0)"
    assert finding.address == "dungeon:d/level:1/cell:0,0"


def test_paired_stairs_are_silent_including_across_dungeons() -> None:
    there = transition(to_dungeon_id="e", to_level_number=1, to_position=(1, 1))
    back = transition(kind="stairs_up", position=(1, 1), to_dungeon_id="d", to_level_number=1, to_position=(0, 0))
    fixture = adventure(
        DungeonSpec(id="d", levels=(level(transitions=(there,)),)),
        DungeonSpec(id="e", levels=(level(transitions=(back,)),)),
    )
    assert lint_adventure(fixture) == ()


def test_one_way_drops_never_pair() -> None:
    levels = (
        level(
            1,
            transitions=(
                transition(kind="trapdoor"),
                transition(kind="chute", position=(1, 0)),
            ),
        ),
        level(2, entrance=None),
    )
    fixture = adventure(DungeonSpec(id="d", levels=levels))
    assert lint_adventure(fixture) == ()


def test_area_overlap_pair_semantics() -> None:
    areas = (
        AreaSpec(id="1", cells=((0, 0), (1, 0))),
        AreaSpec(id="2", cells=((1, 0), (0, 0), (2, 0))),
        AreaSpec(id="3", cells=((2, 0),)),
    )
    edges = {"1,0:west": OPEN, "2,0:west": OPEN}
    fixture = adventure(DungeonSpec(id="d", levels=(level(edges=edges, areas=areas),)))
    findings = lint_adventure(fixture)
    assert codes(findings) == ["area_overlap", "area_overlap"]
    # One finding per unordered pair, addressed to the later area — the one
    # area_at silently loses — naming both, the count, and a sample cell.
    assert findings[0].address == "dungeon:d/level:1/area:2"
    assert findings[0].message == (
        "area '2' overlaps area '1' on 2 cell(s), e.g. (1, 0) — "
        "area_at resolves the first area in authored order, so the overlap is invisible in play"
    )
    assert findings[1].address == "dungeon:d/level:1/area:3"
    assert findings[1].severity == "warning"


def test_findings_group_by_check_id_not_document_order() -> None:
    # An edge_invalid in the second dungeon still precedes an area_unreachable
    # in the first: forge groups by check id in the vocabulary's order.
    fixture = adventure(
        DungeonSpec(id="a", levels=(level(areas=(AreaSpec(id="1", cells=((2, 2),)),)),)),
        DungeonSpec(id="b", levels=(level(edges={"bogus": OPEN}),)),
    )
    assert codes(lint_adventure(fixture)) == ["edge_invalid", "area_unreachable"]


def test_lint_runs_even_when_validation_fails() -> None:
    fixture = adventure(
        DungeonSpec(
            id="d",
            levels=(level(entrance=(9, 9), areas=(AreaSpec(id="1", cells=((2, 2),)),)),),
        )
    )
    diagnostics = compute_diagnostics(fixture)
    assert "entrance_out_of_bounds" in [finding.code for finding in diagnostics.validation]
    assert "area_unreachable" in [finding.code for finding in diagnostics.lint]


def test_torture_fixture_validates_clean() -> None:
    fixture = load_adventure(TORTURE_PATH.read_bytes())
    validate_adventure(fixture, load_monsters(), load_equipment())


def test_torture_fixture_matches_its_builder() -> None:
    assert TORTURE_PATH.read_bytes() == dump_adventure(build_torture_adventure())


def test_torture_fixture_round_trips_byte_identically() -> None:
    data = TORTURE_PATH.read_bytes()
    assert dump_adventure(load_adventure(data)) == data


def test_torture_fixture_lints_exactly_as_built() -> None:
    findings = lint_adventure(load_adventure(TORTURE_PATH.read_bytes()))
    assert [(finding.code, finding.address) for finding in findings] == [
        ("orphan_cell", "dungeon:tannery-vaults/level:1/cell:0,5"),
        ("orphan_cell", "dungeon:tannery-vaults/level:1/cell:1,5"),
        ("secret_only_access", "dungeon:tannery-vaults/level:1/area:4"),
        ("area_overlap", "dungeon:tannery-vaults/level:1/area:6"),
    ]


def test_a_doctored_non_canonical_key_is_the_one_error_only_foreign_documents_produce() -> None:
    document = json.loads(TORTURE_PATH.read_bytes())
    document["payload"]["dungeons"][0]["levels"][0]["edges"]["0,1:south"] = {"kind": "open", "door": None}
    fixture = load_adventure(canonical_json_bytes(document))
    findings = lint_adventure(fixture)
    assert findings[0].code == "edge_invalid"
    assert findings[0].severity == "error"
    assert findings[0].message == "edge key '0,1:south' is never consulted — osrlib's canonical form is '0,2:north'"
    assert findings[0].address == "dungeon:tannery-vaults/level:1"
    assert codes(findings[1:]) == ["orphan_cell", "orphan_cell", "secret_only_access", "area_overlap"]


# --- the phase 16 advisory class ---------------------------------------------------
# Warning severity by construction — never escalating, never gating.


def flag_trigger(trigger_id: str, key: str, **overrides: object) -> TriggerSpec:
    """A trigger writing `key` — the advisory suites' writer-side building block."""
    values: dict[str, object] = {
        "id": trigger_id,
        "when": TownEnteredPattern(),
        "consequences": (SetFlag(key=key, value=True),),
    }
    values.update(overrides)
    return TriggerSpec.model_validate(values)


def flag_gate(key: str, value: str | int | bool = True) -> GateSpec:
    return GateSpec(condition=FlagEqualsCondition(key=key, value=value))


def authored(
    *dungeons: DungeonSpec,
    triggers: tuple[TriggerSpec, ...] = (),
    quests: tuple[QuestSpec, ...] = (),
    items: tuple[GearTemplate, ...] = (),
) -> Adventure:
    return Adventure(
        name="Lint fixture",
        town=TownSpec(name=""),
        dungeons=dungeons or (DungeonSpec(id="d", levels=(level(),)),),
        triggers=triggers,
        quests=quests,
        items=items,
    )


def test_flag_read_no_writer_addresses_each_reading_site() -> None:
    gated_door = Edge(kind=EdgeKind.DOOR, door=DoorSpec(requires=flag_gate("unwritten")))
    toll = transition(requires=flag_gate("unwritten"), to_level_number=1)
    reader = TriggerSpec(
        id="watcher",
        when=FlagSetPattern(key="unwritten"),
        conditions=(FlagEqualsCondition(key="unwritten", value=True),),
    )
    fixture = authored(
        DungeonSpec(id="d", levels=(level(edges={"1,1:north": gated_door}, transitions=(toll,)),)),
        triggers=(reader,),
    )
    findings = [finding for finding in lint_adventure(fixture) if finding.code == "flag_read_no_writer"]
    assert [finding.address for finding in findings] == [
        "dungeon:d/level:1/edge:1,1:north",
        "dungeon:d/level:1/cell:0,0",
        "trigger:watcher",
        "trigger:watcher",
    ]
    assert all(finding.severity == "warning" for finding in findings)
    assert all("'unwritten'" in finding.message for finding in findings)


def test_a_trigger_consequence_writer_silences_the_read() -> None:
    gated_door = Edge(kind=EdgeKind.DOOR, door=DoorSpec(requires=flag_gate("wired")))
    fixture = authored(
        DungeonSpec(id="d", levels=(level(edges={"1,1:north": gated_door}),)),
        triggers=(flag_trigger("lever", "wired"),),
    )
    assert "flag_read_no_writer" not in codes(lint_adventure(fixture))


def test_a_quest_reward_writer_silences_the_read() -> None:
    # The writer set includes quests even before their authoring surface
    # exists — a foreign document's reward-written flag must not lint falsely.
    gated_door = Edge(kind=EdgeKind.DOOR, door=DoorSpec(requires=flag_gate("earned")))
    quest = QuestSpec(
        id="q",
        name="The quest",
        objectives=(ObjectiveSpec(id="o", when=TriggerClause(pattern=TownEnteredPattern())),),
        rewards=(SetFlag(key="earned", value=True),),
    )
    fixture = authored(
        DungeonSpec(id="d", levels=(level(edges={"1,1:north": gated_door}),)),
        quests=(quest,),
    )
    assert "flag_read_no_writer" not in codes(lint_adventure(fixture))


def test_the_match_is_key_level_and_value_blind() -> None:
    # The gate wants True but the writer writes "open": still silent — a
    # value mismatch is a different and rarer mistake, and strict-typed
    # matching across an open domain invites false positives.
    gated_door = Edge(kind=EdgeKind.DOOR, door=DoorSpec(requires=flag_gate("wired", value=True)))
    fixture = authored(
        DungeonSpec(id="d", levels=(level(edges={"1,1:north": gated_door}),)),
        triggers=(
            TriggerSpec(id="lever", when=TownEnteredPattern(), consequences=(SetFlag(key="wired", value="open"),)),
        ),
    )
    assert "flag_read_no_writer" not in codes(lint_adventure(fixture))


def test_quest_owned_readers_address_the_owning_quest() -> None:
    # Phase 17's address upgrade: activation, objective completion, and
    # reveal clauses alike navigate to `quest:<id>` — the quest detail editor
    # owns its objectives, so no finer address exists.
    quest = QuestSpec(
        id="q",
        name="The quest",
        activation=TriggerClause(pattern=FlagSetPattern(key="unwritten")),
        objectives=(
            ObjectiveSpec(
                id="o",
                when=TriggerClause(
                    pattern=TownEnteredPattern(), conditions=(FlagEqualsCondition(key="unwritten", value=1),)
                ),
                hidden=True,
                reveal_when=TriggerClause(pattern=FlagSetPattern(key="unwritten")),
            ),
        ),
    )
    findings = [
        finding for finding in lint_adventure(authored(quests=(quest,))) if finding.code == "flag_read_no_writer"
    ]
    assert len(findings) == 3
    assert all(finding.address == "quest:q" for finding in findings)


def test_trigger_cycle_yields_one_finding_per_loop() -> None:
    # a → b → a: one row, members in document order, addressed to the first.
    a = TriggerSpec(id="a", when=FlagSetPattern(key="k-b"), consequences=(SetFlag(key="k-a", value=True),))
    b = TriggerSpec(id="b", when=FlagSetPattern(key="k-a"), consequences=(SetFlag(key="k-b", value=True),))
    findings = [finding for finding in lint_adventure(authored(triggers=(a, b))) if finding.code == "trigger_cycle"]
    assert len(findings) == 1
    assert findings[0].address == "trigger:a"
    assert "'a', 'b'" in findings[0].message
    assert findings[0].severity == "warning"


def test_a_three_trigger_loop_is_one_row_not_three() -> None:
    a = TriggerSpec(id="a", when=FlagSetPattern(key="k-c"), consequences=(SetFlag(key="k-a", value=True),))
    b = TriggerSpec(id="b", when=FlagSetPattern(key="k-a"), consequences=(SetFlag(key="k-b", value=True),))
    c = TriggerSpec(id="c", when=FlagSetPattern(key="k-b"), consequences=(SetFlag(key="k-c", value=True),))
    findings = [finding for finding in lint_adventure(authored(triggers=(a, b, c))) if finding.code == "trigger_cycle"]
    assert len(findings) == 1
    assert findings[0].address == "trigger:a"


def test_a_self_loop_is_a_cycle() -> None:
    selfloop = TriggerSpec(id="ouro", when=FlagSetPattern(key="k"), consequences=(SetFlag(key="k", value=1),))
    findings = [
        finding for finding in lint_adventure(authored(triggers=(selfloop,))) if finding.code == "trigger_cycle"
    ]
    assert len(findings) == 1
    assert findings[0].address == "trigger:ouro"


def test_a_value_mismatched_edge_does_not_link() -> None:
    # flag_values_equal is strict: a written 1 never satisfies an authored
    # True, so the loop never closes.
    a = TriggerSpec(id="a", when=FlagSetPattern(key="k-b", value=True), consequences=(SetFlag(key="k-a", value=1),))
    b = TriggerSpec(id="b", when=FlagSetPattern(key="k-a", value=True), consequences=(SetFlag(key="k-b", value=True),))
    assert "trigger_cycle" not in codes(lint_adventure(authored(triggers=(a, b))))


def test_an_any_value_pattern_links_any_write() -> None:
    a = TriggerSpec(id="a", when=FlagSetPattern(key="k-b"), consequences=(SetFlag(key="k-a", value="anything"),))
    b = TriggerSpec(id="b", when=FlagSetPattern(key="k-a"), consequences=(SetFlag(key="k-b", value=42),))
    assert "trigger_cycle" in codes(lint_adventure(authored(triggers=(a, b))))


def test_a_chain_without_a_loop_is_silent() -> None:
    a = TriggerSpec(id="a", when=TownEnteredPattern(), consequences=(SetFlag(key="k-a", value=True),))
    b = TriggerSpec(id="b", when=FlagSetPattern(key="k-a"), consequences=(SetFlag(key="k-b", value=True),))
    assert "trigger_cycle" not in codes(lint_adventure(authored(triggers=(a, b))))


def spawn_trigger(area_id: str) -> TriggerSpec:
    return TriggerSpec(
        id="ambush",
        when=AreaEnteredPattern(dungeon_id="d", level_number=1, area_id=area_id),
        consequences=(SpawnMonsters(template_id="orc", count_fixed=2, distance_feet=30),),
    )


def test_trigger_spawn_collision_names_the_area() -> None:
    stocked = AreaSpec(
        id="1",
        cells=((1, 1),),
        encounter=KeyedEncounter(monsters=(KeyedMonster(template_id="orc", count_fixed=1),)),
    )
    fixture = authored(
        DungeonSpec(id="d", levels=(level(areas=(stocked,)),)),
        triggers=(spawn_trigger("1"),),
    )
    findings = [finding for finding in lint_adventure(fixture) if finding.code == "trigger_spawn_collision"]
    assert len(findings) == 1
    assert findings[0].address == "trigger:ambush"
    assert "area '1'" in findings[0].message
    assert findings[0].severity == "warning"


def test_a_spawn_into_an_encounterless_area_is_silent() -> None:
    empty = AreaSpec(id="1", cells=((1, 1),))
    fixture = authored(
        DungeonSpec(id="d", levels=(level(areas=(empty,)),)),
        triggers=(spawn_trigger("1"),),
    )
    assert "trigger_spawn_collision" not in codes(lint_adventure(fixture))


def test_a_spawn_into_a_dangling_area_is_validations_territory() -> None:
    fixture = authored(triggers=(spawn_trigger("ghost"),))
    assert "trigger_spawn_collision" not in codes(lint_adventure(fixture))


# --- quest_reward_unpriced: the grid over grant kind × concludes × AwardXP --------


def reward_quest(quest_id: str = "q", *, rewards: tuple = (), concludes: bool = False) -> QuestSpec:
    return QuestSpec(
        id=quest_id,
        name="The quest",
        objectives=(ObjectiveSpec(id="o", when=TriggerClause(pattern=TownEnteredPattern())),),
        rewards=rewards,
        concludes_adventure=concludes,
    )


def unpriced(fixture: Adventure) -> list[Finding]:
    return [finding for finding in lint_adventure(fixture) if finding.code == "quest_reward_unpriced"]


def test_a_grant_item_reward_without_award_xp_is_unpriced() -> None:
    # Granted items value at zero under the engine's XP rule, so nothing ever
    # prices this payment.
    quest = reward_quest(rewards=(GrantItem(character_id="@party", item_id="sword"),))
    findings = unpriced(authored(quests=(quest,)))
    assert len(findings) == 1
    assert findings[0].address == "quest:q"
    assert findings[0].severity == "warning"
    assert "granted items value at zero" in findings[0].message


def test_an_award_xp_anywhere_in_the_tuple_silences_the_quest() -> None:
    quest = reward_quest(
        rewards=(GrantItem(character_id="@party", item_id="sword"), AwardXP(character_id="@party", amount=100))
    )
    assert unpriced(authored(quests=(quest,))) == []


def test_granted_coins_on_a_non_concluding_quest_price_themselves() -> None:
    # The return-to-town award prices the valuation delta; coins count at
    # face value there, so no flag.
    quest = reward_quest(rewards=(GrantCoins(character_id="@party", coins=Coins(gp=500)),))
    assert unpriced(authored(quests=(quest,))) == []


def test_granted_coins_on_a_concluding_quest_are_unpriced() -> None:
    # The grant lands after victory, where no return-to-town award ever runs.
    quest = reward_quest(rewards=(GrantCoins(character_id="@party", coins=Coins(gp=500)),), concludes=True)
    findings = unpriced(authored(quests=(quest,)))
    assert len(findings) == 1
    assert findings[0].address == "quest:q"
    assert "after victory" in findings[0].message


def test_an_award_xp_silences_the_concluding_coins() -> None:
    quest = reward_quest(
        rewards=(GrantCoins(character_id="@party", coins=Coins(gp=500)), AwardXP(character_id="@party", amount=200)),
        concludes=True,
    )
    assert unpriced(authored(quests=(quest,))) == []


def test_a_grant_item_on_a_concluding_quest_is_unpriced_too() -> None:
    quest = reward_quest(rewards=(GrantItem(character_id="@party", item_id="sword"),), concludes=True)
    assert len(unpriced(authored(quests=(quest,)))) == 1


def test_flag_only_rewards_are_silent() -> None:
    quest = reward_quest(rewards=(SetFlag(key="k", value=True),))
    assert unpriced(authored(quests=(quest,))) == []


def test_a_trigger_grant_item_never_flags() -> None:
    # The check reads quest rewards alone: a trigger's GrantItem is a key or
    # a tool, not a payment — flagging it would false-positive on the exact
    # lever-and-key wiring phase 16 exists for.
    granting = TriggerSpec(
        id="lever",
        when=TownEnteredPattern(),
        consequences=(GrantItem(character_id="@party", item_id="sword"),),
    )
    assert unpriced(authored(triggers=(granting,))) == []


# --- key_not_placed: the satisfier grid ------------------------------------------


IDOL = GearTemplate(id="jade-idol", name="Jade idol", cost_gp=0)


def idol_door(item_id: str = "jade-idol") -> Edge:
    return Edge(kind=EdgeKind.DOOR, door=DoorSpec(requires=GateSpec(condition=HasItemCondition(item_id=item_id))))


def key_not_placed(fixture: Adventure) -> list[Finding]:
    return [finding for finding in lint_adventure(fixture) if finding.code == "key_not_placed"]


def test_a_gate_on_an_unplaced_bundled_item_flags_the_edge() -> None:
    fixture = authored(DungeonSpec(id="d", levels=(level(edges={"1,1:north": idol_door()}),)), items=(IDOL,))
    findings = key_not_placed(fixture)
    assert len(findings) == 1
    assert findings[0].address == "dungeon:d/level:1/edge:1,1:north"
    assert findings[0].severity == "warning"
    assert "'jade-idol'" in findings[0].message


def test_a_consuming_toll_flags_the_transitions_cell() -> None:
    # An unplaceable toll is the same authoring mistake as an unplaceable key.
    toll = transition(
        requires=GateSpec(condition=HasItemCondition(item_id="jade-idol", consumes=True)), to_level_number=1
    )
    fixture = authored(DungeonSpec(id="d", levels=(level(transitions=(toll,)),)), items=(IDOL,))
    findings = key_not_placed(fixture)
    assert len(findings) == 1
    assert findings[0].address == "dungeon:d/level:1/cell:0,0"


def test_an_area_cache_satisfies_the_gate() -> None:
    stocked = AreaSpec(
        id="1",
        cells=((1, 1),),
        features=(FeatureSpec(id="cache", kind="treasure_cache", cell=None, item_ids=("jade-idol",)),),
    )
    fixture = authored(
        DungeonSpec(id="d", levels=(level(edges={"1,1:north": idol_door()}, areas=(stocked,)),)), items=(IDOL,)
    )
    assert key_not_placed(fixture) == []


def test_a_level_cache_satisfies_the_gate() -> None:
    cache = FeatureSpec(id="cache", kind="treasure_cache", cell=(0, 0), item_ids=("jade-idol",))
    fixture = authored(
        DungeonSpec(id="d", levels=(level(edges={"1,1:north": idol_door()}, features=(cache,)),)), items=(IDOL,)
    )
    assert key_not_placed(fixture) == []


def test_a_trigger_grant_satisfies_the_gate() -> None:
    granting = TriggerSpec(
        id="lever",
        when=TownEnteredPattern(),
        consequences=(GrantItem(character_id="@party", item_id="jade-idol"),),
    )
    fixture = authored(
        DungeonSpec(id="d", levels=(level(edges={"1,1:north": idol_door()}),)),
        triggers=(granting,),
        items=(IDOL,),
    )
    assert key_not_placed(fixture) == []


def test_a_non_concluding_quest_reward_satisfies_the_gate() -> None:
    quest = reward_quest(rewards=(GrantItem(character_id="@party", item_id="jade-idol"),))
    fixture = authored(
        DungeonSpec(id="d", levels=(level(edges={"1,1:north": idol_door()}),)),
        quests=(quest,),
        items=(IDOL,),
    )
    assert key_not_placed(fixture) == []


def test_a_concluding_quests_grant_does_not_satisfy() -> None:
    # The grant lands after SessionMode.VICTORY — the session is terminal and
    # no gate is ever read again, so counting it would hide the exact case
    # where the author is most wrong.
    quest = reward_quest(rewards=(GrantItem(character_id="@party", item_id="jade-idol"),), concludes=True)
    fixture = authored(
        DungeonSpec(id="d", levels=(level(edges={"1,1:north": idol_door()}),)),
        quests=(quest,),
        items=(IDOL,),
    )
    assert len(key_not_placed(fixture)) == 1


def test_a_shipped_id_gate_is_never_flagged() -> None:
    # Shipped ids are purchasable in town — the torch toll is a design, not a
    # mistake.
    fixture = authored(DungeonSpec(id="d", levels=(level(edges={"1,1:north": idol_door("torch")}),)))
    assert key_not_placed(fixture) == []


def test_a_dangling_id_gate_is_validations_territory() -> None:
    # The id names no bundled item: door_gate_unknown_item already covers it.
    fixture = authored(DungeonSpec(id="d", levels=(level(edges={"1,1:north": idol_door("ghost-key")}),)))
    assert key_not_placed(fixture) == []


def test_the_advisory_groups_follow_area_overlap_in_order() -> None:
    overlapping = (
        AreaSpec(id="1", cells=((1, 1),)),
        AreaSpec(
            id="2",
            cells=((1, 1),),
            encounter=KeyedEncounter(monsters=(KeyedMonster(template_id="orc", count_fixed=1),)),
        ),
    )
    gated_door = Edge(kind=EdgeKind.DOOR, door=DoorSpec(requires=flag_gate("unwritten")))
    loop = TriggerSpec(id="ouro", when=FlagSetPattern(key="k"), consequences=(SetFlag(key="k", value=1),))
    spawn = TriggerSpec(
        id="ambush",
        when=AreaEnteredPattern(dungeon_id="d", level_number=1, area_id="2"),
        consequences=(SpawnMonsters(template_id="orc", count_fixed=2, distance_feet=30),),
    )
    unpriced_quest = reward_quest(rewards=(GrantItem(character_id="@party", item_id="sword"),))
    fixture = authored(
        DungeonSpec(
            id="d",
            levels=(
                level(
                    areas=overlapping,
                    edges={"1,0:west": OPEN, "1,1:north": OPEN, "1,1:west": gated_door, "2,1:west": idol_door()},
                ),
            ),
        ),
        triggers=(loop, spawn),
        quests=(unpriced_quest,),
        items=(IDOL,),
    )
    assert codes(lint_adventure(fixture)) == [
        "area_overlap",
        "flag_read_no_writer",
        "trigger_cycle",
        "trigger_spawn_collision",
        "quest_reward_unpriced",
        "key_not_placed",
    ]


def test_the_full_pass_stays_trivially_fast() -> None:
    # "Incremental" cashes out as recomputed live on every commit; measured,
    # not assumed. 50 ms is two orders of magnitude above the observed cost.
    fixture = load_adventure(TORTURE_PATH.read_bytes())
    lint_adventure(fixture)  # warm anything cacheable
    started = time.perf_counter()
    lint_adventure(fixture)
    assert time.perf_counter() - started < 0.05
