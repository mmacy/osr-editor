"""The op→override translator and `overrides.yaml` serialization.

A forge project's document is derived state: the editor never writes
`adventure.json`, only `overrides.yaml`, and re-runs `assemble` to rebuild.
Every editor gesture that would mutate a native document instead translates to a
merged, reasoned override entry here.

[`translate_batch`][osreditor.overrides.translate_batch] is pure: the document
service applies the ops to the assembled document first (through the shared
`_apply_op` machinery, with the growth rule relaxing the geometry invariants),
then hands the translator the applied *candidate* alongside the current overrides
and report. The translator emits exactly the override entries whose desired state
differs from the assembled state, merged one-entry-per-address over the current
overrides, with a page-anchored auto-drafted reason on every fresh entry and a
human-composed reason preserved through later merges.

The round-trip theorem keeps it honest: the assembled result of the new overrides
equals the op-applied candidate under a derivation-aware equivalence — modulo
edge representation, derived level dimensions, and bundled-template pruning; the
suite asserts it on every case.
"""

from collections.abc import Iterable

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
from osrlib.crawl.dungeon import AreaSpec, Edge, EdgeKind, LevelSpec, Position, TransitionSpec

from osreditor.addresses import area_address, dungeon_address, level_address
from osreditor.errors import OpInvariantError, OpUnsupportedForgeError
from osreditor.ops import (
    AddFeature,
    AddTransition,
    AnyEditOp,
    CreateArea,
    RemoveArea,
    RemoveFeature,
    RemoveTransition,
    SetAdventureField,
    SetAreaCells,
    SetAreaField,
    SetEdges,
    SetEncounter,
    SetEntrance,
    SetFeature,
    SetTownField,
    SetTrap,
    SetTreasure,
)

__all__ = [
    "auto_reason_key",
    "check_forge_ops",
    "serialize_overrides",
    "translate_batch",
]

# The ops with no override kind — blocked in a forge project, offered the detach
# dialog in place. Each maps its op code to the one-line why the dialog renders.
_BLOCKED_OPS: dict[str, str] = {
    "set_wandering": "wandering-monster parameters have no override kind",
    "set_dungeon_field": "dungeon metadata has no override kind",
    "rename_dungeon": "renaming a dungeon has no override kind — override addressing is by key",
    "add_dungeon": "adding a dungeon has no override kind",
    "remove_dungeon": "removing a dungeon has no override kind",
    "add_level": "adding a level has no override kind",
    "remove_level": "removing a level has no override kind",
    "renumber_level": "renumbering a level has no override kind — override addressing is by key",
    "resize_level": "level dimensions are derived from the floor plan's bounding box",
}

_AREA_CONTENT_FIELDS = ("encounter", "trap", "treasure", "features")


def serialize_overrides(overrides: Overrides) -> bytes:
    """Serialize an `Overrides` value to the `overrides.yaml` bytes forge accepts.

    pyyaml with `sort_keys=False`, block style, kinds in `Overrides` field order,
    plain strings, trailing newline. `exclude_unset=True` is load-bearing: it
    carries the pinned absent-vs-null semantics through unchanged — a field the
    editor never set is omitted (untouched), an explicitly-`None` field emits
    `null` (clear). Entry order is insertion order (never a sort), the one
    ordering rule `build_draft` and `render_previews` must agree on. Comments in
    a pre-existing hand-authored file are not preserved — the honest
    normalize-on-first-write posture, with the `reason` fields as the record.

    Args:
        overrides: The override value to serialize.

    Returns:
        The UTF-8 YAML bytes, round-tripped by test through forge's own
        `load_overrides`.
    """
    data = overrides.model_dump(mode="json", exclude_unset=True)
    text = yaml.safe_dump(data, sort_keys=False, default_flow_style=False, allow_unicode=True, width=4096)
    return text.encode("utf-8")


