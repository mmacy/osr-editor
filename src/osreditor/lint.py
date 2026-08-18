"""The tier-3 structural lint: forge's five graph checks mirrored exactly, plus the editor extensions.

The five shared checks mirror `osrforge.check`'s static tier — semantics,
messages verbatim, severities from forge's producer-pinned table — which is
what makes the spec's "forge's finding vocabulary where the checks coincide"
true rather than aspirational. The contract is the running comparison: the
cross-implementation parity suite (`tests/test_lint_parity.py`) runs forge's
own `check()` beside [`lint_adventure`][osreditor.lint.lint_adventure] on the
shared fixtures and their doctored variants, asserting ids, severities,
messages, and order exactly, and locations under a refinement relation — the
editor's `orphan_cell` and `transition_unpaired` addresses navigate to the
exact cell where forge's location grammar stops at the level. The citations
below remain as orientation, no longer the contract.

Reachability is a BFS over one of two graph flavors — *inclusive* (open edges
plus doors in any state, secret included) and *non-secret* (secret doors become
walls) — seeded from each dungeon's **first entrance-bearing level only**
(osrlib's `EnterDungeon` uses exactly this expression, and an override-authored
second entrance must not manufacture phantom reachability; `check.py:117-119`),
expanding over passable edges and directed transitions into levels that exist.

The engine is pure and whole-document — reachability is inherently cross-level
(transitions jump levels and dungeons), so the unit of computation is the
document. "Incremental" cashes out as *recomputed live, in-process, on every
commit*: a full pass is one BFS plus per-level scans over documents whose
largest known instance is ~300 KB — microseconds, measured in the test suite
rather than assumed. If a pathological document ever disagrees, the named
fallback is memoizing per-level scans keyed on the delta's touched subtrees;
nobody builds that speculatively.

Ordering is deterministic and mirrors forge's exactly: findings are grouped by
check id in the vocabulary's order (`check.py:189`), each check doing its own
full dungeon/level sweep in document order — `edge_invalid`,
`area_unreachable`, `orphan_cell` (bounding-box scan, y outer),
`secret_only_access`, `transition_unpaired` — with the editor extensions as
further groups after them: `area_overlap`, then phase 16's advisory class —
`flag_read_no_writer`, `trigger_cycle`, and `trigger_spawn_collision`, warning
severity by construction, never escalating, never gating. Stable output keeps
tests exact and the panel steady.
"""

import re
from collections import deque
from collections.abc import Mapping
from typing import Literal

from osrlib.crawl.adventure import Adventure
from osrlib.crawl.commands import ConsequenceCommand, SetFlag, SpawnMonsters, SpawnNpcParty
from osrlib.crawl.dungeon import Direction, Edge, EdgeKind, LevelSpec, Position, edge_key, step
from osrlib.crawl.gates import ConditionSpec, FlagEqualsCondition, flag_values_equal
from osrlib.crawl.quests import TriggerClause
from osrlib.crawl.triggers import AreaEnteredPattern, FlagSetPattern, TriggerPattern

from osreditor.addresses import area_address, cell_address, edge_address, level_address, trigger_address
from osreditor.ops import Finding

__all__ = ["SEVERITY", "lint_adventure"]

SEVERITY: Mapping[str, Literal["error", "warning"]] = {
    "edge_invalid": "error",
    "area_unreachable": "error",
    "orphan_cell": "warning",
    "secret_only_access": "warning",
    "transition_unpaired": "warning",
    "area_overlap": "warning",
    "flag_read_no_writer": "warning",
    "trigger_cycle": "warning",
    "trigger_spawn_collision": "warning",
}
"""Each check's severity — forge's producer-pinned table (`check.py:62-70`), plus the editor extensions.

The last three are phase 16's advisory class: warning severity by
construction, so they can never escalate and never gate publish.
"""

_EDGE_KEY_SHAPE = re.compile(r"^(-?[0-9]+),(-?[0-9]+):(north|south|east|west)$")
"""Forge's edge-key shape regex (`check.py:85`): any compass side, signed integers."""


