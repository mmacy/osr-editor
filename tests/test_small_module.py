"""The small complete module: the spec's content-half fixture, and its suites.

The builder is the source of truth; the committed fixture must match it
byte-for-byte (regenerate with `uv run python tests/generate_small_module.py`
only on a deliberate, reviewed osrlib document-shape change). The module is
hand-authorable content — keyed encounters exercising dice and fixed counts, a
pinned alignment, aware and a stance; an area treasure by letters and another
unguarded; a pit trap; a trapped treasure cache; a construction trick and a
level-scope custom feature; a secret door on the only route to the treasure
room; an inline wandering table on level 2; town, hooks, and services filled.
Validation-clean, and lint-clean except the one finding it is built to carry:
the secret-only treasure room *is* the `secret_only_access` trigger — the
spec's own publish rule ("secret-only access is sometimes the point") needs a
module that exercises it, so the publish suite proves a warning-bearing module
publishes. All content is original — no retail module material.
"""

import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from osrlib.core.alignment import Alignment
from osrlib.core.combat import SaveCategory
from osrlib.core.items import Coins
from osrlib.core.spells import SaveSpec
from osrlib.core.tables import ReactionResult
from osrlib.crawl.adventure import Adventure, TownSpec, validate_adventure
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
SECRET_DOOR = Edge(kind=EdgeKind.DOOR, door=DoorSpec(kind="secret"))


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
        features=(),
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
                item_ids=("sword",),
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
            "3,0:west": DOOR,
            "3,1:north": OPEN,
            "4,0:west": SECRET_DOOR,
            "4,1:north": OPEN,
        },
        areas=(guard_room, pit_room, treasure_room),
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
            ),
        ),
        entrance=(0, 0),
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
