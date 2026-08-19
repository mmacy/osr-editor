"""The small complete module: the spec's content-half fixture, and its suites.

The builder is the source of truth; the committed fixture must match it
byte-for-byte (regenerate with `uv run python tests/generate_small_module.py`
only on a deliberate, reviewed osrlib document-shape change). The module is
hand-authorable content — keyed encounters exercising dice and fixed counts, a
pinned alignment, aware and a stance; an area treasure by letters and another
unguarded; a pit trap; a trapped treasure cache; a construction trick and a
level-scope custom feature; a secret door on the only route to the treasure
room; an inline wandering table on level 2; a bundled bespoke monster template
keyed in a level 2 encounter (phase 4's growth, so the round-trip, golden, and
publish suites cover `Adventure.monsters` permanently); and the authored layer
(phase 15's growth, covered by the same suites permanently): a bundled gear
item — the miller's key — cached in room 1's strongbox, the treasure-room
secret door gated on carrying it with authored refusal, success, and speaker,
the stairs down gated on a toll that consumes a torch, and level 1 guidance
prose; the trigger layer (phase 16's growth, the milestone's
lever-opens-portcullis pairing): a once-only `area_entered` trigger on the
wheel room whose one consequence writes the portcullis flag, with authored
fired and journal beats and a speaker, and the portcullis door into the tail
race gated `flag_equals` on that key with authored refusal and success text —
so the flag has a writer by construction and the advisory lints stay silent;
and the quest layer (phase 17's growth, the milestone's winnable shape): a
second bundled gear item — the millstone idol — cached in the miller's chest,
and one concluding fetch quest activating on `dungeon_entered`, its one
objective completing on `item_acquired` of the idol's id with an authored
name, rewards granting coins and awarding XP (the award silences
`quest_reward_unpriced` by construction), offer and completion beats with a
speaker, and objective offer and progress beats. Town, hooks, and
services filled. Validation-clean, and lint-clean except the one finding it is
built to carry: the secret-only treasure room *is* the `secret_only_access`
trigger — the spec's own publish rule ("secret-only access is sometimes the
point") needs a module that exercises it, so the publish suite proves a
warning-bearing module publishes. All content is original — no retail module
material.
"""

import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from osrlib.core.alignment import Alignment
from osrlib.core.classes import SavingThrows
from osrlib.core.combat import SaveCategory
from osrlib.core.items import Coins, GearTemplate
from osrlib.core.monsters import (
    AlignmentSpec,
    AttackRoutine,
    MonsterAbility,
    MonsterAttack,
    MonsterHitDice,
    MonsterSaves,
    MonsterTemplate,
    MovementMode,
    NumberAppearing,
    NumberAppearingValue,
)
from osrlib.core.spells import SaveSpec
from osrlib.core.tables import ReactionResult
from osrlib.crawl.adventure import Adventure, TownSpec, validate_adventure
from osrlib.crawl.commands import AwardXP, GrantCoins, SetFlag
from osrlib.crawl.dungeon import (
    AreaSpec,
    AreaTreasureSpec,
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
    TrapEffect,
    TrapSpec,
    ValuableSpec,
    WanderingSpec,
)
from osrlib.crawl.gates import FlagEqualsCondition, GateSpec, HasItemCondition
from osrlib.crawl.narrative import NarrativeBlock
from osrlib.crawl.quests import ObjectiveSpec, QuestSpec, TriggerClause
from osrlib.crawl.triggers import AreaEnteredPattern, DungeonEnteredPattern, ItemAcquiredPattern, TriggerSpec
from osrlib.data import load_encounter_tables, load_equipment, load_monsters
from osrlib.errors import ContentValidationError

from osreditor.app import create_app
from osreditor.diagnostics import compute_diagnostics, parse_validation_error
from osreditor.documents import DocumentService, dump_adventure, load_adventure
from osreditor.lint import lint_adventure
from osreditor.ops import AnyEditOp, OpBatch, SetAreaField
from osreditor.projects import open_project
from osreditor.store import LocalProjectStore

SMALL_MODULE_PATH = Path(__file__).parent / "fixtures" / "small_module.json"

OPEN = Edge(kind=EdgeKind.OPEN)
DOOR = Edge(kind=EdgeKind.DOOR, door=DoorSpec())

