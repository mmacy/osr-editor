"""The content-validation diagnostics tier: run `validate_adventure`, parse, address.

osrlib's `validate_adventure` emits no structured findings — it accumulates
plain strings and raises one `ContentValidationError` with a newline-joined
message — so this module maps each line back to a stable code and a navigable
address. The parsing is deliberate, contained fragility: the sanctioned
alternative (re-implementing the checks) is forbidden by the
no-rules-implementation fence. Three containments: the osrlib pin, parser tests
asserting every mapped shape against the *installed* osrlib, and the
unclassified fallback — a line matching no shape becomes
`validation_unclassified` with the message verbatim and no address, so findings
are never dropped and an upstream wording change degrades to a less-navigable
finding, not a lie.

Classification resolves against the document, not regex captures alone. osrlib
builds its location prefix unquoted (`owner = f"{dungeon.id} level
{level.number}"`), so extracting ids from the message by pattern is forgeable
by hostile ids. Instead, each owner-scoped shape is confirmed by enumeration:
render every `(dungeon, level)` the document actually contains as an owner
prefix and accept the classification only when exactly one renders the line —
and likewise each area id, rendered exactly as osrlib reprs it. A line no
enumeration confirms falls through to the next shape and ultimately to
`validation_unclassified`; a wrong code or address is a lie, a missing one a
shrug.

The address grammar, pinned by this first producer: `/`-joined `kind:value`
segments, values percent-encoded (RFC 3986) so arbitrary osrlib ids can never
make the grammar ambiguous. Segments: `town`, `monsters`, `dungeon:<id>`,
`dungeon:<id>/level:<n>`, `dungeon:<id>/level:<n>/area:<id>`. Phase 2 extends
with `cell:` and `edge:` segments.
"""

import re
from urllib.parse import quote

from osrlib.crawl.adventure import Adventure, validate_adventure
from osrlib.crawl.dungeon import LevelSpec
from osrlib.data import load_equipment, load_monsters
from osrlib.errors import ContentValidationError

from osreditor.ops import Diagnostics, Finding

__all__ = [
    "compute_diagnostics",
    "parse_validation_error",
]

_HEADER = "adventure validation failed:"

_POSITION = r"\(-?\d+, -?\d+\)"

# Owner-scoped shapes: the tail each check appends after osrlib's
# `{dungeon.id} level {level.number}: ` prefix, full-matched against the line's
# remainder for every (dungeon, level) the document contains. `area_prefix` is
# the literal that follows the repr'd area id for shapes that name one, letting
# the resolver confirm the area the same way. Ordered: first confirmed shape
# wins.
_OWNER_SHAPES: tuple[tuple[str, re.Pattern[str], str | None], ...] = (
    ("entrance_out_of_bounds", re.compile(rf"entrance {_POSITION} is out of bounds"), None),
    ("feature_id_conflict", re.compile(r"feature ids are not unique"), None),
    ("feature_id_reserved", re.compile(r"feature id 'pile' is reserved for drop piles"), None),
    ("area_id_conflict", re.compile(r"area ids are not unique"), None),
    ("area_cell_out_of_bounds", re.compile(rf"area .+ cell {_POSITION} is out of bounds"), " cell ("),
    ("encounter_unknown_monster", re.compile(r"area .+ references unknown monster .+"), " references unknown monster "),
    ("encounter_alignment_invalid", re.compile(r"area .+ pins alignment .+ outside .+'s options"), " pins alignment "),
    ("feature_unknown_item", re.compile(r"feature .+ references unknown item .+"), None),
    ("feature_cell_out_of_bounds", re.compile(rf"feature .+ cell {_POSITION} is out of bounds"), None),
    ("feature_needs_cell", re.compile(r"level-scope feature .+ needs a cell"), None),
    ("wandering_unknown_monster", re.compile(r"wandering row .+ references unknown monster .+"), None),
    ("transition_out_of_bounds", re.compile(rf"transition at {_POSITION} is out of bounds"), None),
    ("transition_target_unknown", re.compile(r"transition targets unknown .+ level \d+"), None),
    (
        "transition_target_cell_out_of_bounds",
        re.compile(rf"transition target cell {_POSITION} is out of bounds"),
        None,
    ),
)


def _encode(value: str) -> str:
    """Percent-encode an id for the address grammar (RFC 3986, everything reserved)."""
    return quote(value, safe="")


