"""The authoring aids: SRD stocking, the previews, and the prose assistant.

Three aids, one module, one philosophy: each applies its result as ordinary op
batches — undoable, editable, no special state. Stocking rolls a blank room's
contents from osrlib's stocking procedure and assembles the content ops; the
previews are pure reads over osrlib's generators and tables; the prose assistant
drafts read-aloud text through forge's provider seam. Stocking's reproducibility
rides the sidecar's seeded RNG (the master seed plus per-area stream snapshots);
the previews and prose hold no persisted state.

The stocking orchestration's *lock-holding* entry point is
[`DocumentService.apply_stock`][osreditor.documents.DocumentService.apply_stock] —
the roll and its commit are one atomic act. This module owns the pure parts: the
target predicate, the effective catalog, the per-area roll, and the seed/stream
derivation the service persists.
"""

import secrets
from dataclasses import dataclass
from typing import Annotated, Literal, cast

from osrforge.contracts.run import TokenUsage
from osrforge.errors import ProviderError, SchemaValidationError
from osrforge.providers.base import ModelProvider, ModelRequest, TextPart
from osrlib.core.classes import SavingThrows
from osrlib.core.dice import roll
from osrlib.core.items import Coins, MagicItemInstance, ValuableInstance
from osrlib.core.monsters import IdAllocator, MonsterCatalog, MonsterHitDice, MonsterTemplate
from osrlib.core.rng import RngStream, RngStreamState
from osrlib.core.tables import EncounterTable, monster_save_band_label, monster_xp, thac0_for_hd
from osrlib.core.treasure import generate_treasure, generate_unguarded_treasure, plan_treasure_ref
from osrlib.crawl.adventure import Adventure
from osrlib.crawl.dungeon import AreaSpec, KeyedEncounter, KeyedMonster, LevelSpec, TrapEffect, TrapSpec
from osrlib.crawl.stocking import stock_area
from osrlib.data import load_combat_tables, load_magic_items, load_monsters
from pydantic import BaseModel, ConfigDict, Field, model_validator

from osreditor.addresses import area_address
from osreditor.errors import AidTargetStockedError, OpTargetNotFoundError, ProviderRequestFailedError
from osreditor.ops import AnyEditOp, OpBatchResult, SetEncounter, SetTrap, SetTreasure
from osreditor.sidecar import StreamState

__all__ = [
    "PROSE_AREA_SYSTEM",
    "PROSE_HOOKS_SYSTEM",
    "STOCK_TRAP_PLACEHOLDER",
    "AidsPreviewRequest",
    "AidsPreviewResponse",
    "AidsProseRequest",
    "AidsProseResponse",
    "AidsStockRequest",
    "AidsStockResponse",
    "EncounterLineView",
    "EncounterPreviewRequest",
    "EncounterPreviewResponse",
    "MagicItemView",
    "ProseAreaResponse",
    "ProseAreaTarget",
    "ProseHooksResponse",
    "ProseHooksTarget",
    "StatblockPreviewRequest",
    "StatblockPreviewResponse",
    "StockFollowUp",
    "StockOutcome",
    "StockRoll",
    "TreasurePreviewRequest",
    "TreasurePreviewResponse",
    "TreasureSample",
    "ValuableView",
    "area_is_stocked",
    "build_area_facts",
    "build_area_prose_request",
    "build_hooks_facts",
    "build_hooks_prose_request",
    "derive_or_restore_stream",
    "effective_catalog",
    "key_order",
    "mint_master_seed",
    "preview_aid",
    "roll_area",
    "run_prose",
    "snapshot_stream",
    "stock_targets",
]


# The editor's placeholder for a stocking-rolled trap: the rules procedure ends at
# "this room holds a trap", so composing the trap is authoring surface, not rules.
# A room trap the author fills in — the one form that needs no restructuring to be
# legal (a treasure trap would demand a cache to sit on).
STOCK_TRAP_PLACEHOLDER = TrapSpec(
    kind="room",
    trigger="enter",
    affects="triggerer",
    effect=TrapEffect(manual="The stocking roll placed a trap here — describe its trigger and effect."),
)