# The gated secret door: the milestone's composition — a gate composes with
# the door's kind and flags rather than replacing them, and the map draws the
# gate diamond beside the secret disc when both apply.
GATED_SECRET_DOOR = Edge(
    kind=EdgeKind.DOOR,
    door=DoorSpec(
        kind="secret",
        requires=GateSpec(
            condition=HasItemCondition(item_id="millers-key"),
            narrative=NarrativeBlock(
                refusal="The false wall holds. Behind it, something counts on its fingers and waits.",
                success="The brass key turns twice, and the counting stops.",
                speaker="The drowned miller",
            ),
        ),
    ),
)

# The toll gate: consuming, so the descent costs a torch per crossing — and
# deliberately hung on a *shipped* item id, so the fixture exercises both
# halves of the gate picker's domain (the door's gate names the bundled key).
TOLL_GATE = GateSpec(
    condition=HasItemCondition(item_id="torch", consumes=True),
    narrative=NarrativeBlock(
        refusal="The dark below drinks unlit steps. It wants fire.",
        success="You feed a torch to the dark; it gutters somewhere below, and the way is open.",
    ),
)

PORTCULLIS_FLAG = "mill-caves.wheel-lever"

# The portcullis: the milestone's flag-gated half. The lever trigger writes
# the flag; this door reads it — a writer exists by construction, so the
# flag_read_no_writer advisory stays silent on the shipped fixture.
PORTCULLIS_DOOR = Edge(
    kind=EdgeKind.DOOR,
    door=DoorSpec(
        requires=GateSpec(
            condition=FlagEqualsCondition(key=PORTCULLIS_FLAG, value="pulled"),
            narrative=NarrativeBlock(
                refusal="The portcullis holds fast — somewhere above, machinery waits to be convinced.",
                success="Chains rattle overhead and the portcullis stands raised; the tail race lies open.",
            ),
        ),
    ),
)


def _level_one() -> LevelSpec:
    guard_room = AreaSpec(
        id="1",
        name="The guard post",
        description=(
            "Broken millstones are stacked into a crude barricade. Orcs dice by torchlight "
            "while their skeleton porters stand motionless against the wall."
        ),
        cells=((0, 0), (1, 0), (0, 1), (1, 1)),
        encounter=KeyedEncounter(
            monsters=(
                KeyedMonster(template_id="orc", count_dice="3d4"),
                KeyedMonster(template_id="skeleton", count_fixed=6),
            ),
            alignment=Alignment.CHAOTIC,
            aware=True,
            stance=ReactionResult.HOSTILE,
        ),
        features=(
            FeatureSpec(
                id="feature-4",
                kind="treasure_cache",
                description="The orcs' pay strongbox, bolted under the barricade's lip.",
                cell=None,
                item_ids=("millers-key",),
                coins=Coins(sp=45),
            ),
        ),
    )
    pit_room = AreaSpec(
        id="2",
        name="The sifting room",
        description=(
            "Flour dust hangs in the air. The floor's central flags pivot on a greased "
            "axle over a ten-foot drop into the old grain hopper."
        ),
        cells=((3, 0), (3, 1)),
        trap=TrapSpec(
            kind="room",
            trigger="enter",
            effect=TrapEffect(
                damage_dice="1d6",
                save=SaveSpec(category=SaveCategory.BREATH, modifier=0, on_save="half"),
                fall_feet=10,
            ),
        ),
        treasure=AreaTreasureSpec(unguarded=True),
    )
    treasure_room = AreaSpec(
        id="3",
        name="The miller's cache",
        description=(
            "A dry vault behind the false wall, undisturbed for a generation. A brass-bound "
            "chest sits on a stone shelf above the damp."
        ),
        cells=((4, 0), (4, 1)),
        treasure=AreaTreasureSpec(letters=("C",)),
        features=(
            FeatureSpec(
                id="feature-1",
                kind="treasure_cache",
                description="The brass-bound chest, its lock plate scratched around the keyhole.",
                cell=None,
                item_ids=("sword", "millstone-idol"),
                coins=Coins(gp=120, sp=30),
                valuables=(
                    ValuableSpec(kind="gem", name="", value_gp=50),
                    ValuableSpec(kind="gem", name="", value_gp=50),
                    ValuableSpec(kind="jewellery", name="The miller's signet ring", value_gp=300, weight_coins=10),
                ),
                trap=TrapSpec(
                    kind="treasure",
                    trigger="open",
                    effect=TrapEffect(
                        save=SaveSpec(category=SaveCategory.DEATH, modifier=0, on_save="negates"),
                        kills=True,
                        manual="A poison needle springs from the lock plate.",
                    ),
                ),
            ),
        ),
    )
    wheel_room = AreaSpec(
        id="6",
        name="The wheel room",
        description=(
            "The mill's great wheel lies on its side, half-sunk in silt. A counterweighted "
            "lever juts from the hub, worn smooth by hands that were not always hands."
        ),
        cells=((2, 1),),
    )
    tail_race = AreaSpec(
        id="7",
        name="The tail race",
        description=(
            "A brick-lined channel where the spent water once ran, dry now but for a black "
            "trickle. Silt banks glitter with what the current dropped."
        ),
        cells=((2, 2),),
        treasure=AreaTreasureSpec(unguarded=True),
    )
    return LevelSpec(
        number=1,
        width=8,
        height=6,
        edges={
            "1,0:west": OPEN,
            "0,1:north": OPEN,
            "1,1:north": OPEN,
            "1,1:west": OPEN,
            "2,0:west": OPEN,
            "2,1:north": OPEN,
            "2,2:north": PORTCULLIS_DOOR,
            "3,0:west": DOOR,
            "3,1:north": OPEN,
            "4,0:west": GATED_SECRET_DOOR,
            "4,1:north": OPEN,
        },
        areas=(guard_room, pit_room, treasure_room, wheel_room, tail_race),
        features=(
            FeatureSpec(
                id="feature-2",
                kind="custom",
                description="A warning in chalk, half-scuffed: 'the floor lies'.",
                cell=(2, 0),
            ),
        ),
        transitions=(
            TransitionSpec(
                kind="stairs_down",
                position=(0, 1),
                to_dungeon_id="mill-caves",
                to_level_number=2,
                to_position=(0, 0),
                to_facing=Direction.SOUTH,
                requires=TOLL_GATE,
            ),
        ),
        entrance=(0, 0),
        guidance=(
            "Narrate the upper caves as the mill gone feral: flour dust in the torchlight, "
            "orc voices ahead, the machinery repurposed for ambush. Keep the miller a rumour "
            "up here — he never leaves the water."
        ),
    )


