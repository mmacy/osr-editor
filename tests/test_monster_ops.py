"""Bundled monster-template ops through the service: the collision matrix, the rename cascade, atomicity."""

from pathlib import Path

import pytest
from osrlib.core.monsters import MonsterTemplate
from osrlib.core.tables import EncounterTable, EncounterTableRow, MonsterEncounterEntry
from osrlib.crawl.adventure import Adventure, TownSpec
from osrlib.crawl.dungeon import (
    AreaSpec,
    DungeonSpec,
    KeyedEncounter,
    KeyedMonster,
    LevelSpec,
    WanderingSpec,
)
from osrlib.data import load_monsters

from osreditor.documents import DocumentService, OpenProject, dump_adventure
from osreditor.errors import OpInvariantError, OpTargetNotFoundError
from osreditor.ops import (
    AddMonsterTemplate,
    AnyEditOp,
    OpBatch,
    RemoveMonsterTemplate,
    SetEncounter,
    SetMonsterTemplate,
)
from osreditor.projects import open_project
from osreditor.store import LocalProjectStore

SHIPPED_ID = load_monsters().monsters[0].id


def template(**overrides: object) -> MonsterTemplate:
    """A model-valid bespoke template — the seed block's shape, editable per test."""
    values: dict[str, object] = {
        "id": "bespoke-1",
        "name": "Bespoke horror",
        "page": "",
        "ac": 9,
        "ac_ascending": 10,
        "hit_dice": {"count": 1, "die": 8},
        "attacks": [{"attacks": [{"name": "weapon", "by_weapon": True}]}],
        "thac0": 19,
        "attack_bonus": 0,
        "movement": [{"rate_feet": 120, "encounter_rate_feet": 40}],
        "saves": {"values": {"death": 12, "wands": 13, "paralysis": 14, "breath": 15, "spells": 16}, "save_as": "1"},
        "morale": 7,
        "alignment": {"options": ["neutral"]},
        "xp": 10,
        "number_appearing": {"dungeon": {"dice": "1d6"}, "lair": {"dice": "1d6"}},
    }
    values.update(overrides)
    return MonsterTemplate.model_validate(values)


def area(**overrides: object) -> AreaSpec:
    values: dict[str, object] = {"id": "1", "cells": ((1, 1),)}
    values.update(overrides)
    return AreaSpec.model_validate(values)


def level(**overrides: object) -> LevelSpec:
    values: dict[str, object] = {"number": 1, "width": 3, "height": 3, "entrance": (0, 0), "areas": (area(),)}
    values.update(overrides)
    return LevelSpec.model_validate(values)


def wandering_with(monster_id: str) -> WanderingSpec:
    rows = tuple(
        EncounterTableRow(
            roll=roll,
            name=f"row {roll}",
            entry=MonsterEncounterEntry(monster_ids=(monster_id if roll == 1 else SHIPPED_ID,)),
            count_fixed=1,
        )
        for roll in range(1, 21)
    )
    return WanderingSpec(table=EncounterTable(id="t", label="Fixture", min_level=1, rows=rows))


@pytest.fixture
def service() -> DocumentService:
    return DocumentService(LocalProjectStore())


def make_project(
    service: DocumentService,
    tmp_path: Path,
    *levels: LevelSpec,
    monsters: tuple[MonsterTemplate, ...] = (),
) -> OpenProject:
    adventure = Adventure(
        name="Fixture",
        town=TownSpec(name=""),
        dungeons=(DungeonSpec(id="d", levels=levels or (level(),)),),
        monsters=monsters,
    )
    project_dir = tmp_path / "fixture.osr"
    service.store.write_artifact(str(project_dir), "adventure.json", dump_adventure(adventure))
    return open_project(service, project_dir)


def commit(service: DocumentService, project: OpenProject, *ops: AnyEditOp):
    return service.apply_batch(project, OpBatch(revision=project.revision, ops=ops))


def reject(service: DocumentService, project: OpenProject, error: type[Exception], *ops: AnyEditOp) -> Exception:
    before = project.adventure
    with pytest.raises(error) as excinfo:
        commit(service, project, *ops)
    assert project.adventure is before
    assert project.revision == "r1"
    return excinfo.value


# --- add / replace / remove ----------------------------------------------------


def test_add_appends_in_authored_order_with_the_monsters_pointer(service: DocumentService, tmp_path: Path) -> None:
    project = make_project(service, tmp_path, monsters=(template(id="first"),))
    added = template(id="second")
    result = commit(service, project, AddMonsterTemplate(template=added))
    assert [entry.id for entry in project.adventure.monsters] == ["first", "second"]
    assert result.delta[0].path == "/monsters"


def test_set_replaces_whole_value_with_the_monsters_pointer(service: DocumentService, tmp_path: Path) -> None:
    project = make_project(service, tmp_path, monsters=(template(),))
    replacement = template(name="Rewritten horror", morale=9)
    result = commit(service, project, SetMonsterTemplate(template_id="bespoke-1", template=replacement))
    assert project.adventure.monsters == (replacement,)
    assert result.delta[0].path == "/monsters"