def auto_reason_key(kind: str, key: str | None = None) -> str:
    """Build the kind-qualified override-entry key the sidecar's `auto_reasons` set tracks.

    The set records which entries still carry a machine-drafted reason, so a
    human-composed reason survives later merges. `town` and `module` are
    singletons and carry no entry key.

    Args:
        kind: The override kind — `monsters`, `monster_templates`, `areas`,
            `geometry`, `town`, or `module`.
        key: The entry key (an address or normalized name); `None` for the
            `town`/`module` singletons.

    Returns:
        `<kind>` for a singleton, else `<kind>:<key>`.
    """
    return kind if key is None else f"{kind}:{key}"


def check_forge_ops(ops: Iterable[AnyEditOp]) -> None:
    """Reject a batch that names a blocked op or a forge-mode op invariant, before any translation.

    The whole batch rejects (atomicity), so a single blocked op fails everything
    before a side effect. Level-scope feature ops and `SetAreaField field="id"`
    are blocked (no override kind reaches them); `CreateArea` gains the forge-mode
    invariant that the id must not contain `/` (the address grammar's one reserved
    character).

    Args:
        ops: The batch's ops.

    Raises:
        OpUnsupportedForgeError: If an op has no override kind.
        OpInvariantError: If a forge-mode op invariant is violated.
    """
    for op in ops:
        why = _blocked_reason(op)
        if why is not None:
            message, address = why
            raise OpUnsupportedForgeError(message, op=op.op, address=address)
        if isinstance(op, CreateArea) and "/" in op.area_id:
            raise OpInvariantError(
                f"area id {op.area_id!r} contains '/', the address grammar's reserved character — "
                "forge-backed area keys cannot contain it"
            )


def _blocked_reason(op: AnyEditOp) -> tuple[str, str | None] | None:
    """Return `(why, address)` when the op is blocked in a forge project, else `None`."""
    if op.op in _BLOCKED_OPS:
        return _BLOCKED_OPS[op.op], _op_address(op)
    if isinstance(op, AddFeature | SetFeature | RemoveFeature) and op.area_id is None:
        return "level-scope features have no override kind", level_address(op.dungeon_id, op.level_number)
    if isinstance(op, SetAreaField) and op.field == "id":
        return (
            "re-keying an area has no override kind — override addressing is by key",
            area_address(op.dungeon_id, op.level_number, op.area_id),
        )
    return None


def _op_address(op: AnyEditOp) -> str | None:
    """Best-effort address of a blocked op, for the detach remedy's context."""
    dungeon_id = getattr(op, "dungeon_id", None)
    old_id = getattr(op, "old_id", None)
    if isinstance(op, SetAreaField):
        return area_address(op.dungeon_id, op.level_number, op.area_id)
    level_number = getattr(op, "level_number", None) or getattr(op, "old_number", None)
    if dungeon_id is not None and level_number is not None:
        return level_address(dungeon_id, level_number)
    if old_id is not None:
        return dungeon_address(old_id)
    if dungeon_id is not None:
        return dungeon_address(dungeon_id)
    return None


def translate_batch(
    ops: tuple[AnyEditOp, ...],
    assembled: Adventure,
    candidate: Adventure,
    overrides: Overrides,
    report: ExtractionReport,
    auto_reasons: tuple[str, ...],
) -> tuple[Overrides, tuple[str, ...]]:
    """Translate an applied op batch into the next `Overrides` value and machine-draft set.

    Args:
        ops: The batch's ops (already applied to `candidate`).
        assembled: The document before the ops — synthesis plus current overrides.
        candidate: The document after the ops — the desired state.
        overrides: The current overrides.
        report: The current report (source pages, and the `added` tombstones that
            distinguish a survey area from an override-added one).
        auto_reasons: The current machine-draft key set.

    Returns:
        The next overrides and the next machine-draft key set.
    """
    builder = _Builder(assembled, candidate, overrides, report, set(auto_reasons))
    for op in ops:
        builder.fold(op)
    return builder.finish()