def _level_two() -> LevelSpec:
    # The inline table is exactly what the editor's "override the compiled
    # table" seeds: the level's band table with the authored identity pinned,
    # then one row edited in place.
    band = load_encounter_tables().for_level(2)
    rows = (
        band.rows[0].model_copy(
            update={
                "name": "Skeleton patrol",
                "entry": band.rows[0].entry.model_copy(update={"monster_ids": ("skeleton",)}),
                "count_dice": None,
                "count_fixed": 6,
            }
        ),
        *band.rows[1:],
    )
    table = band.model_copy(
        update={
            "id": "mill-caves-level-2-wandering",
            "label": "Level 2 wandering",
            "min_level": 1,
            "max_level": None,
            "rows": rows,
            "overrides_applied": (),
        }
    )
    bone_hall = AreaSpec(
        id="4",
        name="The bone hall",
        description=(
            "The cave widens under the mill's foundations. Long bones are sorted into "
            "alcoves by size, patient as a larder."
        ),
        cells=((0, 0), (1, 0)),
        features=(
            FeatureSpec(
                id="feature-3",
                kind="construction_trick",
                description="The third alcove's back wall pivots when the shelf is unweighted.",
                cell=None,
            ),
        ),
    )
    spring_cave = AreaSpec(
        id="5",
        name="The spring cave",
        description="The millstream rises here, black and cold; the current tugs at torchlight.",
        cells=((1, 1),),
        encounter=KeyedEncounter(monsters=(KeyedMonster(template_id="drowned-miller", count_fixed=1),)),
    )
    return LevelSpec(
        number=2,
        width=6,
        height=4,
        edges={
            "1,0:west": OPEN,
            "1,1:north": OPEN,
        },
        areas=(bone_hall, spring_cave),
        transitions=(
            TransitionSpec(
                kind="stairs_up",
                position=(0, 0),
                to_dungeon_id="mill-caves",
                to_level_number=1,
                to_position=(0, 1),
                to_facing=Direction.NORTH,
            ),
        ),
        wandering=WanderingSpec(chance_in_six=2, interval_turns=2, table=table),
    )