def area_is_stocked(area: AreaSpec) -> bool:
    """Whether an area already holds authored content — the one target predicate.

    The authority the frontend's `isAreaStocked` mirrors: any of a non-empty
    description, an encounter, a trap, a treasure declaration, or a feature. A
    stocking roll fills only blank rooms, so a stocked area is never a target.

    Args:
        area: The area.

    Returns:
        True when the area carries any content.
    """
    return bool(area.description.strip() or area.encounter or area.trap or area.treasure or area.features)


def effective_catalog(adventure: Adventure) -> MonsterCatalog:
    """Compose the shipped catalog with the adventure's bundled templates.

    The same composition `GameSession.effective_monsters` performs — shipped
    first, then each bundled template whose id does not collide with a shipped
    one — so an authored override table naming a bundled monster resolves. The
    editor assembles the catalog rather than forking any rule; it is the same
    merge the frontend's `effectiveMonsterCatalog` already performs client-side.

    Args:
        adventure: The open document.

    Returns:
        The effective monster catalog.
    """
    base = load_monsters()
    seen = {template.id for template in base.monsters}
    accepted: list[MonsterTemplate] = []
    for template in adventure.monsters:
        if template.id not in seen:
            seen.add(template.id)
            accepted.append(template)
    if not accepted:
        return base
    return MonsterCatalog(monsters=(*base.monsters, *accepted))


class StockFollowUp(BaseModel):
    """One thing the dice left to the author — rendered as a report badge.

    `special` and `trap_design` name work the SRD leaves to the referee;
    `npc_party` carries the rolled kind and count (a party has no authorable
    content model, so it is a follow-up, never a silent re-roll that would
    distort the printed odds); `no_lair_treasure` means treasure was rolled but
    the monster's type yields no lair letters and no extra gp — reported, never
    backfilled from the unguarded band.
    """

    model_config = ConfigDict(frozen=True)

    kind: Literal["special", "npc_party", "trap_design", "no_lair_treasure"]
    npc_kind: Literal["basic", "expert"] | None = None
    npc_count: int | None = None


class StockRoll(BaseModel):
    """One target area's stocking result — what the report renders per room.

    `summary` holds module-notation lines (`"5 × acolyte"`, `"type C"`,
    `"unguarded"`); `follow_ups` the typed badges. The pair says what landed in
    the room and what the author still owes it.
    """

    model_config = ConfigDict(frozen=True)

    area_id: str
    address: str
    contents: Literal["empty", "monster", "special", "trap"]
    treasure_present: bool
    summary: tuple[str, ...] = ()
    follow_ups: tuple[StockFollowUp, ...] = ()


@dataclass(frozen=True)
class StockOutcome:
    """One area's roll, unpacked: the content ops to apply and the report row."""

    ops: tuple[AnyEditOp, ...]
    roll: StockRoll


class AidsStockRequest(BaseModel):
    """A stocking request: a single-room roll (`area_id` set) or a level sweep (`area_id=None`)."""

    model_config = ConfigDict(frozen=True)

    revision: str
    dungeon_id: str
    level_number: int = Field(ge=1)
    area_id: str | None = None


class AidsStockResponse(BaseModel):
    """The stocking answer: the per-target report and the ordinary batch result.

    `result` is `None` when no ops rolled (an all-empty sweep, or a single empty
    or special room) — the store consumes it exactly like an `/ops` response,
    and the revision does not bump.
    """

    model_config = ConfigDict(frozen=True)

    rolls: tuple[StockRoll, ...]
    result: OpBatchResult | None = None


def key_order(areas: list[AreaSpec]) -> list[AreaSpec]:
    """Key order: numeric ids numerically, then non-numeric ids lexicographically (the map's walk order).

    Shared by stocking's sweep targets and the content library's pack
    projection — both walk a level the way the map reads it.

    Args:
        areas: The areas to order.

    Returns:
        The areas in key order.
    """
    numeric = sorted((area for area in areas if area.id.isdigit()), key=lambda area: int(area.id))
    rest = sorted((area for area in areas if not area.id.isdigit()), key=lambda area: area.id)
    return [*numeric, *rest]


