"""The diagnostics address grammar, built: `/`-joined `kind:value` segments.

The grammar was pinned by the validation tier (see
[`osreditor.diagnostics`][osreditor.diagnostics]): values are percent-encoded
(RFC 3986, everything reserved) so arbitrary osrlib ids can never make the
grammar ambiguous. Phase 2 adds two geometry segments, appended after the level
segment: `cell:<x>,<y>` and `edge:<x>,<y>:<north|west>`. Their values are
numeric grammar, unambiguous without encoding; the general segment parse rule
stays "kind is up to the first `:`, value is the remainder". The `edge:`
segment ships with the grammar (the inspector and hover refs use edge
addressing) even though no phase 2 finding emits it — `edge_invalid`
deliberately addresses the level.

Three producers build addresses — the validation parser, the structural lint,
and the `ResizeLevel` offender list — so the builders live here, in one place.
"""

from urllib.parse import quote

from osrlib.crawl.dungeon import Position

__all__ = [
    "area_address",
    "cell_address",
    "dungeon_address",
    "edge_address",
    "encode_value",
    "level_address",
]


def encode_value(value: str) -> str:
    """Percent-encode an id for the address grammar (RFC 3986, everything reserved).

    Args:
        value: The raw id.

    Returns:
        The encoded segment value.
    """
    return quote(value, safe="")


def dungeon_address(dungeon_id: str) -> str:
    """Build a dungeon-scope address.

    Args:
        dungeon_id: The dungeon id.

    Returns:
        `dungeon:<id>`.
    """
    return f"dungeon:{encode_value(dungeon_id)}"


def level_address(dungeon_id: str, level_number: int) -> str:
    """Build a level-scope address.

    Args:
        dungeon_id: The dungeon id.
        level_number: The 1-based level number.

    Returns:
        `dungeon:<id>/level:<n>`.
    """
    return f"{dungeon_address(dungeon_id)}/level:{level_number}"


def area_address(dungeon_id: str, level_number: int, area_id: str) -> str:
    """Build an area-scope address.

    Args:
        dungeon_id: The dungeon id.
        level_number: The 1-based level number.
        area_id: The area id.

    Returns:
        `dungeon:<id>/level:<n>/area:<id>`.
    """
    return f"{level_address(dungeon_id, level_number)}/area:{encode_value(area_id)}"


def cell_address(dungeon_id: str, level_number: int, cell: Position) -> str:
    """Build a cell-scope address.

    Args:
        dungeon_id: The dungeon id.
        level_number: The 1-based level number.
        cell: The cell.

    Returns:
        `dungeon:<id>/level:<n>/cell:<x>,<y>`.
    """
    return f"{level_address(dungeon_id, level_number)}/cell:{cell[0]},{cell[1]}"


def edge_address(dungeon_id: str, level_number: int, edge_key: str) -> str:
    """Build an edge-scope address from a canonical edge key.

    Args:
        dungeon_id: The dungeon id.
        level_number: The 1-based level number.
        edge_key: The canonical edge key (`x,y:north|west`).

    Returns:
        `dungeon:<id>/level:<n>/edge:<x>,<y>:<side>`.
    """
    return f"{level_address(dungeon_id, level_number)}/edge:{edge_key}"
