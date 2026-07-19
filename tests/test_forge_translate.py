"""The op→override translator: the round-trip theorem, the merge algebra, blocked ops, reasons."""

import shutil
from pathlib import Path

import pytest
from osrlib.crawl.adventure import Adventure
from osrlib.crawl.dungeon import Edge, EdgeKind

from osreditor.documents import DocumentService, OpenProject, forge_apply_bounds
from osreditor.documents import _apply_op as apply_op
from osreditor.errors import OpInvariantError, OpUnsupportedForgeError
from osreditor.ops import (
    AddDungeon,
    AddTransition,
    CreateArea,
    OpBatch,
    RemoveArea,
    RenameDungeon,
    ResizeLevel,
    SetAdventureField,
    SetAreaCells,
    SetAreaField,
    SetEdges,
    SetEncounter,
    SetEntrance,
    SetTownField,
    SetTreasure,
    SetWandering,
)
from osreditor.overrides import check_forge_ops, serialize_overrides
from osreditor.projects import open_project
from osreditor.store import LocalProjectStore

FIXTURE = Path(__file__).parent / "fixtures" / "forge_workdir"
DUNGEON = "sunken-vault"


def fstate(project: OpenProject):
    """Return a forge project's working state, asserting it is a forge project."""
    assert project.forge is not None
    return project.forge


def open_forge(tmp_path: Path):
    workdir = tmp_path / "vault.forge"
    shutil.copytree(FIXTURE, workdir)
    service = DocumentService(LocalProjectStore())
    return service, open_project(service, workdir)


def _candidate(assembled: Adventure, ops: tuple) -> Adventure:
    """Apply ops to the assembled document under the growth rule — the translator's candidate."""
    candidate = assembled
    with forge_apply_bounds():
        for op in ops:
            candidate, _ = apply_op(candidate, op)
    return Adventure.model_validate(candidate.model_dump())


def _normalize(adventure: Adventure) -> dict:
    """Project a document to the derivation-aware equivalence.

    The round-trip theorem holds modulo edge representation (an absent entry and
    an explicit `Edge(kind="wall")` are the same wall — the native model expresses
    by absence what forge's merge stores as a seal), level `width`/`height` (forge
    recomputes them as the plan's bounding box), and `Adventure.monsters` (assembly
    bundles only the custom templates the built encounters still reference);
    everything else must match exactly.
    """
    data = adventure.model_dump(mode="json")
    data["monsters"] = "<bundled>"
    for dungeon in data["dungeons"]:
        for level in dungeon["levels"]:
            level["width"] = "<derived>"
            level["height"] = "<derived>"
            # Strip explicit-wall entries so absence and a wall seal compare equal.
            level["edges"] = {key: edge for key, edge in level["edges"].items() if edge["kind"] != "wall"}
    return data


def assert_round_trip(service, project, ops: tuple) -> None:
    """Commit a batch and assert the re-assembled document equals the op-applied candidate (mod derivation)."""
    candidate = _candidate(project.adventure, ops)
    service.apply_batch(project, OpBatch(revision=project.revision, ops=ops))
    assert _normalize(project.adventure) == _normalize(candidate)
    # The overrides.yaml forge produced round-trips through its own loader.
    from osrforge.contracts.overrides import load_overrides

    reloaded = load_overrides(Path(project.path) / "overrides.yaml")
    assert reloaded == fstate(project).overrides


# --- The round-trip theorem across the supported table -------------------------


def test_round_trip_set_adventure_field(tmp_path: Path) -> None:
    service, project = open_forge(tmp_path)
    assert_round_trip(service, project, (SetAdventureField(field="name", value="Renamed"),))
    assert project.adventure.name == "Renamed"
    assert fstate(project).overrides.module is not None


def test_round_trip_set_town_field(tmp_path: Path) -> None:
    service, project = open_forge(tmp_path)
    assert_round_trip(service, project, (SetTownField(field="services", value=("smith", "healer")),))
    assert fstate(project).overrides.town is not None


def test_round_trip_set_area_description(tmp_path: Path) -> None:
    service, project = open_forge(tmp_path)
    ops = (SetAreaField(dungeon_id=DUNGEON, level_number=1, area_id="3", field="description", value="Corrected."),)
    assert_round_trip(service, project, ops)
    entry = fstate(project).overrides.areas[f"{DUNGEON}/1/3"]
    assert entry.description == "Corrected."


def test_round_trip_set_encounter_clear(tmp_path: Path) -> None:
    service, project = open_forge(tmp_path)
    ops = (SetEncounter(dungeon_id=DUNGEON, level_number=1, area_id="2", encounter=None),)
    assert_round_trip(service, project, ops)
    entry = fstate(project).overrides.areas[f"{DUNGEON}/1/2"]
    assert "encounter" in entry.model_fields_set and entry.encounter is None


