"""The importer seam: protocol, discovery, sniff/load, the normalization table, error mapping."""

import json
import logging
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from osrlib.crawl.adventure import Adventure, TownSpec
from osrlib.crawl.dungeon import (
    AreaSpec,
    Direction,
    DungeonSpec,
    Edge,
    EdgeKind,
    LevelSpec,
    TransitionSpec,
)

import osreditor.importers
from osreditor.app import create_app
from osreditor.documents import dump_adventure
from osreditor.errors import ImportSourceInvalidError
from osreditor.importers import (
    GeometryImporter,
    ImportedGeometry,
    ImportedLevel,
    ProjectImporter,
    discover_importers,
)

OPEN = Edge(kind=EdgeKind.OPEN)


def write_project(path: Path, adventure: Adventure) -> Path:
    path.mkdir(parents=True, exist_ok=True)
    (path / "adventure.json").write_bytes(dump_adventure(adventure))
    return path


def simple_adventure(**level_overrides: object) -> Adventure:
    values: dict[str, object] = {"number": 1, "width": 3, "height": 3, "entrance": (0, 0)}
    values.update(level_overrides)
    return Adventure(
        name="Source",
        description="A source project.",
        town=TownSpec(name=""),
        dungeons=(DungeonSpec(id="d", levels=(LevelSpec.model_validate(values),)),),
    )


def test_the_built_in_importer_conforms_to_the_protocol() -> None:
    assert isinstance(ProjectImporter(), GeometryImporter)


def test_discovery_finds_the_built_in_through_the_public_group() -> None:
    importers = discover_importers()
    assert "project" in importers
    assert isinstance(importers["project"], ProjectImporter)


class _SyntheticImporter:
    """A third-party importer shape: registers through the group, no editor changes."""

    format_id = "synthetic"
    label = "Synthetic format"

    def sniff(self, path: Path) -> bool:
        return path.suffix == ".synthetic"

    def load(self, path: Path) -> ImportedGeometry:
        return ImportedGeometry(levels=(ImportedLevel(label="synthetic level", width=2, height=2),))


class _FakeEntryPoint:
    def __init__(self, name: str, loader: object) -> None:
        self.name = name
        self._loader = loader

    def load(self) -> object:
        if isinstance(self._loader, Exception):
            raise self._loader
        return self._loader


def _patch_entry_points(monkeypatch: pytest.MonkeyPatch, *entries: _FakeEntryPoint) -> None:
    monkeypatch.setattr(
        osreditor.importers.metadata, "entry_points", lambda group: entries if group == "osreditor.importers" else ()
    )


