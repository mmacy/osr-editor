"""The One Page Dungeon reader: sniff, the payload goldens, the door table, and every repair path.

The committed fixtures under `tests/assets/opd/` are hand-authored synthetic
OPD-shaped JSON — original material, never generator output; see that
directory's provenance note. The whole-payload goldens in `tests/fixtures/`
regenerate with `uv run python tests/generate_opd_goldens.py`, and regenerating
them is a reviewed decision, never a fix for a red test whose cause is not
understood.
"""

import json
from pathlib import Path

import pytest
from osrlib.crawl.adventure import Adventure, TownSpec
from osrlib.crawl.dungeon import (
    Direction,
    DoorSpec,
    DungeonSpec,
    Edge,
    EdgeKind,
    LevelSpec,
    Position,
    edge_key,
)

from osreditor.documents import (
    DocumentService,
    OpenProject,
    canonical_edge_cells,
    canonical_json_bytes,
    dump_adventure,
    load_adventure,
)
from osreditor.errors import ImportSourceInvalidError
from osreditor.importers import ImportedGeometry, ImportedLevel
from osreditor.importers.watabou import OPDImporter
from osreditor.ops import AddLevel, AddTransition, AnyEditOp, CreateArea, OpBatch, SetEdges, SetEntrance
from osreditor.projects import open_project
from osreditor.store import LocalProjectStore

ASSETS = Path(__file__).parent / "assets" / "opd"
FIXTURES = Path(__file__).parent / "fixtures"
NOMINAL = ASSETS / "nominal.json"
TORTURE = ASSETS / "torture.json"

GOLDEN_PATHS = {
    "nominal": FIXTURES / "opd_nominal_payload.json",
    "torture": FIXTURES / "opd_torture_payload.json",
}

OPEN = Edge(kind=EdgeKind.OPEN)
DOOR = Edge(kind=EdgeKind.DOOR, door=DoorSpec())
LOCKED = Edge(kind=EdgeKind.DOOR, door=DoorSpec(locked=True))
SECRET = Edge(kind=EdgeKind.DOOR, door=DoorSpec(kind="secret"))


def opd_document(**overrides: object) -> dict[str, object]:
    """A minimal export carrying all eight required keys, before the case under test."""
    document: dict[str, object] = {
        "version": "1.2.7",
        "title": "",
        "story": "",
        "rects": [],
        "doors": [],
        "notes": [],
        "columns": [],
        "water": [],
    }
    document.update(overrides)
    return document


def write_opd(tmp_path: Path, document: object, name: str = "source.json") -> Path:
    path = tmp_path / name
    path.write_text(json.dumps(document), encoding="utf-8")
    return path


def rect(x: int, y: int, w: int, h: int, **extra: object) -> dict[str, object]:
    return {"x": x, "y": y, "w": w, "h": h, **extra}


def door(x: int, y: int, dx: int, dy: int, kind: int) -> dict[str, object]:
    return {"x": x, "y": y, "dir": {"x": dx, "y": dy}, "type": kind}


def note(x: float, y: float, ref: str, text: str = "…") -> dict[str, object]:
    return {"pos": {"x": x, "y": y}, "ref": ref, "text": text}


def load_level(tmp_path: Path, **overrides: object) -> ImportedLevel:
    return OPDImporter().load(write_opd(tmp_path, opd_document(**overrides))).levels[0]


def payload(path: Path) -> ImportedGeometry:
    return OPDImporter().load(path)


def golden_bytes(geometry: ImportedGeometry) -> bytes:
    return canonical_json_bytes(geometry.model_dump(mode="json"))


# The sniff: presence-level, bounded, and never a parse.


def test_sniff_accepts_the_committed_fixtures() -> None:
    importer = OPDImporter()
    assert importer.sniff(NOMINAL)
    assert importer.sniff(TORTURE)


def test_sniff_finds_the_signature_past_a_small_head_but_inside_the_bound(tmp_path: Path) -> None:
    # "doors" follows the whole rects array, so a small head would
    # false-negative on a big dungeon; 64 KB clears a large export.
    big = opd_document(rects=[rect(x, 0, 1, 1) for x in range(1000)], doors=[door(0, 0, 0, -1, 3)])
    path = write_opd(tmp_path, big, "big.json")
    head = path.read_bytes().index(b'"doors"')
    assert 8 * 1024 < head < 64 * 1024
    assert OPDImporter().sniff(path)


