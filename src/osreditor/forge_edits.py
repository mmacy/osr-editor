"""Override-level edits: monster remaps, printed-notation stat-block patches, reason editing, entry removal.

Not every correction is an op translation. Monster remaps and stat-block patches
address extracted *names* (not document addresses), and reason editing addresses
the overrides file itself. One revision-guarded route carries them as a batch of
typed, discriminated edits, applied through the same commit protocol as a
translated op batch — snapshot, write, assemble, refresh, one undo step.

Exclusivity is resolved here, at the edit: committing a remap for a name deletes
any template patch for the same normalized name and vice versa — one correction
per name, never forge's contradictory-corrections error discovered at assemble.
Everything else forge validates at assembly (an unknown name, a `statblocks.json`
cache-state failure) surfaces through the commit protocol with forge's message
verbatim.
"""

from typing import Annotated, Literal

from osrforge.contracts.overrides import (
    MonsterOverride,
    Overrides,
    StatBlockOverride,
)
from osrforge.contracts.stages import AcNotation
from osrforge.monsters import normalize_monster_name
from pydantic import BaseModel, ConfigDict, Field

from osreditor.errors import OpTargetNotFoundError
from osreditor.overrides import auto_reason_key

__all__ = [
    "AnyOverrideEdit",
    "OverrideEditBatch",
    "RemoveEntry",
    "RemoveMonsterRemap",
    "RemoveTemplatePatch",
    "SetMonsterRemap",
    "SetReason",
    "SetTemplatePatch",
    "StatBlockPatch",
    "apply_overrides_edits",
]

# The override kinds a reason edit or entry removal can address.
OverrideKind = Literal["monsters", "monster_templates", "areas", "geometry", "town", "module"]


class SetMonsterRemap(BaseModel):
    """Remap an extracted monster name to a catalog (or emitted custom) template."""

    model_config = ConfigDict(frozen=True)

    edit: Literal["set_monster_remap"] = "set_monster_remap"
    name: str
    template_id: str
    reason: str | None = None


class RemoveMonsterRemap(BaseModel):
    """Drop a monster remap by extracted name."""

    model_config = ConfigDict(frozen=True)

    edit: Literal["remove_monster_remap"] = "remove_monster_remap"
    name: str


class StatBlockPatch(BaseModel):
    """Forge's `StatBlockOverride` shape minus `reason`: printed notation, corrected pre-mapping.

    Absent means untouched; explicit `null` clears the field back to unprinted —
    the same semantics forge honors, carried through the request unchanged.
    """

    model_config = ConfigDict(frozen=True)

    ac: str | None = None
    ac_notation: AcNotation | None = None
    thac0: str | None = None
    hit_dice: str | None = None
    class_level: str | None = None
    hp: Annotated[int, Field(ge=1)] | None = None
    attacks: tuple[str, ...] | None = None
    movement: str | None = None
    saves: str | None = None
    morale: Annotated[int, Field(ge=2, le=12)] | None = None
    alignment: str | None = None
    xp: Annotated[int, Field(ge=0)] | None = None
    number_appearing: str | None = None
    special: tuple[str, ...] | None = None


class SetTemplatePatch(BaseModel):
    """Patch (or supply) one extracted name's printed stat block."""

    model_config = ConfigDict(frozen=True)

    edit: Literal["set_template_patch"] = "set_template_patch"
    name: str
    patch: StatBlockPatch
    reason: str | None = None


class RemoveTemplatePatch(BaseModel):
    """Drop a stat-block patch by extracted name."""

    model_config = ConfigDict(frozen=True)

    edit: Literal["remove_template_patch"] = "remove_template_patch"
    name: str


class SetReason(BaseModel):
    """Compose an entry's reason inline — marks it human-composed (drops the machine-draft flag)."""

    model_config = ConfigDict(frozen=True)

    edit: Literal["set_reason"] = "set_reason"
    kind: OverrideKind
    key: str = ""
    reason: Annotated[str, Field(min_length=1)]


class RemoveEntry(BaseModel):
    """Remove one override entry at entry grain (a geometry entry removes whole, per level)."""

    model_config = ConfigDict(frozen=True)

    edit: Literal["remove_entry"] = "remove_entry"
    kind: OverrideKind
    key: str = ""


AnyOverrideEdit = Annotated[
    SetMonsterRemap | RemoveMonsterRemap | SetTemplatePatch | RemoveTemplatePatch | SetReason | RemoveEntry,
    Field(discriminator="edit"),
]
"""Any override-level edit, discriminated by `edit`."""


class OverrideEditBatch(BaseModel):
    """One atomic batch of override-level edits, computed against a named revision."""

    model_config = ConfigDict(frozen=True)

    revision: str
    edits: tuple[AnyOverrideEdit, ...] = Field(min_length=1)