def test_round_trip_set_treasure(tmp_path: Path) -> None:
    service, project = open_forge(tmp_path)
    from osrlib.crawl.dungeon import AreaTreasureSpec

    ops = (SetTreasure(dungeon_id=DUNGEON, level_number=1, area_id="3", treasure=AreaTreasureSpec(letters=("A",))),)
    assert_round_trip(service, project, ops)


def test_round_trip_create_area(tmp_path: Path) -> None:
    service, project = open_forge(tmp_path)
    ops = (
        CreateArea(dungeon_id=DUNGEON, level_number=1, area_id="side-vault", cells=((0, 0), (0, 1)), name="Side vault"),
    )
    assert_round_trip(service, project, ops)
    assert f"{DUNGEON}/1/side-vault" in fstate(project).overrides.areas
    assert "side-vault" in fstate(project).overrides.geometry[f"{DUNGEON}/1"].areas


def test_round_trip_set_area_cells(tmp_path: Path) -> None:
    service, project = open_forge(tmp_path)
    ops = (SetAreaCells(dungeon_id=DUNGEON, level_number=1, area_id="1", cells=((2, 2), (2, 3), (3, 3))),)
    assert_round_trip(service, project, ops)


def test_round_trip_remove_survey_area(tmp_path: Path) -> None:
    service, project = open_forge(tmp_path)
    ops = (RemoveArea(dungeon_id=DUNGEON, level_number=1, area_id="3"),)
    assert_round_trip(service, project, ops)
    assert fstate(project).overrides.areas[f"{DUNGEON}/1/3"].remove is True


def test_round_trip_draw_open_edge(tmp_path: Path) -> None:
    service, project = open_forge(tmp_path)
    ops = (SetEdges(dungeon_id=DUNGEON, level_number=1, edges={"1,1:north": Edge(kind=EdgeKind.OPEN)}),)
    assert_round_trip(service, project, ops)


def _first_open_edge(project) -> str:
    level = next(lvl for d in project.adventure.dungeons for lvl in d.levels if lvl.number == 1)
    return next(key for key, edge in level.edges.items() if edge.kind is EdgeKind.OPEN)


def test_wall_gesture_over_a_synthesized_opening_lands_an_explicit_wall_seal(tmp_path: Path) -> None:
    # Deleting a synthesized-open edge (the native wall gesture) must translate to
    # an explicit Edge(kind=wall) — the seal forge's merge stores over synthesis.
    service, project = open_forge(tmp_path)
    open_key = _first_open_edge(project)
    ops = (SetEdges(dungeon_id=DUNGEON, level_number=1, edges={open_key: None}),)
    assert_round_trip(service, project, ops)
    edges = fstate(project).overrides.geometry[f"{DUNGEON}/1"].edges
    assert edges[open_key].kind is EdgeKind.WALL


def test_edge_edit_matching_the_assembled_state_is_a_no_op(tmp_path: Path) -> None:
    # Re-asserting an edge the assembled document already holds emits no entry —
    # the semantic diff detects the no-op.
    service, project = open_forge(tmp_path)
    open_key = _first_open_edge(project)
    ops = (SetEdges(dungeon_id=DUNGEON, level_number=1, edges={open_key: Edge(kind=EdgeKind.OPEN)}),)
    service.apply_batch(project, OpBatch(revision=project.revision, ops=ops))
    geometry = fstate(project).overrides.geometry.get(f"{DUNGEON}/1")
    assert geometry is None or open_key not in geometry.edges


def test_round_trip_set_entrance(tmp_path: Path) -> None:
    service, project = open_forge(tmp_path)
    ops = (SetEntrance(dungeon_id=DUNGEON, level_number=1, entrance=(1, 1)),)
    assert_round_trip(service, project, ops)
    assert fstate(project).overrides.geometry[f"{DUNGEON}/1"].entrance == (1, 1)


def test_round_trip_transitions(tmp_path: Path) -> None:
    service, project = open_forge(tmp_path)
    from osrlib.crawl.dungeon import Direction, TransitionSpec

    transition = TransitionSpec(
        kind="stairs_down",
        position=(0, 0),
        to_dungeon_id=DUNGEON,
        to_level_number=2,
        to_position=(0, 0),
        to_facing=Direction.NORTH,
    )
    ops = (AddTransition(dungeon_id=DUNGEON, level_number=1, transition=transition),)
    assert_round_trip(service, project, ops)


