"""The op→override translator: from an applied batch to the next `overrides.yaml` value.

Pure functions from an applied batch and the current forge state (assembled
document, current overrides, report) to the next `Overrides` value — the
document service runs the commit protocol around them. The merge semantics
rest on one research fact: the assembled document *is* synthesis plus current
overrides, so emitting entries for exactly the state that differs from the
assembled state, merged over the existing entry per canonical key, produces
the correct final override map without the editor ever importing forge's
synthesis.

The blocked-op list is the spec's general rule made a table: any op whose
translation has no override kind rejects the whole batch in place with the
detach offer, before any translation side effect.
"""

from collections.abc import Iterable, Sequence
from dataclasses import dataclass, field
from typing import cast

import yaml
from osrforge.contracts.overrides import (
    AreaGeometryOverride,
    AreaOverride,
    GeometryOverride,
    ModuleOverride,
    Overrides,
    TownOverride,
)
from osrforge.contracts.report import ExtractionReport
from osrforge.overrides import canonicalize_edge_key
from osrlib.crawl.adventure import Adventure
from osrlib.crawl.dungeon import Edge, EdgeKind, LevelSpec, Position
from pydantic import BaseModel

from osreditor.addresses import area_address, dungeon_address, level_address
from osreditor.errors import OpUnsupportedForgeError
from osreditor.ops import (
    AddDungeon,
    AddFeature,
    AddLevel,
    AddTransition,
    AnyEditOp,
    CreateArea,
    RemoveArea,
    RemoveDungeon,
    RemoveFeature,
    RemoveLevel,
    RemoveTransition,
    RenameDungeon,
    RenumberLevel,
    ResizeLevel,
    SetAdventureField,
    SetAreaCells,
    SetAreaField,
    SetDungeonField,
    SetEdges,
    SetEncounter,
    SetEntrance,
    SetFeature,
    SetTownField,
    SetTrap,
    SetTreasure,
    SetWandering,
)

__all__ = [
    "ForgeTranslationState",
    "TranslationResult",
    "ensure_forge_supported",
    "serialize_overrides",
    "translate_batch",
]

_AREA_CONTENT_FIELDS = ("encounter", "trap", "treasure", "features")
_AREA_FIELD_ORDER = ("name", "description", "encounter", "trap", "treasure", "features")


@dataclass(frozen=True)
class ForgeTranslationState:
    """The translator's whole input beyond the ops themselves.

    Attributes:
        document: The assembled document *before* the batch — the diff base.
        applied: The op-applied candidate — the desired final state.
        overrides: The current overrides value.
        report: The current extraction report — how the translator tells a
            survey area from an override-added one (the `"added"` and
            `"removed"` tombstones) without ever reading forge's stage caches.
        auto_reasons: The kind-qualified entry keys whose reason is still a
            machine draft.
    """

    document: Adventure
    applied: Adventure
    overrides: Overrides
    report: ExtractionReport
    auto_reasons: frozenset[str]


@dataclass(frozen=True)
class TranslationResult:
    """The translator's answer: the next overrides value, its ledger, and its bytes."""

    overrides: Overrides
    auto_reasons: frozenset[str]
    serialized: bytes


_BLOCKED_MESSAGES: dict[type, str] = {
    SetWandering: "wandering-monster parameters have no override kind",
    SetDungeonField: "dungeon fields have no override kind",
    RenameDungeon: "dungeon ids have no override kind — override addressing is by id",
    AddDungeon: "dungeon structure has no override kind",
    RemoveDungeon: "dungeon structure has no override kind",
    AddLevel: "level structure has no override kind",
    RemoveLevel: "level structure has no override kind",
    RenumberLevel: "level numbers have no override kind — override addressing is by number",
    ResizeLevel: "level dimensions are derived state — the bounding box forge recomputes",
}


