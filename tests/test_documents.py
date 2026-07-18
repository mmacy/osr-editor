"""Canonical serialization: byte-stability, the golden compatibility gate, and error paths."""

import json
from pathlib import Path

import pytest
from osrlib.crawl.adventure import Adventure, TownSpec, validate_adventure
from osrlib.crawl.dungeon import (
    AreaSpec,
    AreaTreasureSpec,
    DoorSpec,
    DungeonSpec,
    Edge,
    EdgeKind,
    KeyedEncounter,
    KeyedMonster,
    LevelSpec,
)
from osrlib.data import load_equipment, load_monsters
from osrlib.errors import ContentValidationError, SaveVersionError
from osrlib.versioning import SCHEMA_VERSION

from osreditor.documents import canonical_json_bytes, dump_adventure, load_adventure

GOLDEN_PATH = Path(__file__).parent / "fixtures" / "golden_adventure.json"


def build_golden_adventure() -> Adventure:
    """Build the golden fixture: a small original mini-adventure.

    The content exercises every phase-0-relevant serialization shape: a hook, a
    town with a `travel_turns` entry, a 3x2 level with an entrance, two keyed
    areas, edges in deliberately non-sorted insertion order including a door
    (the `Edge`/`DoorSpec` coupling), a keyed encounter referencing a shipped
    SRD monster id, and an unguarded-treasure area. `monsters=()` keeps the
    `MonsterTemplate` subtree out of the runtime fixture; typegen covers it
    statically.
    """
    level = LevelSpec(
        number=1,
        width=3,
        height=2,
        # Insertion order is map-drawing order, deliberately not lexicographic:
        # a writer that sorts keys anywhere breaks the golden bytes.
        edges={
            "1,0:west": Edge(kind=EdgeKind.OPEN),
            "2,0:west": Edge(kind=EdgeKind.OPEN),
            "1,1:north": Edge(kind=EdgeKind.DOOR, door=DoorSpec(kind="normal", locked=True)),
            "2,1:west": Edge(kind=EdgeKind.OPEN),
        },
        areas=(
            AreaSpec(
                id="1",
                name="Guard post",
                description="Two rough cots, a brazier of cold ash, and a table scattered with knucklebones.",
                cells=((1, 0), (2, 0)),
                encounter=KeyedEncounter(monsters=(KeyedMonster(template_id="orc", count_dice="1d4"),)),
            ),
            AreaSpec(
                id="2",
                name="Flooded cellar",
                description="Ankle-deep water over cracked flagstones; something glints below the surface.",
                cells=((1, 1), (2, 1)),
                treasure=AreaTreasureSpec(unguarded=True),
            ),
        ),
        entrance=(0, 0),
    )
    return Adventure(
        name="The mill on the moor",
        description="A ruined mill hides the entrance to the caves its miller dug too deep.",
        hooks=(
            "The miller of Dusthollow vanished a fortnight ago; his creditors offer 50 gp for the deed to his mill.",
        ),
        town=TownSpec(
            name="Dusthollow",
            description="A wind-scoured crossroads hamlet of a dozen households.",
            travel_turns={"mill-caves": 2},
        ),
        dungeons=(DungeonSpec(id="mill-caves", name="The caves under the mill", levels=(level,)),),
    )


def test_dump_load_dump_is_byte_stable() -> None:
    adventure = build_golden_adventure()
    first = dump_adventure(adventure)
    second = dump_adventure(load_adventure(first))
    assert second == first


def test_golden_loads_and_validates_clean() -> None:
    adventure = load_adventure(GOLDEN_PATH.read_bytes())
    validate_adventure(adventure, load_monsters(), load_equipment())


def test_golden_formatting_is_canonical() -> None:
    data = GOLDEN_PATH.read_bytes()
    assert canonical_json_bytes(json.loads(data)) == data


def test_golden_payload_round_trips_exactly() -> None:
    data = GOLDEN_PATH.read_bytes()
    committed_payload = json.loads(data)["payload"]
    assert load_adventure(data).model_dump(mode="json") == committed_payload


def _doctored_document(**changes: object) -> bytes:
    document = json.loads(GOLDEN_PATH.read_bytes())
    document.update(changes)
    return canonical_json_bytes(document)


def test_newer_schema_version_raises_save_version_error() -> None:
    data = _doctored_document(schema_version=SCHEMA_VERSION + 1)
    with pytest.raises(SaveVersionError):
        load_adventure(data)


def test_wrong_kind_raises_content_validation_error() -> None:
    data = _doctored_document(kind="save")
    with pytest.raises(ContentValidationError):
        load_adventure(data)
