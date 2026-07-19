"""The catalog routes: shapes and counts against the installed osrlib."""

import pytest
from fastapi.testclient import TestClient
from osrlib.data import load_encounter_tables, load_equipment, load_monsters, load_treasure_tables

from osreditor.app import create_app
from osreditor.catalogs import encounter_table_catalog


@pytest.fixture
def client() -> TestClient:
    return TestClient(create_app())


def test_monster_catalog_serves_the_shipped_list(client: TestClient) -> None:
    response = client.get("/api/catalogs/monsters")
    assert response.status_code == 200
    monsters = response.json()["monsters"]
    shipped = load_monsters().monsters
    assert len(monsters) == len(shipped)
    assert [entry["id"] for entry in monsters] == [template.id for template in shipped]


def test_monster_catalog_entries_carry_the_picker_fields(client: TestClient) -> None:
    monsters = client.get("/api/catalogs/monsters").json()["monsters"]
    skeleton = next(entry for entry in monsters if entry["id"] == "skeleton")
    template = load_monsters().get("skeleton")
    assert skeleton == {
        "id": "skeleton",
        "name": template.name,
        "page": template.page,
        "categories": list(template.categories),
        "alignment_options": [option.value for option in template.alignment.options],
        "usual_alignment": template.alignment.usual.value if template.alignment.usual else None,
        "hit_dice": template.hit_dice.model_dump(mode="json"),
    }


def test_equipment_catalog_serves_the_four_pickable_lists(client: TestClient) -> None:
    response = client.get("/api/catalogs/equipment")
    assert response.status_code == 200
    items = response.json()["items"]
    equipment = load_equipment()
    pickable = (*equipment.weapons, *equipment.armour, *equipment.gear, *equipment.ammunition)
    assert [entry["id"] for entry in items] == [template.id for template in pickable]
    assert {entry["item_type"] for entry in items} == {"weapon", "armour", "gear", "ammunition"}
    sword = next(entry for entry in items if entry["id"] == "sword")
    assert sword["cost_gp"] == equipment.get("sword").cost_gp


def test_equipment_catalog_excludes_treasure_weights(client: TestClient) -> None:
    items = client.get("/api/catalogs/equipment").json()["items"]
    equipment = load_equipment()
    # Treasure weights are not id-addressable equipment (`EquipmentCatalog.get`
    # never resolves them), so the response carries exactly the four lists and
    # nothing more. (Id-set disjointness cannot be the assertion: 'staff' is
    # legitimately both a weapon and a treasure-weight row — separate
    # namespaces.)
    assert len(items) == len(equipment.weapons) + len(equipment.armour) + len(equipment.gear) + len(
        equipment.ammunition
    )


def test_treasure_type_catalog_serves_the_shipped_letters(client: TestClient) -> None:
    response = client.get("/api/catalogs/treasure-types")
    assert response.status_code == 200
    types = response.json()["treasure_types"]
    shipped = load_treasure_tables().treasure_types
    assert [entry["letter"] for entry in types] == [table.letter for table in shipped]
    assert [entry["kind"] for entry in types] == [table.kind.value for table in shipped]
    assert {entry["kind"] for entry in types} == {"hoard", "individual", "group"}


def test_encounter_table_catalog_serves_the_compiled_tables_verbatim(client: TestClient) -> None:
    response = client.get("/api/catalogs/encounter-tables")
    assert response.status_code == 200
    tables = load_encounter_tables().tables
    assert response.json() == {"tables": [table.model_dump(mode="json") for table in tables]}
    # The NPC generation tables stay server-side: the response model carries
    # exactly the dungeon tables, nothing else.
    assert set(response.json()) == {"tables"}


def test_catalog_builders_cache_per_process() -> None:
    assert encounter_table_catalog() is encounter_table_catalog()
