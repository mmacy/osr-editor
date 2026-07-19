"""The envelope models and the phase 1 op vocabulary: round-trips, pairing validators, frozen-ness."""

import pytest
from osrlib.crawl.dungeon import (
    AreaTreasureSpec,
    FeatureSpec,
    KeyedEncounter,
    KeyedMonster,
    TrapEffect,
    TrapSpec,
    WanderingSpec,
)
from pydantic import BaseModel, ValidationError

from osreditor.ops import (
    AddFeature,
    Diagnostics,
    Finding,
    OpBatch,
    OpBatchResult,
    RemoveFeature,
    SetAdventureField,
    SetEncounter,
    SetFeature,
    SetTownField,
    SetTrap,
    SetTreasure,
    SetWandering,
    SubtreeChange,
)
from osreditor.sidecar import EditorSidecar

FINDING = Finding(
    source="validation",
    code="encounter_unknown_monster",
    severity="error",
    message="mill-caves level 1: area '1' references unknown monster 'orc-chief'",
    address="dungeon:mill-caves/level:1/area:1",
)
DIAGNOSTICS = Diagnostics(
    validation=(FINDING,),
    lint=(Finding(source="lint", code="area_unreachable", severity="error", message="…"),),
)
RESULT = OpBatchResult(
    revision="r2",
    diagnostics=DIAGNOSTICS,
    delta=(SubtreeChange(path="/town", value={"name": "Dusthollow"}),),
    can_undo=True,
    can_redo=False,
    sidecar=EditorSidecar(),
)


@pytest.mark.parametrize(
    "model",
    [
        SetAdventureField(field="name", value="The mill on the moor"),
        SetAdventureField(field="hooks", value=("A hook", "Another")),
        SetTownField(field="services", value=("inn",)),
        SetTownField(field="travel_turns", value={"mill-caves": 2}),
        SetWandering(dungeon_id="mill-caves", level_number=1, wandering=WanderingSpec(chance_in_six=2)),
        SetEncounter(
            dungeon_id="mill-caves",
            level_number=1,
            area_id="1",
            encounter=KeyedEncounter(monsters=(KeyedMonster(template_id="orc", count_dice="3d4"),)),
        ),
        SetEncounter(dungeon_id="mill-caves", level_number=1, area_id="1", encounter=None),
        SetTrap(
            dungeon_id="mill-caves",
            level_number=1,
            area_id="1",
            trap=TrapSpec(kind="room", trigger="enter", effect=TrapEffect(damage_dice="2d6")),
        ),
        SetTreasure(dungeon_id="mill-caves", level_number=1, area_id="1", treasure=AreaTreasureSpec(letters=("C",))),
        AddFeature(
            dungeon_id="mill-caves",
            level_number=1,
            area_id=None,
            feature=FeatureSpec(id="feature-1", kind="custom", cell=(1, 1)),
        ),
        SetFeature(
            dungeon_id="mill-caves",
            level_number=1,
            area_id="1",
            feature_id="feature-1",
            feature=FeatureSpec(id="feature-1", kind="treasure_cache", cell=None),
        ),
        RemoveFeature(dungeon_id="mill-caves", level_number=1, area_id="1", feature_id="feature-1"),
        OpBatch(revision="rev-1", ops=(SetAdventureField(field="description", value="…"),)),
        FINDING,
        Finding(source="lint", code="orphan_cell", severity="warning", message="cell (2, 1) is in no area"),
        DIAGNOSTICS,
        Diagnostics(),
        SubtreeChange(path="", value={"name": "whole document"}),
        RESULT,
    ],
)
def test_envelope_models_round_trip(model: BaseModel) -> None:
    assert type(model).model_validate(model.model_dump(mode="json")) == model


def test_op_batch_discriminates_on_op() -> None:
    batch = OpBatch.model_validate(
        {
            "revision": "r1",
            "ops": [
                {"op": "set_adventure_field", "field": "name", "value": "X"},
                {"op": "set_town_field", "field": "name", "value": "Y"},
                {"op": "set_wandering", "dungeon_id": "d", "level_number": 1, "wandering": {}},
                {"op": "set_encounter", "dungeon_id": "d", "level_number": 1, "area_id": "1", "encounter": None},
                {"op": "set_trap", "dungeon_id": "d", "level_number": 1, "area_id": "1", "trap": None},
                {"op": "set_treasure", "dungeon_id": "d", "level_number": 1, "area_id": "1", "treasure": None},
                {
                    "op": "add_feature",
                    "dungeon_id": "d",
                    "level_number": 1,
                    "area_id": None,
                    "feature": {"id": "feature-1", "kind": "custom", "cell": [1, 1]},
                },
                {
                    "op": "set_feature",
                    "dungeon_id": "d",
                    "level_number": 1,
                    "area_id": "1",
                    "feature_id": "feature-1",
                    "feature": {"id": "feature-1", "kind": "custom"},
                },
                {"op": "remove_feature", "dungeon_id": "d", "level_number": 1, "area_id": "1", "feature_id": "f"},
            ],
        }
    )
    assert [type(op) for op in batch.ops] == [
        SetAdventureField,
        SetTownField,
        SetWandering,
        SetEncounter,
        SetTrap,
        SetTreasure,
        AddFeature,
        SetFeature,
        RemoveFeature,
    ]