def _drowned_miller() -> MonsterTemplate:
    """The bundled bespoke template: the miller himself, keyed in the spring cave.

    Editor-authored conventions apply — `page=""` (the unpaged marker) and
    `overrides_applied=()` (SRD-compiler provenance, meaningless here). Printed
    values follow the 3 HD rows: THAC0 17 [+2], the 1-3 save band, 50 XP
    (35 base + 15 for the asterisk).
    """
    return MonsterTemplate(
        id="drowned-miller",
        name="The drowned miller",
        page="",
        intro=(
            "He went into the millrace owing everyone and surfaced owing nothing. What walks "
            "the spring cave still counts on its fingers."
        ),
        ac=7,
        ac_ascending=12,
        hit_dice=MonsterHitDice(count=3, die=8, asterisks=1),
        attacks=(AttackRoutine(attacks=(MonsterAttack(name="sodden grasp", damage="1d6"),)),),
        thac0=17,
        attack_bonus=2,
        movement=(
            MovementMode(rate_feet=60, encounter_rate_feet=20),
            MovementMode(rate_feet=120, encounter_rate_feet=40, descriptor="swimming"),
        ),
        saves=MonsterSaves(values=SavingThrows(death=12, wands=13, paralysis=14, breath=15, spells=16), save_as="3"),
        morale=12,
        alignment=AlignmentSpec(options=(Alignment.CHAOTIC,)),
        xp=50,
        number_appearing=NumberAppearing(dungeon=NumberAppearingValue(fixed=1), lair=NumberAppearingValue(fixed=1)),
        abilities=(
            MonsterAbility(
                tag="millrace_chill",
                name="Chill of the millrace",
                prose=(
                    "A character grappled by the miller and dragged under the spring must save "
                    "versus paralysis or lose their next round to the cold."
                ),
                manual=True,
            ),
        ),
        categories=("undead",),
    )


def build_small_module() -> Adventure:
    """Build the small complete module — the source of truth for the committed fixture."""
    return Adventure(
        name="The Mill on the Moor",
        description=(
            "A ruined mill above a wind-scoured hamlet hides the caves its miller dug, died in, and never left."
        ),
        hooks=(
            "The miller vanished a fortnight ago; his creditors will pay for proof either way.",
            "Orcs have been trading flour nobody grinds anymore.",
        ),
        town=TownSpec(
            name="Dusthollow",
            description="A crossroads hamlet of stubborn farmers under a big grey sky.",
            services=("The Wheat Sheaf inn", "A dour smith who buys old iron"),
            travel_turns={"mill-caves": 2},
        ),
        dungeons=(DungeonSpec(id="mill-caves", name="The mill caves", levels=(_level_one(), _level_two())),),
        monsters=(_drowned_miller(),),
        items=(
            # The bundled key: editor-authored conventions apply —
            # overrides_applied=() (SRD-compiler provenance, meaningless here).
            GearTemplate(
                id="millers-key",
                name="The miller's brass key",
                cost_gp=0,
            ),
            # The milestone's fetch-quest object, cached in the miller's
            # brass-bound chest behind the gated secret door.
            GearTemplate(
                id="millstone-idol",
                name="The millstone idol",
                cost_gp=0,
            ),
        ),
        triggers=(
            # The milestone's lever half: once-only (the default), entering
            # the wheel room writes the flag the portcullis door reads.
            TriggerSpec(
                id="wheel-lever",
                when=AreaEnteredPattern(dungeon_id="mill-caves", level_number=1, area_id="6"),
                consequences=(SetFlag(key=PORTCULLIS_FLAG, value="pulled"),),
                narrative=NarrativeBlock(
                    fired="The lever gives; the counterweight drops and the tail-race portcullis ratchets up.",
                    journal=(
                        "In the wheel room a worn lever moved under our hands, and somewhere east "
                        "iron rose grinding from its groove."
                    ),
                    speaker="The drowned miller",
                ),
            ),
        ),
        quests=(
            # The milestone's concluding fetch quest: activation on entering
            # the dungeon, one objective on acquiring the idol, coins granted
            # and XP awarded (the award silences quest_reward_unpriced by
            # construction), victory on completion.
            QuestSpec(
                id="the-millers-idol",
                name="The miller's idol",
                activation=TriggerClause(pattern=DungeonEnteredPattern(dungeon_id="mill-caves")),
                objectives=(
                    ObjectiveSpec(
                        id="recover-idol",
                        name="Recover the millstone idol",
                        when=TriggerClause(pattern=ItemAcquiredPattern(item_id="millstone-idol")),
                        narrative=NarrativeBlock(
                            offer="The idol is said to sit in the miller's cache, behind walls that count.",
                            progress="The idol is cold in your pack, and the mill feels lighter for it.",
                        ),
                    ),
                ),
                rewards=(
                    GrantCoins(character_id="@party", coins=Coins(gp=200)),
                    AwardXP(character_id="@party", amount=400),
                ),
                concludes_adventure=True,
                narrative=NarrativeBlock(
                    offer=(
                        "Bring back the miller's stone idol and the estate settles every debt — "
                        "proof of what became of him, and payment for the trouble."
                    ),
                    completion=(
                        "The idol changes hands and the ledgers close; whatever walks the mill owes nobody now."
                    ),
                    speaker="The creditors' clerk",
                ),
            ),
        ),
    )