def _blocked_address(op: AnyEditOp) -> str:
    """The blocked op's target in the diagnostics address grammar."""
    if isinstance(op, SetDungeonField | RemoveDungeon):
        return dungeon_address(op.dungeon_id)
    if isinstance(op, AddDungeon):
        return dungeon_address(op.dungeon_id)
    if isinstance(op, RenameDungeon):
        return dungeon_address(op.old_id)
    if isinstance(op, AddLevel):
        return level_address(op.dungeon_id, op.number)
    if isinstance(op, RenumberLevel):
        return level_address(op.dungeon_id, op.old_number)
    if isinstance(op, SetAreaField):
        return area_address(op.dungeon_id, op.level_number, op.area_id)
    if isinstance(op, SetWandering | ResizeLevel | RemoveLevel | AddFeature | SetFeature | RemoveFeature):
        return level_address(op.dungeon_id, op.level_number)
    raise AssertionError(f"no blocked address rule for {type(op).__name__}")  # pragma: no cover


def ensure_forge_supported(ops: Sequence[AnyEditOp]) -> None:
    """Reject the whole batch when any op has no override translation.

    Runs before any op is applied — the spec's "blocks in place with the
    detach offer", and the atomicity rule: the batch rejects whole, before any
    translation side effect.

    Args:
        ops: The batch's ops.

    Raises:
        OpUnsupportedForgeError: On the first blocked op, with the op code and
            its target address in `details`.
    """
    for op in ops:
        message = _BLOCKED_MESSAGES.get(type(op))
        if message is not None:
            raise OpUnsupportedForgeError(message, op=op.op, address=_blocked_address(op))
        if isinstance(op, SetAreaField) and op.field == "id":
            raise OpUnsupportedForgeError(
                "area re-keying has no override kind — override addressing is by key",
                op=op.op,
                address=_blocked_address(op),
            )
        if isinstance(op, AddFeature | SetFeature | RemoveFeature) and op.area_id is None:
            raise OpUnsupportedForgeError(
                "level-scope features have no override kind",
                op=op.op,
                address=_blocked_address(op),
            )


@dataclass
class _AreaFold:
    """One area address's net effect after the batch's left-to-right fold."""

    remove: bool = False
    delete_add: bool = False
    create: bool = False
    recreate: bool = False
    fields: dict[str, object] = field(default_factory=dict[str, object])
    features_touched: bool = False
    touched: list[str] = field(default_factory=list[str])


@dataclass
class _GeometryFold:
    """One level address's net geometry effect after the fold."""

    cells: dict[str, tuple[Position, ...]] = field(default_factory=dict[str, tuple[Position, ...]])
    drop_cells: set[str] = field(default_factory=set[str])
    edge_keys: list[str] = field(default_factory=list[str])
    entrance_set: bool = False
    entrance: Position | None = None
    transitions_set: bool = False
    touched: list[str] = field(default_factory=list[str])


def _forge_area_address(dungeon_id: str, level_number: int, area_key: str) -> str:
    return f"{dungeon_id}/{level_number}/{area_key}"


def _forge_level_address(dungeon_id: str, level_number: int) -> str:
    return f"{dungeon_id}/{level_number}"


def _find_level(document: Adventure, dungeon_id: str, level_number: int) -> LevelSpec | None:
    for dungeon in document.dungeons:
        if dungeon.id == dungeon_id:
            for level in dungeon.levels:
                if level.number == level_number:
                    return level
    return None


def _touch(fold_touched: list[str], label: str) -> None:
    if label not in fold_touched:
        fold_touched.append(label)


