"""The locked ops/revision/diagnostics envelope: the shape every edit obeys from birth.

These models are the editor's echo of osrlib's commands-in/events-out discipline:
the frontend posts an [`OpBatch`][osreditor.ops.OpBatch] naming the revision it was
computed against, the backend applies it atomically and answers with an
[`OpBatchResult`][osreditor.ops.OpBatchResult] carrying the new revision and
refreshed [`Diagnostics`][osreditor.ops.Diagnostics]. A stale revision is rejected
with 409 and the structured `stale_revision` error, never a silent overwrite.

The envelope grows additively. The first concrete ops, the `AnyEditOp` union, and
the changed-subtree delta field land with the document service in phase 1; the
`forge` diagnostics tier lands with forge-backed projects in phase 5.
"""

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

__all__ = [
    "Diagnostics",
    "EditOp",
    "Finding",
    "OpBatch",
    "OpBatchResult",
]


class EditOp(BaseModel):
    """The frozen base every edit operation extends.

    `op` is the discriminator: a stable snake_case code naming the domain action,
    e.g. `set_adventure_field`. Concrete operations are frozen subclasses that
    narrow `op` to a `Literal`, joined into a discriminated `AnyEditOp` union
    exactly as osrlib builds `AnyCommand`; the vocabulary grows additively and
    the first concrete ops land with the document service in phase 1.
    """

    model_config = ConfigDict(frozen=True)

    op: str


class OpBatch(BaseModel):
    """One atomic unit of edit work, computed against a named revision.

    A batch applies atomically — all ops or none — and forms exactly one undo
    step, so a compound gesture is a single unit of work and a single Ctrl+Z.
    `revision` is the revision the batch was computed against; a batch naming a
    revision that is no longer current is rejected whole with 409
    (`stale_revision`), which makes a second browser tab safe rather than
    silently destructive.
    """

    model_config = ConfigDict(frozen=True)

    revision: str
    ops: tuple[EditOp, ...] = Field(min_length=1)


class Finding(BaseModel):
    """One diagnostic finding: its source tier, a stable code, and a location.

    `address` is the click-to-navigate location (area/cell/edge addressing). Its
    grammar is pinned by the first producers — phase 1 for validation, phase 2
    for lint — as content within this locked shape; forge's `AreaAddress` form
    and osrlib's `cell_ref`/`edge_ref` are the precedents they draw on.
    """

    model_config = ConfigDict(frozen=True)

    source: Literal["validation", "lint", "forge"]
    code: str
    message: str
    address: str | None = None


class Diagnostics(BaseModel):
    """Live diagnostics, recomputed after every batch.

    Two tiers here mirror the spec's diagnostics panel: `validation` is
    `validate_adventure` output, `lint` the editor's structural lint. Tier 1,
    model validity, is unrepresentable by construction — invalid batches are
    rejected whole and never become state. Forge-check findings merge in
    phase 5 via an additive `forge` field.
    """

    model_config = ConfigDict(frozen=True)

    validation: tuple[Finding, ...] = ()
    lint: tuple[Finding, ...] = ()


class OpBatchResult(BaseModel):
    """A committed batch's answer: the new revision and refreshed diagnostics.

    `revision` is an opaque server-issued string — the envelope locks the type
    and the opacity, not the representation, which is the phase 1 issuer's
    decision. The spec's changed-subtree delta field is deliberately absent: its
    encoding is the document service's central design problem, and the
    envelope's additive-growth rule lets phase 1 add it.
    """

    model_config = ConfigDict(frozen=True)

    revision: str
    diagnostics: Diagnostics