def stock_targets(level: LevelSpec, area_id: str | None) -> list[AreaSpec]:
    """Resolve a stocking request's target areas over an already-resolved level.

    A single-room request names one area: a missing area is the targeting miss,
    a stocked area is refused (the typed route enforces what the frontend never
    offers). A sweep (`area_id=None`) targets exactly the unstocked areas, in
    key order; a sweep with zero targets is legal and returns an empty list.

    Args:
        level: The resolved target level.
        area_id: The single area to roll, or `None` for a level sweep.

    Returns:
        The target areas.

    Raises:
        OpTargetNotFoundError: If the named single-room area is absent.
        AidTargetStockedError: If a single-room target already holds content.
    """
    if area_id is not None:
        for area in level.areas:
            if area.id == area_id:
                if area_is_stocked(area):
                    raise AidTargetStockedError(
                        f"area {area_id!r} already holds content — undo or clear it before rolling stocking"
                    )
                return [area]
        raise OpTargetNotFoundError(f"level {level.number} has no area {area_id!r}")
    return key_order([area for area in level.areas if not area_is_stocked(area)])


def mint_master_seed() -> str:
    """Mint a fresh stocking master seed — server entropy, decimal-string-encoded."""
    return str(secrets.randbits(64))


def derive_or_restore_stream(master_seed: str, address: str, snapshot: StreamState | None) -> RngStream:
    """A fresh area stream from the master seed, or the stored snapshot restored.

    A first roll derives from `(master_seed, "stock:<address>")` — the `stock:`
    namespace fences future stream kinds; a re-roll restores the advanced
    snapshot instead, so re-rolls are order-independent and never rewind.

    Args:
        master_seed: The decimal-string master seed.
        address: The area address (the stream key namespace).
        snapshot: The stored snapshot, or `None` for a first roll.

    Returns:
        The area's RNG stream.
    """
    if snapshot is None:
        return RngStream.from_seed_material(int(master_seed), f"stock:{address}")
    return RngStream.restore(RngStreamState(state=int(snapshot.state), inc=int(snapshot.inc)))


def snapshot_stream(stream: RngStream) -> StreamState:
    """Snapshot an advanced stream to the sidecar's decimal-string encoding."""
    state = stream.export_state()
    return StreamState(state=str(state.state), inc=str(state.inc))


def _lair_treasure(encounter: KeyedEncounter, catalog: MonsterCatalog) -> tuple[list[str], int]:
    """The keyed monsters' combined lair letters and extra gp — what the engine's hoard would draw."""
    letters: list[str] = []
    extra = 0
    for line in encounter.monsters:
        plan = plan_treasure_ref(catalog.get(line.template_id).treasure)
        for _ in range(plan.multiplier):
            letters.extend(plan.lair)
        extra += plan.extra_gp
    return letters, extra


def roll_area(
    dungeon_id: str,
    level_number: int,
    area: AreaSpec,
    catalog: MonsterCatalog,
    stream: RngStream,
    table: EncounterTable | None,
) -> StockOutcome:
    """Roll one area's contents and assemble its ops and report row.

    Advances `stream` in place (osrlib's `stock_area` draws from it). Emits a
    `SetEncounter` (with `hoard` from the roll) for a monster room, a
    `SetTreasure` for an empty or trap room's unguarded roll, and a `SetTrap`
    placeholder for a trap room; specials and empty rolls emit no ops.

    Args:
        dungeon_id: The target dungeon id.
        level_number: The target level number.
        area: The area being stocked.
        catalog: The effective monster catalog.
        stream: The area's RNG stream (advanced in place).
        table: The level's authored wandering table, or `None` for the band table.

    Returns:
        The ops to apply and the report row.
    """
    stocked = stock_area(level_number, catalog=catalog, stream=stream, table=table)
    address = area_address(dungeon_id, level_number, area.id)
    ops: list[AnyEditOp] = []
    summary: list[str] = []
    follow_ups: list[StockFollowUp] = []

    if stocked.npc_party is not None:
        follow_ups.append(
            StockFollowUp(kind="npc_party", npc_kind=stocked.npc_party.kind, npc_count=stocked.npc_party.count)
        )
        summary.append(f"NPC party ({stocked.npc_party.kind} × {stocked.npc_party.count})")
    elif stocked.encounter is not None:
        ops.append(
            SetEncounter(dungeon_id=dungeon_id, level_number=level_number, area_id=area.id, encounter=stocked.encounter)
        )
        for line in stocked.encounter.monsters:
            summary.append(f"{line.count_fixed} × {catalog.get(line.template_id).name}")
        if stocked.treasure_present:
            letters, extra = _lair_treasure(stocked.encounter, catalog)
            if letters:
                summary.append(f"type {', '.join(letters)}")
            elif extra:
                summary.append(f"{extra} gp")
            else:
                follow_ups.append(StockFollowUp(kind="no_lair_treasure"))
    elif stocked.contents == "trap":
        ops.append(
            SetTrap(dungeon_id=dungeon_id, level_number=level_number, area_id=area.id, trap=STOCK_TRAP_PLACEHOLDER)
        )
        follow_ups.append(StockFollowUp(kind="trap_design"))
    elif stocked.contents == "special":
        follow_ups.append(StockFollowUp(kind="special"))

    if stocked.treasure is not None:
        ops.append(
            SetTreasure(dungeon_id=dungeon_id, level_number=level_number, area_id=area.id, treasure=stocked.treasure)
        )
        summary.append("unguarded")

    roll = StockRoll(
        area_id=area.id,
        address=address,
        contents=stocked.contents,
        treasure_present=stocked.treasure_present,
        summary=tuple(summary),
        follow_ups=tuple(follow_ups),
    )
    return StockOutcome(ops=tuple(ops), roll=roll)