def _finding(code: str, message: str, address: str) -> Finding:
    return Finding(source="lint", code=code, severity=SEVERITY[code], message=message, address=address)


def _passable(edge: Edge, *, include_secret: bool) -> bool:
    """The inclusive/non-secret flavors: open edges plus doors, optionally minus secret ones.

    Stuck and locked doors are passable in both flavors — a party can force and
    pick; only secrecy hides a door from the non-secret graph (`check.py:88-94`).
    """
    if edge.kind is EdgeKind.OPEN:
        return True
    if edge.kind is EdgeKind.DOOR:
        return include_secret or (edge.door is not None and edge.door.kind != "secret")
    return False


_Node = tuple[str, int, Position]


def _reachable(adventure: Adventure, *, include_secret: bool) -> set[_Node]:
    """BFS over one flavor's graph plus directed transitions, seeded per dungeon (`check.py:110-147`).

    Seeds are each dungeon's first entrance-bearing level's entrance, when in
    bounds — an out-of-bounds entrance seeds nothing. Transitions expand only
    into levels that exist with in-bounds target cells.
    """
    levels = {(dungeon.id, level.number): level for dungeon in adventure.dungeons for level in dungeon.levels}
    seeds: list[_Node] = []
    for dungeon in adventure.dungeons:
        entrance_level = next((level for level in dungeon.levels if level.entrance is not None), None)
        if (
            entrance_level is not None
            and entrance_level.entrance is not None
            and entrance_level.in_bounds(entrance_level.entrance)
        ):
            seeds.append((dungeon.id, entrance_level.number, entrance_level.entrance))
    visited: set[_Node] = set(seeds)
    queue = deque(seeds)
    while queue:
        dungeon_id, number, cell = queue.popleft()
        level = levels[(dungeon_id, number)]
        for direction in Direction:
            if not _passable(level.edge(cell, direction), include_secret=include_secret):
                continue
            node = (dungeon_id, number, step(cell, direction))
            if node not in visited:
                visited.add(node)
                queue.append(node)
        for transition in level.transitions:
            if transition.position != cell:
                continue
            target = levels.get((transition.to_dungeon_id, transition.to_level_number))
            if target is None or not target.in_bounds(transition.to_position):
                continue
            node = (transition.to_dungeon_id, transition.to_level_number, transition.to_position)
            if node not in visited:
                visited.add(node)
                queue.append(node)
    return visited


def invalid_edge_key_message(key: str, level: LevelSpec) -> str | None:
    """Classify one edge key exactly as the `edge_invalid` check does.

    Public because the diagnostics panel's remove-entry action resolves its key
    by enumeration, never extraction: the frontend recomputes a level's invalid
    keys, renders each key's message with this exact logic (mirrored in
    TypeScript), and acts on the key whose rendering equals the finding's
    message.

    Args:
        key: The edge-map key to classify.
        level: The level whose bounds judge the incident cells.

    Returns:
        The finding message the key would produce, or `None` for a valid key.
    """
    match = _EDGE_KEY_SHAPE.match(key)
    if match is None:
        return f"edge key {key!r} is malformed — expected 'x,y:side'"
    x, y = int(match.group(1)), int(match.group(2))
    canonical = edge_key((x, y), Direction(match.group(3)))
    if key != canonical:
        return f"edge key {key!r} is never consulted — osrlib's canonical form is {canonical!r}"
    incident = ((x, y), step((x, y), Direction(match.group(3))))
    for cell in incident:
        if not level.in_bounds(cell):
            return f"edge key {key!r} references the out-of-bounds cell {cell}"
    return None


def _edge_invalid_findings(adventure: Adventure) -> list[Finding]:
    """Keys osrlib would silently ignore — forge's "single most dangerous silent failure" (`check.py:150-185`).

    Editor-authored documents can only acquire these from foreign files —
    `SetEdges` refuses to write them — which is why the lint must exist. The
    address is the level: an invalid edge is not a navigable edge; the key
    rides the message.
    """
    findings: list[Finding] = []
    for dungeon in adventure.dungeons:
        for level in dungeon.levels:
            address = level_address(dungeon.id, level.number)
            for key in level.edges:
                message = invalid_edge_key_message(key, level)
                if message is not None:
                    findings.append(_finding("edge_invalid", message, address))
    return findings


