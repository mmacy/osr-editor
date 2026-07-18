"""The envelope models: serialization round-trips, minimum batch size, frozen-ness."""

import pytest
from pydantic import BaseModel, ValidationError

from osreditor.ops import Diagnostics, EditOp, Finding, OpBatch, OpBatchResult

FINDING = Finding(
    source="validation",
    code="unknown_monster",
    message="area '1' references unknown monster 'orc-chief'",
    address="mill-caves:1:area:1",
)
DIAGNOSTICS = Diagnostics(validation=(FINDING,), lint=(Finding(source="lint", code="area_unreachable", message="…"),))


@pytest.mark.parametrize(
    "model",
    [
        EditOp(op="set_adventure_field"),
        OpBatch(revision="rev-1", ops=(EditOp(op="set_adventure_field"),)),
        FINDING,
        Finding(source="lint", code="orphan_cell", message="cell (2, 1) is in no area"),
        DIAGNOSTICS,
        Diagnostics(),
        OpBatchResult(revision="rev-2", diagnostics=DIAGNOSTICS),
        OpBatchResult(revision="rev-2", diagnostics=Diagnostics()),
    ],
)
def test_envelope_models_round_trip(model: BaseModel) -> None:
    assert type(model).model_validate(model.model_dump(mode="json")) == model


def test_op_batch_requires_at_least_one_op() -> None:
    with pytest.raises(ValidationError):
        OpBatch(revision="rev-1", ops=())


def test_finding_rejects_unknown_source() -> None:
    with pytest.raises(ValidationError):
        Finding(source="vibes", code="x", message="y")  # type: ignore[arg-type]


@pytest.mark.parametrize(
    "model",
    [
        EditOp(op="set_adventure_field"),
        OpBatch(revision="rev-1", ops=(EditOp(op="set_adventure_field"),)),
        FINDING,
        DIAGNOSTICS,
        OpBatchResult(revision="rev-2", diagnostics=Diagnostics()),
    ],
)
def test_envelope_models_are_frozen(model: BaseModel) -> None:
    field = next(iter(type(model).model_fields))
    with pytest.raises(ValidationError):
        setattr(model, field, "mutated")