class _Builder:
    """Folds a batch's ops into a net override effect per address, reading final values from the candidate."""

    def __init__(
        self,
        assembled: Adventure,
        candidate: Adventure,
        overrides: Overrides,
        report: ExtractionReport,
        auto_reasons: set[str],
    ) -> None:
        self.assembled = assembled
        self.candidate = candidate
        self.overrides = overrides
        self.report = report
        self.old_auto = auto_reasons
        self.new_auto: set[str] = set(auto_reasons)
        self.pages = {area.id: area.source_pages for area in report.areas}
        self.added_addrs = {area.id for area in report.areas if "added" in area.overridden}
        self.survey_addrs = {area.id for area in report.areas if "added" not in area.overridden}
        # Touch records, folded left-to-right.
        self.module_fields: set[str] = set()
        self.town_fields: set[str] = set()
        self.area_fields: dict[str, set[str]] = {}
        self.area_creates: set[str] = set()
        self.area_removes: set[str] = set()
        self.geo_edges: dict[str, set[str]] = {}
        self.geo_entrance: set[str] = set()
        self.geo_transitions: set[str] = set()
        self.geo_cells: dict[str, set[str]] = {}

    def fold(self, op: AnyEditOp) -> None:
        if isinstance(op, SetAdventureField):
            self.module_fields.add(op.field)
        elif isinstance(op, SetTownField):
            self.town_fields.add(op.field)
        elif isinstance(op, SetEncounter):
            self._touch_area_field(op.dungeon_id, op.level_number, op.area_id, "encounter")
        elif isinstance(op, SetTrap):
            self._touch_area_field(op.dungeon_id, op.level_number, op.area_id, "trap")
        elif isinstance(op, SetTreasure):
            self._touch_area_field(op.dungeon_id, op.level_number, op.area_id, "treasure")
        elif isinstance(op, AddFeature | SetFeature | RemoveFeature):
            assert op.area_id is not None  # level scope is blocked upstream
            self._touch_area_field(op.dungeon_id, op.level_number, op.area_id, "features")
        elif isinstance(op, SetAreaField):
            self._touch_area_field(op.dungeon_id, op.level_number, op.area_id, op.field)
        elif isinstance(op, CreateArea):
            addr = self._area_addr(op.dungeon_id, op.level_number, op.area_id)
            self.area_creates.add(addr)
            self.area_removes.discard(addr)
            self.geo_cells.setdefault(self._level_addr(op.dungeon_id, op.level_number), set()).add(op.area_id)
        elif isinstance(op, SetAreaCells):
            self.geo_cells.setdefault(self._level_addr(op.dungeon_id, op.level_number), set()).add(op.area_id)
        elif isinstance(op, RemoveArea):
            addr = self._area_addr(op.dungeon_id, op.level_number, op.area_id)
            self.area_removes.add(addr)
            self.area_creates.discard(addr)
        elif isinstance(op, SetEdges):
            keys = self.geo_edges.setdefault(self._level_addr(op.dungeon_id, op.level_number), set())
            keys.update(op.edges.keys())
        elif isinstance(op, SetEntrance):
            self.geo_entrance.add(self._level_addr(op.dungeon_id, op.level_number))
        elif isinstance(op, AddTransition | RemoveTransition):
            self.geo_transitions.add(self._level_addr(op.dungeon_id, op.level_number))

    def _touch_area_field(self, dungeon_id: str, level_number: int, area_id: str, field: str) -> None:
        self.area_fields.setdefault(self._area_addr(dungeon_id, level_number, area_id), set()).add(field)

    @staticmethod
    def _area_addr(dungeon_id: str, level_number: int, area_id: str) -> str:
        return f"{dungeon_id}/{level_number}/{area_id}"

    @staticmethod
    def _level_addr(dungeon_id: str, level_number: int) -> str:
        return f"{dungeon_id}/{level_number}"

    # --- Finalization ----------------------------------------------------------

    def finish(self) -> tuple[Overrides, tuple[str, ...]]:
        module = self._build_module()
        town = self._build_town()
        areas = self._build_areas()
        geometry = self._build_geometry(dropped_area_cells=self._dropped_area_cells())
        kwargs: dict[str, object] = {}
        if self.overrides.monsters:
            kwargs["monsters"] = self.overrides.monsters
        if self.overrides.monster_templates:
            kwargs["monster_templates"] = self.overrides.monster_templates
        if areas:
            kwargs["areas"] = areas
        if geometry:
            kwargs["geometry"] = geometry
        if town is not None:
            kwargs["town"] = town
        if module is not None:
            kwargs["module"] = module
        return Overrides.model_validate(kwargs), tuple(sorted(self.new_auto))

    def _reason(self, kind: str, key: str | None, existing_reason: str | None, drafted: str) -> str:
        """Resolve an entry's reason: draft when machine-owned or new, preserve a human's composition."""
        auto_key = auto_reason_key(kind, key)
        if existing_reason is None or auto_key in self.old_auto:
            self.new_auto.add(auto_key)
            return drafted
        self.new_auto.discard(auto_key)
        return existing_reason

    def _build_module(self) -> ModuleOverride | None:
        if not self.module_fields:
            return self.overrides.module
        base: dict[str, object] = {}
        if self.overrides.module is not None:
            base = self.overrides.module.model_dump(exclude_unset=True)
            base.pop("reason", None)
        for field in self.module_fields:
            base[field] = getattr(self.candidate, field)
        existing = self.overrides.module.reason if self.overrides.module is not None else None
        reason = self._reason("module", None, existing, "module metadata corrected")
        return ModuleOverride.model_validate({**base, "reason": reason})

    def _build_town(self) -> TownOverride | None:
        if not self.town_fields:
            return self.overrides.town
        base: dict[str, object] = {}
        if self.overrides.town is not None:
            base = self.overrides.town.model_dump(exclude_unset=True)
            base.pop("reason", None)
        for field in self.town_fields:
            base[field] = getattr(self.candidate.town, field)
        existing = self.overrides.town.reason if self.overrides.town is not None else None
        drafted = f"town {', '.join(sorted(self.town_fields))} corrected"
        reason = self._reason("town", None, existing, drafted)
        return TownOverride.model_validate({**base, "reason": reason})

    def _touched_area_addrs(self) -> list[str]:
        seen: dict[str, None] = {}
        for addr in [*self.area_fields, *self.area_creates, *self.area_removes]:
            seen.setdefault(addr, None)
        return list(seen)

    def _build_areas(self) -> dict[str, AreaOverride]:
        result = dict(self.overrides.areas)
        for addr in self._touched_area_addrs():
            entry = self._build_area_entry(addr)
            if entry is None:
                result.pop(addr, None)
            else:
                result[addr] = entry
        return result

    def _build_area_entry(self, addr: str) -> AreaOverride | None:
        area = self._candidate_area(addr)
        is_survey = addr in self.survey_addrs
        existing = self.overrides.areas.get(addr)
        existing_reason = existing.reason if existing is not None else None
        if area is None:
            # Net removal.
            if not is_survey:
                # An override-added area removed: delete the add entry outright.
                self.new_auto.discard(auto_reason_key("areas", addr))
                return None
            reason = self._reason("areas", addr, existing_reason, f"area {self._key(addr)} removed")
            return AreaOverride(remove=True, reason=reason)
        touched = self.area_fields.get(addr, set())
        created = addr in self.area_creates
        if created and not is_survey:
            payload = self._area_add_payload(area, touched)
        elif created and is_survey:
            payload = self._area_collapse_payload(area)
        else:
            payload = self._area_replace_payload(area, touched, existing)
        reason = self._reason("areas", addr, existing_reason, self._area_reason(addr, created, is_survey, touched))
        return AreaOverride.model_validate({**payload, "reason": reason})

    def _area_add_payload(self, area: AreaSpec, touched: set[str]) -> dict[str, object]:
        payload: dict[str, object] = {"name": area.name, "description": area.description}
        for field in _AREA_CONTENT_FIELDS:
            if field in touched:
                payload[field] = getattr(area, field)
        return payload

    def _area_collapse_payload(self, area: AreaSpec) -> dict[str, object]:
        # A recreated survey key: replace name/description and explicitly clear
        # the survey content (a replacement leaves unset survey fields in force).
        return {
            "name": area.name,
            "description": area.description,
            "encounter": area.encounter,
            "trap": area.trap,
            "treasure": area.treasure,
            "features": area.features,
        }

    def _area_replace_payload(
        self, area: AreaSpec, touched: set[str], existing: AreaOverride | None
    ) -> dict[str, object]:
        base: dict[str, object] = {}
        if existing is not None:
            base = existing.model_dump(exclude_unset=True)
            base.pop("reason", None)
            base.pop("remove", None)
        for field in touched:
            base[field] = getattr(area, field)
        return base

    def _area_reason(self, addr: str, created: bool, is_survey: bool, touched: set[str]) -> str:
        key = self._key(addr)
        anchor = self._page_anchor(addr)
        if created and not is_survey:
            return f"area {key} added"
        if created and is_survey:
            return f"area {key} replaced{anchor}"
        fields = ", ".join(sorted(touched)) if touched else "content"
        return f"area {key} {fields} corrected{anchor}"

    def _dropped_area_cells(self) -> set[str]:
        """Level-address+area-key pairs whose geometry cells must drop with an area removal."""
        dropped: set[str] = set()
        for addr in self.area_removes:
            if self._candidate_area(addr) is None:
                dropped.add(addr)
        return dropped

    def _build_geometry(self, dropped_area_cells: set[str]) -> dict[str, GeometryOverride]:
        result = dict(self.overrides.geometry)
        level_addrs = {*self.geo_edges, *self.geo_entrance, *self.geo_transitions, *self.geo_cells}
        # A removal that drops an added area's cells also touches that level's geometry.
        for addr in dropped_area_cells:
            level_addrs.add(self._level_of(addr))
        for level_addr in level_addrs:
            entry = self._build_geometry_entry(level_addr, dropped_area_cells)
            if entry is None:
                result.pop(level_addr, None)
            else:
                result[level_addr] = entry
        return result

    def _build_geometry_entry(self, level_addr: str, dropped_area_cells: set[str]) -> GeometryOverride | None:
        candidate_level = self._candidate_level(level_addr)
        assembled_level = self._assembled_level(level_addr)
        existing = self.overrides.geometry.get(level_addr)
        existing_reason = existing.reason if existing is not None else None

        areas = self._merge_area_cells(level_addr, existing, candidate_level, dropped_area_cells)
        edges = self._merge_edges(level_addr, existing, candidate_level, assembled_level)
        entrance_set, entrance = self._merge_entrance(level_addr, existing, candidate_level)
        transitions_set, transitions = self._merge_transitions(level_addr, existing, candidate_level)

        if not areas and not edges and not entrance_set and not transitions_set:
            self.new_auto.discard(auto_reason_key("geometry", level_addr))
            return None
        reason = self._reason("geometry", level_addr, existing_reason, self._geometry_reason(level_addr))
        kwargs: dict[str, object] = {"reason": reason}
        if areas:
            kwargs["areas"] = areas
        if edges:
            kwargs["edges"] = edges
        if entrance_set:
            kwargs["entrance"] = entrance
        if transitions_set:
            kwargs["transitions"] = transitions
        return GeometryOverride.model_validate(kwargs)

    def _merge_area_cells(
        self,
        level_addr: str,
        existing: GeometryOverride | None,
        candidate_level: LevelSpec | None,
        dropped_area_cells: set[str],
    ) -> dict[str, AreaGeometryOverride]:
        areas: dict[str, AreaGeometryOverride] = dict(existing.areas) if existing is not None else {}
        for area_id in self.geo_cells.get(level_addr, set()):
            area = self._area_on(candidate_level, area_id)
            if area is not None:
                areas[area_id] = AreaGeometryOverride(cells=area.cells)
        # A removed added-area's cells entry drops with it.
        for dropped in dropped_area_cells:
            if self._level_of(dropped) == level_addr:
                areas.pop(self._key(dropped), None)
        return areas

    def _merge_edges(
        self,
        level_addr: str,
        existing: GeometryOverride | None,
        candidate_level: LevelSpec | None,
        assembled_level: LevelSpec | None,
    ) -> dict[str, Edge]:
        edges: dict[str, Edge] = {}
        if existing is not None:
            # Canonicalize hand-authored east/south keys so the merged map never
            # carries two spellings of one edge.
            for key, edge in existing.edges.items():
                edges[canonicalize_edge_key(key)] = edge
        for key in self.geo_edges.get(level_addr, set()):
            canonical = canonicalize_edge_key(key)
            desired = candidate_level.edges.get(canonical) if candidate_level is not None else None
            assembled = assembled_level.edges.get(canonical) if assembled_level is not None else None
            if desired == assembled:
                # A no-op in effect: an absent entry and an explicit wall are the
                # same wall, so leave any existing override entry untouched.
                continue
            edges[canonical] = desired if desired is not None else Edge(kind=EdgeKind.WALL)
        return edges

    def _merge_entrance(
        self, level_addr: str, existing: GeometryOverride | None, candidate_level: LevelSpec | None
    ) -> tuple[bool, Position | None]:
        if level_addr in self.geo_entrance:
            return True, candidate_level.entrance if candidate_level is not None else None
        if existing is not None and "entrance" in existing.model_fields_set:
            return True, existing.entrance
        return False, None

    def _merge_transitions(
        self, level_addr: str, existing: GeometryOverride | None, candidate_level: LevelSpec | None
    ) -> tuple[bool, tuple[TransitionSpec, ...] | None]:
        if level_addr in self.geo_transitions:
            return True, candidate_level.transitions if candidate_level is not None else ()
        if existing is not None and "transitions" in existing.model_fields_set:
            return True, existing.transitions
        return False, None

    def _geometry_reason(self, level_addr: str) -> str:
        _, number = level_addr.split("/")
        if level_addr in self.geo_edges:
            return f"level {number} edges redrawn"
        if level_addr in self.geo_entrance:
            return f"level {number} entrance moved"
        if level_addr in self.geo_transitions:
            return f"level {number} transitions corrected"
        return f"level {number} geometry redrawn"

    # --- Candidate/assembled accessors -----------------------------------------

    def _candidate_area(self, addr: str) -> AreaSpec | None:
        return self._area_on(self._candidate_level(self._level_of(addr)), self._key(addr))

    def _candidate_level(self, level_addr: str) -> LevelSpec | None:
        return self._level_on(self.candidate, level_addr)

    def _assembled_level(self, level_addr: str) -> LevelSpec | None:
        return self._level_on(self.assembled, level_addr)

    @staticmethod
    def _level_on(adventure: Adventure, level_addr: str) -> LevelSpec | None:
        dungeon_id, number = level_addr.split("/")
        for dungeon in adventure.dungeons:
            if dungeon.id == dungeon_id:
                for level in dungeon.levels:
                    if level.number == int(number):
                        return level
        return None

    @staticmethod
    def _area_on(level: LevelSpec | None, area_id: str) -> AreaSpec | None:
        if level is None:
            return None
        for area in level.areas:
            if area.id == area_id:
                return area
        return None

    @staticmethod
    def _level_of(addr: str) -> str:
        dungeon_id, number, _ = addr.split("/")
        return f"{dungeon_id}/{number}"

    @staticmethod
    def _key(addr: str) -> str:
        return addr.split("/")[2]

    def _page_anchor(self, addr: str) -> str:
        pages = self.pages.get(addr, ())
        if not pages:
            return ""
        return " against p. " + ", ".join(str(page) for page in pages)
