"""The catalog route models: editor-defined summaries over osrlib's shipped data.

The pickers need identity and a few display fields, not whole stat blocks, so
each route model wraps exactly what its picker consumes. The catalogs are small
(233 monsters, 51 pickable equipment items, 164 magic items, 22 treasure types)
and immutable per process — osrlib's loaders are `functools.cache`d — so the
builders here cache too and the routes serve whole lists; the frontend filters
client-side.

The *effective* monster catalog (shipped plus the open document's bundled
templates) is a client-side merge — the document is already in hand there, so no
per-project catalog route exists. The one full-template route is
[`catalog_monster`][osreditor.catalogs.catalog_monster], phase 4's clone source:
the summaries deliberately omit the stat block, and clone-and-modify needs a
shipped monster's whole `MonsterTemplate` (bundled templates need no route — the
document is in hand client-side, the same reasoning as the merge). Encounter
tables ride verbatim: the six compiled dungeon tables seed the wandering-table
editor, and [`EncounterTable`][osrlib.core.tables.EncounterTable] already
crosses the wire inside `WanderingSpec`. The NPC generation tables stay
server-side, no consumer.
"""

from functools import cache

from osrlib.core.alignment import Alignment
from osrlib.core.items import ItemTemplate, MagicItemCategory
from osrlib.core.monsters import MonsterHitDice, MonsterTemplate
from osrlib.core.tables import EncounterTable
from osrlib.core.treasure import TreasureSection
from osrlib.data import load_encounter_tables, load_equipment, load_magic_items, load_monsters, load_treasure_tables
from pydantic import BaseModel, ConfigDict

from osreditor.errors import CatalogItemNotFoundError, CatalogMonsterNotFoundError

__all__ = [
    "CatalogItem",
    "CatalogMagicItem",
    "CatalogMonster",
    "CatalogTreasureType",
    "EncounterTableCatalogResponse",
    "EquipmentCatalogResponse",
    "MagicItemCatalogResponse",
    "MonsterCatalogResponse",
    "TreasureTypeCatalogResponse",
    "catalog_item",
    "catalog_monster",
    "encounter_table_catalog",
    "equipment_catalog",
    "magic_item_catalog",
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


class CatalogMagicItem(BaseModel):
    """One magic-item picker entry.

    `cursed` rides along so the picker can mark the trap-for-players forms —
    placing a cursed item in a cache is a deliberate authoring choice, never a
    surprise the catalog withheld.
    """

    model_config = ConfigDict(frozen=True)

    id: str
    name: str
    category: MagicItemCategory
    cursed: bool


class MagicItemCatalogResponse(BaseModel):
    """The shipped magic items, catalog order preserved."""

    model_config = ConfigDict(frozen=True)

    items: tuple[CatalogMagicItem, ...]


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


def catalog_monster(monster_id: str) -> MonsterTemplate:
    """Answer one shipped monster's full stat block — the clone source.

    Serves from `load_monsters()` itself (osrlib's cached loader); the list
    route's summary cache holds picker fields and cannot answer a full stat
    block. The response model is osrlib's own `MonsterTemplate` riding the
    OpenAPI surface — already generated, never mirrored.

    Args:
        monster_id: A shipped monster id.

    Returns:
        The full template, verbatim.

    Raises:
        CatalogMonsterNotFoundError: If no shipped monster has that id.
    """
    try:
        return load_monsters().get(monster_id)
    except ValueError as error:
        raise CatalogMonsterNotFoundError(f"the shipped catalog has no monster {monster_id!r}") from error


def catalog_item(item_id: str) -> ItemTemplate:
    """Answer one shipped equipment item's full template — the item clone source.

    Serves from `load_equipment()` itself (osrlib's cached loader); the list
    route's summaries stay picker-thin by this module's charter. Bundled
    templates need no route — the document is in hand client-side — and magic
    items are not clone sources (a bundle is never magic), so they get no
    detail route either.

    Args:
        item_id: A shipped equipment id, from any of the four lists.

    Returns:
        The full template, verbatim.

    Raises:
        CatalogItemNotFoundError: If no shipped equipment item has that id.
    """
    try:
        return load_equipment().get(item_id)
    except ValueError as error:
        raise CatalogItemNotFoundError(f"the shipped catalog has no equipment item {item_id!r}") from error


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
def magic_item_catalog() -> MagicItemCatalogResponse:
    """Build the magic-item catalog response from the shipped data.

    Returns:
        Every shipped magic item as a picker summary, in catalog order.
    """
    return MagicItemCatalogResponse(
        items=tuple(
            CatalogMagicItem(id=template.id, name=template.name, category=template.category, cursed=template.cursed)
            for template in load_magic_items().items
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