def translate_batch(ops: Sequence[AnyEditOp], state: ForgeTranslationState) -> TranslationResult:
    """Translate one applied batch into the next overrides value — pure.

    The batch folds left-to-right into a net effect per address, then merges
    over the current overrides: one entry per address always, successive edits
    merging into the entry, a remove superseding prior replacements, a
    remove-then-create of one survey key collapsing to a replacement.

    Args:
        ops: The batch's ops, already applied to `state.applied` and already
            past [`ensure_forge_supported`][osreditor.overrides.ensure_forge_supported].
        state: The translation state.

    Returns:
        The next overrides value with its updated `auto_reasons` and
        serialized bytes.
    """
    added_addresses = {record.id for record in state.report.areas if "added" in record.overridden}
    removed_addresses = {record.id for record in state.report.areas if "removed" in record.overridden}
    pages_by_address = {record.id: record.source_pages for record in state.report.areas}

    area_folds: dict[str, _AreaFold] = {}
    geometry_folds: dict[str, _GeometryFold] = {}
    town_fields: dict[str, object] = {}
    module_fields: dict[str, object] = {}

    def area_fold(dungeon_id: str, level_number: int, area_key: str) -> _AreaFold:
        return area_folds.setdefault(_forge_area_address(dungeon_id, level_number, area_key), _AreaFold())

    def geometry_fold(dungeon_id: str, level_number: int) -> _GeometryFold:
        return geometry_folds.setdefault(_forge_level_address(dungeon_id, level_number), _GeometryFold())

    for op in ops:
        if isinstance(op, SetAdventureField):
            module_fields[op.field] = tuple(op.value) if isinstance(op.value, tuple) else op.value
        elif isinstance(op, SetTownField):
            town_fields[op.field] = op.value
        elif isinstance(op, SetEncounter):
            fold = area_fold(op.dungeon_id, op.level_number, op.area_id)
            fold.fields["encounter"] = op.encounter
            _touch(fold.touched, "encounter")
        elif isinstance(op, SetTrap):
            fold = area_fold(op.dungeon_id, op.level_number, op.area_id)
            fold.fields["trap"] = op.trap
            _touch(fold.touched, "trap")
        elif isinstance(op, SetTreasure):
            fold = area_fold(op.dungeon_id, op.level_number, op.area_id)
            fold.fields["treasure"] = op.treasure
            _touch(fold.touched, "treasure")
        elif isinstance(op, AddFeature | SetFeature | RemoveFeature):
            assert op.area_id is not None  # level scope is blocked upstream
            fold = area_fold(op.dungeon_id, op.level_number, op.area_id)
            fold.features_touched = True
            _touch(fold.touched, "features")
        elif isinstance(op, SetAreaField):
            fold = area_fold(op.dungeon_id, op.level_number, op.area_id)
            fold.fields[op.field] = op.value
            _touch(fold.touched, op.field)
        elif isinstance(op, CreateArea):
            address = _forge_area_address(op.dungeon_id, op.level_number, op.area_id)
            fold = area_fold(op.dungeon_id, op.level_number, op.area_id)
            geometry = geometry_fold(op.dungeon_id, op.level_number)
            geometry.cells[op.area_id] = op.cells
            geometry.drop_cells.discard(op.area_id)
            _touch(geometry.touched, "cells")
            if fold.remove or address in removed_addresses:
                # A survey key returns: the collapse. A replacement entry
                # leaves unset survey fields in force, and a recreated area
                # must not resurrect the survey's content — explicit nulls for
                # every content field the batch does not itself set.
                fold.remove = False
                fold.recreate = True
                fold.fields = {"name": op.name, "description": op.description}
                fold.features_touched = False
                fold.touched = ["replaced"]
            else:
                fold.create = True
                fold.fields = {"name": op.name, "description": op.description}
                fold.touched = ["added"]
        elif isinstance(op, SetAreaCells):
            geometry = geometry_fold(op.dungeon_id, op.level_number)
            geometry.cells[op.area_id] = op.cells
            _touch(geometry.touched, "cells")
        elif isinstance(op, RemoveArea):
            address = _forge_area_address(op.dungeon_id, op.level_number, op.area_id)
            fold = area_fold(op.dungeon_id, op.level_number, op.area_id)
            geometry = geometry_fold(op.dungeon_id, op.level_number)
            geometry.cells.pop(op.area_id, None)
            geometry.drop_cells.add(op.area_id)
            if fold.create or address in added_addresses:
                # Removing an override-added area deletes the add — forge
                # rejects removing an area the survey lacks.
                fold.delete_add = True
                fold.create = False
                fold.recreate = False
                fold.remove = False
            else:
                fold.remove = True
                fold.delete_add = False
                fold.recreate = False
            fold.fields = {}
            fold.features_touched = False
            fold.touched = ["removed"]
        elif isinstance(op, SetEdges):
            geometry = geometry_fold(op.dungeon_id, op.level_number)
            for key in op.edges:
                canonical = canonicalize_edge_key(key)
                if canonical not in geometry.edge_keys:
                    geometry.edge_keys.append(canonical)
            _touch(geometry.touched, "edges")
        elif isinstance(op, SetEntrance):
            geometry = geometry_fold(op.dungeon_id, op.level_number)
            geometry.entrance_set = True
            geometry.entrance = op.entrance
            _touch(geometry.touched, "entrance")
        elif isinstance(op, AddTransition | RemoveTransition):
            geometry = geometry_fold(op.dungeon_id, op.level_number)
            geometry.transitions_set = True
            _touch(geometry.touched, "transitions")
        else:  # pragma: no cover — ensure_forge_supported already rejected the rest
            raise AssertionError(f"unhandled op {type(op).__name__}")

    auto_reasons = set(state.auto_reasons)
    new_areas = dict(state.overrides.areas)
    new_geometry = {address: entry for address, entry in state.overrides.geometry.items()}

    for address, fold in area_folds.items():
        ledger_key = f"areas:{address}"
        if fold.delete_add:
            new_areas.pop(address, None)
            auto_reasons.discard(ledger_key)
            continue
        if not (fold.remove or fold.create or fold.recreate or fold.fields or fold.features_touched):
            continue
        existing = new_areas.get(address)
        reason = _entry_reason(existing, ledger_key, auto_reasons, _draft_area_reason(address, fold, pages_by_address))
        if fold.remove:
            new_areas[address] = AreaOverride(remove=True, reason=reason)
            auto_reasons_add_if_machine(auto_reasons, ledger_key, existing, state.auto_reasons)
            continue
        fields = _entry_fields(existing) if not (fold.create or fold.recreate) else {}
        fields.update(fold.fields)
        if fold.features_touched:
            fields["features"] = _applied_area_features(state.applied, address)
        if fold.recreate:
            for name in _AREA_CONTENT_FIELDS:
                fields.setdefault(name, None)
        new_areas[address] = AreaOverride(**fields, reason=reason)  # pyright: ignore[reportArgumentType] — the fold holds field-typed values
        auto_reasons_add_if_machine(auto_reasons, ledger_key, existing, state.auto_reasons)

    for address, fold in geometry_folds.items():
        ledger_key = f"geometry:{address}"
        existing = new_geometry.get(address)
        dungeon_id, _, level_text = address.partition("/")
        level_number = int(level_text)
        base_areas: dict[str, AreaGeometryOverride] = dict(existing.areas) if existing is not None else {}
        base_edges: dict[str, Edge] = (
            {canonicalize_edge_key(key): edge for key, edge in existing.edges.items()} if existing is not None else {}
        )
        entrance_set = existing is not None and "entrance" in existing.model_fields_set
        entrance = existing.entrance if existing is not None else None
        transitions_set = existing is not None and "transitions" in existing.model_fields_set
        transitions = existing.transitions if existing is not None and existing.transitions is not None else ()

        for area_key, cells in fold.cells.items():
            base_areas[area_key] = AreaGeometryOverride(cells=cells)
        for area_key in fold.drop_cells:
            base_areas.pop(area_key, None)
        base_edges.update(
            _edge_diff(
                fold.edge_keys,
                _find_level(state.document, dungeon_id, level_number),
                _find_level(state.applied, dungeon_id, level_number),
            )
        )
        if fold.entrance_set:
            entrance_set = True
            entrance = fold.entrance
        if fold.transitions_set:
            transitions_set = True
            applied_level = _find_level(state.applied, dungeon_id, level_number)
            transitions = applied_level.transitions if applied_level is not None else ()

        if not base_areas and not base_edges and not entrance_set and not transitions_set:
            new_geometry.pop(address, None)
            auto_reasons.discard(ledger_key)
            continue
        reason = _entry_reason(existing, ledger_key, auto_reasons, _draft_geometry_reason(level_number, fold))
        entry_fields: dict[str, object] = {}
        if base_areas:
            entry_fields["areas"] = base_areas
        if base_edges:
            entry_fields["edges"] = base_edges
        if entrance_set:
            entry_fields["entrance"] = entrance
        if transitions_set:
            entry_fields["transitions"] = transitions
        new_geometry[address] = GeometryOverride(**entry_fields, reason=reason)  # pyright: ignore[reportArgumentType] — field-typed values
        auto_reasons_add_if_machine(auto_reasons, ledger_key, existing, state.auto_reasons)

    new_town = state.overrides.town
    if town_fields:
        existing_town = state.overrides.town
        reason = _entry_reason(existing_town, "town", auto_reasons, f"town {_joined(town_fields)} corrected")
        fields = _entry_fields(existing_town)
        fields.update(town_fields)
        new_town = TownOverride(**fields, reason=reason)  # pyright: ignore[reportArgumentType] — field-typed values
        auto_reasons_add_if_machine(auto_reasons, "town", existing_town, state.auto_reasons)

    new_module = state.overrides.module
    if module_fields:
        existing_module = state.overrides.module
        reason = _entry_reason(existing_module, "module", auto_reasons, f"module {_joined(module_fields)} corrected")
        fields = _entry_fields(existing_module)
        fields.update(module_fields)
        new_module = ModuleOverride(**fields, reason=reason)  # pyright: ignore[reportArgumentType] — field-typed values
        auto_reasons_add_if_machine(auto_reasons, "module", existing_module, state.auto_reasons)

    overrides = Overrides(
        monsters=state.overrides.monsters,
        monster_templates=state.overrides.monster_templates,
        areas=new_areas,
        geometry=new_geometry,
        town=new_town,
        module=new_module,
    )
    return TranslationResult(
        overrides=overrides,
        auto_reasons=frozenset(auto_reasons),
        serialized=serialize_overrides(overrides),
    )


