"""The op→override translator: goldens, the round-trip theorem, the merge algebra, the blocked-op matrix."""

from pathlib import Path

import pytest
import yaml
from osrforge.contracts.overrides import load_overrides

from osreditor.documents import DocumentService, OpenProject, _apply_op
from osreditor.errors import OpInvariantError, OpUnsupportedForgeError
from osreditor.ops import OpBatch
from osreditor.overrides import serialize_overrides
from osreditor.projects import open_project
from osreditor.store import LocalProjectStore

DUNGEON = "millstone-warrens"

BESPOKE_TEMPLATE = {
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


def open_forge(workdir: Path) -> tuple[DocumentService, OpenProject]:
    service = DocumentService(LocalProjectStore())
    return service, open_project(service, workdir)


def batch(project: OpenProject, *ops: dict) -> OpBatch:
    return OpBatch.model_validate({"revision": project.revision, "ops": list(ops)})


def overrides_data(workdir: Path) -> dict:
    return yaml.safe_load((workdir / "overrides.yaml").read_text())


def normalized(document) -> dict:
    """The round-trip theorem's derivation-aware equivalence.

    Equal modulo edge representation (an absent entry and an explicit wall are
    the same wall), modulo level width/height (derived state forge recomputes
    as the bounding box), and modulo `Adventure.monsters` (assembly bundles
    only the templates the built encounters still reference).
    """
    data = document.model_dump(mode="json")
    data.pop("monsters")
    for dungeon in data["dungeons"]:
        for level in dungeon["levels"]:
            level.pop("width")
            level.pop("height")
            level["edges"] = {key: edge for key, edge in level["edges"].items() if edge["kind"] != "wall"}
    return data


def apply_and_check_roundtrip(service: DocumentService, project: OpenProject, *ops: dict) -> None:
    """Apply a batch and assert the theorem: assembled result ≡ op-applied candidate."""
    candidate = project.adventure
    for op_data in ops:
        op = OpBatch.model_validate({"revision": project.revision, "ops": [op_data]}).ops[0]
        candidate, _ = _apply_op(candidate, op, forge_mode=True)
    service.apply_batch(project, batch(project, *ops))
    assert normalized(project.adventure) == normalized(candidate)


# --- the per-op table, golden outputs ----------------------------------------


def test_set_adventure_field_translates_to_module_entry(forge_workdir: Path) -> None:
    service, project = open_forge(forge_workdir)
    apply_and_check_roundtrip(
        service,
        project,
        {"op": "set_adventure_field", "field": "name", "value": "The Millstone Warrens, revised"},
        {"op": "set_adventure_field", "field": "hooks", "value": ["A new hook."]},
    )
    assert (forge_workdir / "overrides.yaml").read_text() == (
        "module:\n"
        "  name: The Millstone Warrens, revised\n"
        "  hooks:\n"
        "  - A new hook.\n"
        "  reason: module name, hooks corrected\n"
    )
    assert load_overrides(forge_workdir / "overrides.yaml").module is not None


def test_set_town_field_translates_to_town_entry(forge_workdir: Path) -> None:
    service, project = open_forge(forge_workdir)
    apply_and_check_roundtrip(
        service,
        project,
        {"op": "set_town_field", "field": "travel_turns", "value": {DUNGEON: 4}},
    )
    assert overrides_data(forge_workdir) == {
        "town": {"travel_turns": {DUNGEON: 4}, "reason": "town travel_turns corrected"}
    }


def test_set_encounter_carries_the_osrlib_payload_verbatim(forge_workdir: Path) -> None:
    service, project = open_forge(forge_workdir)
    apply_and_check_roundtrip(
        service,
        project,
        {
            "op": "set_encounter",
            "dungeon_id": DUNGEON,
            "level_number": 1,
            "area_id": "1",
            "encounter": {"monsters": [{"template_id": "goblin", "count_dice": "2d4"}]},
        },
    )
    data = overrides_data(forge_workdir)
    entry = data["areas"][f"{DUNGEON}/1/1"]
    assert entry["encounter"]["monsters"][0]["template_id"] == "goblin"
    assert entry["encounter"]["monsters"][0]["count_dice"] == "2d4"
    encounter = project.adventure.dungeons[0].levels[0].areas[0].encounter
    assert encounter is not None and encounter.monsters[0].count_dice == "2d4"


def test_clearing_content_emits_explicit_null(forge_workdir: Path) -> None:
    service, project = open_forge(forge_workdir)
    # Area 1/2 has a cache-derived trap; None must clear it — present-and-null.
    assert project.adventure.dungeons[0].levels[0].areas[1].trap is not None
    apply_and_check_roundtrip(
        service,
        project,
        {"op": "set_trap", "dungeon_id": DUNGEON, "level_number": 1, "area_id": "2", "trap": None},
    )
    text = (forge_workdir / "overrides.yaml").read_text()
    assert "trap: null" in text
    assert project.adventure.dungeons[0].levels[0].areas[1].trap is None


def test_feature_ops_replace_the_tuple_wholesale(forge_workdir: Path) -> None:
    service, project = open_forge(forge_workdir)
    # Area 1/1 has one cache-derived feature; adding another writes both.
    apply_and_check_roundtrip(
        service,
        project,
        {
            "op": "add_feature",
            "dungeon_id": DUNGEON,
            "level_number": 1,
            "area_id": "1",
            "feature": {"id": "shaft-brake", "kind": "custom", "description": "A rusted brake lever."},
        },
    )
    entry = overrides_data(forge_workdir)["areas"][f"{DUNGEON}/1/1"]
    assert [feature["id"] for feature in entry["features"]] == ["1-f1", "shaft-brake"]


def test_create_area_emits_add_entry_plus_cells(forge_workdir: Path) -> None:
    service, project = open_forge(forge_workdir)
    apply_and_check_roundtrip(
        service,
        project,
        {
            "op": "create_area",
            "dungeon_id": DUNGEON,
            "level_number": 1,
            "area_id": "9",
            "cells": [[0, 4], [1, 4]],
            "name": "Hidden pantry",
            "description": "Shelves of forgotten preserves.",
        },
    )
    data = overrides_data(forge_workdir)
    assert data["areas"][f"{DUNGEON}/1/9"] == {
        "name": "Hidden pantry",
        "description": "Shelves of forgotten preserves.",
        "reason": "area 9 added",
    }
    assert data["geometry"][f"{DUNGEON}/1"]["areas"]["9"] == {"cells": [[0, 4], [1, 4]]}
    # The report tombstones the add — how later batches recognize it.
    assert project.forge is not None
    record = next(r for r in project.forge.report.areas if r.id == f"{DUNGEON}/1/9")
    assert record.overridden == ("added",)


def test_set_area_cells_updates_the_cells_entry(forge_workdir: Path) -> None:
    service, project = open_forge(forge_workdir)
    area = project.adventure.dungeons[0].levels[0].areas[0]
    new_cells = [list(cell) for cell in area.cells] + [[0, 3]]
    apply_and_check_roundtrip(
        service,
        project,
        {"op": "set_area_cells", "dungeon_id": DUNGEON, "level_number": 1, "area_id": "1", "cells": new_cells},
    )
    entry = overrides_data(forge_workdir)["geometry"][f"{DUNGEON}/1"]
    assert entry["areas"]["1"]["cells"] == new_cells
    assert entry["reason"] == "level 1 cells redrawn"


def test_remove_survey_area_translates_to_remove_true(forge_workdir: Path) -> None:
    service, project = open_forge(forge_workdir)
    # Give the area a field replacement and a cells entry first; the remove
    # must supersede both (forge rejects the combinations).
    service.apply_batch(
        project,
        batch(
            project,
            {
                "op": "set_area_field",
                "dungeon_id": DUNGEON,
                "level_number": 1,
                "area_id": "1",
                "field": "name",
                "value": "Renamed",
            },
            {
                "op": "set_area_cells",
                "dungeon_id": DUNGEON,
                "level_number": 1,
                "area_id": "1",
                "cells": [[0, 0], [1, 0]],
            },
        ),
    )
    apply_and_check_roundtrip(
        service,
        project,
        {"op": "remove_area", "dungeon_id": DUNGEON, "level_number": 1, "area_id": "1"},
    )
    data = overrides_data(forge_workdir)
    assert data["areas"][f"{DUNGEON}/1/1"] == {"remove": True, "reason": "area 1 removed"}
    assert "1" not in data.get("geometry", {}).get(f"{DUNGEON}/1", {}).get("areas", {})
    assert project.forge is not None
    record = next(r for r in project.forge.report.areas if r.id == f"{DUNGEON}/1/1")
    assert record.overridden == ("removed",)


def test_remove_added_area_deletes_the_add_entry(forge_workdir: Path) -> None:
    service, project = open_forge(forge_workdir)
    service.apply_batch(
        project,
        batch(
            project,
            {
                "op": "create_area",
                "dungeon_id": DUNGEON,
                "level_number": 1,
                "area_id": "9",
                "cells": [[0, 4]],
                "name": "Pantry",
                "description": "Shelves.",
            },
        ),
    )
    apply_and_check_roundtrip(
        service,
        project,
        {"op": "remove_area", "dungeon_id": DUNGEON, "level_number": 1, "area_id": "9"},
    )
    data = overrides_data(forge_workdir) or {}
    assert f"{DUNGEON}/1/9" not in data.get("areas", {})
    assert "9" not in data.get("geometry", {}).get(f"{DUNGEON}/1", {}).get("areas", {})


def test_remove_then_create_collapses_to_replacement_with_explicit_nulls(forge_workdir: Path) -> None:
    service, project = open_forge(forge_workdir)
    service.apply_batch(
        project,
        batch(
            project,
            {"op": "remove_area", "dungeon_id": DUNGEON, "level_number": 1, "area_id": "2"},
            {
                "op": "create_area",
                "dungeon_id": DUNGEON,
                "level_number": 1,
                "area_id": "2",
                "cells": [[2, 0], [3, 0]],
                "name": "Rebuilt cellar",
                "description": "Swept clean.",
            },
        ),
    )
    entry = overrides_data(forge_workdir)["areas"][f"{DUNGEON}/1/2"]
    # A replacement entry leaves unset survey fields in force, so a recreated
    # area must not resurrect the survey's content: explicit nulls.
    assert entry == {
        "name": "Rebuilt cellar",
        "description": "Swept clean.",
        "encounter": None,
        "trap": None,
        "treasure": None,
        "features": None,
        "reason": "area 2 replaced",
    }
    rebuilt = next(a for a in project.adventure.dungeons[0].levels[0].areas if a.id == "2")
    assert rebuilt.name == "Rebuilt cellar"
    assert rebuilt.encounter is None and rebuilt.trap is None and rebuilt.treasure is None
    assert rebuilt.features == ()
    # The collapse keeps the survey slot: the area sits where the survey put it.
    assert [a.id for a in project.adventure.dungeons[0].levels[0].areas] == ["1", "2", "3"]


def test_create_over_a_key_removed_in_an_earlier_commit_also_collapses(forge_workdir: Path) -> None:
    service, project = open_forge(forge_workdir)
    service.apply_batch(
        project, batch(project, {"op": "remove_area", "dungeon_id": DUNGEON, "level_number": 1, "area_id": "2"})
    )
    service.apply_batch(
        project,
        batch(
            project,
            {
                "op": "create_area",
                "dungeon_id": DUNGEON,
                "level_number": 1,
                "area_id": "2",
                "cells": [[2, 0]],
                "name": "Back again",
                "description": "The cellar returns.",
            },
        ),
    )
    entry = overrides_data(forge_workdir)["areas"][f"{DUNGEON}/1/2"]
    assert entry["encounter"] is None and entry["features"] is None
    assert "remove" not in entry


def test_wall_gesture_seals_a_synthesized_opening(forge_workdir: Path) -> None:
    service, project = open_forge(forge_workdir)
    level = project.adventure.dungeons[0].levels[0]
    open_key = next(key for key, edge in level.edges.items() if edge.kind.value == "open")
    apply_and_check_roundtrip(
        service,
        project,
        {"op": "set_edges", "dungeon_id": DUNGEON, "level_number": 1, "edges": {open_key: None}},
    )
    entry = overrides_data(forge_workdir)["geometry"][f"{DUNGEON}/1"]
    assert entry["edges"][open_key] == {"kind": "wall"}
    sealed = project.adventure.dungeons[0].levels[0].edges[open_key]
    assert sealed.kind.value == "wall"


def test_edge_value_translates_verbatim_and_diff_is_semantic(forge_workdir: Path) -> None:
    service, project = open_forge(forge_workdir)
    level = project.adventure.dungeons[0].levels[0]
    open_key = next(key for key, edge in level.edges.items() if edge.kind.value == "open")
    apply_and_check_roundtrip(
        service,
        project,
        {
            "op": "set_edges",
            "dungeon_id": DUNGEON,
            "level_number": 1,
            "edges": {open_key: {"kind": "door", "door": {"kind": "secret", "stuck": False, "locked": False}}},
        },
    )
    entry = overrides_data(forge_workdir)["geometry"][f"{DUNGEON}/1"]
    assert entry["edges"][open_key]["kind"] == "door"
    assert entry["edges"][open_key]["door"]["kind"] == "secret"


def test_wall_gesture_over_an_explicit_wall_keeps_the_entry(forge_workdir: Path) -> None:
    service, project = open_forge(forge_workdir)
    level = project.adventure.dungeons[0].levels[0]
    open_key = next(key for key, edge in level.edges.items() if edge.kind.value == "open")
    service.apply_batch(
        project,
        batch(project, {"op": "set_edges", "dungeon_id": DUNGEON, "level_number": 1, "edges": {open_key: None}}),
    )
    before = (forge_workdir / "overrides.yaml").read_text()
    # The assembled document now carries the explicit wall entry; the wall
    # gesture over it deletes in the candidate but must keep the override —
    # dropping it could silently re-open the synthesized passage underneath.
    apply_and_check_roundtrip(
        service,
        project,
        {"op": "set_edges", "dungeon_id": DUNGEON, "level_number": 1, "edges": {open_key: None}},
    )
    assert (forge_workdir / "overrides.yaml").read_text() == before


def test_set_entrance_translates_position_and_explicit_null(forge_workdir: Path) -> None:
    service, project = open_forge(forge_workdir)
    apply_and_check_roundtrip(
        service,
        project,
        {"op": "set_entrance", "dungeon_id": DUNGEON, "level_number": 1, "entrance": [1, 1]},
    )
    assert overrides_data(forge_workdir)["geometry"][f"{DUNGEON}/1"]["entrance"] == [1, 1]
    service.apply_batch(
        project,
        batch(project, {"op": "set_entrance", "dungeon_id": DUNGEON, "level_number": 1, "entrance": None}),
    )
    text = (forge_workdir / "overrides.yaml").read_text()
    assert "entrance: null" in text
    assert project.adventure.dungeons[0].levels[0].entrance is None


def test_transitions_replace_wholesale(forge_workdir: Path) -> None:
    service, project = open_forge(forge_workdir)
    level = project.adventure.dungeons[0].levels[0]
    existing = level.transitions[0]
    apply_and_check_roundtrip(
        service,
        project,
        {"op": "remove_transition", "dungeon_id": DUNGEON, "level_number": 1, "position": list(existing.position)},
        {
            "op": "add_transition",
            "dungeon_id": DUNGEON,
            "level_number": 1,
            "transition": {
                "kind": "stairs_down",
                "position": [0, 1],
                "to_dungeon_id": DUNGEON,
                "to_level_number": 2,
                "to_position": [0, 0],
                "to_facing": "south",
            },
        },
    )
    entry = overrides_data(forge_workdir)["geometry"][f"{DUNGEON}/1"]
    assert [t["position"] for t in entry["transitions"]] == [[0, 1]]
    # Correcting a guessed landing drops the transition_guessed badge with it.
    assert project.forge is not None
    record = next(r for r in project.forge.report.areas if r.id == f"{DUNGEON}/1/3")
    assert not any(flag.startswith("transition_guessed") for flag in record.flags)


# --- the growth rule ----------------------------------------------------------


def test_forge_geometry_admits_growth_beyond_the_current_extent(forge_workdir: Path) -> None:
    service, project = open_forge(forge_workdir)
    level = project.adventure.dungeons[0].levels[0]
    beyond = [level.width + 2, level.height + 2]
    apply_and_check_roundtrip(
        service,
        project,
        {
            "op": "create_area",
            "dungeon_id": DUNGEON,
            "level_number": 1,
            "area_id": "annex",
            "cells": [beyond],
            "name": "Annex",
            "description": "Beyond the old extent.",
        },
    )
    grown = project.adventure.dungeons[0].levels[0]
    # Forge recomputed the bounding box over the grown cells.
    assert grown.width == beyond[0] + 1
    assert grown.height == beyond[1] + 1


def test_negative_coordinates_stay_rejected_in_forge_mode(forge_workdir: Path) -> None:
    service, project = open_forge(forge_workdir)
    with pytest.raises(OpInvariantError) as excinfo:
        service.apply_batch(
            project,
            batch(
                project,
                {
                    "op": "create_area",
                    "dungeon_id": DUNGEON,
                    "level_number": 1,
                    "area_id": "bad",
                    "cells": [[-1, 0]],
                    "name": "",
                    "description": "",
                },
            ),
        )
    assert "negative" in str(excinfo.value)


def test_forge_mode_rejects_a_slash_in_a_new_area_id(forge_workdir: Path) -> None:
    service, project = open_forge(forge_workdir)
    with pytest.raises(OpInvariantError) as excinfo:
        service.apply_batch(
            project,
            batch(
                project,
                {
                    "op": "create_area",
                    "dungeon_id": DUNGEON,
                    "level_number": 1,
                    "area_id": "a/b",
                    "cells": [[0, 4]],
                    "name": "",
                    "description": "",
                },
            ),
        )
    assert "'/'" in str(excinfo.value)


# --- the blocked-op matrix ----------------------------------------------------

BLOCKED_OPS = [
    {
        "op": "set_wandering",
        "dungeon_id": DUNGEON,
        "level_number": 1,
        "wandering": {"chance_in_six": 1, "interval_turns": 2},
    },
    {"op": "set_dungeon_field", "dungeon_id": DUNGEON, "field": "name", "value": "Renamed"},
    {"op": "rename_dungeon", "old_id": DUNGEON, "new_id": "new-warrens"},
    {"op": "add_dungeon", "dungeon_id": "annex", "width": 5, "height": 5},
    {"op": "remove_dungeon", "dungeon_id": DUNGEON},
    {"op": "add_level", "dungeon_id": DUNGEON, "number": 3, "width": 5, "height": 5},
    {"op": "remove_level", "dungeon_id": DUNGEON, "level_number": 2},
    {"op": "renumber_level", "dungeon_id": DUNGEON, "old_number": 2, "new_number": 3},
    {"op": "resize_level", "dungeon_id": DUNGEON, "level_number": 1, "width": 40, "height": 40},
    {"op": "set_area_field", "dungeon_id": DUNGEON, "level_number": 1, "area_id": "2", "field": "id", "value": "2a"},
    {
        "op": "add_feature",
        "dungeon_id": DUNGEON,
        "level_number": 1,
        "area_id": None,
        "feature": {"id": "lvl", "kind": "custom"},
    },
    {"op": "add_monster_template", "template": BESPOKE_TEMPLATE},
    {"op": "set_monster_template", "template_id": "bespoke-1", "template": BESPOKE_TEMPLATE},
    {"op": "remove_monster_template", "template_id": "bespoke-1"},
]


@pytest.mark.parametrize("blocked", BLOCKED_OPS, ids=lambda op: str(op["op"]))
def test_blocked_ops_reject_with_the_detach_offer(forge_workdir: Path, blocked: dict) -> None:
    service, project = open_forge(forge_workdir)
    with pytest.raises(OpUnsupportedForgeError) as excinfo:
        service.apply_batch(project, batch(project, blocked))
    assert excinfo.value.op == blocked["op"]
    assert excinfo.value.address


def test_blocked_monster_template_ops_answer_the_monster_address(forge_workdir: Path) -> None:
    service, project = open_forge(forge_workdir)
    for op_data in (
        {"op": "add_monster_template", "template": BESPOKE_TEMPLATE},
        {"op": "set_monster_template", "template_id": "bespoke-1", "template": BESPOKE_TEMPLATE},
        {"op": "remove_monster_template", "template_id": "bespoke-1"},
    ):
        with pytest.raises(OpUnsupportedForgeError) as excinfo:
            service.apply_batch(project, batch(project, op_data))
        assert excinfo.value.address == "monster:bespoke-1"
        assert "assembly derives them from the monsters stage" in str(excinfo.value)


def test_a_blocked_op_rejects_the_whole_batch_before_any_side_effect(forge_workdir: Path) -> None:
    service, project = open_forge(forge_workdir)
    with pytest.raises(OpUnsupportedForgeError):
        service.apply_batch(
            project,
            batch(
                project,
                {
                    "op": "set_area_field",
                    "dungeon_id": DUNGEON,
                    "level_number": 1,
                    "area_id": "2",
                    "field": "name",
                    "value": "X",
                },
                {"op": "resize_level", "dungeon_id": DUNGEON, "level_number": 1, "width": 40, "height": 40},
            ),
        )
    assert not (forge_workdir / "overrides.yaml").exists()
    assert project.revision == "r1"


# --- the merge algebra and reasons -------------------------------------------


def test_successive_edits_merge_into_one_entry_and_redraft_the_reason(forge_workdir: Path) -> None:
    service, project = open_forge(forge_workdir)
    service.apply_batch(
        project,
        batch(
            project,
            {
                "op": "set_area_field",
                "dungeon_id": DUNGEON,
                "level_number": 1,
                "area_id": "2",
                "field": "name",
                "value": "The Flour Cellar",
            },
        ),
    )
    service.apply_batch(
        project,
        batch(
            project,
            {
                "op": "set_area_field",
                "dungeon_id": DUNGEON,
                "level_number": 1,
                "area_id": "2",
                "field": "description",
                "value": "Corrected.",
            },
        ),
    )
    data = overrides_data(forge_workdir)
    assert list(data["areas"]) == [f"{DUNGEON}/1/2"]
    entry = data["areas"][f"{DUNGEON}/1/2"]
    assert entry["name"] == "The Flour Cellar"
    assert entry["description"] == "Corrected."
    # Latest-wins across machine drafts: the second batch's draft replaced the first's.
    assert entry["reason"] == "area 2 description corrected against p. 1"


def test_a_human_composed_reason_survives_later_merges(forge_workdir: Path) -> None:
    service, project = open_forge(forge_workdir)
    service.apply_batch(
        project,
        batch(
            project,
            {
                "op": "set_area_field",
                "dungeon_id": DUNGEON,
                "level_number": 1,
                "area_id": "2",
                "field": "name",
                "value": "The Flour Cellar",
            },
        ),
    )
    # Simulate a human composing the reason: the ledger drops the key (item 4's
    # set_reason route owns this in production).
    ledger = tuple(k for k in project.sidecar.auto_reasons if k != f"areas:{DUNGEON}/1/2")
    project.sidecar = project.sidecar.model_copy(update={"auto_reasons": ledger})
    service.apply_batch(
        project,
        batch(
            project,
            {
                "op": "set_area_field",
                "dungeon_id": DUNGEON,
                "level_number": 1,
                "area_id": "2",
                "field": "description",
                "value": "Corrected.",
            },
        ),
    )
    entry = overrides_data(forge_workdir)["areas"][f"{DUNGEON}/1/2"]
    assert entry["reason"] == "area 2 name corrected against p. 1"


def test_hand_authored_east_south_keys_canonicalize_on_rewrite(forge_workdir: Path) -> None:
    (forge_workdir / "overrides.yaml").write_text(
        "geometry:\n"
        f"  {DUNGEON}/1:\n"
        "    edges:\n"
        "      0,0:east:\n"
        "        kind: open\n"
        "    reason: hand-authored opening\n",
        encoding="utf-8",
    )
    service, project = open_forge(forge_workdir)
    level = project.adventure.dungeons[0].levels[0]
    open_key = next(key for key, edge in level.edges.items() if edge.kind.value == "open" and key != "1,0:west")
    service.apply_batch(
        project,
        batch(project, {"op": "set_edges", "dungeon_id": DUNGEON, "level_number": 1, "edges": {open_key: None}}),
    )
    entry = overrides_data(forge_workdir)["geometry"][f"{DUNGEON}/1"]
    # 0,0:east canonicalized to 1,0:west; the hand-authored reason survives
    # (the entry never entered the machine-draft ledger).
    assert "0,0:east" not in entry["edges"]
    assert entry["edges"]["1,0:west"] == {"kind": "open"}
    assert entry["reason"] == "hand-authored opening"
    assert load_overrides(forge_workdir / "overrides.yaml").geometry


def test_serialization_is_deterministic_and_forge_loadable(forge_workdir: Path) -> None:
    service, project = open_forge(forge_workdir)
    service.apply_batch(
        project,
        batch(
            project,
            {
                "op": "set_area_field",
                "dungeon_id": DUNGEON,
                "level_number": 1,
                "area_id": "2",
                "field": "description",
                "value": "Corrected.",
            },
            {"op": "set_adventure_field", "field": "name", "value": "Renamed"},
        ),
    )
    written = (forge_workdir / "overrides.yaml").read_bytes()
    assert written.endswith(b"\n")
    loaded = load_overrides(forge_workdir / "overrides.yaml")
    assert serialize_overrides(loaded) == written
    assert project.forge is not None
    assert serialize_overrides(project.forge.overrides) == written


def test_kinds_serialize_in_overrides_field_order(forge_workdir: Path) -> None:
    service, project = open_forge(forge_workdir)
    service.apply_batch(
        project,
        batch(
            project,
            {"op": "set_adventure_field", "field": "name", "value": "Renamed"},
            {"op": "set_town_field", "field": "name", "value": "Bran's Crossing"},
            {
                "op": "set_area_field",
                "dungeon_id": DUNGEON,
                "level_number": 1,
                "area_id": "2",
                "field": "name",
                "value": "Cellar",
            },
            {"op": "set_entrance", "dungeon_id": DUNGEON, "level_number": 1, "entrance": [1, 1]},
        ),
    )
    data = overrides_data(forge_workdir)
    assert list(data) == ["areas", "geometry", "town", "module"]