def test_sniff_rejects_a_directory_a_non_json_file_and_foreign_json(tmp_path: Path) -> None:
    importer = OPDImporter()
    directory = tmp_path / "project.osr"
    directory.mkdir()
    assert not importer.sniff(directory)
    assert not importer.sniff(tmp_path / "missing.json")
    renamed = tmp_path / "export.txt"
    renamed.write_bytes(NOMINAL.read_bytes())
    assert not importer.sniff(renamed)
    foreign = write_opd(tmp_path, {"kind": "adventure", "payload": {}}, "foreign.json")
    assert not importer.sniff(foreign)


# The whole-payload goldens.


@pytest.mark.parametrize(("name", "source"), [("nominal", NOMINAL), ("torture", TORTURE)])
def test_the_payload_matches_its_committed_golden(name: str, source: Path) -> None:
    assert golden_bytes(payload(source)) == GOLDEN_PATHS[name].read_bytes()


def test_the_nominal_fixture_imports_with_only_the_provenance_notes() -> None:
    geometry = payload(NOMINAL)
    level = geometry.levels[0]
    assert geometry.title == "The Hollow Beneath Redcap Hill"
    assert geometry.description is not None and geometry.description.startswith("A shepherd's boy")
    assert (level.label, level.width, level.height) == ("The Hollow Beneath Redcap Hill", 14, 10)
    assert level.entrance == (2, 9)
    assert [area.id for area in level.areas] == ["1", "2"]
    # Everything a clean export costs: the version it came from and the shift
    # that put its entrance-relative grid on a non-negative one.
    assert len(level.notes) == 2
    assert level.notes[0] == "converted from a One Page Dungeon export stamped version '1.2.7'"
    assert level.notes[1].startswith("normalized the entrance-relative source grid onto 14×10 cells")


# The door table, case by case.


@pytest.mark.parametrize(
    ("kind", "expected"),
    [(0, OPEN), (1, DOOR), (2, OPEN), (4, LOCKED), (5, DOOR), (6, SECRET), (7, LOCKED), (9, OPEN)],
)
def test_every_interior_door_type_maps_to_its_edge(tmp_path: Path, kind: int, expected: Edge) -> None:
    level = load_level(tmp_path, rects=[rect(0, 0, 3, 1)], doors=[door(1, 0, 1, 0, kind)])
    assert level.edges[edge_key((1, 0), Direction.EAST)] == expected


@pytest.mark.parametrize(("kind", "fragment"), [(4, "portcullis"), (5, "double door"), (7, "barred"), (9, "steps")])
def test_the_lossy_door_types_each_carry_one_counted_note(tmp_path: Path, kind: int, fragment: str) -> None:
    level = load_level(
        tmp_path,
        rects=[rect(0, 0, 5, 1)],
        doors=[door(1, 0, 1, 0, kind), door(3, 0, 1, 0, kind)],
    )
    mapped = [entry for entry in level.notes if fragment in entry]
    assert len(mapped) == 1
    assert mapped[0].startswith("imported 2 ")


def test_the_two_boundary_types_are_not_edges(tmp_path: Path) -> None:
    # Type 3 is the entrance and type 8 a level transition; neither joins two
    # floor cells, so neither overrides an edge.
    level = load_level(
        tmp_path,
        rects=[rect(0, 0, 3, 1)],
        doors=[door(0, 0, -1, 0, 3), door(2, 0, 1, 0, 8)],
    )
    assert level.entrance == (0, 0)
    assert [(t.kind, t.position) for t in level.transitions] == [("stairs_down", (2, 0))]
    assert all(edge.kind is EdgeKind.OPEN for edge in level.edges.values())


def test_an_unknown_door_type_imports_as_a_plain_door_with_a_note(tmp_path: Path) -> None:
    level = load_level(tmp_path, rects=[rect(0, 0, 3, 1)], doors=[door(1, 0, 1, 0, 47)])
    assert level.edges[edge_key((1, 0), Direction.EAST)] == DOOR
    assert any("unrecognized type 47" in entry for entry in level.notes)


def test_two_doors_on_one_cell_resolve_first_wins(tmp_path: Path) -> None:
    level = load_level(
        tmp_path,
        rects=[rect(0, 0, 3, 1)],
        doors=[door(1, 0, 1, 0, 6), door(1, 0, -1, 0, 1)],
    )
    assert level.edges[edge_key((1, 0), Direction.EAST)] == SECRET
    assert level.edges[edge_key((1, 0), Direction.WEST)] == OPEN
    assert "dropped the door at (1, 0): the secret door already on that cell wins, being first" in level.notes