# ---------------------------------------------------------------------------
# Previews: pure reads over osrlib's generators and tables — treasure sample
# hoards, encounter stat tables with sampled counts and XP, and the phase 4
# derive-from-HD helpers. No revision, no document mutation, no sidecar contact.
# ---------------------------------------------------------------------------


class TreasurePreviewRequest(BaseModel):
    """Preview N example hoards from treasure letters, or an unguarded band."""

    model_config = ConfigDict(frozen=True)

    kind: Literal["treasure"] = "treasure"
    letters: tuple[str, ...] = ()
    unguarded_level: int | None = None
    tier: Literal["basic", "expert"] = "basic"
    samples: int = Field(default=3, ge=1, le=10)
    seed: str | None = None

    @model_validator(mode="after")
    def _letters_xor_unguarded(self) -> TreasurePreviewRequest:
        if bool(self.letters) == (self.unguarded_level is not None):
            raise ValueError("a treasure preview names letters or an unguarded level, not both or neither")
        return self


class EncounterPreviewRequest(BaseModel):
    """Preview a keyed encounter's stat table with sampled counts and XP totals."""

    model_config = ConfigDict(frozen=True)

    kind: Literal["encounter"] = "encounter"
    encounter: KeyedEncounter
    samples: int = Field(default=3, ge=1, le=10)
    seed: str | None = None


class StatblockPreviewRequest(BaseModel):
    """Derive a monster's XP, attack values, and saves from its hit dice (phase 4's deferral)."""

    model_config = ConfigDict(frozen=True)

    kind: Literal["statblock"] = "statblock"
    hit_dice: MonsterHitDice


AidsPreviewRequest = Annotated[
    TreasurePreviewRequest | EncounterPreviewRequest | StatblockPreviewRequest,
    Field(discriminator="kind"),
]
"""Any preview request, discriminated by `kind`."""


class ValuableView(BaseModel):
    """One generated gem or jewellery, resolved for display."""

    model_config = ConfigDict(frozen=True)

    name: str
    kind: Literal["gem", "jewellery"]
    value_gp: int


class MagicItemView(BaseModel):
    """One generated magic item, its template id resolved to a display name."""

    model_config = ConfigDict(frozen=True)

    template_id: str
    name: str
    quantity: int
    charges_remaining: int | None = None


class TreasureSample(BaseModel):
    """One example hoard: coins, valuables, magic items, and the total gp value."""

    model_config = ConfigDict(frozen=True)

    coins: Coins
    valuables: tuple[ValuableView, ...]
    magic_items: tuple[MagicItemView, ...]
    total_gp: int


class TreasurePreviewResponse(BaseModel):
    """N example hoards generated from the request."""

    model_config = ConfigDict(frozen=True)

    kind: Literal["treasure"] = "treasure"
    samples: tuple[TreasureSample, ...]


