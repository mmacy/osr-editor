"""The catalog route models: editor-defined summaries over osrlib's shipped data.

The pickers need identity and a few display fields, not whole stat blocks, so
each route model wraps exactly what its picker consumes. The catalogs are small
(233 monsters, 51 pickable equipment items, 22 treasure types) and immutable per
process — osrlib's loaders are `functools.cache`d — so the builders here cache
too and the routes serve whole lists; the frontend filters client-side.

The *effective* monster catalog (shipped plus the open document's bundled
templates) is a client-side merge — the document is already in hand there, so no
per-project catalog route exists. Encounter tables ride verbatim: the six
compiled dungeon tables seed the wandering-table editor, and
[`EncounterTable`][osrlib.core.tables.EncounterTable] already crosses the wire
inside `WanderingSpec`. The NPC generation tables stay server-side, no consumer.
"""

from functools import cache

from osrlib.core.alignment import Alignment
from osrlib.core.monsters import MonsterHitDice
from osrlib.core.tables import EncounterTable
from osrlib.core.treasure import TreasureSection
from osrlib.data import load_encounter_tables, load_equipment, load_monsters, load_treasure_tables
from pydantic import BaseModel, ConfigDict

__all__ = [
    "CatalogItem",
    "CatalogMonster",
    "CatalogTreasureType",
    "EncounterTableCatalogResponse",
    "EquipmentCatalogResponse",
    "MonsterCatalogResponse",
    "TreasureTypeCatalogResponse",
    "encounter_table_catalog",
    "equipment_catalog",
    "monster_catalog",
    "treasure_type_catalog",
]


class CatalogMonster(BaseModel):
    """One monster picker entry: identity, grouping, and the fields the encounter card constrains by.

    `alignment_options` flattens `AlignmentSpec.options` — the encounter card's
    alignment select offers the intersection of every line's options.
    `hit_dice` rides whole; the frontend formats it.
    """

    model_config = ConfigDict(frozen=True)

    id: str
    name: str
    page: str
    categories: tuple[str, ...]
    alignment_options: tuple[Alignment, ...]
    usual_alignment: Alignment | None
    hit_dice: MonsterHitDice


class MonsterCatalogResponse(BaseModel):
    """The shipped monster catalog, in shipped order."""

    model_config = ConfigDict(frozen=True)

    monsters: tuple[CatalogMonster, ...]


class CatalogItem(BaseModel):
    """One equipment picker entry.

    The four pickable lists (`weapons`, `armour`, `gear`, `ammunition`) are the
    same four `EquipmentCatalog.get` resolves; `treasure_weights` is not
    id-addressable equipment and stays out.
    """

    model_config = ConfigDict(frozen=True)

    id: str
    name: str
    item_type: str
    cost_gp: int


class EquipmentCatalogResponse(BaseModel):
    """The pickable equipment items, grouped list order preserved."""

    model_config = ConfigDict(frozen=True)

    items: tuple[CatalogItem, ...]


class CatalogTreasureType(BaseModel):
    """One treasure-type picker entry: the letter and its section."""

    model_config = ConfigDict(frozen=True)

    letter: str
    kind: TreasureSection


class TreasureTypeCatalogResponse(BaseModel):
    """The shipped treasure types, table order preserved."""

    model_config = ConfigDict(frozen=True)

    treasure_types: tuple[CatalogTreasureType, ...]


class EncounterTableCatalogResponse(BaseModel):
    """The six compiled dungeon encounter tables, verbatim."""

    model_config = ConfigDict(frozen=True)

    tables: tuple[EncounterTable, ...]


@cache
def monster_catalog() -> MonsterCatalogResponse:
    """Build the monster catalog response from the shipped data.

    Returns:
        Every shipped monster as a picker summary, in shipped order.
    """
    return MonsterCatalogResponse(
        monsters=tuple(
            CatalogMonster(
                id=template.id,
                name=template.name,
                page=template.page,
                categories=template.categories,
                alignment_options=template.alignment.options,
                usual_alignment=template.alignment.usual,
                hit_dice=template.hit_dice,
            )
            for template in load_monsters().monsters
        )
    )


@cache
def equipment_catalog() -> EquipmentCatalogResponse:
    """Build the equipment catalog response from the shipped data.

    Returns:
        Every pickable item across the four lists, in list order.
    """
    equipment = load_equipment()
    return EquipmentCatalogResponse(
        items=tuple(
            CatalogItem(id=template.id, name=template.name, item_type=template.item_type, cost_gp=template.cost_gp)
            for template in (*equipment.weapons, *equipment.armour, *equipment.gear, *equipment.ammunition)
        )
    )


@cache
def treasure_type_catalog() -> TreasureTypeCatalogResponse:
    """Build the treasure-type catalog response from the shipped data.

    Returns:
        Every shipped treasure type letter with its section.
    """
    return TreasureTypeCatalogResponse(
        treasure_types=tuple(
            CatalogTreasureType(letter=table.letter, kind=table.kind) for table in load_treasure_tables().treasure_types
        )
    )


@cache
def encounter_table_catalog() -> EncounterTableCatalogResponse:
    """Build the encounter-table catalog response from the shipped data.

    Returns:
        The six compiled dungeon tables, verbatim.
    """
    return EncounterTableCatalogResponse(tables=load_encounter_tables().tables)
