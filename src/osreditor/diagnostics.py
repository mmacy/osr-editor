"""The content-validation diagnostics tier: run `validate_adventure`, parse, address.

osrlib's `validate_adventure` emits no structured findings — it accumulates
plain strings and raises one `ContentValidationError` with a newline-joined
message — so this module maps each line through an ordered table of regexes
matched to osrlib's exact f-string shapes, yielding
[`Finding`][osreditor.ops.Finding]s with stable codes and navigable addresses.
The parsing is deliberate, contained fragility: the sanctioned alternative
(re-implementing the checks) is forbidden by the no-rules-implementation fence.
Three containments: the osrlib pin, parser tests asserting every mapped shape
against the *installed* osrlib, and the unclassified fallback — a line matching
no pattern becomes `validation_unclassified` with the message verbatim and no
address, so findings are never dropped and an upstream wording change degrades
to a less-navigable finding, not a lie.

The address grammar, pinned by this first producer: `/`-joined `kind:value`
segments, values percent-encoded (RFC 3986) so arbitrary osrlib ids can never
make the grammar ambiguous. Segments: `town`, `monsters`, `dungeon:<id>`,
`dungeon:<id>/level:<n>`, `dungeon:<id>/level:<n>/area:<id>`. Phase 2 extends
with `cell:` and `edge:` segments. osrlib builds its location prefix unquoted
(`owner = f"{dungeon.id} level {level.number}"`), so extraction gets the same
honesty guard as classification: every extracted dungeon/level/area resolves
against the actual document, and `address` degrades to `None` when the target
does not resolve — a wrong address is a lie; a missing one is a shrug.
"""

import re
from collections.abc import Callable
from urllib.parse import quote

from osrlib.crawl.adventure import Adventure, validate_adventure
from osrlib.data import load_equipment, load_monsters
from osrlib.errors import ContentValidationError

from osreditor.ops import Diagnostics, Finding

__all__ = [
    "compute_diagnostics",
    "parse_validation_error",
]

_HEADER = "adventure validation failed:"

# A repr'd id: single-quoted for ordinary ids. Ids whose repr double-quotes or
# escapes (embedded quotes, backslashes) fail the pattern or the resolution
# guard and degrade honestly.
_ID = r"'(?P<{name}>.*)'"
_POSITION = r"\(-?\d+, -?\d+\)"


def _address_town(adventure: Adventure, match: re.Match[str]) -> str | None:
    return "town"


def _address_monsters(adventure: Adventure, match: re.Match[str]) -> str | None:
    return "monsters"


def _address_dungeon(adventure: Adventure, match: re.Match[str]) -> str | None:
    dungeon_id = match.group("dungeon")
    if not any(dungeon.id == dungeon_id for dungeon in adventure.dungeons):
        return None
    return f"dungeon:{_encode(dungeon_id)}"


def _address_level(adventure: Adventure, match: re.Match[str]) -> str | None:
    resolved = _resolve_owner(adventure, match.group("owner"))
    if resolved is None:
        return None
    dungeon_id, level_number = resolved
    return f"dungeon:{_encode(dungeon_id)}/level:{level_number}"


def _address_area(adventure: Adventure, match: re.Match[str]) -> str | None:
    resolved = _resolve_owner(adventure, match.group("owner"))
    if resolved is None:
        return None
    dungeon_id, level_number = resolved
    area_id = match.group("area")
    level = next(d for d in adventure.dungeons if d.id == dungeon_id).level(level_number)
    if not any(area.id == area_id for area in level.areas):
        return None
    return f"dungeon:{_encode(dungeon_id)}/level:{level_number}/area:{_encode(area_id)}"


def _encode(value: str) -> str:
    """Percent-encode an id for the address grammar (RFC 3986, everything reserved)."""
    return quote(value, safe="")


_OWNER_RE = re.compile(r"^(?P<dungeon>.+) level (?P<level>\d+)$")


def _resolve_owner(adventure: Adventure, owner: str) -> tuple[str, int] | None:
    """Split osrlib's unquoted `{dungeon.id} level {number}` prefix and verify it.

    The greedy split takes the last ` level <digits>` as the level, which is the
    true one for every id the document actually contains — and the resolution
    check below is what guarantees a hostile id can only cost the address, never
    forge a wrong one.
    """
    match = _OWNER_RE.match(owner)
    if match is None:
        return None
    dungeon_id = match.group("dungeon")
    level_number = int(match.group("level"))
    for dungeon in adventure.dungeons:
        if dungeon.id == dungeon_id:
            if any(level.number == level_number for level in dungeon.levels):
                return dungeon_id, level_number
            return None
    return None


_OWNER = r"^(?P<owner>.+): "
_id = _ID.format
_AddressBuilder = Callable[[Adventure, re.Match[str]], str | None]