def test_a_synthetic_third_party_importer_registers_without_editor_changes(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _patch_entry_points(
        monkeypatch, _FakeEntryPoint("project", ProjectImporter), _FakeEntryPoint("synthetic", _SyntheticImporter)
    )
    importers = discover_importers()
    assert list(importers) == ["project", "synthetic"]
    assert importers["synthetic"].label == "Synthetic format"


def test_a_broken_entry_point_is_skipped_with_a_warning(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    _patch_entry_points(
        monkeypatch,
        _FakeEntryPoint("broken", RuntimeError("import boom")),
        _FakeEntryPoint("project", ProjectImporter),
    )
    with caplog.at_level(logging.WARNING, logger="osreditor.importers"):
        importers = discover_importers()
    assert list(importers) == ["project"]
    assert "failed to load" in caplog.text


def test_a_non_importer_entry_is_skipped_with_a_warning(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    _patch_entry_points(monkeypatch, _FakeEntryPoint("junk", lambda: object()))
    with caplog.at_level(logging.WARNING, logger="osreditor.importers"):
        assert discover_importers() == {}
    assert "did not produce a GeometryImporter" in caplog.text


def test_a_duplicate_format_id_keeps_the_first_registration(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    class _Shadow(ProjectImporter):
        label = "Shadowing importer"

    _patch_entry_points(monkeypatch, _FakeEntryPoint("project", ProjectImporter), _FakeEntryPoint("shadow", _Shadow))
    with caplog.at_level(logging.WARNING, logger="osreditor.importers"):
        importers = discover_importers()
    assert importers["project"].label == "osr-editor project"
    assert "keeping the first registration" in caplog.text


def test_sniff_recognizes_native_projects_and_workdir_shapes(tmp_path: Path) -> None:
    importer = ProjectImporter()
    native = write_project(tmp_path / "native.osr", simple_adventure())
    workdir = write_project(tmp_path / "draft.forge", simple_adventure())
    (workdir / "run.json").write_text("{}", encoding="utf-8")
    (workdir / "stages").mkdir()
    (workdir / "stages" / "survey.json").write_text("{}", encoding="utf-8")
    assert importer.sniff(native)
    # A forge workdir also sniffs true: importing geometry from a draft is legitimate.
    assert importer.sniff(workdir)
    assert not importer.sniff(tmp_path / "missing")
    assert not importer.sniff(tmp_path)


def test_load_labels_every_level_of_every_dungeon(tmp_path: Path) -> None:
    adventure = Adventure(
        name="Two dungeons",
        description="…",
        town=TownSpec(name=""),
        dungeons=(
            DungeonSpec(
                id="a",
                levels=(
                    LevelSpec(number=1, width=2, height=2, entrance=(0, 0)),
                    LevelSpec(number=2, width=2, height=2),
                ),
            ),
            DungeonSpec(id="b", levels=(LevelSpec(number=1, width=2, height=2, entrance=(0, 0)),)),
        ),
    )
    geometry = ProjectImporter().load(write_project(tmp_path / "src.osr", adventure))
    assert geometry.title == "Two dungeons"
    assert geometry.description == "…"
    assert [level.label for level in geometry.levels] == ["a level 1", "a level 2", "b level 1"]


def test_load_normalizes_a_dirty_source_and_notes_every_repair(tmp_path: Path) -> None:
    dirty = simple_adventure(
        entrance=(9, 9),
        edges={
            "1,0:west": OPEN,  # clean — survives
            "0,1:south": OPEN,  # non-canonical alias
            "bogus": OPEN,  # malformed
            "1,1:north": Edge(kind=EdgeKind.WALL),  # explicit wall
            "0,0:north": OPEN,  # canonical, out-of-bounds incident cell
        },
        areas=(
            AreaSpec(id="1", cells=((0, 0), (9, 9))),  # loses one cell
            AreaSpec(id="1", cells=((1, 1),)),  # duplicate id — renamed
            AreaSpec(id="lost", cells=((9, 9),)),  # every cell out of bounds — dropped
            AreaSpec(id="2", cells=((2, 2),)),  # a later legit id the rename must not steal
        ),
        transitions=(
            TransitionSpec(
                kind="stairs_down",
                position=(1, 1),
                to_dungeon_id="nowhere",
                to_level_number=9,
                to_position=(0, 0),
                to_facing=Direction.NORTH,
            ),
            TransitionSpec(
                kind="chute",
                position=(1, 1),  # stacked on the first — dropped
                to_dungeon_id="d",
                to_level_number=1,
                to_position=(0, 0),
                to_facing=Direction.NORTH,
            ),
            TransitionSpec(
                kind="trapdoor",
                position=(9, 9),  # out-of-bounds source — dropped
                to_dungeon_id="d",
                to_level_number=1,
                to_position=(0, 0),
                to_facing=Direction.NORTH,
            ),
        ),
    )
    geometry = ProjectImporter().load(write_project(tmp_path / "dirty.osr", dirty))
    level = geometry.levels[0]
    assert level.edges == {"1,0:west": OPEN}
    assert [(area.id, area.cells) for area in level.areas] == [
        ("1", ((0, 0),)),
        ("3", ((1, 1),)),  # renamed past the later legit "2"
        ("2", ((2, 2),)),
    ]
    assert level.entrance is None
    # The dangling target stays — the op admits it; only the stacked and
    # out-of-bounds-source entries drop.
    assert [(t.kind, t.position) for t in level.transitions] == [("stairs_down", (1, 1))]
    assert level.notes == (
        "dropped edge entry '0,1:south': not osrlib's canonical form, so it is never consulted",
        "dropped edge entry 'bogus': not osrlib's canonical form, so it is never consulted",
        "dropped edge entry '1,1:north': an explicit wall entry — an absent edge is already a wall",
        "dropped edge entry '0,0:north': it references an out-of-bounds cell",
        "dropped 1 out-of-bounds cell(s) from area '1'",
        "renamed area '1' to '3' (duplicate of area '1'); geometry preserved",
        "dropped area 'lost': every cell is out of bounds",
        "dropped the entrance at (9, 9): out of bounds",
        "dropped the chute at (1, 1): a transition already occupies the cell (osrlib resolves the first match)",
        "dropped the trapdoor at (9, 9): its source cell is out of bounds",
    )


def test_a_clean_source_loads_with_no_notes(tmp_path: Path) -> None:
    geometry = ProjectImporter().load(write_project(tmp_path / "clean.osr", simple_adventure(edges={"1,0:west": OPEN})))
    assert geometry.levels[0].notes == ()
    assert geometry.levels[0].edges == {"1,0:west": OPEN}


def test_load_raises_on_unreadable_and_unloadable_sources(tmp_path: Path) -> None:
    importer = ProjectImporter()
    with pytest.raises(ImportSourceInvalidError, match="cannot read"):
        importer.load(tmp_path / "missing")
    junk = tmp_path / "junk.osr"
    junk.mkdir()
    (junk / "adventure.json").write_text("not json", encoding="utf-8")
    with pytest.raises(ImportSourceInvalidError, match="not a loadable adventure document"):
        importer.load(junk)


@pytest.fixture
def client() -> TestClient:
    return TestClient(create_app())


def test_importer_routes_list_sniff_and_load(client: TestClient, tmp_path: Path) -> None:
    listed = client.get("/api/importers")
    assert listed.status_code == 200
    assert {"format_id": "project", "label": "osr-editor project"} in listed.json()["importers"]

    source = write_project(tmp_path / "src.osr", simple_adventure())
    sniffed = client.post("/api/importers/sniff", json={"path": str(source)})
    assert sniffed.json() == {"format_ids": ["project"]}

    loaded = client.post("/api/importers/project/load", json={"path": str(source)})
    assert loaded.status_code == 200
    assert [level["label"] for level in loaded.json()["levels"]] == ["d level 1"]


def test_sniff_route_answers_empty_for_a_nonexistent_path(client: TestClient, tmp_path: Path) -> None:
    response = client.post("/api/importers/sniff", json={"path": str(tmp_path / "never")})
    assert response.status_code == 200
    assert response.json() == {"format_ids": []}


def test_unknown_importer_answers_404(client: TestClient, tmp_path: Path) -> None:
    response = client.post("/api/importers/watabou/load", json={"path": str(tmp_path)})
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "importer_not_found"


def test_unloadable_source_answers_import_source_invalid(client: TestClient, tmp_path: Path) -> None:
    junk = tmp_path / "junk.osr"
    junk.mkdir()
    (junk / "adventure.json").write_text(json.dumps({"kind": "save"}), encoding="utf-8")
    response = client.post("/api/importers/project/load", json={"path": str(junk)})
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "import_source_invalid"


def test_torture_fixture_is_a_clean_import_source(tmp_path: Path) -> None:
    source = tmp_path / "torture.osr"
    source.mkdir()
    fixture_bytes = (Path(__file__).parent / "fixtures" / "torture_geometry.json").read_bytes()
    (source / "adventure.json").write_bytes(fixture_bytes)
    geometry = ProjectImporter().load(source)
    assert [level.label for level in geometry.levels] == ["tannery-vaults level 1", "tannery-vaults level 2"]
    # Editor-buildable geometry normalizes to itself: nothing dropped, nothing noted.
    assert all(level.notes == () for level in geometry.levels)
    assert len(geometry.levels[0].edges) == 18