def test_two_doors_claiming_one_edge_from_opposite_cells_resolve_first_wins(tmp_path: Path) -> None:
    level = load_level(
        tmp_path,
        rects=[rect(0, 0, 2, 1)],
        doors=[door(0, 0, 1, 0, 6), door(1, 0, -1, 0, 1)],
    )
    assert level.edges == {edge_key((0, 0), Direction.EAST): SECRET}
    assert (
        "dropped the door at (1, 0): the secret door at (0, 0) already holds the '1,0:west' edge "
        "between them, being first" in level.notes
    )


def test_a_first_wins_note_names_what_actually_holds_the_edge(tmp_path: Path) -> None:
    # The winner is often an opening — types 0, 2, and 9 map to OPEN — so the
    # note must not tell the author to look for a door that is not there.
    level = load_level(
        tmp_path,
        rects=[rect(0, 0, 2, 1)],
        doors=[door(0, 0, 1, 0, 0), door(1, 0, -1, 0, 1)],
    )
    assert level.edges == {edge_key((0, 0), Direction.EAST): OPEN}
    assert (
        "dropped the door at (1, 0): the opening at (0, 0) already holds the '1,0:west' edge "
        "between them, being first" in level.notes
    )


@pytest.mark.parametrize(
    ("record", "fragment"),
    [
        ({"x": 1, "dir": {"x": 1, "y": 0}, "type": 1}, "dropped doors[0]"),
        ({"x": 1, "y": 0, "dir": {"x": 1, "y": 1}, "type": 1}, "dropped doors[0]"),
        ({"x": 1, "y": 0, "dir": {"x": 1, "y": 0}}, "dropped doors[0]"),
        ("not a door", "dropped doors[0]"),
    ],
)
def test_a_malformed_door_record_is_dropped_with_a_note(tmp_path: Path, record: object, fragment: str) -> None:
    level = load_level(tmp_path, rects=[rect(0, 0, 3, 1)], doors=[record])
    assert level.edges == {
        edge_key((0, 0), Direction.EAST): OPEN,
        edge_key((1, 0), Direction.EAST): OPEN,
    }
    assert any(entry.startswith(fragment) for entry in level.notes)


def test_a_door_opening_onto_void_is_dropped_with_a_note(tmp_path: Path) -> None:
    # Only types 3 and 8 legitimately point at void; anything else is a
    # malformed record, and dropping it beats crashing the import.
    level = load_level(tmp_path, rects=[rect(0, 0, 2, 1)], doors=[door(1, 0, 1, 0, 1)])
    assert level.edges == {edge_key((0, 0), Direction.EAST): OPEN}
    assert any("which is not floor" in entry for entry in level.notes)


def test_a_door_on_a_void_cell_is_dropped_with_a_note(tmp_path: Path) -> None:
    level = load_level(tmp_path, rects=[rect(0, 0, 2, 1)], doors=[door(5, 5, 1, 0, 1)])
    assert any("its own cell is not floor" in entry for entry in level.notes)


# Normalization, and the edge set connectivity is built from.


def test_coordinates_normalize_from_a_negative_entrance_relative_grid(tmp_path: Path) -> None:
    level = load_level(
        tmp_path,
        rects=[rect(-3, -4, 2, 2), rect(-1, -3, 1, 1), rect(0, -3, 2, 2)],
        doors=[door(-1, -3, 1, 0, 1)],
    )
    # x spans [-3, 1] and y spans [-4, -2]: a 5x3 grid shifted by (3, 4).
    assert (level.width, level.height) == (5, 3)
    assert level.edges[edge_key((2, 1), Direction.EAST)] == DOOR
    assert any("the source's (0, 0) is the editor's (3, 4)" in entry for entry in level.notes)


@pytest.mark.parametrize("source", [NOMINAL, TORTURE])
def test_every_edge_key_is_canonical_and_in_bounds(source: Path) -> None:
    level = payload(source).levels[0]
    touched: set[Position] = set()
    for key in level.edges:
        cells = canonical_edge_cells(key)
        assert cells is not None, key
        for cell in cells:
            assert 0 <= cell[0] < level.width, key
            assert 0 <= cell[1] < level.height, key
            touched.add(cell)
    # Every floor cell the fixture describes carries at least one edge: the
    # union of the rects is exactly the cell set the edges span.
    assert len(touched) == (47 if source is NOMINAL else 74)
    assert level.entrance in touched
    assert all(transition.position in touched for transition in level.transitions)


