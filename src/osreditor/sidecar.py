"""The `editor.json` sidecar: models, load, and the artifact name.

The sidecar is editor-only data beside the deliverable — provenance, view
state, per-entity author notes, forge review marks, and the machine-draft
reason ledger. It lives in its own module because both the project layer
(create, open, detach) and the document service (the note cascade, the forge
commit protocol's `auto_reasons`) consume it, and the service must not import
the project layer.
"""

import json
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, JsonValue, StringConstraints, ValidationError

from osreditor.errors import ArtifactNotFoundError, DocumentPayloadInvalidError
from osreditor.store import ProjectStore

__all__ = [
    "SIDECAR_ARTIFACT",
    "SIDECAR_SCHEMA_VERSION",
    "AnySidecarPatch",
    "CopyRecord",
    "DismissFlag",
    "EditorSidecar",
    "RecordCopy",
    "RemoveNote",
    "RemoveStashPack",
    "ReviewMark",
    "SetNote",
    "SetStockingSeed",
    "SetViewState",
    "SidecarProvenance",
    "StashedPack",
    "StockingState",
    "StreamState",
    "UndismissFlag",
    "ViewState",
    "ZoomPan",
    "apply_sidecar_patches",
    "load_sidecar",
]

SIDECAR_ARTIFACT = "editor.json"
SIDECAR_SCHEMA_VERSION = 1


class SidecarProvenance(BaseModel):
    """Who created the project and against which engine — written once at create.

    `source_workdir` and `osrforge_version` are the detach record: the workdir
    a detached project came from and the forge version (from the workdir's
    `RunMeta`) that converted it. Additive and optional — a created-from-scratch
    project has no conversion to record.
    """

    model_config = ConfigDict(frozen=True)

    created_by: str
    osrlib_version: str
    created_at: str
    source_workdir: str | None = None
    osrforge_version: str | None = None


class ZoomPan(BaseModel):
    """One level's persisted camera: zoom factor plus pan offset in canvas pixels."""

    model_config = ConfigDict(frozen=True)

    zoom: float
    pan_x: float
    pan_y: float


class ViewState(BaseModel):
    """Where a session left off: the active level, per-level cameras, the review queue's selected row.

    `zoom_pan` is keyed by the level address (the diagnostics address grammar);
    `review_selection` is the selected review row's address, `""` for the
    module-scope row, `None` when no row is selected. Writes coalesce on the
    frontend — navigation transitions, never per pointer frame.
    """

    model_config = ConfigDict(frozen=True)

    active_dungeon_id: str | None = None
    active_level_number: int | None = None
    zoom_pan: dict[str, ZoomPan] = {}
    review_selection: str | None = None


class ReviewMark(BaseModel):
    """One dismissed review flag: the area address (`""` for module scope) and the exact flag string.

    Keyed by the exact flag string so a mark survives re-assembly for as long
    as the flag it answered does, and goes dormant with the flag when a
    correction clears it. Forge-only; the report's flags have no native
    counterpart.
    """

    model_config = ConfigDict(frozen=True)

    address: str
    flag: str


class StreamState(BaseModel):
    """One stocking stream's PCG64 snapshot, both fields decimal-string-encoded.

    Mirrors osrlib's `RngStreamState` (`state`, `inc`), but the two 128-bit
    integers ride as decimal strings: the sidecar echoes into JavaScript on
    every op result, and a number above 2^53 loses precision silently there.
    A lossless-by-construction field beats one that is safe only while nobody
    reads it back.
    """

    model_config = ConfigDict(frozen=True)

    state: str
    inc: str


class StockingState(BaseModel):
    """The reproducible-stocking seed: the master seed and per-area stream snapshots.

    `master_seed` is minted once (server entropy) at the first stocking use and
    persisted before the first draw; `streams` holds one advanced snapshot per
    stocked area, keyed by the area address (the `notes` pattern). Per-address
    streams make re-rolls order-independent — re-rolling one room never changes
    what another would roll — and the master seed lets an identical action
    sequence reproduce byte-identical documents. Decimal-string-encoded
    (`master_seed` too, since `secrets.randbits(64)` exceeds 2^53).
    """

    model_config = ConfigDict(frozen=True)

    master_seed: str | None = None
    streams: dict[str, StreamState] = {}


class StashedPack(BaseModel):
    """One stash entry: a stamped content-pack document with its listing identity beside it.

    `document` is `ContentPack.to_document()`'s output verbatim — the sidecar's
    one content-bearing field, the owner-sanctioned posture change the spec
    records. `pack_id` and `label` deliberately duplicate the envelope's
    payload: the panel lists stash packs without parsing every stamped
    document, and a pack a newer engine stamped — which the vetting open must
    refuse — can still be *named* in the listing with the upgrade remedy
    instead of vanishing. Drift is impossible because stash packs are
    immutable: created by the stash act, deleted by the patch, never edited.
    """

    model_config = ConfigDict(frozen=True)

    pack_id: str
    label: str
    created_at: str
    document: JsonValue


