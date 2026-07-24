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
from typing import Literal

from osrlib.core.monsters import MonsterCatalog, MonsterTemplate
from osrlib.core.rng import RngStream, RngStreamState
from osrlib.core.tables import EncounterTable
from osrlib.core.treasure import plan_treasure_ref
from osrlib.crawl.adventure import Adventure
from osrlib.crawl.dungeon import AreaSpec, KeyedEncounter, LevelSpec, TrapEffect, TrapSpec
from osrlib.crawl.stocking import stock_area
from osrlib.data import load_monsters
from pydantic import BaseModel, ConfigDict, Field

from osreditor.addresses import area_address
from osreditor.errors import AidTargetStockedError, OpTargetNotFoundError
from osreditor.ops import AnyEditOp, OpBatchResult, SetEncounter, SetTrap, SetTreasure
from osreditor.sidecar import StreamState

__all__ = [
    "STOCK_TRAP_PLACEHOLDER",
    "AidsStockRequest",
    "AidsStockResponse",
    "StockFollowUp",
    "StockOutcome",
    "StockRoll",
    "area_is_stocked",
    "derive_or_restore_stream",
    "effective_catalog",
    "mint_master_seed",
    "roll_area",
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


def _key_order(areas: list[AreaSpec]) -> list[AreaSpec]:
    """Key order: numeric ids numerically, then non-numeric ids lexicographically (the map's walk order)."""
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
    return _key_order([area for area in level.areas if not area_is_stocked(area)])


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