@pytest.fixture
def service() -> DocumentService:
    return DocumentService(LocalProjectStore())


def test_small_module_fixture_matches_its_builder() -> None:
    assert SMALL_MODULE_PATH.read_bytes() == dump_adventure(build_small_module())


def test_small_module_round_trips_byte_identically() -> None:
    data = SMALL_MODULE_PATH.read_bytes()
    assert dump_adventure(load_adventure(data)) == data


def test_small_module_validates_clean() -> None:
    validate_adventure(build_small_module(), load_monsters(), load_equipment())


def test_small_module_lints_exactly_its_declared_finding() -> None:
    findings = lint_adventure(build_small_module())
    assert [(finding.code, finding.address) for finding in findings] == [
        ("secret_only_access", "dungeon:mill-caves/level:1/area:3"),
    ]


def test_small_module_byte_stability_through_open_edit_undo(service: DocumentService, tmp_path: Path) -> None:
    project_dir = tmp_path / "small.osr"
    original = SMALL_MODULE_PATH.read_bytes()
    service.store.write_artifact(str(project_dir), "adventure.json", original)
    project = open_project(service, project_dir)
    ops: tuple[AnyEditOp, ...] = (
        SetAreaField(dungeon_id="mill-caves", level_number=1, area_id="1", field="name", value="Renamed"),
    )
    service.apply_batch(project, OpBatch(revision=project.revision, ops=ops))
    assert service.store.read_artifact(str(project_dir), "adventure.json") != original
    service.undo(project)
    assert service.store.read_artifact(str(project_dir), "adventure.json") == original


def test_small_module_publishes_through_the_lint_warning(tmp_path: Path) -> None:
    # The declared secret_only_access warning is the point: lint never blocks
    # server-side, so the warning-bearing module publishes cleanly.
    client = TestClient(create_app())
    checkout = tmp_path / "osr-web"
    (checkout / "adventures").mkdir(parents=True)
    project_dir = tmp_path / "small.osr"
    project_dir.mkdir()
    (project_dir / "adventure.json").write_bytes(SMALL_MODULE_PATH.read_bytes())
    opened = client.post("/api/projects/open", json={"path": str(project_dir)})
    assert opened.status_code == 200, opened.text
    project = opened.json()
    assert [finding["code"] for finding in project["diagnostics"]["lint"]] == ["secret_only_access"]
    assert project["diagnostics"]["validation"] == []
    response = client.post(
        f"/api/projects/{project['id']}/publish",
        json={"mode": "symlink", "checkout_path": str(checkout)},
    )
    assert response.status_code == 200, response.text
    published = checkout / "adventures" / "small"
    assert published.is_symlink()
    assert json.loads((published / "adventure.json").read_bytes())["payload"]["name"] == "The Mill on the Moor"


# --- doctored variants: the content codes re-asserted against the module ---