def test_overlapping_rects_union_harmlessly(tmp_path: Path) -> None:
    level = load_level(tmp_path, rects=[rect(0, 0, 2, 2), rect(1, 0, 2, 2)])
    assert (level.width, level.height) == (3, 2)
    assert len(level.edges) == 7


def test_a_malformed_rect_is_dropped_with_a_note(tmp_path: Path) -> None:
    level = load_level(tmp_path, rects=[rect(0, 0, 2, 1), rect(5, 5, 0, 3), "junk"])
    assert (level.width, level.height) == (2, 1)
    assert [entry for entry in level.notes if entry.startswith("dropped rects[")] == [
        "dropped rects[1]: not a rectangle with integer x, y and w, h of at least 1",
        "dropped rects[2]: not a rectangle with integer x, y and w, h of at least 1",
    ]


# Keyed notes become keyed areas, by ref and never by array position.


def test_notes_key_rooms_by_ref_under_a_shuffled_array_order(tmp_path: Path) -> None:
    # sortRooms orders the array by path cost from the entrance, so array
    # position and ref disagree in every real export.
    level = load_level(
        tmp_path,
        rects=[rect(0, 0, 2, 2), rect(4, 0, 2, 2), rect(8, 0, 2, 2)],
        notes=[note(9, 1, "3", "third"), note(1, 1, "1", "first"), note(5, 1, "2", "second")],
    )
    assert [(area.id, area.description) for area in level.areas] == [
        ("3", "third"),
        ("1", "first"),
        ("2", "second"),
    ]
    assert level.areas[0].cells == ((8, 0), (9, 0), (8, 1), (9, 1))
    # OPD has no room-name field, and inventing one from prose is editorializing.
    assert all(area.name == "" for area in level.areas)


def test_an_unusable_ref_renames_past_every_authored_ref(tmp_path: Path) -> None:
    # The three ids CreateArea rejects, each repaired: a duplicate, an empty
    # one, and one carrying the slash forge keys area entries with. The batch
    # is atomic, so any of the three would 422 the whole import.
    level = load_level(
        tmp_path,
        rects=[rect(0, 0, 2, 2), rect(4, 0, 2, 2), rect(8, 0, 2, 2), rect(12, 0, 2, 2), rect(16, 0, 2, 2)],
        notes=[note(1, 1, "1"), note(5, 1, "1"), note(9, 1, ""), note(13, 1, "2"), note(17, 1, "a/b")],
    )
    assert [area.id for area in level.areas] == ["1", "3", "4", "2", "5"]
    assert [entry for entry in level.notes if entry.startswith("renamed")] == [
        "renamed area '1' to '3' (duplicate of area '1'); geometry preserved",
        "renamed area '' to '4' (empty id); geometry preserved",
        "renamed area 'a/b' to '5' ('/' is not addressable in a forge-backed project); geometry preserved",
    ]


def test_a_note_landing_in_no_rect_or_an_already_keyed_rect_is_dropped(tmp_path: Path) -> None:
    level = load_level(
        tmp_path,
        rects=[rect(0, 0, 2, 2)],
        notes=[note(1, 1, "1"), note(0.5, 0.5, "2"), note(40, 40, "3")],
    )
    assert [area.id for area in level.areas] == ["1"]
    assert [entry for entry in level.notes if entry.startswith("dropped note")] == [
        "dropped note '2': its room is already keyed as area '1'",
        "dropped note '3': its position (40.0, 40.0) lands in no room rectangle",
    ]


def test_a_malformed_note_record_is_dropped_with_a_note(tmp_path: Path) -> None:
    level = load_level(tmp_path, rects=[rect(0, 0, 2, 2)], notes=[{"ref": "1", "text": "…"}])
    assert level.areas == ()
    assert any(entry.startswith("dropped notes[0]") for entry in level.notes)


# The entrance invariant, and the level transition's fabricated destination.