def test_remove_drops_the_template(service: DocumentService, tmp_path: Path) -> None:
    project = make_project(service, tmp_path, monsters=(template(id="a"), template(id="b")))
    result = commit(service, project, RemoveMonsterTemplate(template_id="a"))
    assert [entry.id for entry in project.adventure.monsters] == ["b"]
    assert result.delta[0].path == "/monsters"


def test_remove_admits_dangling_references_as_diagnostics(service: DocumentService, tmp_path: Path) -> None:
    keyed = KeyedEncounter(monsters=(KeyedMonster(template_id="bespoke-1", count_fixed=1),))
    project = make_project(
        service,
        tmp_path,
        level(areas=(area(encounter=keyed),), wandering=wandering_with("bespoke-1")),
        monsters=(template(),),
    )
    result = commit(service, project, RemoveMonsterTemplate(template_id="bespoke-1"))
    codes = [finding.code for finding in result.diagnostics.validation]
    assert "encounter_unknown_monster" in codes
    assert "wandering_unknown_monster" in codes


def test_an_added_template_satisfies_a_dangling_encounter_reference(service: DocumentService, tmp_path: Path) -> None:
    dangling = KeyedEncounter(monsters=(KeyedMonster(template_id="bespoke-1", count_fixed=1),))
    project = make_project(service, tmp_path)
    result = commit(service, project, SetEncounter(dungeon_id="d", level_number=1, area_id="1", encounter=dangling))
    assert "encounter_unknown_monster" in [finding.code for finding in result.diagnostics.validation]
    result = commit(service, project, AddMonsterTemplate(template=template()))
    assert result.diagnostics.validation == ()


# --- the collision matrix --------------------------------------------------------


def test_add_rejects_a_shipped_catalog_collision(service: DocumentService, tmp_path: Path) -> None:
    project = make_project(service, tmp_path)
    error = reject(service, project, OpInvariantError, AddMonsterTemplate(template=template(id=SHIPPED_ID)))
    assert "collides with the shipped catalog" in str(error)


def test_add_rejects_a_bundled_collision(service: DocumentService, tmp_path: Path) -> None:
    project = make_project(service, tmp_path, monsters=(template(),))
    error = reject(service, project, OpInvariantError, AddMonsterTemplate(template=template(name="Twin")))
    assert "already bundles" in str(error)


def test_add_rejects_an_empty_id(service: DocumentService, tmp_path: Path) -> None:
    project = make_project(service, tmp_path)
    error = reject(service, project, OpInvariantError, AddMonsterTemplate(template=template(id="")))
    assert "non-empty" in str(error)


@pytest.mark.parametrize("taken_id", [SHIPPED_ID, "taken"])
def test_rename_falls_under_the_add_id_rules(service: DocumentService, tmp_path: Path, taken_id: str) -> None:
    project = make_project(service, tmp_path, monsters=(template(id="editable"), template(id="taken")))
    reject(
        service,
        project,
        OpInvariantError,
        SetMonsterTemplate(template_id="editable", template=template(id=taken_id)),
    )


def test_a_foreign_colliding_templates_unchanged_id_carries_through(service: DocumentService, tmp_path: Path) -> None:
    # The invariant is "no op ever introduces a collision", not "no colliding
    # document may be edited": the unchanged id never rejects, other fields
    # edit cleanly, and the finding stays a navigable diagnostic.
    project = make_project(service, tmp_path, monsters=(template(id=SHIPPED_ID),))
    result = commit(
        service,
        project,
        SetMonsterTemplate(template_id=SHIPPED_ID, template=template(id=SHIPPED_ID, name="Edited.")),
    )
    assert project.adventure.monsters[0].name == "Edited."
    assert "bundled_monster_collision" in [finding.code for finding in result.diagnostics.validation]


def test_a_rename_away_from_a_collision_clears_the_finding(service: DocumentService, tmp_path: Path) -> None:
    project = make_project(service, tmp_path, monsters=(template(id=SHIPPED_ID),))
    result = commit(
        service,
        project,
        SetMonsterTemplate(template_id=SHIPPED_ID, template=template(id="now-free")),
    )
    assert project.adventure.monsters[0].id == "now-free"
    assert result.diagnostics.validation == ()


# --- the rename cascade ----------------------------------------------------------


