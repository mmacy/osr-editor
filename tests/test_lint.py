"""The structural lint: every check's semantics, messages, ordering, and the torture fixture."""

import json
import time
from pathlib import Path

from osrlib.crawl.adventure import Adventure, TownSpec, validate_adventure
from osrlib.crawl.dungeon import (
    AreaSpec,
    Direction,
    DoorSpec,
    DungeonSpec,
    Edge,
    EdgeKind,
    LevelSpec,
    TransitionSpec,
)
from osrlib.data import load_equipment, load_monsters

from osreditor.diagnostics import compute_diagnostics
from osreditor.documents import dump_adventure, load_adventure
from osreditor.lint import SEVERITY, lint_adventure
from osreditor.ops import Finding
from osreditor.serialize import canonical_json_bytes

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


def test_the_full_pass_stays_trivially_fast() -> None:
    # "Incremental" cashes out as recomputed live on every commit; measured,
    # not assumed. 50 ms is two orders of magnitude above the observed cost.
    fixture = load_adventure(TORTURE_PATH.read_bytes())
    lint_adventure(fixture)  # warm anything cacheable
    started = time.perf_counter()
    lint_adventure(fixture)
    assert time.perf_counter() - started < 0.05