def _doctored_findings(adventure: Adventure) -> list[tuple[str, str | None]]:
    with pytest.raises(ContentValidationError) as excinfo:
        validate_adventure(adventure, load_monsters(), load_equipment())
    return [(finding.code, finding.address) for finding in parse_validation_error(str(excinfo.value), adventure)]


def _replace_area(adventure: Adventure, level_index: int, area_index: int, area: AreaSpec) -> Adventure:
    dungeon = adventure.dungeons[0]
    level = dungeon.levels[level_index]
    areas = (*level.areas[:area_index], area, *level.areas[area_index + 1 :])
    levels = (
        *dungeon.levels[:level_index],
        level.model_copy(update={"areas": areas}),
        *dungeon.levels[level_index + 1 :],
    )
    return adventure.model_copy(update={"dungeons": (dungeon.model_copy(update={"levels": levels}),)})


def test_doctored_unknown_monster() -> None:
    module = build_small_module()
    guard_room = module.dungeons[0].levels[0].areas[0]
    encounter = guard_room.encounter
    assert encounter is not None
    doctored = encounter.model_copy(
        update={
            "monsters": (
                encounter.monsters[0].model_copy(update={"template_id": "gloom-stalker"}),
                *encounter.monsters[1:],
            )
        }
    )
    findings = _doctored_findings(_replace_area(module, 0, 0, guard_room.model_copy(update={"encounter": doctored})))
    assert ("encounter_unknown_monster", "dungeon:mill-caves/level:1/area:1") in findings


def test_doctored_alignment_outside_options() -> None:
    module = build_small_module()
    guard_room = module.dungeons[0].levels[0].areas[0]
    encounter = guard_room.encounter
    assert encounter is not None
    # model_copy bypasses validation, so the enum member is required — a raw
    # string would never render as osrlib renders it.
    doctored = encounter.model_copy(update={"alignment": Alignment.LAWFUL})
    findings = _doctored_findings(_replace_area(module, 0, 0, guard_room.model_copy(update={"encounter": doctored})))
    assert ("encounter_alignment_invalid", "dungeon:mill-caves/level:1/area:1") in findings


def test_doctored_unknown_item() -> None:
    module = build_small_module()
    treasure_room = module.dungeons[0].levels[0].areas[2]
    cache = treasure_room.features[0].model_copy(update={"item_ids": ("vorpal-spork",)})
    findings = _doctored_findings(_replace_area(module, 0, 2, treasure_room.model_copy(update={"features": (cache,)})))
    assert ("feature_unknown_item", "dungeon:mill-caves/level:1") in findings


def test_doctored_level_feature_without_cell() -> None:
    module = build_small_module()
    dungeon = module.dungeons[0]
    level = dungeon.levels[0]
    stripped = level.features[0].model_copy(update={"cell": None})
    doctored = module.model_copy(
        update={
            "dungeons": (
                dungeon.model_copy(
                    update={"levels": (level.model_copy(update={"features": (stripped,)}), *dungeon.levels[1:])}
                ),
            )
        }
    )
    assert ("feature_needs_cell", "dungeon:mill-caves/level:1") in _doctored_findings(doctored)


def test_doctored_wandering_unknown_monster() -> None:
    module = build_small_module()
    dungeon = module.dungeons[0]
    level = dungeon.levels[1]
    table = level.wandering.table
    assert table is not None
    row = table.rows[0]
    assert row.entry.kind == "monster"
    doctored_row = row.model_copy(update={"entry": row.entry.model_copy(update={"monster_ids": ("gloom-stalker",)})})
    doctored_table = table.model_copy(update={"rows": (doctored_row, *table.rows[1:])})
    doctored = module.model_copy(
        update={
            "dungeons": (
                dungeon.model_copy(
                    update={
                        "levels": (
                            dungeon.levels[0],
                            level.model_copy(
                                update={"wandering": level.wandering.model_copy(update={"table": doctored_table})}
                            ),
                        )
                    }
                ),
            )
        }
    )
    assert ("wandering_unknown_monster", "dungeon:mill-caves/level:2") in _doctored_findings(doctored)


def test_small_module_diagnostics_are_the_declared_warning_only() -> None:
    diagnostics = compute_diagnostics(build_small_module())
    assert diagnostics.validation == ()
    assert [finding.code for finding in diagnostics.lint] == ["secret_only_access"]
    assert all(finding.severity == "warning" for finding in diagnostics.lint)