def test_rename_cascades_encounters_and_wandering_rows_with_the_whole_document_delta(
    service: DocumentService, tmp_path: Path
) -> None:
    keyed = KeyedEncounter(
        monsters=(
            KeyedMonster(template_id="bespoke-1", count_fixed=2),
            KeyedMonster(template_id=SHIPPED_ID, count_dice="1d4"),
        )
    )
    project = make_project(
        service,
        tmp_path,
        level(areas=(area(encounter=keyed),), wandering=wandering_with("bespoke-1")),
        monsters=(template(),),
    )
    result = commit(service, project, SetMonsterTemplate(template_id="bespoke-1", template=template(id="renamed")))
    assert result.delta == (result.delta[0],)
    assert result.delta[0].path == ""
    level_state = project.adventure.dungeons[0].levels[0]
    encounter = level_state.areas[0].encounter
    assert encounter is not None
    assert [keyed_line.template_id for keyed_line in encounter.monsters] == ["renamed", SHIPPED_ID]
    table = level_state.wandering.table
    assert table is not None
    first_entry = table.rows[0].entry
    assert first_entry.kind == "monster"
    assert first_entry.monster_ids == ("renamed",)
    assert result.diagnostics.validation == ()


def test_rename_is_one_undo_step_notes_included(service: DocumentService, tmp_path: Path) -> None:
    from osreditor.sidecar import SetNote

    keyed = KeyedEncounter(monsters=(KeyedMonster(template_id="bespoke-1", count_fixed=1),))
    project = make_project(service, tmp_path, level(areas=(area(encounter=keyed),)), monsters=(template(),))
    service.apply_sidecar_patch(project, (SetNote(address="monster:bespoke-1", text="Ours."),))
    commit(service, project, SetMonsterTemplate(template_id="bespoke-1", template=template(id="renamed")))
    assert project.sidecar.notes == {"monster:renamed": "Ours."}
    service.undo(project)
    assert project.adventure.monsters[0].id == "bespoke-1"
    encounter = project.adventure.dungeons[0].levels[0].areas[0].encounter
    assert encounter is not None
    assert encounter.monsters[0].template_id == "bespoke-1"
    assert project.sidecar.notes == {"monster:bespoke-1": "Ours."}
    service.redo(project)
    assert project.adventure.monsters[0].id == "renamed"
    assert project.sidecar.notes == {"monster:renamed": "Ours."}


def test_rename_onto_a_dangling_reference_resolves_it(service: DocumentService, tmp_path: Path) -> None:
    # References to the *new* id existed before the rename (dangling); the
    # rename makes them resolve — the diagnostic clears, no special handling.
    dangling = KeyedEncounter(monsters=(KeyedMonster(template_id="wanted", count_fixed=1),))
    project = make_project(service, tmp_path, level(areas=(area(encounter=dangling),)), monsters=(template(),))
    assert "encounter_unknown_monster" in [finding.code for finding in project.diagnostics.validation]
    result = commit(service, project, SetMonsterTemplate(template_id="bespoke-1", template=template(id="wanted")))
    assert result.diagnostics.validation == ()
    encounter = project.adventure.dungeons[0].levels[0].areas[0].encounter
    assert encounter is not None
    assert encounter.monsters[0].template_id == "wanted"


# --- targeting and first-match ----------------------------------------------------


def test_set_and_remove_resolve_first_match_over_foreign_duplicates(service: DocumentService, tmp_path: Path) -> None:
    twins = (template(name="First"), template(name="Second"))
    project = make_project(service, tmp_path, monsters=twins)
    commit(
        service,
        project,
        SetMonsterTemplate(template_id="bespoke-1", template=template(name="Edited first")),
    )
    assert [entry.name for entry in project.adventure.monsters] == ["Edited first", "Second"]
    commit(service, project, RemoveMonsterTemplate(template_id="bespoke-1"))
    assert [entry.name for entry in project.adventure.monsters] == ["Second"]


@pytest.mark.parametrize(
    "op",
    [
        SetMonsterTemplate(template_id="no-such", template=template(id="no-such")),
        RemoveMonsterTemplate(template_id="no-such"),
    ],
)
def test_unknown_targets_answer_op_target_not_found(service: DocumentService, tmp_path: Path, op: AnyEditOp) -> None:
    project = make_project(service, tmp_path, monsters=(template(),))
    reject(service, project, OpTargetNotFoundError, op)


# --- atomicity ---------------------------------------------------------------------


def test_a_mixed_batch_with_a_colliding_add_is_atomic(service: DocumentService, tmp_path: Path) -> None:
    project = make_project(service, tmp_path)
    before = project.adventure
    with pytest.raises(OpInvariantError):
        commit(
            service,
            project,
            AddMonsterTemplate(template=template(id="fine")),
            AddMonsterTemplate(template=template(id=SHIPPED_ID)),
        )
    assert project.adventure is before
    assert service.store.read_artifact(str(project.path), "adventure.json") == dump_adventure(before)


def test_a_collision_introduced_within_one_batch_rejects(service: DocumentService, tmp_path: Path) -> None:
    # The second add collides with the first — the invariant checks the
    # candidate document, so an intra-batch duplicate rejects like any other.
    project = make_project(service, tmp_path)
    with pytest.raises(OpInvariantError):
        commit(
            service,
            project,
            AddMonsterTemplate(template=template(id="twice")),
            AddMonsterTemplate(template=template(id="twice")),
        )