def lint_adventure(adventure: Adventure) -> tuple[Finding, ...]:
    """Run the structural lint over a whole document.

    Args:
        adventure: The current working document.

    Returns:
        The findings, grouped by check id in the vocabulary's order, each check
        sweeping dungeons and levels in document order.
    """
    findings = _edge_invalid_findings(adventure)
    inclusive = _reachable(adventure, include_secret=True)
    non_secret = _reachable(adventure, include_secret=False)

    for dungeon in adventure.dungeons:
        for level in dungeon.levels:
            for area in level.areas:
                if not any((dungeon.id, level.number, cell) in inclusive for cell in area.cells):
                    findings.append(
                        _finding(
                            "area_unreachable",
                            "no path from any entrance reaches this area",
                            area_address(dungeon.id, level.number, area.id),
                        )
                    )

    for dungeon in adventure.dungeons:
        for level in dungeon.levels:
            area_cells = {cell for area in level.areas for cell in area.cells}
            for y in range(level.height):
                for x in range(level.width):
                    cell = (x, y)
                    if cell in area_cells or (dungeon.id, level.number, cell) in inclusive:
                        continue
                    # Forge's corridor definition: a non-area cell with at
                    # least one non-wall edge. Flagging every blank
                    # bounding-box cell would drown the panel (`check.py:207-226`).
                    if any(level.edge(cell, direction).kind is not EdgeKind.WALL for direction in Direction):
                        findings.append(
                            _finding(
                                "orphan_cell",
                                f"cell {cell} renders as corridor but no path reaches it",
                                cell_address(dungeon.id, level.number, cell),
                            )
                        )

    for dungeon in adventure.dungeons:
        for level in dungeon.levels:
            for area in level.areas:
                reached = any((dungeon.id, level.number, cell) in inclusive for cell in area.cells)
                reached_openly = any((dungeon.id, level.number, cell) in non_secret for cell in area.cells)
                if reached and not reached_openly:
                    findings.append(
                        _finding(
                            "secret_only_access",
                            "every path into this area passes through a secret door",
                            area_address(dungeon.id, level.number, area.id),
                        )
                    )

    levels = {(dungeon.id, level.number): level for dungeon in adventure.dungeons for level in dungeon.levels}
    for dungeon in adventure.dungeons:
        for level in dungeon.levels:
            for transition in level.transitions:
                if transition.kind not in ("stairs_up", "stairs_down"):
                    continue  # trapdoors and chutes are one-way by osrlib's design
                target = levels.get((transition.to_dungeon_id, transition.to_level_number))
                reciprocal = target is not None and any(
                    other.position == transition.to_position
                    and other.to_dungeon_id == dungeon.id
                    and other.to_level_number == level.number
                    and other.to_position == transition.position
                    for other in target.transitions
                )
                if not reciprocal:
                    findings.append(
                        _finding(
                            "transition_unpaired",
                            (
                                f"{transition.kind} at {transition.position} has no transition back from "
                                f"{transition.to_dungeon_id}/{transition.to_level_number} {transition.to_position}"
                            ),
                            cell_address(dungeon.id, level.number, transition.position),
                        )
                    )

    findings.extend(_area_overlap_findings(adventure))
    findings.extend(_flag_read_no_writer_findings(adventure))
    findings.extend(_trigger_cycle_findings(adventure))
    findings.extend(_trigger_spawn_collision_findings(adventure))
    return tuple(findings)


def _flag_writers(adventure: Adventure) -> set[str]:
    """Every flag key some `SetFlag` writes — trigger consequences *and* quest rewards.

    The writer set includes quests even before their authoring surface exists:
    a foreign document whose quest reward writes the key a gate reads must not
    lint falsely.
    """
    keys: set[str] = set()
    for trigger in adventure.triggers:
        for consequence in trigger.consequences:
            if isinstance(consequence, SetFlag):
                keys.add(consequence.key)
    for quest in adventure.quests:
        for reward in quest.rewards:
            if isinstance(reward, SetFlag):
                keys.add(reward.key)
    return keys