def test_round_trip_growth_beyond_extent(tmp_path: Path) -> None:
    # The flagship growth case: redrawing an area past the current dimensions.
    # ResizeLevel is blocked, so growth is carried by the area cells alone.
    service, project = open_forge(tmp_path)
    level = next(level for d in project.adventure.dungeons for level in d.levels if level.number == 1)
    far = (level.width + 3, level.height + 3)
    ops = (SetAreaCells(dungeon_id=DUNGEON, level_number=1, area_id="1", cells=((0, 0), far)),)
    assert_round_trip(service, project, ops)
    grown = next(lvl for d in project.adventure.dungeons for lvl in d.levels if lvl.number == 1)
    assert grown.width >= far[0] + 1 and grown.height >= far[1] + 1


# --- The merge algebra ---------------------------------------------------------


def test_successive_edits_merge_into_one_entry(tmp_path: Path) -> None:
    service, project = open_forge(tmp_path)
    addr = f"{DUNGEON}/1/3"
    service.apply_batch(
        project,
        OpBatch(
            revision=project.revision,
            ops=(SetAreaField(dungeon_id=DUNGEON, level_number=1, area_id="3", field="name", value="First"),),
        ),
    )
    service.apply_batch(
        project,
        OpBatch(
            revision=project.revision,
            ops=(SetAreaField(dungeon_id=DUNGEON, level_number=1, area_id="3", field="description", value="Second"),),
        ),
    )
    entry = fstate(project).overrides.areas[addr]
    assert entry.name == "First" and entry.description == "Second"


def test_remove_then_recreate_collapses_to_replacement(tmp_path: Path) -> None:
    # A merge-algebra case, not a round-trip one: the naive candidate appends the
    # recreated area at the end, while the collapse keeps the survey key in survey
    # position — so the documents differ in area order by design. What must hold is
    # the override structure and the re-assembled content.
    service, project = open_forge(tmp_path)
    addr = f"{DUNGEON}/1/2"
    ops = (
        RemoveArea(dungeon_id=DUNGEON, level_number=1, area_id="2"),
        CreateArea(dungeon_id=DUNGEON, level_number=1, area_id="2", cells=((0, 0),), name="Rebuilt", description="New"),
    )
    service.apply_batch(project, OpBatch(revision=project.revision, ops=ops))
    entry = fstate(project).overrides.areas[addr]
    # A replacement, not a removal; survey content explicitly cleared.
    assert entry.remove is False
    assert entry.name == "Rebuilt"
    assert "encounter" in entry.model_fields_set and entry.encounter is None
    assert "trap" in entry.model_fields_set and entry.trap is None
    # The re-assembled document keeps area 2 in survey position with the new content.
    level = next(lvl for d in project.adventure.dungeons for lvl in d.levels if lvl.number == 1)
    rebuilt = next(area for area in level.areas if area.id == "2")
    assert rebuilt.name == "Rebuilt" and rebuilt.encounter is None
    # The overrides round-trip through forge's own loader.
    from osrforge.contracts.overrides import load_overrides

    assert load_overrides(Path(project.path) / "overrides.yaml") == fstate(project).overrides


def test_hand_authored_edge_keys_are_canonicalized(tmp_path: Path) -> None:
    service, project = open_forge(tmp_path)
    # A hand-authored overrides.yaml carrying a south/east key.
    (Path(project.path) / "overrides.yaml").write_text(
        f"geometry:\n  {DUNGEON}/1:\n    edges:\n      1,1:south:\n        kind: open\n    reason: hand authored\n",
        encoding="utf-8",
    )
    fstate(project).overrides = __import__("osrforge.contracts.overrides", fromlist=["load_overrides"]).load_overrides(
        Path(project.path) / "overrides.yaml"
    )
    # Any geometry edit rewrites the entry; the south key canonicalizes to a north key.
    service.apply_batch(
        project,
        OpBatch(
            revision=project.revision,
            ops=(SetEdges(dungeon_id=DUNGEON, level_number=1, edges={"2,2:west": Edge(kind=EdgeKind.OPEN)}),),
        ),
    )
    keys = set(fstate(project).overrides.geometry[f"{DUNGEON}/1"].edges)
    assert "1,1:south" not in keys
    assert "1,2:north" in keys  # 1,1:south == 1,2:north canonically


# --- Blocked ops ---------------------------------------------------------------