class EncounterLineView(BaseModel):
    """One encounter line, resolved against the effective catalog with sampled counts.

    `resolution` is `unresolved` for a dangling id (diagnostics-legal, previewed
    as such, never an error); the stat fields are `None` there. `sampled_counts`
    holds one rolled count per sample.
    """

    model_config = ConfigDict(frozen=True)

    template_id: str
    name: str
    resolution: Literal["shipped", "bundled", "unresolved"]
    ac: int | None = None
    ac_ascending: int | None = None
    hit_dice: MonsterHitDice | None = None
    thac0: int | None = None
    attack_bonus: int | None = None
    movement: str = ""
    morale: int | None = None
    xp: int | None = None
    number_appearing: str = ""
    sampled_counts: tuple[int, ...] = ()


class EncounterPreviewResponse(BaseModel):
    """The encounter's resolved lines and per-sample XP totals."""

    model_config = ConfigDict(frozen=True)

    kind: Literal["encounter"] = "encounter"
    lines: tuple[EncounterLineView, ...]
    sample_xp_totals: tuple[int, ...]


class StatblockPreviewResponse(BaseModel):
    """The derived stat-block values for a monster's hit dice."""

    model_config = ConfigDict(frozen=True)

    kind: Literal["statblock"] = "statblock"
    xp: int
    thac0: int
    attack_bonus: int
    save_band: str
    saves: SavingThrows


AidsPreviewResponse = Annotated[
    TreasurePreviewResponse | EncounterPreviewResponse | StatblockPreviewResponse,
    Field(discriminator="kind"),
]
"""Any preview response, discriminated by `kind`."""


def _preview_master(seed: str | None) -> int:
    """The preview's base seed — the request's when set (reproducible test surface), else server entropy."""
    return int(seed) if seed else secrets.randbits(64)


def _format_movement(template: MonsterTemplate) -> str:
    """The base and encounter movement rates in module notation, e.g. `120' (40')`."""
    if not template.movement:
        return ""
    rate = template.movement[0]
    return f"{rate.rate_feet}' ({rate.encounter_rate_feet}')"


def _format_number_appearing(template: MonsterTemplate) -> str:
    """The dungeon number-appearing in module notation — the dice, the fixed count, or a referral."""
    dungeon = template.number_appearing.dungeon
    if dungeon.see_below:
        return "see below"
    return dungeon.dice if dungeon.dice is not None else str(dungeon.fixed)


def _preview_treasure(request: TreasurePreviewRequest) -> TreasurePreviewResponse:
    """Generate N example hoards — each letter set (or the unguarded band) on a fresh stream."""
    master = _preview_master(request.seed)
    magic = load_magic_items()
    samples: list[TreasureSample] = []
    for index in range(request.samples):
        stream = RngStream.from_seed_material(master, f"preview:treasure:{index}")
        allocator = IdAllocator()
        coins = Coins()
        valuables: list[ValuableInstance] = []
        magic_items: list[MagicItemInstance] = []
        if request.unguarded_level is not None:
            generated = [
                generate_unguarded_treasure(
                    request.unguarded_level, tier=request.tier, stream=stream, allocator=allocator
                )
            ]
        else:
            generated = [
                generate_treasure(letter, tier=request.tier, stream=stream, allocator=allocator)
                for letter in request.letters
            ]
        for hoard in generated:
            coins = _add_coins(coins, hoard.coins)
            valuables.extend(hoard.valuables)
            magic_items.extend(hoard.magic_items)
        total_gp = coins.value_gp + sum(valuable.value_gp for valuable in valuables)
        samples.append(
            TreasureSample(
                coins=coins,
                valuables=tuple(
                    ValuableView(name=valuable.name, kind=valuable.kind, value_gp=valuable.value_gp)
                    for valuable in valuables
                ),
                magic_items=tuple(
                    MagicItemView(
                        template_id=item.template_id,
                        name=magic.get(item.template_id).name,
                        quantity=item.quantity,
                        charges_remaining=item.charges_remaining,
                    )
                    for item in magic_items
                ),
                total_gp=total_gp,
            )
        )
    return TreasurePreviewResponse(samples=tuple(samples))


def _add_coins(left: Coins, right: Coins) -> Coins:
    """Sum two coin piles denomination-wise."""
    return Coins(
        pp=left.pp + right.pp,
        gp=left.gp + right.gp,
        ep=left.ep + right.ep,
        sp=left.sp + right.sp,
        cp=left.cp + right.cp,
    )


