"""The locked ops/revision/diagnostics envelope and the phase 1 op vocabulary.

These models are the editor's echo of osrlib's commands-in/events-out discipline:
the frontend posts an [`OpBatch`][osreditor.ops.OpBatch] naming the revision it was
computed against, the backend applies it atomically and answers with an
[`OpBatchResult`][osreditor.ops.OpBatchResult] carrying the new revision, the
changed-subtree delta, and refreshed [`Diagnostics`][osreditor.ops.Diagnostics].
A stale revision is rejected with 409 and the structured `stale_revision` error,
never a silent overwrite.

The envelope grows additively. The phase 1 ops and the `AnyEditOp` union landed
here with the document service, built exactly as osrlib builds `AnyCommand`;
phase 2 added the geometry and dungeon/level-management vocabulary; phase 3 adds
the content vocabulary — encounters, traps, treasure, and features. The `forge`
diagnostics tier arrives with forge-backed projects in phase 5.

The op-level philosophy, continuing phase 1's `travel_turns >= 0` guard:
**reject what is never intentional and is not a transient editing state**
(malformed edge keys, out-of-bounds cells, duplicate ids); **admit what a
workflow legitimately passes through** (dangling transition targets, missing
entrances) and let diagnostics guide the fix. The models here carry only shape
constraints (types, bounds on scalars, minimum lengths); the editor-enforced
semantic invariants are checked against the document at apply time and raise
[`OpInvariantError`][osreditor.errors.OpInvariantError] — see each op's
docstring for its pinned invariants.
"""

from typing import Annotated, Literal

from osrlib.crawl.dungeon import (
    AreaTreasureSpec,
    Edge,
    FeatureSpec,
    KeyedEncounter,
    Position,
    TransitionSpec,
    TrapSpec,
    WanderingSpec,
)
from pydantic import BaseModel, ConfigDict, Field, model_validator