def test_the_content_models_validate_at_request_parse() -> None:
    # The embedded osrlib models' own validators fire when an op parses, so an
    # invalid combination is a 422 before any op logic runs.
    with pytest.raises(ValidationError, match="exactly one of count_dice or count_fixed"):
        SetEncounter.model_validate(
            {
                "dungeon_id": "d",
                "level_number": 1,
                "area_id": "1",
                "encounter": {"monsters": [{"template_id": "orc", "count_dice": "1d6", "count_fixed": 3}]},
            }
        )
    with pytest.raises(ValidationError, match="letters or sets unguarded"):
        SetTreasure.model_validate(
            {"dungeon_id": "d", "level_number": 1, "area_id": "1", "treasure": {"letters": [], "unguarded": False}}
        )
    with pytest.raises(ValidationError, match="a volley needs per-projectile damage dice"):
        SetTrap.model_validate(
            {
                "dungeon_id": "d",
                "level_number": 1,
                "area_id": "1",
                "trap": {"kind": "room", "trigger": "enter", "effect": {"volley_dice": "1d6"}},
            }
        )
    with pytest.raises(ValidationError, match="a condition duration needs a condition"):
        SetTrap.model_validate(
            {
                "dungeon_id": "d",
                "level_number": 1,
                "area_id": "1",
                "trap": {"kind": "room", "trigger": "enter", "effect": {"condition_duration_amount": 3}},
            }
        )


def test_op_batch_rejects_unknown_op_code() -> None:
    with pytest.raises(ValidationError):
        OpBatch.model_validate({"revision": "r1", "ops": [{"op": "set_vibes", "field": "name", "value": "X"}]})


@pytest.mark.parametrize(
    ("field", "value"),
    [("name", ("not", "a", "string")), ("description", ()), ("hooks", "not a tuple")],
)
def test_set_adventure_field_enforces_the_pairing(field: str, value: object) -> None:
    with pytest.raises(ValidationError):
        SetAdventureField.model_validate({"field": field, "value": value})


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("name", ("tuple",)),
        ("description", {"a": 1}),
        ("services", "not a tuple"),
        ("travel_turns", "not a mapping"),
        ("travel_turns", ("not", "a", "mapping")),
    ],
)
def test_set_town_field_enforces_the_pairing(field: str, value: object) -> None:
    with pytest.raises(ValidationError):
        SetTownField.model_validate({"field": field, "value": value})


def test_set_town_field_rejects_negative_travel_turns() -> None:
    with pytest.raises(ValidationError, match="travel_turns values must be >= 0"):
        SetTownField.model_validate({"field": "travel_turns", "value": {"mill-caves": -1}})


def test_set_wandering_requires_a_positive_level_number() -> None:
    with pytest.raises(ValidationError):
        SetWandering.model_validate({"dungeon_id": "d", "level_number": 0, "wandering": {}})


def test_set_wandering_carries_the_full_spec() -> None:
    op = SetWandering.model_validate(
        {"dungeon_id": "d", "level_number": 1, "wandering": {"chance_in_six": 3, "interval_turns": 1}}
    )
    assert op.wandering == WanderingSpec(chance_in_six=3, interval_turns=1, table=None)


def test_op_batch_requires_at_least_one_op() -> None:
    with pytest.raises(ValidationError):
        OpBatch(revision="rev-1", ops=())


def test_finding_rejects_unknown_source() -> None:
    with pytest.raises(ValidationError):
        Finding(source="vibes", code="x", severity="error", message="y")  # type: ignore[arg-type]


def test_finding_rejects_unknown_severity() -> None:
    with pytest.raises(ValidationError):
        Finding(source="lint", code="x", severity="fatal", message="y")  # type: ignore[arg-type]


@pytest.mark.parametrize(
    "model",
    [
        SetAdventureField(field="name", value="X"),
        OpBatch(revision="rev-1", ops=(SetAdventureField(field="name", value="X"),)),
        FINDING,
        DIAGNOSTICS,
        SubtreeChange(path="/town", value=None),
        RESULT,
    ],
)
def test_envelope_models_are_frozen(model: BaseModel) -> None:
    field = next(iter(type(model).model_fields))
    with pytest.raises(ValidationError):
        setattr(model, field, "mutated")