def _preview_encounter(request: EncounterPreviewRequest, adventure: Adventure) -> EncounterPreviewResponse:
    """Resolve each line against the effective catalog, sample counts, and total per-sample XP."""
    master = _preview_master(request.seed)
    catalog = effective_catalog(adventure)
    shipped_ids = {template.id for template in load_monsters().monsters}
    lines: list[EncounterLineView] = []
    for index, line in enumerate(request.encounter.monsters):
        counts = _sample_counts(line, master, index, request.samples)
        try:
            template = catalog.get(line.template_id)
        except ValueError:
            lines.append(
                EncounterLineView(
                    template_id=line.template_id,
                    name=line.template_id,
                    resolution="unresolved",
                    sampled_counts=counts,
                )
            )
            continue
        resolution: Literal["shipped", "bundled", "unresolved"] = (
            "shipped" if line.template_id in shipped_ids else "bundled"
        )
        lines.append(
            EncounterLineView(
                template_id=line.template_id,
                name=template.name,
                resolution=resolution,
                ac=template.ac,
                ac_ascending=template.ac_ascending,
                hit_dice=template.hit_dice,
                thac0=template.thac0,
                attack_bonus=template.attack_bonus,
                movement=_format_movement(template),
                morale=template.morale,
                xp=template.xp,
                number_appearing=_format_number_appearing(template),
                sampled_counts=counts,
            )
        )
    sample_xp_totals = tuple(
        sum((line.xp or 0) * line.sampled_counts[index] for line in lines) for index in range(request.samples)
    )
    return EncounterPreviewResponse(lines=tuple(lines), sample_xp_totals=sample_xp_totals)


def _sample_counts(line: KeyedMonster, master: int, line_index: int, samples: int) -> tuple[int, ...]:
    """One count per sample: the fixed count repeated, or the line's dice rolled once per sample.

    Keyed by line position so two lines sharing a template id sample independently.
    """
    if line.count_fixed is not None:
        return (line.count_fixed,) * samples
    assert line.count_dice is not None  # the line model guarantees exactly one count form
    counts: list[int] = []
    for index in range(samples):
        stream = RngStream.from_seed_material(master, f"preview:count:{line_index}:{index}")
        counts.append(max(1, roll(line.count_dice, stream).total))
    return tuple(counts)


def _preview_statblock(request: StatblockPreviewRequest) -> StatblockPreviewResponse:
    """Derive XP, the THAC0/attack-bonus pair, and the save band — pure over the shipped tables."""
    combat = load_combat_tables()
    hit_dice = request.hit_dice
    thac0, attack_bonus = thac0_for_hd(hit_dice.count, bonus_modifier=hit_dice.modifier > 0)
    label = monster_save_band_label(hit_dice)
    return StatblockPreviewResponse(
        xp=monster_xp(combat, hit_dice),
        thac0=thac0,
        attack_bonus=attack_bonus,
        save_band=label,
        saves=combat.save_band(label).saves,
    )


def preview_aid(request: AidsPreviewRequest, adventure: Adventure) -> AidsPreviewResponse:
    """Dispatch a preview request — pure over osrlib's generators and tables.

    Args:
        request: The discriminated preview request.
        adventure: The open document (read for the effective catalog on encounter
            previews; unused by the treasure and statblock kinds).

    Returns:
        The per-kind preview response.
    """
    if isinstance(request, TreasurePreviewRequest):
        return _preview_treasure(request)
    if isinstance(request, EncounterPreviewRequest):
        return _preview_encounter(request, adventure)
    return _preview_statblock(request)


# ---------------------------------------------------------------------------
# The prose assistant: draft read-aloud text through forge's provider seam.
# Requests follow forge's house pattern — module-constant system prompts, a
# single TextPart of canonically ordered facts (the fingerprint is the fixture
# key), and schema-forced JSON. Acceptance is entirely client-side.
# ---------------------------------------------------------------------------

PROSE_AREA_SYSTEM = (
    "You draft the read-aloud description a referee speaks when the party enters a keyed dungeon room. "
    "Write in the second person, present tense, evocative but concise — two to four sentences. "
    "Describe only what the facts state: the room, its named monsters (as atmosphere, never as a stat block), "
    "any treasure or trap as sensory hints, not mechanics. Never invent monsters, treasure, exits, or numbers "
    "the facts do not give. Do not restate dice, hit dice, or rules. Return the description as JSON."
)