def auto_reasons_add_if_machine(
    auto_reasons: set[str],
    ledger_key: str,
    existing: BaseModel | None,
    previous: frozenset[str],
) -> None:
    """Record a machine draft in the ledger — unless a human composed this entry's reason.

    A fresh entry is always machine-drafted; an existing entry is redrafted
    exactly when its key is still in the ledger. A human's composed record is
    not the editor's to overwrite, so its key stays out.

    Args:
        auto_reasons: The ledger under construction (mutated).
        ledger_key: The entry's kind-qualified key.
        existing: The entry before this batch, or `None` when fresh.
        previous: The ledger before this batch.
    """
    if existing is None or ledger_key in previous:
        auto_reasons.add(ledger_key)


def _entry_reason(existing: BaseModel | None, ledger_key: str, auto_reasons: set[str], draft: str) -> str:
    """Latest-wins for machine drafts; a human-composed reason is preserved verbatim."""
    if existing is not None and ledger_key not in auto_reasons:
        return cast(str, getattr(existing, "reason"))  # noqa: B009 — every override entry carries a required reason
    return draft


def _entry_fields(entry: BaseModel | None) -> dict[str, object]:
    """An entry's explicitly-set fields (reason excluded) — the merge base."""
    if entry is None:
        return {}
    return {name: getattr(entry, name) for name in entry.model_fields_set if name != "reason"}