def _read_flag_key(condition: ConditionSpec) -> str | None:
    return condition.key if isinstance(condition, FlagEqualsCondition) else None


def _pattern_flag_key(pattern: TriggerPattern) -> str | None:
    return pattern.key if isinstance(pattern, FlagSetPattern) else None


def _flag_read_no_writer_findings(adventure: Adventure) -> list[Finding]:
    """Phase 16's first advisory check: a flag read over a key no `SetFlag` writes.

    The match is key-level and value-blind by decision: the spec names the
    check over keys, a value mismatch is a different and rarer mistake, and
    strict-typed value matching across an open domain invites false positives.
    One finding per reading site, addressed to it — the door's edge, the
    transition's cell, the trigger — except quest-owned readers, which carry
    `address=None` until phase 17 grows their grammar: visible and honest,
    never a navigable lie.
    """
    writers = _flag_writers(adventure)
    sites: list[tuple[str, str | None]] = []
    for dungeon in adventure.dungeons:
        for level in dungeon.levels:
            for key, edge in level.edges.items():
                if edge.door is not None and edge.door.requires is not None:
                    flag = _read_flag_key(edge.door.requires.condition)
                    if flag is not None:
                        sites.append((flag, edge_address(dungeon.id, level.number, key)))
            for transition in level.transitions:
                if transition.requires is not None:
                    flag = _read_flag_key(transition.requires.condition)
                    if flag is not None:
                        sites.append((flag, cell_address(dungeon.id, level.number, transition.position)))
    for trigger in adventure.triggers:
        flag = _pattern_flag_key(trigger.when)
        if flag is not None:
            sites.append((flag, trigger_address(trigger.id)))
        for condition in trigger.conditions:
            flag = _read_flag_key(condition)
            if flag is not None:
                sites.append((flag, trigger_address(trigger.id)))
    for quest in adventure.quests:
        clauses: list[TriggerClause] = []
        if quest.activation is not None:
            clauses.append(quest.activation)
        for objective in quest.objectives:
            clauses.append(objective.when)
            if objective.reveal_when is not None:
                clauses.append(objective.reveal_when)
        for clause in clauses:
            flag = _pattern_flag_key(clause.pattern)
            if flag is not None:
                sites.append((flag, None))
            for condition in clause.conditions:
                flag = _read_flag_key(condition)
                if flag is not None:
                    sites.append((flag, None))
    return [
        Finding(
            source="lint",
            code="flag_read_no_writer",
            severity=SEVERITY["flag_read_no_writer"],
            message=f"flag {key!r} is read but never written — no trigger consequence or quest reward sets it",
            address=address,
        )
        for key, address in sites
        if key not in writers
    ]


def _trigger_cycle_findings(adventure: Adventure) -> list[Finding]:
    """Phase 16's second advisory check: `SetFlag` feeding `flag_set` back into a loop.

    The graph is triggers alone — quests are not nodes by construction, not
    merely by scope: quest lifecycle beats fire once, so a path through a
    quest cannot loop. An edge runs from A to B where A carries a
    `SetFlag(key, value)` and B's `when` is a `FlagSetPattern` over the same
    key with a value of `None` (any write) or one that satisfies
    `flag_values_equal`. Every strongly connected component with a cycle (two
    or more members, or a self-loop) yields one finding naming its members in
    document order, addressed to the first member — deduped by member set, so
    a three-trigger loop is one row, not three. A cycle of once-only triggers
    self-limits in play and is flagged anyway: circular flag wiring is almost
    always a mistake, and the check is advisory by construction.
    """
    triggers = adventure.triggers
    edges: dict[int, set[int]] = {}
    for index, trigger in enumerate(triggers):
        writes = [consequence for consequence in trigger.consequences if isinstance(consequence, SetFlag)]
        if not writes:
            continue
        targets = {
            listener_index
            for listener_index, listener in enumerate(triggers)
            if isinstance(listener.when, FlagSetPattern)
            and any(
                write.key == listener.when.key
                and (listener.when.value is None or flag_values_equal(write.value, listener.when.value))
                for write in writes
            )
        }
        if targets:
            edges[index] = targets

    def reach(start: int) -> set[int]:
        """Nodes reachable from `start` through at least one edge (so `start` is in it only on a cycle)."""
        visited: set[int] = set()
        queue = deque(edges.get(start, ()))
        while queue:
            node = queue.popleft()
            if node in visited:
                continue
            visited.add(node)
            queue.extend(edges.get(node, ()))
        return visited

    reachable = {index: reach(index) for index in range(len(triggers))}
    seen: set[frozenset[int]] = set()
    findings: list[Finding] = []
    for index in range(len(triggers)):
        if index not in reachable[index]:
            continue
        members = sorted({other for other in reachable[index] if index in reachable[other]} | {index})
        component = frozenset(members)
        if component in seen:
            continue
        seen.add(component)
        names = ", ".join(repr(triggers[member].id) for member in members)
        findings.append(
            Finding(
                source="lint",
                code="trigger_cycle",
                severity=SEVERITY["trigger_cycle"],
                message=(
                    f"flag wiring loops through {names} — the engine truncates the cascade at its "
                    "depth bound and drops deeper firings as notes"
                ),
                address=trigger_address(triggers[members[0]].id),
            )
        )
    return findings


