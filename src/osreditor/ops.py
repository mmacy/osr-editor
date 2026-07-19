"""The locked ops/revision/diagnostics envelope and the phase 1 op vocabulary.

These models are the editor's echo of osrlib's commands-in/events-out discipline:
the frontend posts an [`OpBatch`][osreditor.ops.OpBatch] naming the revision it was
computed against, the backend applies it atomically and answers with an
[`OpBatchResult`][osreditor.ops.OpBatchResult] carrying the new revision, the
changed-subtree delta, and refreshed [`Diagnostics`][osreditor.ops.Diagnostics].
A stale revision is rejected with 409 and the structured `stale_revision` error,
never a silent overwrite.

The envelope grows additively. The first concrete ops and the `AnyEditOp` union
land here with phase 1's document service, built exactly as osrlib builds
`AnyCommand`; geometry and dungeon/level-management ops arrive with the map
editor in phase 2, and the `forge` diagnostics tier with forge-backed projects
in phase 5.
"""

from typing import Annotated, Literal

from osrlib.crawl.dungeon import WanderingSpec
from pydantic import BaseModel, ConfigDict, Field, model_validator

__all__ = [
    "AnyEditOp",
    "Diagnostics",
    "EditOp",
    "Finding",
    "OpBatch",
    "OpBatchResult",
    "SetAdventureField",
    "SetTownField",
    "SetWandering",
    "SubtreeChange",
]


class EditOp(BaseModel):
    """The frozen base every edit operation extends.

    `op` is the discriminator: a stable snake_case code naming the domain action,
    e.g. `set_adventure_field`. Concrete operations are frozen subclasses that
    narrow `op` to a `Literal`, joined into the discriminated
    [`AnyEditOp`][osreditor.ops.AnyEditOp] union exactly as osrlib builds
    `AnyCommand`; the vocabulary grows additively.
    """

    model_config = ConfigDict(frozen=True)

    op: str


class SetAdventureField(EditOp):
    """Set one adventure-scope metadata field.

    `hooks` takes the whole tuple (list editors commit the full value); `name`
    and `description` take a string.
    """

    op: Literal["set_adventure_field"] = "set_adventure_field"  # pyright: ignore[reportIncompatibleVariableOverride] — frozen models; pydantic sanctions the narrow
    field: Literal["name", "description", "hooks"]
    value: str | tuple[str, ...]

    @model_validator(mode="after")
    def _value_matches_field(self) -> SetAdventureField:
        if self.field == "hooks":
            if not isinstance(self.value, tuple):
                raise ValueError("hooks takes a tuple of strings")
        elif not isinstance(self.value, str):
            raise ValueError(f"{self.field} takes a string")
        return self


class SetTownField(EditOp):
    """Set one town field.

    `services` takes the whole tuple, `travel_turns` the whole mapping, `name`
    and `description` a string. Travel-turn values are guarded `>= 0` here —
    osrlib's `dict[str, int]` has no lower bound and would happily persist a
    negative travel cost.
    """

    op: Literal["set_town_field"] = "set_town_field"  # pyright: ignore[reportIncompatibleVariableOverride] — frozen models; pydantic sanctions the narrow
    field: Literal["name", "description", "services", "travel_turns"]
    value: str | tuple[str, ...] | dict[str, int]

    @model_validator(mode="after")
    def _value_matches_field(self) -> SetTownField:
        if self.field in ("name", "description"):
            if not isinstance(self.value, str):
                raise ValueError(f"{self.field} takes a string")
        elif self.field == "services":
            if not isinstance(self.value, tuple):
                raise ValueError("services takes a tuple of strings")
        else:
            if not isinstance(self.value, dict):
                raise ValueError("travel_turns takes a mapping of dungeon id to turns")
            negative = sorted(dungeon_id for dungeon_id, turns in self.value.items() if turns < 0)
            if negative:
                raise ValueError(f"travel_turns values must be >= 0, got negative turns for {negative}")
        return self


class SetWandering(EditOp):
    """Replace one level's wandering-monster parameters.

    The op carries the full [`WanderingSpec`][osrlib.crawl.dungeon.WanderingSpec],
    inline `table` included, so the vocabulary is data-complete even though the
    phase 1 form authors only `chance_in_six` and `interval_turns` — the d20
    table form belongs with phase 3's pickers.
    """

    op: Literal["set_wandering"] = "set_wandering"  # pyright: ignore[reportIncompatibleVariableOverride] — frozen models; pydantic sanctions the narrow
    dungeon_id: str
    level_number: int = Field(ge=1)
    wandering: WanderingSpec


AnyEditOp = Annotated[
    SetAdventureField | SetTownField | SetWandering,
    Field(discriminator="op"),
]
"""Any edit operation, discriminated by `op`."""


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
    ops: tuple[AnyEditOp, ...] = Field(min_length=1)


class Finding(BaseModel):
    """One diagnostic finding: its source tier, a stable code, and a location.

    `address` is the click-to-navigate location. Its grammar is pinned by the
    first producers as content within this locked shape — phase 1's validation
    tier pins `/`-joined `kind:value` segments with percent-encoded values (see
    [`osreditor.diagnostics`][osreditor.diagnostics]); phase 2's lint extends it
    with `cell:` and `edge:` segments.
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


class SubtreeChange(BaseModel):
    """One changed subtree: where it is and what it now holds.

    `path` is an RFC 6901 JSON Pointer into the adventure payload; `""` means
    the whole document. `value` is the replacement subtree in serialization-mode
    JSON — loose by design, since it can be any node of the document.
    """

    model_config = ConfigDict(frozen=True)

    path: str
    value: object = None


class OpBatchResult(BaseModel):
    """A committed batch's answer: the new revision, the delta, and refreshed diagnostics.

    `revision` is an opaque server-issued string — the envelope locks the type
    and the opacity, not the representation, which is the issuer's decision.
    `delta` entries apply in order and are coalesced so no entry's path is a
    descendant of another's; undo and redo answer with the degenerate
    whole-document delta (`path=""`). `can_undo`/`can_redo` track the stacks so
    the frontend's buttons never need a second request.
    """

    model_config = ConfigDict(frozen=True)

    revision: str
    diagnostics: Diagnostics
    delta: tuple[SubtreeChange, ...]
    can_undo: bool
    can_redo: bool