def apply_overrides_edits(
    edits: tuple[AnyOverrideEdit, ...], overrides: Overrides, auto_reasons: tuple[str, ...]
) -> tuple[Overrides, tuple[str, ...]]:
    """Fold a batch of override-level edits into the next `Overrides` and machine-draft set.

    Pure: the document service applies the result through the shared commit
    protocol, where forge validates the names and cache state at assembly.

    Args:
        edits: The batch's edits.
        overrides: The current overrides.
        auto_reasons: The current machine-draft key set.

    Returns:
        The next overrides and the next machine-draft key set.

    Raises:
        OpTargetNotFoundError: If a reason edit or entry removal names an override
            entry that does not exist.
    """
    monsters = dict(overrides.monsters)
    templates = dict(overrides.monster_templates)
    areas = dict(overrides.areas)
    geometry = dict(overrides.geometry)
    town = overrides.town
    module = overrides.module
    auto = set(auto_reasons)

    for edit in edits:
        if isinstance(edit, SetMonsterRemap):
            name = normalize_monster_name(edit.name)
            reason = _resolve(auto, "monsters", name, edit.reason, f"remapped to {edit.template_id}")
            monsters[name] = MonsterOverride(template_id=edit.template_id, reason=reason)
            _drop(templates, auto, "monster_templates", name)  # exclusivity: one correction per name
        elif isinstance(edit, RemoveMonsterRemap):
            _drop(monsters, auto, "monsters", normalize_monster_name(edit.name))
        elif isinstance(edit, SetTemplatePatch):
            name = normalize_monster_name(edit.name)
            drafted = f"printed stat block corrected for {edit.name}"
            reason = _resolve(auto, "monster_templates", name, edit.reason, drafted)
            payload = {**edit.patch.model_dump(exclude_unset=True), "reason": reason}
            templates[name] = StatBlockOverride.model_validate(payload)
            _drop(monsters, auto, "monsters", name)
        elif isinstance(edit, RemoveTemplatePatch):
            _drop(templates, auto, "monster_templates", normalize_monster_name(edit.name))
        elif isinstance(edit, SetReason):
            if edit.kind == "monsters":
                _reason(monsters, edit.kind, edit.key, edit.reason)
            elif edit.kind == "monster_templates":
                _reason(templates, edit.kind, edit.key, edit.reason)
            elif edit.kind == "areas":
                _reason(areas, edit.kind, edit.key, edit.reason)
            elif edit.kind == "geometry":
                _reason(geometry, edit.kind, edit.key, edit.reason)
            elif edit.kind == "town":
                town = _reason_singleton(town, "town", edit.reason)
            else:
                module = _reason_singleton(module, "module", edit.reason)
            auto.discard(auto_reason_key(edit.kind, None if edit.kind in ("town", "module") else edit.key))
        else:  # RemoveEntry — the union's last member
            if edit.kind == "monsters":
                _remove(monsters, edit.kind, edit.key)
            elif edit.kind == "monster_templates":
                _remove(templates, edit.kind, edit.key)
            elif edit.kind == "areas":
                _remove(areas, edit.kind, edit.key)
            elif edit.kind == "geometry":
                _remove(geometry, edit.kind, edit.key)
            elif edit.kind == "town":
                town = _remove_singleton(town, "town")
            else:
                module = _remove_singleton(module, "module")
            auto.discard(auto_reason_key(edit.kind, None if edit.kind in ("town", "module") else edit.key))

    kwargs: dict[str, object] = {}
    if monsters:
        kwargs["monsters"] = monsters
    if templates:
        kwargs["monster_templates"] = templates
    if areas:
        kwargs["areas"] = areas
    if geometry:
        kwargs["geometry"] = geometry
    if town is not None:
        kwargs["town"] = town
    if module is not None:
        kwargs["module"] = module
    return Overrides.model_validate(kwargs), tuple(sorted(auto))


def _resolve(auto: set[str], kind: str, key: str, human_reason: str | None, drafted: str) -> str:
    """A human-supplied reason is composed (drops the auto flag); otherwise draft and flag it."""
    entry_key = auto_reason_key(kind, key)
    if human_reason is not None:
        auto.discard(entry_key)
        return human_reason
    auto.add(entry_key)
    return drafted


def _drop[T](entries: dict[str, T], auto: set[str], kind: str, key: str) -> None:
    entries.pop(key, None)
    auto.discard(auto_reason_key(kind, key))


def _reason[T: BaseModel](entries: dict[str, T], kind: str, key: str, reason: str) -> None:
    if key not in entries:
        raise OpTargetNotFoundError(f"no override entry {kind}:{key!r} to reason")
    entries[key] = entries[key].model_copy(update={"reason": reason})


def _remove[T](entries: dict[str, T], kind: str, key: str) -> None:
    if key not in entries:
        raise OpTargetNotFoundError(f"no override entry {kind}:{key!r} to remove")
    entries.pop(key)


def _reason_singleton[T: BaseModel](current: T | None, kind: str, reason: str) -> T:
    if current is None:
        raise OpTargetNotFoundError(f"no {kind} override to reason")
    return current.model_copy(update={"reason": reason})


def _remove_singleton(current: BaseModel | None, kind: str) -> None:
    if current is None:
        raise OpTargetNotFoundError(f"no {kind} override to remove")
    return None
