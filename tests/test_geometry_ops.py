"""Geometry ops through the service: apply and reject per invariant, delta pointers, atomicity."""

from pathlib import Path

import pytest
from osrlib.crawl.adventure import Adventure, TownSpec
from osrlib.crawl.dungeon import (
    AreaSpec,
    Direction,
    DoorSpec,
    DungeonSpec,
    Edge,
    EdgeKind,
    LevelSpec,
    TransitionSpec,
)

from osreditor.documents import DocumentService, OpenProject, dump_adventure
from osreditor.errors import OpInvariantError, OpTargetNotFoundError
from osreditor.ops import (
    AddTransition,
    AnyEditOp,
    CreateArea,
    OpBatch,
    RemoveArea,
    RemoveTransition,
    SetAreaCells,
    SetAreaField,
    SetEdges,
    SetEntrance,
)
from osreditor.projects import open_project
from osreditor.store import LocalProjectStore

OPEN = Edge(kind=EdgeKind.OPEN)
DOOR = Edge(kind=EdgeKind.DOOR, door=DoorSpec())


def level(**overrides: object) -> LevelSpec:
    values: dict[str, object] = {"number": 1, "width": 3, "height": 3, "entrance": (0, 0)}
    values.update(overrides)
    return LevelSpec.model_validate(values)


def transition(**overrides: object) -> TransitionSpec:
    values: dict[str, object] = {
        "kind": "stairs_down",
        "position": (1, 1),
        "to_dungeon_id": "d",
        "to_level_number": 2,
        "to_position": (0, 0),
        "to_facing": Direction.NORTH,
    }
    values.update(overrides)
    return TransitionSpec.model_validate(values)


@pytest.fixture
def service() -> DocumentService:
    return DocumentService(LocalProjectStore())