def _applied_area_features(applied: Adventure, address: str) -> tuple[object, ...]:
    """The area's full post-batch features tuple — forge replaces features wholesale."""
    dungeon_id, level_text, area_key = address.split("/")
    level = _find_level(applied, dungeon_id, int(level_text))
    if level is None:  # pragma: no cover — the ops resolved the level already
        return ()
    for area in level.areas:
        if area.id == area_key:
            return area.features
    return ()  # pragma: no cover — the ops resolved the area already


def _effective_edge(level: LevelSpec | None, key: str) -> Edge | None:
    """A level's semantic edge at a canonical key: `None` means wall, explicit walls included."""
    if level is None:
        return None
    edge = level.edges.get(key)
    if edge is None or edge.kind is EdgeKind.WALL:
        return None
    return edge


def _edge_diff(edge_keys: Iterable[str], before: LevelSpec | None, after: LevelSpec | None) -> dict[str, Edge]:
    """The semantic edge diff: entries for exactly the keys whose desired state differs in effect.

    An absent entry and an explicit `Edge(kind="wall")` are the same wall —
    the native model expresses by absence what forge's merge stores as a seal.
    Two consequences fall out: a delete naming an edge the assembled document
    already treats as wall emits nothing (and any existing override entry at
    the key is kept — dropping it could silently re-open the synthesized
    passage underneath, which only synthesis could reveal); a genuine wall
    gesture over a synthesized opening emits the sanctioned explicit seal.
    """
    diff: dict[str, Edge] = {}
    for key in edge_keys:
        desired = _effective_edge(after, key)
        assembled = _effective_edge(before, key)
        if desired == assembled:
            continue
        diff[key] = desired if desired is not None else Edge(kind=EdgeKind.WALL)
    return diff