__all__ = [
    "AddDungeon",
    "AddFeature",
    "AddLevel",
    "AddTransition",
    "AnyEditOp",
    "AreaOp",
    "CreateArea",
    "Diagnostics",
    "EditOp",
    "FeatureContainerOp",
    "Finding",
    "LevelOp",
    "OpBatch",
    "OpBatchResult",
    "RemoveArea",
    "RemoveDungeon",
    "RemoveFeature",
    "RemoveLevel",
    "RemoveTransition",
    "RenameDungeon",
    "RenumberLevel",
    "ResizeLevel",
    "SetAdventureField",
    "SetAreaCells",
    "SetAreaField",
    "SetDungeonField",
    "SetEdges",
    "SetEncounter",
    "SetEntrance",
    "SetFeature",
    "SetTownField",
    "SetTrap",
    "SetTreasure",
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


class LevelOp(EditOp):
    """Shared targeting for ops scoped to one level: `dungeon_id` + `level_number`.

    A miss on either raises
    [`OpTargetNotFoundError`][osreditor.errors.OpTargetNotFoundError] at apply.
    """

    dungeon_id: str
    level_number: int = Field(ge=1)


class SetWandering(LevelOp):
    """Replace one level's wandering-monster parameters.

    The op carries the full [`WanderingSpec`][osrlib.crawl.dungeon.WanderingSpec],
    inline `table` included, so the vocabulary is data-complete even though the
    phase 1 form authors only `chance_in_six` and `interval_turns` — the d20
    table form belongs with phase 3's pickers.
    """

    op: Literal["set_wandering"] = "set_wandering"  # pyright: ignore[reportIncompatibleVariableOverride] — frozen models; pydantic sanctions the narrow
    wandering: WanderingSpec


class SetEdges(LevelOp):
    """Apply a batch of edge-key → assignment entries; `None` deletes (wall).

    Invariants at apply: a non-`None` assignment requires a key in the
    canonical grammar (`x,y:north|west`, non-negative, no leading zeros — the
    editor authors storage form, never the aliases osrlib silently ignores)
    with both incident cells in bounds, and rejects an explicit
    `Edge(kind="wall")` value — deletion is the one way to say wall, so
    editor-written documents keep a single representation. A `None` assignment
    instead accepts any key string exactly matching an existing entry (and
    rejects a key matching nothing): deletion authors no key, so the malformed
    and non-canonical keys a foreign document legally carries stay deletable —
    the `edge_invalid` remediation path and replace-mode import depend on
    exactly this.
    """

    op: Literal["set_edges"] = "set_edges"  # pyright: ignore[reportIncompatibleVariableOverride] — frozen models; pydantic sanctions the narrow
    edges: dict[str, Edge | None] = Field(min_length=1)


class SetEntrance(LevelOp):
    """Place or clear the level's entrance.

    A position must be in bounds (apply-time invariant); `None` clears, and the
    resulting `entrance_missing` finding is the legal, navigable consequence.
    """

    op: Literal["set_entrance"] = "set_entrance"  # pyright: ignore[reportIncompatibleVariableOverride] — frozen models; pydantic sanctions the narrow
    entrance: Position | None


class CreateArea(LevelOp):
    """Create a keyed area over a cell cluster.

    Invariants at apply: `area_id` non-empty and not already present on the
    level (a duplicate is never intentional — the model can't see it and
    `validate_adventure` would only flag it later); every cell in bounds. Cells
    may overlap another area's — that is `area_overlap` lint's territory, legal
    by the model and sometimes transiently useful mid-edit.
    """

    op: Literal["create_area"] = "create_area"  # pyright: ignore[reportIncompatibleVariableOverride] — frozen models; pydantic sanctions the narrow
    area_id: str
    cells: tuple[Position, ...] = Field(min_length=1)
    name: str = ""
    description: str = ""


class SetAreaCells(LevelOp):
    """Replace an area's cell cluster wholesale — the paint/lasso tool's op.

    Invariant at apply: every cell in bounds.
    """

    op: Literal["set_area_cells"] = "set_area_cells"  # pyright: ignore[reportIncompatibleVariableOverride] — frozen models; pydantic sanctions the narrow
    area_id: str
    cells: tuple[Position, ...] = Field(min_length=1)


class SetAreaField(LevelOp):
    """Set one area identity field; every field in the literal takes a string.

    `id` is the re-key affordance (key numbers render on the map, so re-keying
    is a map concern): apply rejects empty and duplicate ids like
    [`CreateArea`][osreditor.ops.CreateArea]. Nothing references area ids in
    the document, so re-keying cascades nowhere. Phase 3 does not grow this
    literal — encounter, trap, and treasure have their own ops per the spec's
    vocabulary.
    """

    op: Literal["set_area_field"] = "set_area_field"  # pyright: ignore[reportIncompatibleVariableOverride] — frozen models; pydantic sanctions the narrow
    area_id: str
    field: Literal["id", "name", "description"]
    value: str


class RemoveArea(LevelOp):
    """Remove an area; its cells become corridor (osrlib's convention — cells in no area).

    Removing an area discards any content it carries; the frontend confirms
    when content exists (foreign documents), silently otherwise.
    """

    op: Literal["remove_area"] = "remove_area"  # pyright: ignore[reportIncompatibleVariableOverride] — frozen models; pydantic sanctions the narrow
    area_id: str


class AreaOp(LevelOp):
    """Shared targeting for ops scoped to one area: a level target plus `area_id`.

    An unknown area id raises
    [`OpTargetNotFoundError`][osreditor.errors.OpTargetNotFoundError] at apply,
    per the phase 2 rule that every targeting miss is `op_target_not_found`.
    """

    area_id: str


class SetEncounter(AreaOp):
    """Replace or clear an area's keyed encounter; `None` removes.

    Whole-value grain, the `SetWandering` precedent: the encounter card commits
    a complete [`KeyedEncounter`][osrlib.crawl.dungeon.KeyedEncounter], and
    internal validity (at least one monster line, exactly one count form per
    line) is the model's own, enforced at request parse. An unknown or
    dangling `template_id` is deliberately *not* checked here — cross-reference
    problems are diagnostics, legal while editing, and foreign documents
    legally carry them.
    """

    op: Literal["set_encounter"] = "set_encounter"  # pyright: ignore[reportIncompatibleVariableOverride] — frozen models; pydantic sanctions the narrow
    encounter: KeyedEncounter | None


class SetTrap(AreaOp):
    """Replace or clear an area's room trap; `None` removes.

    The op does not inspect `kind`: the trap card authors `kind="room"` by
    construction, and a mismatched kind is exactly what the whole-batch
    re-validation backstop exists to catch — `op_rejected` carrying osrlib's
    own "area {id!r} carries a non-room trap".
    """

    op: Literal["set_trap"] = "set_trap"  # pyright: ignore[reportIncompatibleVariableOverride] — frozen models; pydantic sanctions the narrow
    trap: TrapSpec | None


class SetTreasure(AreaOp):
    """Replace or clear an area's generated-treasure declaration; `None` removes.

    The letters-xor-unguarded rule is the model's own
    ([`AreaTreasureSpec`][osrlib.crawl.dungeon.AreaTreasureSpec]), enforced at
    request parse.
    """

    op: Literal["set_treasure"] = "set_treasure"  # pyright: ignore[reportIncompatibleVariableOverride] — frozen models; pydantic sanctions the narrow
    treasure: AreaTreasureSpec | None


class FeatureContainerOp(LevelOp):
    """Shared targeting for feature ops: a level target plus the feature's container.

    `area_id=None` addresses the level itself — `LevelSpec.features` is real,
    and a vocabulary that cannot reach level-scope features would leave foreign
    documents' level-feature findings permanently unfixable.
    """

    area_id: str | None


class AddFeature(FeatureContainerOp):
    """Add a feature to an area or (with `area_id=None`) the level itself.

    Invariants at apply: the feature id non-empty; not already used anywhere on
    the level — `validate_adventure`'s uniqueness scope spans the level's own
    features and every area's, and a duplicate is never intentional (the
    `CreateArea` reasoning); not the reserved id `"pile"` (colliding with the
    runtime's drop-pile convention is never intentional either). A non-`None`
    `cell` must be in bounds — the editor never authors out-of-bounds geometry.
    `cell=None` is admitted at level scope: `feature_needs_cell` is a content
    finding, legal while editing.
    """

    op: Literal["add_feature"] = "add_feature"  # pyright: ignore[reportIncompatibleVariableOverride] — frozen models; pydantic sanctions the narrow
    feature: FeatureSpec


class SetFeature(FeatureContainerOp):
    """Replace one feature whole; a differing `feature.id` is a rename.

    Whole-value replacement at the card's commit grain — this deliberately
    implements the spec's `SetFeatureField` slot at whole-value grain (a
    field-grained op over `FeatureSpec` would need an undiscriminable value
    union; the vocabulary is explicitly representative). A rename falls under
    [`AddFeature`][osreditor.ops.AddFeature]'s id rejections; nothing in the
    document references feature ids, so a rename cascades nowhere. The
    cell-bounds invariant applies to a *changed* cell only: a `cell` equal to
    the targeted feature's current cell passes through untouched, so editing
    any other field of a foreign feature with an out-of-bounds cell never
    locks. Among foreign duplicate feature ids, the first match in authored
    order is the target — osrlib's own resolution posture.
    """

    op: Literal["set_feature"] = "set_feature"  # pyright: ignore[reportIncompatibleVariableOverride] — frozen models; pydantic sanctions the narrow
    feature_id: str
    feature: FeatureSpec


class RemoveFeature(FeatureContainerOp):
    """Remove one feature; first-match among foreign duplicate ids.

    Moving a feature between containers is a `RemoveFeature` + `AddFeature`
    batch — one gesture, one undo step, the transition-edit precedent.
    """

    op: Literal["remove_feature"] = "remove_feature"  # pyright: ignore[reportIncompatibleVariableOverride] — frozen models; pydantic sanctions the narrow
    feature_id: str


class AddTransition(LevelOp):
    """Add a transition, carrying the full [`TransitionSpec`][osrlib.crawl.dungeon.TransitionSpec].

    Invariants at apply: the source `position` in bounds and unoccupied —
    osrlib's `transition_at` returns the first match, so a second transition on
    one cell is dead data; editing a transition is a remove+add batch (one
    gesture, one undo step). The target is deliberately unvalidated beyond the
    model's own `to_level_number >= 1`: an unknown dungeon, missing level, or
    out-of-bounds target cell is a validation finding, legal while editing —
    an import may land stairs before their destination level exists.
    """

    op: Literal["add_transition"] = "add_transition"  # pyright: ignore[reportIncompatibleVariableOverride] — frozen models; pydantic sanctions the narrow
    transition: TransitionSpec


class RemoveTransition(LevelOp):
    """Remove the first transition at a source position.

    First-match is osrlib's own resolution order (`transition_at`) — a foreign
    document can stack two transitions on one cell, and first-match keeps
    "remove one per existing entry" sequences (the replace-mode import) correct
    by construction. No transition at the position is a targeting miss.
    """

    op: Literal["remove_transition"] = "remove_transition"  # pyright: ignore[reportIncompatibleVariableOverride] — frozen models; pydantic sanctions the narrow
    position: Position


class AddDungeon(EditOp):
    """Add a dungeon, scaffolding level 1 with an entrance at `(0, 0)`.

    The scaffold is exactly `starter_adventure`'s, so a new dungeon validates
    clean from birth and the entrance tool moves what exists rather than the
    panel nagging about what doesn't. Invariant at apply: a duplicate dungeon
    id is rejected.
    """

    op: Literal["add_dungeon"] = "add_dungeon"  # pyright: ignore[reportIncompatibleVariableOverride] — frozen models; pydantic sanctions the narrow
    dungeon_id: str
    name: str = ""
    width: int = Field(ge=1)
    height: int = Field(ge=1)


class SetDungeonField(EditOp):
    """Set one dungeon field — `name`, the one plain settable field.

    The literal grows if `DungeonSpec` ever does.
    """

    op: Literal["set_dungeon_field"] = "set_dungeon_field"  # pyright: ignore[reportIncompatibleVariableOverride] — frozen models; pydantic sanctions the narrow
    dungeon_id: str
    field: Literal["name"]
    value: str


class RenameDungeon(EditOp):
    """Rename a dungeon, cascading every reference to it.

    A rename means "same thing, new name", so references follow, atomically, in
    one undo step: the dungeon's `id`, the town's `travel_turns` key (order
    preserved), and every `TransitionSpec.to_dungeon_id` naming it, across all
    dungeons. Invariants at apply: `new_id` non-empty and not already taken.
    Contrast [`RemoveDungeon`][osreditor.ops.RemoveDungeon], which deliberately
    does not cascade.
    """

    op: Literal["rename_dungeon"] = "rename_dungeon"  # pyright: ignore[reportIncompatibleVariableOverride] — frozen models; pydantic sanctions the narrow
    old_id: str
    new_id: str


class RemoveDungeon(EditOp):
    """Remove a dungeon — never the last one, and never cascading.

    A removed dungeon's dangling `travel_turns` entry and inbound transitions
    are honest diagnostics (`travel_unknown_dungeon`,
    `transition_target_unknown`) — removal never silently edits other subtrees.
    """

    op: Literal["remove_dungeon"] = "remove_dungeon"  # pyright: ignore[reportIncompatibleVariableOverride] — frozen models; pydantic sanctions the narrow
    dungeon_id: str


class AddLevel(EditOp):
    """Add a level to a dungeon; no entrance (validation requires one per dungeon, not per level).

    Invariant at apply: `number` unique in the dungeon. The new level is
    *inserted* before the first existing level whose `number` exceeds it,
    appended when none does — deterministic over any tuple,
    ascending-preserving over an ascending one; no op ever reorders existing
    levels. Stored order is rules-visible when more than one level bears an
    entrance (`EnterDungeon` lands on the first entrance-bearing level in
    stored order), so a re-sort could silently change where a foreign dungeon's
    play begins; insertion is safe precisely because a new level carries no
    entrance.
    """

    op: Literal["add_level"] = "add_level"  # pyright: ignore[reportIncompatibleVariableOverride] — frozen models; pydantic sanctions the narrow
    dungeon_id: str
    number: int = Field(ge=1)
    width: int = Field(ge=1)
    height: int = Field(ge=1)


class RenumberLevel(EditOp):
    """Renumber a level, cascading every transition in the document targeting it.

    Same rename-vs-remove logic as dungeons; per the no-reorder rule the level
    stays where it sits in the tuple (display order is sorted anyway, and
    moving it could change the stored-order entrance semantics). Invariant at
    apply: `new_number` not already taken in the dungeon.
    """

    op: Literal["renumber_level"] = "renumber_level"  # pyright: ignore[reportIncompatibleVariableOverride] — frozen models; pydantic sanctions the narrow
    dungeon_id: str
    old_number: int = Field(ge=1)
    new_number: int = Field(ge=1)


class ResizeLevel(LevelOp):
    """Resize a level's grid.

    Shrinking below existing content is rejected listing every offender —
    areas with cells outside the new bounds, features with out-of-bounds cells,
    transitions whose *source* leaves the grid, an entrance outside — as
    `details.offenders`, each an address-grammar string plus a message.
    (Transitions *elsewhere* that target now-out-of-bounds cells in this level
    are not offenders; they become `transition_target_cell_out_of_bounds`
    validation findings, the dangling-reference rule.) One pinned exception:
    edge entries whose incident cells fall outside the new bounds are pruned by
    the op — edges are spatial annotation, not content; osrlib treats an
    out-of-bounds entry as nonexistent and `validate_adventure` never sees it,
    so keeping it would strand invisible `edge_invalid` errors on keys the map
    cannot even display, and rejecting on it would demand the user hand-erase
    edges they cannot see. The prune is deterministic and inside the single
    undo step.
    """

    op: Literal["resize_level"] = "resize_level"  # pyright: ignore[reportIncompatibleVariableOverride] — frozen models; pydantic sanctions the narrow
    width: int = Field(ge=1)
    height: int = Field(ge=1)


class RemoveLevel(LevelOp):
    """Remove a level — never a dungeon's last one. Inbound transitions dangle as diagnostics."""

    op: Literal["remove_level"] = "remove_level"  # pyright: ignore[reportIncompatibleVariableOverride] — frozen models; pydantic sanctions the narrow


AnyEditOp = Annotated[
    SetAdventureField
    | SetTownField
    | SetWandering
    | SetEdges
    | SetEntrance
    | CreateArea
    | SetAreaCells
    | SetAreaField
    | RemoveArea
    | SetEncounter
    | SetTrap
    | SetTreasure
    | AddFeature
    | SetFeature
    | RemoveFeature
    | AddTransition
    | RemoveTransition
    | AddDungeon
    | SetDungeonField
    | RenameDungeon
    | RemoveDungeon
    | AddLevel
    | RenumberLevel
    | ResizeLevel
    | RemoveLevel,
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
    """One diagnostic finding: its source tier, a stable code, severity, and a location.

    `severity` is a field with a producer-pinned table, not a function of the
    code (forge's own contract decision, mirrored): the validation producer
    sets `"error"` on every finding — `validate_adventure` output gates
    publish, which is what error means here — and the lint producer pins each
    check's severity in [`osreditor.lint`][osreditor.lint]. The design language
    reserves red for errors; warnings use the pencil palette.

    `address` is the click-to-navigate location. Its grammar is pinned by the
    first producers as content within this locked shape — phase 1's validation
    tier pins `/`-joined `kind:value` segments with percent-encoded values (see
    [`osreditor.addresses`][osreditor.addresses]); phase 2's lint extends it
    with `cell:` and `edge:` segments.
    """

    model_config = ConfigDict(frozen=True)

    source: Literal["validation", "lint", "forge"]
    code: str
    severity: Literal["error", "warning"]
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