def make_project(service: DocumentService, tmp_path: Path, *levels: LevelSpec) -> OpenProject:
    adventure = Adventure(
        name="Fixture",
        town=TownSpec(name=""),
        dungeons=(DungeonSpec(id="d", levels=levels or (level(),)),),
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


def the_level(project: OpenProject) -> LevelSpec:
    return project.adventure.dungeons[0].levels[0]


def edges_op(entries: dict[str, Edge | None]) -> SetEdges:
    return SetEdges(dungeon_id="d", level_number=1, edges=entries)


def test_set_edges_applies_a_batch_of_assignments(service: DocumentService, tmp_path: Path) -> None:
    project = make_project(service, tmp_path)
    result = commit(service, project, edges_op({"1,0:west": OPEN, "1,1:north": DOOR}))
    assert the_level(project).edges == {"1,0:west": OPEN, "1,1:north": DOOR}
    assert result.delta[0].path == "/dungeons/0/levels/0/edges"


def test_set_edges_replaces_an_existing_entry_in_place(service: DocumentService, tmp_path: Path) -> None:
    project = make_project(service, tmp_path, level(edges={"1,0:west": OPEN, "1,1:north": OPEN}))
    commit(service, project, edges_op({"1,0:west": DOOR}))
    assert list(the_level(project).edges) == ["1,0:west", "1,1:north"]
    assert the_level(project).edges["1,0:west"] == DOOR


@pytest.mark.parametrize(
    "key",
    [
        "0,1:south",  # canonical side only — south folds onto the neighbour's north
        "1,0:east",
        "01,1:north",  # no leading zeros
        "1,-1:north",  # non-negative
        "nonsense",
        "1,1",
        "1,1:up",
    ],
)
def test_set_edges_rejects_non_canonical_keys(service: DocumentService, tmp_path: Path, key: str) -> None:
    project = make_project(service, tmp_path)
    error = reject(service, project, OpInvariantError, edges_op({key: OPEN}))
    assert "not canonical" in str(error)


@pytest.mark.parametrize(
    "key",
    [
        "0,0:north",  # neighbour (0, -1)
        "0,0:west",  # neighbour (-1, 0)
        "3,1:west",  # own cell x == width
        "1,3:north",  # own cell y == height
    ],
)
def test_set_edges_rejects_out_of_bounds_incident_cells(service: DocumentService, tmp_path: Path, key: str) -> None:
    project = make_project(service, tmp_path)
    error = reject(service, project, OpInvariantError, edges_op({key: OPEN}))
    assert "out-of-bounds" in str(error)


def test_set_edges_rejects_an_explicit_wall_entry(service: DocumentService, tmp_path: Path) -> None:
    project = make_project(service, tmp_path)
    error = reject(service, project, OpInvariantError, edges_op({"1,1:north": Edge(kind=EdgeKind.WALL)}))
    assert "explicit wall" in str(error)


def test_set_edges_deletes_any_existing_key_including_foreign_junk(service: DocumentService, tmp_path: Path) -> None:
    # A foreign document legally carries malformed, non-canonical, and
    # explicit-wall entries; deletion authors no key, so all stay deletable.
    foreign = {
        "bogus": OPEN,
        "0,1:south": OPEN,
        "1,0:west": Edge(kind=EdgeKind.WALL),
        "2,1:north": OPEN,
    }
    project = make_project(service, tmp_path, level(edges=foreign))
    commit(
        service,
        project,
        edges_op({"bogus": None, "0,1:south": None, "1,0:west": None}),
    )
    assert the_level(project).edges == {"2,1:north": OPEN}


def test_set_edges_rejects_a_delete_naming_no_entry(service: DocumentService, tmp_path: Path) -> None:
    project = make_project(service, tmp_path)
    error = reject(service, project, OpInvariantError, edges_op({"1,1:north": None}))
    assert "names no existing entry" in str(error)


def test_set_entrance_places_and_clears(service: DocumentService, tmp_path: Path) -> None:
    project = make_project(service, tmp_path)
    result = commit(service, project, SetEntrance(dungeon_id="d", level_number=1, entrance=(2, 2)))
    assert the_level(project).entrance == (2, 2)
    assert result.delta[0].path == "/dungeons/0/levels/0/entrance"
    cleared = commit(service, project, SetEntrance(dungeon_id="d", level_number=1, entrance=None))
    assert the_level(project).entrance is None
    # The legal, navigable consequence — not a rejection.
    assert [finding.code for finding in cleared.diagnostics.validation] == ["entrance_missing"]


def test_set_entrance_rejects_out_of_bounds(service: DocumentService, tmp_path: Path) -> None:
    project = make_project(service, tmp_path)
    reject(service, project, OpInvariantError, SetEntrance(dungeon_id="d", level_number=1, entrance=(3, 0)))


def test_create_area_applies_with_defaults(service: DocumentService, tmp_path: Path) -> None:
    project = make_project(service, tmp_path)
    result = commit(service, project, CreateArea(dungeon_id="d", level_number=1, area_id="1", cells=((0, 0), (1, 0))))
    area = the_level(project).areas[0]
    assert (area.id, area.name, area.description, area.cells) == ("1", "", "", ((0, 0), (1, 0)))
    assert result.delta[0].path == "/dungeons/0/levels/0/areas"


def test_create_area_rejects_duplicate_and_empty_ids(service: DocumentService, tmp_path: Path) -> None:
    project = make_project(service, tmp_path, level(areas=(AreaSpec(id="1", cells=((0, 0),)),)))
    reject(service, project, OpInvariantError, CreateArea(dungeon_id="d", level_number=1, area_id="1", cells=((1, 1),)))
    reject(service, project, OpInvariantError, CreateArea(dungeon_id="d", level_number=1, area_id="", cells=((1, 1),)))


def test_create_area_rejects_out_of_bounds_cells(service: DocumentService, tmp_path: Path) -> None:
    project = make_project(service, tmp_path)
    reject(service, project, OpInvariantError, CreateArea(dungeon_id="d", level_number=1, area_id="1", cells=((3, 3),)))


def test_create_area_admits_overlap_as_lint_territory(service: DocumentService, tmp_path: Path) -> None:
    project = make_project(service, tmp_path, level(areas=(AreaSpec(id="1", cells=((0, 0),)),)))
    result = commit(service, project, CreateArea(dungeon_id="d", level_number=1, area_id="2", cells=((0, 0),)))
    assert "area_overlap" in [finding.code for finding in result.diagnostics.lint]


def test_set_area_cells_replaces_wholesale(service: DocumentService, tmp_path: Path) -> None:
    project = make_project(service, tmp_path, level(areas=(AreaSpec(id="1", cells=((0, 0),)),)))
    commit(service, project, SetAreaCells(dungeon_id="d", level_number=1, area_id="1", cells=((1, 1), (2, 1))))
    assert the_level(project).areas[0].cells == ((1, 1), (2, 1))


def test_set_area_cells_rejects_out_of_bounds(service: DocumentService, tmp_path: Path) -> None:
    project = make_project(service, tmp_path, level(areas=(AreaSpec(id="1", cells=((0, 0),)),)))
    reject(
        service, project, OpInvariantError, SetAreaCells(dungeon_id="d", level_number=1, area_id="1", cells=((9, 9),))
    )


def test_set_area_field_rekeys_and_edits_prose(service: DocumentService, tmp_path: Path) -> None:
    project = make_project(service, tmp_path, level(areas=(AreaSpec(id="1", cells=((0, 0),)),)))
    commit(service, project, SetAreaField(dungeon_id="d", level_number=1, area_id="1", field="id", value="7"))
    commit(service, project, SetAreaField(dungeon_id="d", level_number=1, area_id="7", field="name", value="Crypt"))
    area = the_level(project).areas[0]
    assert (area.id, area.name) == ("7", "Crypt")


def test_set_area_field_rejects_duplicate_and_empty_ids(service: DocumentService, tmp_path: Path) -> None:
    areas = (AreaSpec(id="1", cells=((0, 0),)), AreaSpec(id="2", cells=((1, 1),)))
    project = make_project(service, tmp_path, level(areas=areas))
    reject(
        service,
        project,
        OpInvariantError,
        SetAreaField(dungeon_id="d", level_number=1, area_id="1", field="id", value="2"),
    )
    reject(
        service,
        project,
        OpInvariantError,
        SetAreaField(dungeon_id="d", level_number=1, area_id="1", field="id", value=""),
    )


def test_remove_area_leaves_corridor(service: DocumentService, tmp_path: Path) -> None:
    project = make_project(service, tmp_path, level(areas=(AreaSpec(id="1", cells=((0, 0),)),)))
    result = commit(service, project, RemoveArea(dungeon_id="d", level_number=1, area_id="1"))
    assert the_level(project).areas == ()
    assert result.delta[0].path == "/dungeons/0/levels/0/areas"


@pytest.mark.parametrize(
    "op",
    [
        SetAreaCells(dungeon_id="d", level_number=1, area_id="nope", cells=((0, 0),)),
        SetAreaField(dungeon_id="d", level_number=1, area_id="nope", field="name", value="x"),
        RemoveArea(dungeon_id="d", level_number=1, area_id="nope"),
        RemoveTransition(dungeon_id="d", level_number=1, position=(1, 1)),
        SetEdges(dungeon_id="nope", level_number=1, edges={"1,1:north": OPEN}),
        SetEntrance(dungeon_id="d", level_number=9, entrance=(0, 0)),
    ],
)
def test_targeting_misses_reject_whole(service: DocumentService, tmp_path: Path, op: AnyEditOp) -> None:
    project = make_project(service, tmp_path)
    reject(service, project, OpTargetNotFoundError, op)


def test_add_transition_applies_and_admits_a_dangling_target(service: DocumentService, tmp_path: Path) -> None:
    project = make_project(service, tmp_path)
    result = commit(
        service, project, AddTransition(dungeon_id="d", level_number=1, transition=transition(to_level_number=9))
    )
    assert the_level(project).transitions[0].to_level_number == 9
    assert result.delta[0].path == "/dungeons/0/levels/0/transitions"
    # The dangling target is a diagnostic, never a rejection — an import may
    # land stairs before their destination level exists.
    assert "transition_target_unknown" in [finding.code for finding in result.diagnostics.validation]


def test_add_transition_rejects_an_occupied_cell(service: DocumentService, tmp_path: Path) -> None:
    project = make_project(service, tmp_path, level(transitions=(transition(),)))
    error = reject(
        service,
        project,
        OpInvariantError,
        AddTransition(dungeon_id="d", level_number=1, transition=transition(kind="chute")),
    )
    assert "already has a transition" in str(error)


def test_add_transition_rejects_an_out_of_bounds_source(service: DocumentService, tmp_path: Path) -> None:
    project = make_project(service, tmp_path)
    reject(
        service,
        project,
        OpInvariantError,
        AddTransition(dungeon_id="d", level_number=1, transition=transition(position=(9, 9))),
    )


def test_remove_transition_removes_the_first_match(service: DocumentService, tmp_path: Path) -> None:
    # A foreign document can stack two transitions on one cell; first-match is
    # osrlib's own resolution order, so remove-per-entry sequences stay correct.
    stacked = (transition(kind="stairs_down"), transition(kind="chute"))
    project = make_project(service, tmp_path, level(transitions=stacked))
    commit(service, project, RemoveTransition(dungeon_id="d", level_number=1, position=(1, 1)))
    assert [t.kind for t in the_level(project).transitions] == ["chute"]
    commit(service, project, RemoveTransition(dungeon_id="d", level_number=1, position=(1, 1)))
    assert the_level(project).transitions == ()


def test_a_mixed_batch_is_atomic(service: DocumentService, tmp_path: Path) -> None:
    project = make_project(service, tmp_path)
    before = project.adventure
    with pytest.raises(OpInvariantError):
        commit(
            service,
            project,
            CreateArea(dungeon_id="d", level_number=1, area_id="1", cells=((0, 0),)),
            edges_op({"0,0:north": OPEN}),
        )
    assert project.adventure is before
    assert service.store.read_artifact(str(project.path), "adventure.json") == dump_adventure(before)


def test_a_compound_gesture_is_one_undo_step(service: DocumentService, tmp_path: Path) -> None:
    project = make_project(service, tmp_path)
    commit(
        service,
        project,
        CreateArea(dungeon_id="d", level_number=1, area_id="1", cells=((1, 0), (2, 0))),
        edges_op({"2,0:west": OPEN}),
    )
    assert the_level(project).areas and the_level(project).edges
    service.undo(project)
    assert the_level(project).areas == () and the_level(project).edges == {}