def _spawns(consequences: tuple[ConsequenceCommand, ...]) -> bool:
    return any(isinstance(consequence, SpawnMonsters | SpawnNpcParty) for consequence in consequences)


def _trigger_spawn_collision_findings(adventure: Adventure) -> list[Finding]:
    """Phase 16's third advisory check: a spawn aimed where a keyed encounter already stands open.

    An `area_entered` trigger spawning into an area that carries a keyed
    encounter loses the race by the engine's own sequence: entering the area
    opens the keyed encounter, the spawn drops with `encounter_in_progress`,
    and a once-only trigger's fired-mark still burns — the mark is issued
    before the consequences run. Only an addressed area that exists and
    carries an encounter fires the check; a dangling area is validation's
    territory.
    """
    levels = {(dungeon.id, level.number): level for dungeon in adventure.dungeons for level in dungeon.levels}
    findings: list[Finding] = []
    for trigger in adventure.triggers:
        pattern = trigger.when
        if not isinstance(pattern, AreaEnteredPattern) or not _spawns(trigger.consequences):
            continue
        level = levels.get((pattern.dungeon_id, pattern.level_number))
        if level is None:
            continue
        area = next((area for area in level.areas if area.id == pattern.area_id), None)
        if area is None or area.encounter is None:
            continue
        findings.append(
            Finding(
                source="lint",
                code="trigger_spawn_collision",
                severity=SEVERITY["trigger_spawn_collision"],
                message=(
                    f"spawns into area {area.id!r} on {pattern.dungeon_id!r} level {pattern.level_number}, "
                    "whose keyed encounter opens first — the spawn drops with encounter_in_progress "
                    "while the fired-mark still burns"
                ),
                address=trigger_address(trigger.id),
            )
        )
    return findings


def _area_overlap_findings(adventure: Adventure) -> list[Finding]:
    """The editor-only check: overlapping area cells are legal but almost always a mistake.

    One finding per unordered pair of areas on a level sharing at least one
    cell, addressed to the pair's later area in authored order — the one
    `area_at` silently loses (`dungeon.py:528-540`).
    """
    findings: list[Finding] = []
    for dungeon in adventure.dungeons:
        for level in dungeon.levels:
            for earlier_index, earlier in enumerate(level.areas):
                earlier_cells = set(earlier.cells)
                for later in level.areas[earlier_index + 1 :]:
                    shared = [cell for cell in later.cells if cell in earlier_cells]
                    if not shared:
                        continue
                    findings.append(
                        _finding(
                            "area_overlap",
                            (
                                f"area {later.id!r} overlaps area {earlier.id!r} on "
                                f"{len(shared)} cell(s), e.g. {shared[0]} — area_at resolves the first "
                                "area in authored order, so the overlap is invisible in play"
                            ),
                            area_address(dungeon.id, level.number, later.id),
                        )
                    )
    return findings