def _confirm_owner(adventure: Adventure, line: str, tail: re.Pattern[str]) -> tuple[str, int] | None:
    """Return the one (dungeon id, level number) whose rendered prefix plus tail is this line.

    Zero confirmations means the shape is not this line's (or a hostile id
    forged it); more than one is unconstructible for distinct renders but
    guarded anyway — either way the classification is refused, never guessed.
    """
    hits: list[tuple[str, int]] = []
    for dungeon in adventure.dungeons:
        for level in dungeon.levels:
            prefix = f"{dungeon.id} level {level.number}: "
            if line.startswith(prefix) and tail.fullmatch(line, len(prefix)):
                hits.append((dungeon.id, level.number))
    if len(hits) != 1:
        return None
    return hits[0]


def _confirm_area(level: LevelSpec, rest: str, area_prefix: str) -> str | None:
    """Return the one area id whose repr'd rendering opens the line's remainder.

    The candidate is rendered exactly as osrlib renders it (`area {id!r}` plus
    the shape's following literal), so an id another id could impersonate would
    need the separator's quote inside itself — which flips or escapes its own
    repr and breaks the render. The `!= 1` guard stays as defense in depth.
    """
    hits = [area.id for area in level.areas if rest.startswith(f"area {area.id!r}{area_prefix}")]
    if len(hits) != 1:
        return None
    return hits[0]


def _classify_owner_scoped(line: str, adventure: Adventure) -> Finding | None:
    for code, tail, area_prefix in _OWNER_SHAPES:
        confirmed = _confirm_owner(adventure, line, tail)
        if confirmed is None:
            continue
        dungeon_id, level_number = confirmed
        address: str | None = f"dungeon:{_encode(dungeon_id)}/level:{level_number}"
        if area_prefix is not None:
            level = next(d for d in adventure.dungeons if d.id == dungeon_id).level(level_number)
            area_id = _confirm_area(level, line[len(f"{dungeon_id} level {level_number}: ") :], area_prefix)
            # The level is confirmed; an unconfirmable area costs only the
            # finer segment, honestly.
            address = f"{address}/area:{_encode(area_id)}" if area_id is not None else address
        return Finding(source="validation", code=code, message=line, address=address)
    return None


def _classify_dungeon_scoped(line: str, adventure: Adventure) -> Finding | None:
    hits = [
        dungeon.id for dungeon in adventure.dungeons if line == f"dungeon {dungeon.id!r} has no entrance on any level"
    ]
    if len(hits) != 1:
        return None
    return Finding(
        source="validation",
        code="entrance_missing",
        message=line,
        address=f"dungeon:{_encode(hits[0])}",
    )


_BUNDLED_RE = re.compile(r"^bundled monster id .+ collides with the catalog$")
_TRAVEL_RE = re.compile(r"^town travel names unknown dungeon .+$")


def _classify(line: str, adventure: Adventure) -> Finding:
    # Owner-confirmed shapes first: a hostile id embedding a static shape's
    # text inside an owner prefix classifies by its true, document-confirmed
    # shape before the static patterns ever see the line.
    finding = _classify_owner_scoped(line, adventure)
    if finding is not None:
        return finding
    finding = _classify_dungeon_scoped(line, adventure)
    if finding is not None:
        return finding
    if _BUNDLED_RE.match(line):
        return Finding(source="validation", code="bundled_monster_collision", message=line, address="monsters")
    if _TRAVEL_RE.match(line):
        return Finding(source="validation", code="travel_unknown_dungeon", message=line, address="town")
    return Finding(source="validation", code="validation_unclassified", message=line, address=None)


def parse_validation_error(message: str, adventure: Adventure) -> tuple[Finding, ...]:
    """Parse a `ContentValidationError` message into findings.

    Args:
        message: The exception's full message, header included.
        adventure: The document the error came from — every classification is
            confirmed against it, and an unconfirmable line degrades to
            `validation_unclassified` rather than a guessed code or address.

    Returns:
        One finding per message line, in osrlib's emission order; a line
        matching no confirmed shape becomes `validation_unclassified` with no
        address, never dropped.
    """
    lines = message.split("\n")
    if lines and lines[0].strip() == _HEADER:
        lines = lines[1:]
    return tuple(_classify(line, adventure) for line in lines if line)


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
