"""The tier-3 structural lint: forge's five graph checks mirrored exactly, plus `area_overlap`.

The five shared checks mirror `osrforge.check`'s static tier — semantics,
messages verbatim, severities from forge's producer-pinned table
(`osrforge/check.py:62-70`) — which is what makes the spec's "forge's finding
vocabulary where the checks coincide" true rather than aspirational. The
mirrored semantics are pinned by fixture tests in this repo; the
cross-implementation test that runs forge's `check()` beside
[`lint_adventure`][osreditor.lint.lint_adventure] on shared fixtures arrives
with phase 5, when `osr-forge` joins the dependencies. Until then the citations
below are the contract.

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
`secret_only_access`, `transition_unpaired` — with `area_overlap`, the editor
extension, as a sixth group after them. Stable output keeps tests exact and
the panel steady.
"""

import re
from collections import deque
from collections.abc import Mapping
from typing import Literal

from osrlib.crawl.adventure import Adventure
from osrlib.crawl.dungeon import Direction, Edge, EdgeKind, LevelSpec, Position, edge_key, step

from osreditor.addresses import area_address, cell_address, level_address
from osreditor.ops import Finding

__all__ = ["SEVERITY", "lint_adventure"]

SEVERITY: Mapping[str, Literal["error", "warning"]] = {
    "edge_invalid": "error",
    "area_unreachable": "error",
    "orphan_cell": "warning",
    "secret_only_access": "warning",
    "transition_unpaired": "warning",
    "area_overlap": "warning",
}
"""Each check's severity — forge's producer-pinned table (`check.py:62-70`), plus the editor extension."""

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
    return tuple(findings)


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