def _joined(fields: dict[str, object]) -> str:
    return ", ".join(fields)


def _draft_area_reason(address: str, fold: _AreaFold, pages_by_address: dict[str, tuple[int, ...]]) -> str:
    """Target-first, change-second, page-anchored when the report knows the pages."""
    area_key = address.rsplit("/", 1)[-1]
    if fold.remove:
        return f"area {area_key} removed"
    if fold.recreate:
        return f"area {area_key} replaced"
    if fold.create:
        return f"area {area_key} added"
    ordered = [name for name in _AREA_FIELD_ORDER if name in fold.touched]
    pages = pages_by_address.get(address, ())
    anchor = f" against p. {pages[0]}" if pages else ""
    return f"area {area_key} {', '.join(ordered)} corrected{anchor}"


_GEOMETRY_ASPECT_ORDER = ("cells", "edges", "entrance", "transitions")


def _draft_geometry_reason(level_number: int, fold: _GeometryFold) -> str:
    ordered = [name for name in _GEOMETRY_ASPECT_ORDER if name in fold.touched]
    return f"level {level_number} {', '.join(ordered)} redrawn"


def _payload_data(value: object) -> object:
    """Dump a value for YAML: osrlib models fully (`None` defaults dropped), containers recursively.

    The full dump — never `exclude_unset` — keeps serialization independent of
    how a payload model was constructed; dropping `None`-valued keys inside
    payloads is safe (a `None` there is always a model default) and keeps the
    file human-shaped. Explicit nulls survive only at the override-entry
    level, where [`_entry_data`][osreditor.overrides._entry_data] preserves
    them from `model_fields_set`.
    """
    if isinstance(value, BaseModel):
        return _clean(value.model_dump(mode="json"))
    if isinstance(value, dict):
        return {key: _payload_data(entry) for key, entry in value.items()}  # pyright: ignore[reportUnknownVariableType, reportUnknownArgumentType, reportUnknownMemberType]
    if isinstance(value, tuple | list):
        return [_payload_data(entry) for entry in value]  # pyright: ignore[reportUnknownVariableType, reportUnknownArgumentType]
    return value


def _clean(value: object) -> object:
    if isinstance(value, dict):
        return {key: _clean(entry) for key, entry in value.items() if entry is not None}  # pyright: ignore[reportUnknownVariableType, reportUnknownArgumentType, reportUnknownMemberType]
    if isinstance(value, list):
        return [_clean(entry) for entry in value]  # pyright: ignore[reportUnknownVariableType, reportUnknownArgumentType]
    return value


def _entry_data(entry: BaseModel) -> dict[str, object]:
    """One override entry as YAML data: explicitly-set fields in model field order, explicit nulls kept."""
    data: dict[str, object] = {}
    for name in type(entry).model_fields:
        if name not in entry.model_fields_set and name != "reason":
            continue
        value = getattr(entry, name)
        data[name] = None if value is None else _payload_data(value)
    return data


def serialize_overrides(overrides: Overrides) -> bytes:
    """Serialize an overrides value in the pinned deterministic format.

    pyyaml, `sort_keys=False`, block style, kinds in `Overrides` field order,
    trailing newline — and insertion-preserving entry order: existing entries
    keep their file order, new entries append, never a sort. Entry order is
    semantic in `areas:` (adds land in the draft in correction-file order), so
    insertion order is the uniform rule for every kind. Comments in a
    pre-existing hand-authored file are not preserved (pyyaml does not
    round-trip them; the `reason` fields are the record) — the same honest
    normalize-on-first-write posture foreign native documents get.

    Args:
        overrides: The overrides value.

    Returns:
        The UTF-8 YAML bytes, loadable by forge's own `load_overrides`.
    """
    data: dict[str, object] = {}
    for kind in ("monsters", "monster_templates", "areas", "geometry"):
        entries: dict[str, BaseModel] = getattr(overrides, kind)
        if entries:
            data[kind] = {key: _entry_data(entry) for key, entry in entries.items()}
    for kind in ("town", "module"):
        entry: BaseModel | None = getattr(overrides, kind)
        if entry is not None:
            data[kind] = _entry_data(entry)
    text = yaml.dump(data, sort_keys=False, allow_unicode=True, default_flow_style=False, width=100)
    return text.encode("utf-8")
