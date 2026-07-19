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
from osrlib.core.tables import EncounterTable, EncounterTableRow, MonsterEncounterEntry
from osrlib.crawl.adventure import Adventure, TownSpec, validate_adventure
from osrlib.crawl.dungeon import (
    AreaSpec,
    Direction,
    DungeonSpec,
    FeatureSpec,
    KeyedEncounter,
    KeyedMonster,
    LevelSpec,
    TransitionSpec,
    WanderingSpec,
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


def test_bundled_monster_collision() -> None:
    finding = sole_finding(adventure(monsters=(load_monsters().monsters[0],)))
    assert finding.code == "bundled_monster_collision"
    assert finding.address == "monsters"


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