PROSE_HOOKS_SYSTEM = (
    "You draft the adventure hooks that draw a party to an adventure — rumors, jobs, and reasons to delve. "
    "Each hook is one or two sentences a referee can drop into a tavern or a patron's offer. Ground every hook "
    "in the stated facts (the adventure, its town, its dungeons); never invent places, factions, or rewards "
    "the facts do not give. Preserve the sense of any existing hooks worth keeping and return the complete "
    "replacement list as JSON — the accepted list replaces the current one wholesale."
)

PROSE_AREA_TAG = "prose.area-description"
PROSE_HOOKS_TAG = "prose.hooks"

_AREA_SCHEMA: dict[str, object] = {
    "type": "object",
    "properties": {"description": {"type": "string"}},
    "required": ["description"],
    "additionalProperties": False,
}

_HOOKS_SCHEMA: dict[str, object] = {
    "type": "object",
    "properties": {"hooks": {"type": "array", "items": {"type": "string"}}},
    "required": ["hooks"],
    "additionalProperties": False,
}


class ProseAreaTarget(BaseModel):
    """Draft a keyed area's read-aloud description."""

    model_config = ConfigDict(frozen=True)

    kind: Literal["area"] = "area"
    dungeon_id: str
    level_number: int = Field(ge=1)
    area_id: str


class ProseHooksTarget(BaseModel):
    """Draft the adventure's hooks — the complete replacement list."""

    model_config = ConfigDict(frozen=True)

    kind: Literal["hooks"] = "hooks"


AidsProseRequest = Annotated[ProseAreaTarget | ProseHooksTarget, Field(discriminator="kind")]
"""Any prose request, discriminated by `kind`."""


class ProseAreaResponse(BaseModel):
    """An area description draft, with the call's token usage and model id."""

    model_config = ConfigDict(frozen=True)

    kind: Literal["area"] = "area"
    description: str
    usage: TokenUsage
    model_id: str


class ProseHooksResponse(BaseModel):
    """A hooks draft (the complete replacement list), with usage and model id."""

    model_config = ConfigDict(frozen=True)

    kind: Literal["hooks"] = "hooks"
    hooks: tuple[str, ...]
    usage: TokenUsage
    model_id: str


AidsProseResponse = Annotated[ProseAreaResponse | ProseHooksResponse, Field(discriminator="kind")]
"""Any prose response, discriminated by `kind`."""


def _encounter_facts(encounter: KeyedEncounter | None, catalog: MonsterCatalog) -> str:
    """Resolved encounter lines in module notation, or `(none)`."""
    if encounter is None:
        return "(none)"
    parts: list[str] = []
    for line in encounter.monsters:
        try:
            name = catalog.get(line.template_id).name
        except ValueError:
            name = line.template_id
        count = str(line.count_fixed) if line.count_fixed is not None else line.count_dice
        parts.append(f"{count} × {name}")
    return ", ".join(parts)


def _treasure_facts(area: AreaSpec, level_number: int) -> str:
    """The area's treasure declaration in module notation, or `(none)`."""
    if area.treasure is None:
        return "(none)"
    if area.treasure.unguarded:
        return f"unguarded (dungeon level {level_number})"
    return f"types {', '.join(area.treasure.letters)}"


def _feature_facts(area: AreaSpec) -> str:
    """The area's features as `id (kind)` lines, or `(none)`."""
    if not area.features:
        return "(none)"
    return ", ".join(f"{feature.id} ({feature.kind})" for feature in area.features)