def test_an_export_with_no_origin_boundary_door_imports_without_an_entrance(tmp_path: Path) -> None:
    # The invariant held in every generator export observed, but the generator
    # is not the only producer of OPD-shaped JSON.
    level = load_level(tmp_path, rects=[rect(0, 0, 3, 1)], doors=[door(1, 0, 1, 0, 1)])
    assert level.entrance is None
    assert any(entry.startswith("no entrance:") for entry in level.notes)


def test_an_origin_door_on_no_floor_cell_drops_the_entrance_rather_than_stranding_it(
    tmp_path: Path,
) -> None:
    # SetEntrance rejects an out-of-bounds cell at apply and the batch is
    # atomic, so an entrance pointing off the grid would 422 the whole import.
    level = load_level(tmp_path, rects=[rect(4, 4, 2, 1)], doors=[door(0, 0, 1, 0, 3)])
    assert level.entrance is None
    assert any(entry.startswith("dropped the entrance:") for entry in level.notes)


def test_a_second_level_transition_on_one_cell_is_dropped_rather_than_stacked(tmp_path: Path) -> None:
    # AddTransition rejects a second transition on one source cell, so a
    # stacked pair would 422 the whole import.
    level = load_level(
        tmp_path,
        rects=[rect(0, 0, 2, 1)],
        doors=[door(1, 0, 1, 0, 8), door(1, 0, 0, -1, 8)],
    )
    assert [transition.position for transition in level.transitions] == [(1, 0)]
    assert any("a transition already occupies the cell" in entry for entry in level.notes)


def test_a_second_boundary_door_is_noted_rather_than_dropped_silently(tmp_path: Path) -> None:
    level = load_level(
        tmp_path,
        rects=[rect(0, 0, 3, 1)],
        doors=[door(0, 0, -1, 0, 3), door(2, 0, 1, 0, 3)],
    )
    assert level.entrance == (0, 0)
    assert any("noted a second boundary door at (2, 0)" in entry for entry in level.notes)


def test_a_level_transition_carries_the_pinned_fabricated_destination(tmp_path: Path) -> None:
    level = load_level(tmp_path, rects=[rect(0, -2, 1, 3)], doors=[door(0, -2, 0, -1, 8)])
    transition = level.transitions[0]
    assert transition.kind == "stairs_down"
    assert transition.position == (0, 0)
    assert (transition.to_dungeon_id, transition.to_level_number) == ("", 2)
    assert (transition.to_position, transition.to_facing) == ((0, 0), Direction.NORTH)
    assert any("carry a fabricated destination" in entry for entry in level.notes)


# The dropped source features, each counted in its own sentence.


def test_every_modelless_source_feature_is_dropped_with_a_counted_note() -> None:
    notes = payload(TORTURE).levels[0].notes
    assert "dropped 2 column(s): the import payload carries geometry only, so add them as features by hand" in notes
    assert "dropped 1 water cell(s): the import payload carries geometry only, so add them as features by hand" in notes
    assert any(entry.startswith("imported 1 round room(s)") for entry in notes)
    assert any(entry.startswith("dropped the export's ending line") for entry in notes)


# Everything unloadable, with a human message rather than a 500.


def test_load_raises_on_an_unreadable_path(tmp_path: Path) -> None:
    with pytest.raises(ImportSourceInvalidError, match="cannot read"):
        OPDImporter().load(tmp_path / "missing.json")


def test_load_raises_on_malformed_json(tmp_path: Path) -> None:
    path = tmp_path / "broken.json"
    path.write_text('{"rects": [', encoding="utf-8")
    with pytest.raises(ImportSourceInvalidError, match="not valid JSON"):
        OPDImporter().load(path)


def test_load_raises_on_a_document_that_is_not_an_object(tmp_path: Path) -> None:
    with pytest.raises(ImportSourceInvalidError, match="the document is not an object"):
        OPDImporter().load(write_opd(tmp_path, ["rects", "doors"]))


def test_load_raises_naming_every_missing_required_key(tmp_path: Path) -> None:
    document = opd_document()
    del document["columns"]
    del document["water"]
    with pytest.raises(ImportSourceInvalidError, match="it is missing columns, water"):
        OPDImporter().load(write_opd(tmp_path, document))


@pytest.mark.parametrize("key", ["rects", "doors"])
def test_load_raises_on_a_non_array_geometry_key(tmp_path: Path, key: str) -> None:
    with pytest.raises(ImportSourceInvalidError, match="rects and doors must be arrays"):
        OPDImporter().load(write_opd(tmp_path, opd_document(**{key: {"x": 0}})))