class CopyRecord(BaseModel):
    """One copy act's record: which pack, and which of its entries, landed on the keyed address.

    `pack_entry_id` is the entry id for a room drop and the section id for a
    wandering copy. A record is a record of the copy *act*: undoing the drop
    does not remove it — used means at least once — and records survive their
    pack's deletion, so a re-minted stash id must never reuse a dead one.
    """

    model_config = ConfigDict(frozen=True)

    pack_identity: str
    pack_entry_id: str


class EditorSidecar(BaseModel):
    """The `editor.json` envelope: editor-only data beside the deliverable.

    The envelope is a shipped contract, additive-only within its schema
    version. Phase 1 wrote only provenance; phase 5 grows `view_state`,
    per-entity `notes`, forge `review` marks, and `auto_reasons`; phase 7 grows
    `stocking`, the reproducible-stocking seed — absent fields default empty, so
    every existing sidecar and every foreign project reads clean. `provenance`
    is optional (an additive relaxation: a required field made optional never
    breaks an existing reader) because a foreign project the editor merely opens
    has no provenance to claim; its first note persists a sidecar with
    `provenance=None`, honest about what the editor did and didn't author.

    Open tolerates a missing sidecar (foreign native projects open fine); the
    file is written on the first sidecar-bearing write, never at open. `notes`
    and `stocking.streams` are keyed by the diagnostics address grammar and
    exist for both project types; `review` and `auto_reasons` are forge-only —
    `auto_reasons` holds the kind-qualified override-entry keys whose reason is
    still a machine draft, and rides the forge undo stack with the
    `overrides.yaml` snapshot (derived state of the same commit).

    Phase 11 grows the content library's three fields. `stash` holds the
    displaced-content packs (the whole sidecar rides every op result; stash
    packs are level-sized projections over localhost JSON, an accepted and
    noted weight). `stash_counter` mints `stash-<n>` monotonically — next-free
    minting would be wrong, because copy records outlive pack deletion by
    design and a re-minted id would inherit a dead pack's badges. `copies` is
    the third addressed map, keyed by *target* address (area address for room
    drops, level address for wandering copies); its keys cascade in lockstep
    with `notes` and `stocking.streams`, its records never ride the undo stack.
    """

    model_config = ConfigDict(frozen=True)

    schema_version: int = SIDECAR_SCHEMA_VERSION
    provenance: SidecarProvenance | None = None
    view_state: ViewState = ViewState()
    notes: dict[str, str] = {}
    review: tuple[ReviewMark, ...] = ()
    auto_reasons: tuple[str, ...] = ()
    stocking: StockingState = StockingState()
    stash: tuple[StashedPack, ...] = ()
    stash_counter: int = 0
    copies: dict[str, tuple[CopyRecord, ...]] = {}


class SetViewState(BaseModel):
    """Replace the view state whole — the frontend flushes on navigation transitions."""

    model_config = ConfigDict(frozen=True)

    action: Literal["set_view_state"] = "set_view_state"
    view_state: ViewState


class SetNote(BaseModel):
    """Set one entity's author note by address."""

    model_config = ConfigDict(frozen=True)

    action: Literal["set_note"] = "set_note"
    address: Annotated[str, StringConstraints(min_length=1)]
    text: Annotated[str, StringConstraints(min_length=1)]


class RemoveNote(BaseModel):
    """Remove one entity's author note by address."""

    model_config = ConfigDict(frozen=True)

    action: Literal["remove_note"] = "remove_note"
    address: Annotated[str, StringConstraints(min_length=1)]


class DismissFlag(BaseModel):
    """Dismiss one review flag: the `{address, flag}` mark grain (`""` for module scope)."""

    model_config = ConfigDict(frozen=True)

    action: Literal["dismiss_flag"] = "dismiss_flag"
    address: str
    flag: Annotated[str, StringConstraints(min_length=1)]


class UndismissFlag(BaseModel):
    """Withdraw one dismissal mark."""

    model_config = ConfigDict(frozen=True)

    action: Literal["undismiss_flag"] = "undismiss_flag"
    address: str
    flag: Annotated[str, StringConstraints(min_length=1)]


class SetStockingSeed(BaseModel):
    """Set the stocking master seed and clear derived stream states.

    Typed API surface with no dialog UI (the fixtures-kind precedent): the e2e
    suite's determinism lever, and a reproducible-stocking lever for anyone
    scripting the API. Clearing `streams` is mandatory — states derived from the
    old seed are meaningless under the new one.
    """

    model_config = ConfigDict(frozen=True)

    action: Literal["set_stocking_seed"] = "set_stocking_seed"
    master_seed: Annotated[str, StringConstraints(pattern=r"^[0-9]+$")]