@pytest.mark.parametrize(
    "op",
    [
        SetWandering.model_validate(
            {"dungeon_id": DUNGEON, "level_number": 1, "wandering": {"chance_in_six": 1, "interval_turns": 2}}
        ),
        RenameDungeon(old_id=DUNGEON, new_id="renamed"),
        AddDungeon(dungeon_id="extra", width=10, height=10),
        ResizeLevel(dungeon_id=DUNGEON, level_number=1, width=40, height=40),
        SetAreaField(dungeon_id=DUNGEON, level_number=1, area_id="1", field="id", value="renamed"),
    ],
)
def test_blocked_ops_reject_the_whole_batch(tmp_path: Path, op) -> None:
    service, project = open_forge(tmp_path)
    before = project.adventure.model_dump()
    with pytest.raises(OpUnsupportedForgeError) as excinfo:
        service.apply_batch(project, OpBatch(revision=project.revision, ops=(op,)))
    assert excinfo.value.op == op.op
    # Whole-batch rejection: the document is untouched.
    assert project.adventure.model_dump() == before


def test_blocked_op_carries_op_and_address(tmp_path: Path) -> None:
    open_forge(tmp_path)
    with pytest.raises(OpUnsupportedForgeError) as excinfo:
        check_forge_ops(
            (
                SetWandering.model_validate(
                    {"dungeon_id": DUNGEON, "level_number": 1, "wandering": {"chance_in_six": 1, "interval_turns": 2}}
                ),
            )
        )
    assert excinfo.value.op == "set_wandering"
    assert excinfo.value.address == f"dungeon:{DUNGEON}/level:1"


def test_forge_slash_in_area_id_is_op_invariant(tmp_path: Path) -> None:
    with pytest.raises(OpInvariantError):
        check_forge_ops((CreateArea(dungeon_id=DUNGEON, level_number=1, area_id="a/b", cells=((0, 0),)),))


# --- Reasons -------------------------------------------------------------------


def test_reason_is_page_anchored_and_latest_wins(tmp_path: Path) -> None:
    service, project = open_forge(tmp_path)
    service.apply_batch(
        project,
        OpBatch(
            revision=project.revision,
            ops=(SetAreaField(dungeon_id=DUNGEON, level_number=1, area_id="3", field="description", value="One"),),
        ),
    )
    reason = fstate(project).overrides.areas[f"{DUNGEON}/1/3"].reason
    assert "area 3" in reason and "p. 2" in reason  # area 3's source page is 2
    # A later auto-draft wins.
    service.apply_batch(
        project,
        OpBatch(
            revision=project.revision,
            ops=(SetAreaField(dungeon_id=DUNGEON, level_number=1, area_id="3", field="name", value="Two"),),
        ),
    )
    assert "name" in fstate(project).overrides.areas[f"{DUNGEON}/1/3"].reason


def test_human_composed_reason_is_preserved_through_a_merge(tmp_path: Path) -> None:
    service, project = open_forge(tmp_path)
    addr = f"{DUNGEON}/1/3"

    # A first edit lands a machine draft; a human then composes the reason.
    service.apply_batch(
        project,
        OpBatch(
            revision=project.revision,
            ops=(SetAreaField(dungeon_id=DUNGEON, level_number=1, area_id="3", field="name", value="First"),),
        ),
    )
    human = fstate(project).overrides.model_copy(
        update={
            "areas": {
                **fstate(project).overrides.areas,
                addr: fstate(project).overrides.areas[addr].model_copy(update={"reason": "Human wording."}),
            }
        }
    )
    # Drop the entry from auto_reasons (a human composed it).
    kept = tuple(r for r in project.sidecar.auto_reasons if r != f"areas:{addr}")
    service.commit_forge_overrides(project, project.revision, human, kept)
    # A later op merges into the entry but must not overwrite the human's reason.
    service.apply_batch(
        project,
        OpBatch(
            revision=project.revision,
            ops=(SetAreaField(dungeon_id=DUNGEON, level_number=1, area_id="3", field="description", value="Third"),),
        ),
    )
    assert fstate(project).overrides.areas[addr].reason == "Human wording."


# --- Serialization -------------------------------------------------------------


def test_serialize_is_deterministic_and_round_trips(tmp_path: Path) -> None:
    service, project = open_forge(tmp_path)
    ops = (
        SetAdventureField(field="name", value="Ordered"),
        SetAreaField(dungeon_id=DUNGEON, level_number=1, area_id="3", field="name", value="Cell"),
    )
    service.apply_batch(project, OpBatch(revision=project.revision, ops=ops))
    first = serialize_overrides(fstate(project).overrides)
    second = serialize_overrides(fstate(project).overrides)
    assert first == second
    from osrforge.contracts.overrides import load_overrides

    (tmp_path / "rt.yaml").write_bytes(first)
    assert load_overrides(tmp_path / "rt.yaml") == fstate(project).overrides