@pytest.mark.parametrize(
    "rects",
    [
        # One rect claiming more grid than exists, and a pair of tiny rects
        # flung far enough apart to make the bounding box do the same.
        [rect(0, 0, 10_000_000, 1)],
        [rect(0, 0, 1, 1), rect(2_000_000, 2_000_000, 1, 1)],
    ],
)
def test_load_raises_rather_than_converting_an_absurd_extent(tmp_path: Path, rects: list[object]) -> None:
    # The route is synchronous, so an unbounded expansion would hold a worker
    # thread and unbounded memory instead of answering.
    with pytest.raises(ImportSourceInvalidError, match="describes more than 1000000 cells"):
        OPDImporter().load(write_opd(tmp_path, opd_document(rects=rects)))


def test_load_raises_on_a_floorless_export(tmp_path: Path) -> None:
    # The one shape that would otherwise fail in the wrong layer: an empty
    # floor set makes the bounding box 0x0, and ImportedLevel's own validation
    # error would surface as a 500 rather than the protocol's 4xx.
    with pytest.raises(ImportSourceInvalidError, match="describes no floor"):
        OPDImporter().load(write_opd(tmp_path, opd_document(rects=[rect(0, 0, 0, 0)])))


def test_a_non_array_notes_entry_degrades_to_no_keyed_rooms(tmp_path: Path) -> None:
    # Geometry must be an array or the file is not this format; annotation
    # degrades, because a whole map is worth more than its keys.
    level = load_level(tmp_path, rects=[rect(0, 0, 2, 2)], notes={"1": "…"})
    assert level.areas == ()
    assert any(entry.startswith("ignored the 'notes' entry") for entry in level.notes)


# The imported payload applies as an ordinary batch and the document stays byte-stable.


def import_batch(level: ImportedLevel, dungeon_id: str, number: int) -> list[AnyEditOp]:
    """The dialog's new-level batch, mirrored: `import-mapping.ts`'s pinned op order."""
    ops: list[AnyEditOp] = [AddLevel(dungeon_id=dungeon_id, number=number, width=level.width, height=level.height)]
    if level.edges:
        ops.append(SetEdges(dungeon_id=dungeon_id, level_number=number, edges=dict(level.edges)))
    ops.extend(
        CreateArea(
            dungeon_id=dungeon_id,
            level_number=number,
            area_id=area.id,
            cells=area.cells,
            name=area.name,
            description=area.description,
        )
        for area in level.areas
    )
    ops.extend(
        AddTransition(dungeon_id=dungeon_id, level_number=number, transition=transition)
        for transition in level.transitions
    )
    if level.entrance is not None:
        ops.append(SetEntrance(dungeon_id=dungeon_id, level_number=number, entrance=level.entrance))
    return ops


@pytest.fixture
def project(tmp_path: Path) -> tuple[DocumentService, OpenProject]:
    service = DocumentService(LocalProjectStore())
    adventure = Adventure(
        name="Import target",
        town=TownSpec(name=""),
        dungeons=(DungeonSpec(id="d", levels=(LevelSpec(number=1, width=3, height=3, entrance=(0, 0)),)),),
    )
    project_dir = tmp_path / "target.osr"
    service.store.write_artifact(str(project_dir), "adventure.json", dump_adventure(adventure))
    return service, open_project(service, project_dir)


def test_the_torture_payload_applies_as_one_batch_and_round_trips_byte_stably(
    project: tuple[DocumentService, OpenProject],
) -> None:
    service, opened = project
    level = payload(TORTURE).levels[0]
    ops = import_batch(level, "d", 2)
    service.apply_batch(opened, OpBatch(revision=opened.revision, ops=tuple(ops)))

    imported = opened.adventure.dungeons[0].levels[1]
    assert (imported.width, imported.height) == (level.width, level.height)
    assert imported.edges == level.edges
    assert imported.entrance == level.entrance
    # CreateArea rejects a duplicate id at apply and the batch is atomic, so a
    # successful apply is the duplicate-ref rename surviving.
    assert [area.id for area in imported.areas] == [area.id for area in level.areas]
    assert len({area.id for area in imported.areas}) == len(level.areas)

    data = service.store.read_artifact(str(opened.path), "adventure.json")
    assert dump_adventure(load_adventure(data)) == data