def build_area_facts(adventure: Adventure, dungeon_id: str, level_number: int, area_id: str) -> str:
    """Assemble a keyed area's facts as canonically ordered text — the request's one TextPart.

    Deterministic serialization: the same document state yields the same facts,
    so a recorded fixture keys off a stable fingerprint.

    An unnamed entity reads as `(unnamed)`, never as its internal id: the model
    is instructed to mention only stated facts, so anything stated here can land
    verbatim in player-facing prose, and a slug like `dungeon-1` in read-aloud
    text is a defect. The area *key* is the one identifier that belongs — it is
    printed-module notation, not an internal handle.

    Args:
        adventure: The open document.
        dungeon_id: The target dungeon id.
        level_number: The target level number.
        area_id: The target area id.

    Returns:
        The facts text.

    Raises:
        OpTargetNotFoundError: If the dungeon, level, or area is absent.
    """
    catalog = effective_catalog(adventure)
    for dungeon in adventure.dungeons:
        if dungeon.id != dungeon_id:
            continue
        for level in dungeon.levels:
            if level.number != level_number:
                continue
            for area in level.areas:
                if area.id != area_id:
                    continue
                lines = [
                    f"Adventure: {adventure.name}",
                    f"Adventure description: {adventure.description or '(none)'}",
                    f"Dungeon: {dungeon.name or '(unnamed)'}",
                    f"Level: {level_number}",
                    f"Area key: {area_id}",
                    f"Area name: {area.name or '(unnamed)'}",
                    f"Existing description: {area.description or '(none)'}",
                    f"Monsters: {_encounter_facts(area.encounter, catalog)}",
                    f"Treasure: {_treasure_facts(area, level_number)}",
                    f"Trap: {'present' if area.trap is not None else '(none)'}",
                    f"Features: {_feature_facts(area)}",
                ]
                return "\n".join(lines)
            raise OpTargetNotFoundError(f"dungeon {dungeon_id!r} level {level_number} has no area {area_id!r}")
        raise OpTargetNotFoundError(f"dungeon {dungeon_id!r} has no level {level_number}")
    raise OpTargetNotFoundError(f"the document has no dungeon {dungeon_id!r}")


def build_hooks_facts(adventure: Adventure) -> str:
    """Assemble the adventure's hook facts as canonically ordered text."""
    town = adventure.town
    dungeon_names = ", ".join(dungeon.name or "(unnamed)" for dungeon in adventure.dungeons) or "(none)"
    services = ", ".join(town.services) or "(none)"
    existing = "\n".join(f"- {hook}" for hook in adventure.hooks) if adventure.hooks else "(none)"
    return "\n".join(
        [
            f"Adventure: {adventure.name}",
            f"Adventure description: {adventure.description or '(none)'}",
            f"Town: {town.name or '(unnamed)'} — services: {services}",
            f"Dungeons: {dungeon_names}",
            "Existing hooks:",
            existing,
        ]
    )


def build_area_prose_request(facts: str) -> ModelRequest:
    """Build the area-description request — the pure path the route and the recorder share."""
    return ModelRequest(
        tag=PROSE_AREA_TAG, system=PROSE_AREA_SYSTEM, parts=(TextPart(text=facts),), schema=_AREA_SCHEMA
    )


def build_hooks_prose_request(facts: str) -> ModelRequest:
    """Build the hooks request — the pure path the route and the recorder share."""
    return ModelRequest(
        tag=PROSE_HOOKS_TAG, system=PROSE_HOOKS_SYSTEM, parts=(TextPart(text=facts),), schema=_HOOKS_SCHEMA
    )


def run_prose(target: AidsProseRequest, adventure: Adventure, provider: ModelProvider) -> AidsProseResponse:
    """Assemble facts, build the request, generate, and shape the draft response.

    The provider call is synchronous; the caller builds the provider (a 422 when
    unconfigured) and holds no lock across the generate. A failed generate maps
    to `ProviderRequestFailedError` (502) with forge's message verbatim.

    Args:
        target: The discriminated prose target.
        adventure: The open document (a snapshot the caller read under the lock).
        provider: The resolved model provider.

    Returns:
        The per-kind prose response with the draft, token usage, and model id.

    Raises:
        OpTargetNotFoundError: If an area target names an absent dungeon/level/area.
        ProviderRequestFailedError: If the generate call fails upstream.
    """
    if isinstance(target, ProseAreaTarget):
        request = build_area_prose_request(
            build_area_facts(adventure, target.dungeon_id, target.level_number, target.area_id)
        )
    else:
        request = build_hooks_prose_request(build_hooks_facts(adventure))
    try:
        response = provider.generate(request)
    except (ProviderError, SchemaValidationError) as error:
        raise ProviderRequestFailedError(str(error)) from error
    data = cast(dict[str, object], response.data)  # schema-forced JSON object; the provider validated it
    if isinstance(target, ProseAreaTarget):
        return ProseAreaResponse(description=str(data["description"]), usage=response.usage, model_id=response.model_id)
    hooks = cast(list[object], data["hooks"])
    return ProseHooksResponse(
        hooks=tuple(str(hook) for hook in hooks), usage=response.usage, model_id=response.model_id
    )