class RecordCopy(BaseModel):
    """Record one copy act onto a target address — append-with-dedupe, annotation by nature."""

    model_config = ConfigDict(frozen=True)

    action: Literal["record_copy"] = "record_copy"
    address: Annotated[str, StringConstraints(min_length=1)]
    pack_identity: Annotated[str, StringConstraints(min_length=1)]
    pack_entry_id: Annotated[str, StringConstraints(min_length=1)]


class RemoveStashPack(BaseModel):
    """Delete one stash pack by id.

    On the unguarded channel by the same owner sanction the spec records: the
    409 discipline protects the deliverable, the stash is a recovery buffer,
    and git remains the cross-session net. The frontend fronts this with a
    destructive-action confirm naming what is discarded. Copy records naming
    the deleted pack stay — they record acts, not links.
    """

    model_config = ConfigDict(frozen=True)

    action: Literal["remove_stash_pack"] = "remove_stash_pack"
    pack_id: Annotated[str, StringConstraints(min_length=1)]


AnySidecarPatch = Annotated[
    SetViewState | SetNote | RemoveNote | DismissFlag | UndismissFlag | SetStockingSeed | RecordCopy | RemoveStashPack,
    Field(discriminator="action"),
]
"""Any sidecar patch, discriminated by `action`."""


def apply_sidecar_patches(sidecar: EditorSidecar, patches: tuple[AnySidecarPatch, ...]) -> EditorSidecar:
    """Fold typed patches into a new sidecar value — pure; the service persists.

    Deliberately tolerant where the document's 409 discipline is strict:
    annotation state is single-user, last-write-wins — removing an absent note
    or re-dismissing a dismissed flag is a no-op, never an error.

    Args:
        sidecar: The current sidecar.
        patches: The patches, in order.

    Returns:
        The new sidecar value.
    """
    view_state = sidecar.view_state
    notes = dict(sidecar.notes)
    review = list(sidecar.review)
    stocking = sidecar.stocking
    stash = list(sidecar.stash)
    copies = dict(sidecar.copies)
    for patch in patches:
        if isinstance(patch, SetViewState):
            view_state = patch.view_state
        elif isinstance(patch, SetNote):
            notes[patch.address] = patch.text
        elif isinstance(patch, RemoveNote):
            notes.pop(patch.address, None)
        elif isinstance(patch, DismissFlag):
            mark = ReviewMark(address=patch.address, flag=patch.flag)
            if mark not in review:
                review.append(mark)
        elif isinstance(patch, UndismissFlag):
            review = [mark for mark in review if not (mark.address == patch.address and mark.flag == patch.flag)]
        elif isinstance(patch, RecordCopy):
            # Append-with-dedupe: re-dropping is allowed, an identical triple
            # never doubles — used means at least once.
            record = CopyRecord(pack_identity=patch.pack_identity, pack_entry_id=patch.pack_entry_id)
            existing = copies.get(patch.address, ())
            if record not in existing:
                copies[patch.address] = (*existing, record)
        elif isinstance(patch, RemoveStashPack):
            stash = [pack for pack in stash if pack.pack_id != patch.pack_id]
        else:
            # A new master seed retires every stream derived from the old one.
            stocking = StockingState(master_seed=patch.master_seed)
    return sidecar.model_copy(
        update={
            "view_state": view_state,
            "notes": notes,
            "review": tuple(review),
            "stocking": stocking,
            "stash": tuple(stash),
            "copies": copies,
        }
    )


def load_sidecar(store: ProjectStore, project_id: str) -> EditorSidecar:
    """Load a project's sidecar; a missing file is the empty sidecar.

    A malformed sidecar fails the open rather than silently starting empty:
    the sidecar holds author notes — user data, not a convenience cache — and
    the first sidecar-bearing write would otherwise destroy whatever the
    malformed file held.

    Args:
        store: The store to read through.
        project_id: The project to read.

    Returns:
        The parsed sidecar, or `EditorSidecar()` when the project has none.

    Raises:
        DocumentPayloadInvalidError: If `editor.json` exists but does not
            parse as the sidecar contract.
    """
    try:
        data = store.read_artifact(project_id, SIDECAR_ARTIFACT)
    except ArtifactNotFoundError:
        return EditorSidecar()
    try:
        return EditorSidecar.model_validate(json.loads(data))
    except (ValueError, ValidationError) as error:
        raise DocumentPayloadInvalidError(
            f"the editor sidecar ({SIDECAR_ARTIFACT}) is malformed: {error}",
            errors=[{"path": "", "message": str(error)}],
        ) from error