# Ordered: first match wins. Each pattern mirrors one exact f-string in
# osrlib's validate_adventure; the suite asserts every shape against the
# installed osrlib, so an upstream wording change fails CI here first.
_PATTERNS: tuple[tuple[str, re.Pattern[str], _AddressBuilder], ...] = (
    (
        "bundled_monster_collision",
        re.compile(r"^bundled monster id .* collides with the catalog$"),
        _address_monsters,
    ),
    (
        "travel_unknown_dungeon",
        re.compile(r"^town travel names unknown dungeon .*$"),
        _address_town,
    ),
    (
        "entrance_missing",
        re.compile(rf"^dungeon {_id(name='dungeon')} has no entrance on any level$"),
        _address_dungeon,
    ),
    (
        "entrance_out_of_bounds",
        re.compile(rf"{_OWNER}entrance {_POSITION} is out of bounds$"),
        _address_level,
    ),
    (
        "feature_id_conflict",
        re.compile(rf"{_OWNER}feature ids are not unique$"),
        _address_level,
    ),
    (
        "feature_id_reserved",
        re.compile(rf"{_OWNER}feature id 'pile' is reserved for drop piles$"),
        _address_level,
    ),
    (
        "area_id_conflict",
        re.compile(rf"{_OWNER}area ids are not unique$"),
        _address_level,
    ),
    (
        "area_cell_out_of_bounds",
        re.compile(rf"{_OWNER}area {_id(name='area')} cell {_POSITION} is out of bounds$"),
        _address_area,
    ),
    (
        "encounter_unknown_monster",
        re.compile(rf"{_OWNER}area {_id(name='area')} references unknown monster .*$"),
        _address_area,
    ),
    (
        "encounter_alignment_invalid",
        re.compile(rf"{_OWNER}area {_id(name='area')} pins alignment .* outside .*'s options$"),
        _address_area,
    ),
    (
        "feature_unknown_item",
        re.compile(rf"{_OWNER}feature .* references unknown item .*$"),
        _address_level,
    ),
    (
        "feature_cell_out_of_bounds",
        re.compile(rf"{_OWNER}feature .* cell {_POSITION} is out of bounds$"),
        _address_level,
    ),
    (
        "feature_needs_cell",
        re.compile(rf"{_OWNER}level-scope feature .* needs a cell$"),
        _address_level,
    ),
    (
        "wandering_unknown_monster",
        re.compile(rf"{_OWNER}wandering row .* references unknown monster .*$"),
        _address_level,
    ),
    (
        "transition_out_of_bounds",
        re.compile(rf"{_OWNER}transition at {_POSITION} is out of bounds$"),
        _address_level,
    ),
    (
        "transition_target_unknown",
        re.compile(rf"{_OWNER}transition targets unknown .* level \d+$"),
        _address_level,
    ),
    (
        "transition_target_cell_out_of_bounds",
        re.compile(rf"{_OWNER}transition target cell {_POSITION} is out of bounds$"),
        _address_level,
    ),
)


def parse_validation_error(message: str, adventure: Adventure) -> tuple[Finding, ...]:
    """Parse a `ContentValidationError` message into findings.

    Args:
        message: The exception's full message, header included.
        adventure: The document the error came from — extraction targets are
            resolved against it, and an unresolvable target degrades the
            finding's address to `None`.

    Returns:
        One finding per message line, in osrlib's emission order; a line
        matching no known shape becomes `validation_unclassified` with no
        address, never dropped.
    """
    lines = message.split("\n")
    if lines and lines[0].strip() == _HEADER:
        lines = lines[1:]
    findings: list[Finding] = []
    for line in lines:
        if not line:
            continue
        findings.append(_classify(line, adventure))
    return tuple(findings)


def _classify(line: str, adventure: Adventure) -> Finding:
    for code, pattern, build_address in _PATTERNS:
        match = pattern.match(line)
        if match is None:
            continue
        return Finding(source="validation", code=code, message=line, address=build_address(adventure, match))
    return Finding(source="validation", code="validation_unclassified", message=line, address=None)


def compute_diagnostics(adventure: Adventure) -> Diagnostics:
    """Run the content-validation tier and parse its output.

    The catalogs are `functools.cache`d module singletons in osrlib — cheap to
    call, no editor-side caching needed. Tier-3 lint stays an empty tuple until
    phase 2 lands `lint.py` with the map that makes its findings navigable.

    Args:
        adventure: The current working document.

    Returns:
        The diagnostics: parsed validation findings, empty lint.
    """
    try:
        validate_adventure(adventure, load_monsters(), load_equipment())
    except ContentValidationError as error:
        return Diagnostics(validation=parse_validation_error(str(error), adventure), lint=())
    return Diagnostics()
