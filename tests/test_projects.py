"""Project detection, native create, the sidecar, and idempotent open."""

import json
from pathlib import Path

import pytest
from osrlib.crawl.adventure import validate_adventure
from osrlib.data import load_equipment, load_monsters

from osreditor.documents import DocumentService, load_adventure
from osreditor.errors import (
    ForgeWorkdirInvalidError,
    InvalidProjectError,
    ProjectExistsError,
    ProjectPathNotFoundError,
)
from osreditor.projects import (
    create_native_project,
    detect_project_type,
    open_project,
    starter_adventure,
)
from osreditor.sidecar import SIDECAR_ARTIFACT
from osreditor.store import LocalProjectStore


def make_forge_workdir(root: Path) -> None:
    """Lay down the forge workdir shape: run.json, stages/, and the assembled adventure.json."""
    (root / "stages").mkdir(parents=True)
    (root / "run.json").write_text("{}", encoding="utf-8")
    (root / "stages" / "01-extract.json").write_text("{}", encoding="utf-8")
    (root / "adventure.json").write_text('{"kind": "adventure"}', encoding="utf-8")


def test_detects_native_project(tmp_path: Path) -> None:
    store = LocalProjectStore()
    create_native_project(store, str(tmp_path / "demo.osr"), "Demo")
    assert detect_project_type(store, str(tmp_path / "demo.osr")) == "native"


def test_detects_forge_workdir_before_native(tmp_path: Path) -> None:
    # A forge workdir also contains an assembled adventure.json at its root, so
    # the ordering is load-bearing: forge markers must win.
    workdir = tmp_path / "demo.forge"
    make_forge_workdir(workdir)
    assert detect_project_type(LocalProjectStore(), str(workdir)) == "forge"


def test_run_json_alone_is_not_a_forge_workdir(tmp_path: Path) -> None:
    # An empty stages/ directory is layout, not an artifact — the directory
    # classifies not-a-project, unreachable for a workdir forge actually wrote into.
    (tmp_path / "stages").mkdir()
    (tmp_path / "run.json").write_text("{}", encoding="utf-8")
    assert detect_project_type(LocalProjectStore(), str(tmp_path)) is None


def test_non_project_directory_detects_none(tmp_path: Path) -> None:
    (tmp_path / "notes.txt").write_text("just a directory", encoding="utf-8")
    assert detect_project_type(LocalProjectStore(), str(tmp_path)) is None


def test_starter_adventure_validates_clean_at_birth() -> None:
    validate_adventure(starter_adventure("A fresh start"), load_monsters(), load_equipment())


def test_create_writes_a_loadable_document_and_the_sidecar(tmp_path: Path) -> None:
    store = LocalProjectStore()
    project = str(tmp_path / "demo.osr")
    created = create_native_project(store, project, "Demo")
    loaded = load_adventure(store.read_artifact(project, "adventure.json"))
    assert loaded == created
    assert loaded.name == "Demo"
    sidecar = json.loads(store.read_artifact(project, SIDECAR_ARTIFACT))
    assert sidecar["schema_version"] == 1
    provenance = sidecar["provenance"]
    assert provenance["created_by"].startswith("osr-editor ")
    assert provenance["osrlib_version"]
    assert provenance["created_at"]
    # The phase 5 additive fields default empty on a native create; detach fills
    # provenance's source_workdir/osrforge_version, empty here.
    assert provenance["source_workdir"] is None
    assert provenance["osrforge_version"] is None
    assert set(sidecar) == {"schema_version", "provenance", "view_state", "notes", "review", "auto_reasons"}


def test_create_refuses_a_non_empty_directory(tmp_path: Path) -> None:
    (tmp_path / "occupied").mkdir()
    (tmp_path / "occupied" / "file.txt").write_text("here first", encoding="utf-8")
    with pytest.raises(ProjectExistsError):
        create_native_project(LocalProjectStore(), str(tmp_path / "occupied"), "Demo")
    # Refusal happens before any write.
    assert [p.name for p in (tmp_path / "occupied").iterdir()] == ["file.txt"]


def test_create_accepts_an_existing_empty_directory(tmp_path: Path) -> None:
    (tmp_path / "empty").mkdir()
    create_native_project(LocalProjectStore(), str(tmp_path / "empty"), "Demo")
    assert (tmp_path / "empty" / "adventure.json").is_file()


def test_open_is_idempotent_for_the_same_path(tmp_path: Path) -> None:
    service = DocumentService(LocalProjectStore())
    project_dir = tmp_path / "demo.osr"
    create_native_project(service.store, str(project_dir), "Demo")
    first = open_project(service, project_dir)
    second = open_project(service, project_dir)
    assert second is first


def test_open_resolves_symlinked_routes_to_one_project(tmp_path: Path) -> None:
    service = DocumentService(LocalProjectStore())
    project_dir = tmp_path / "demo.osr"
    create_native_project(service.store, str(project_dir), "Demo")
    link = tmp_path / "shortcut"
    link.symlink_to(project_dir)
    assert open_project(service, link) is open_project(service, project_dir)


def test_open_missing_directory_raises_path_not_found(tmp_path: Path) -> None:
    with pytest.raises(ProjectPathNotFoundError):
        open_project(DocumentService(LocalProjectStore()), tmp_path / "never-created")


def test_open_non_project_raises_invalid_project(tmp_path: Path) -> None:
    with pytest.raises(InvalidProjectError):
        open_project(DocumentService(LocalProjectStore()), tmp_path)


def test_open_forge_workdir_with_unparseable_run_json_is_invalid(tmp_path: Path) -> None:
    # `make_forge_workdir` writes a placeholder run.json ("{}") that does not
    # parse as RunMeta — the first open gate refuses it.
    workdir = tmp_path / "demo.forge"
    make_forge_workdir(workdir)
    with pytest.raises(ForgeWorkdirInvalidError):
        open_project(DocumentService(LocalProjectStore()), workdir)


def test_open_never_writes_for_native(tmp_path: Path) -> None:
    # The open-never-writes invariant is scoped to native projects, where the
    # document is the user's source of truth. A forge open re-assembles, and that
    # is forge's own write (see the forge open suite).
    service = DocumentService(LocalProjectStore())
    project_dir = tmp_path / "demo.osr"
    create_native_project(service.store, str(project_dir), "Demo")
    before = {path: path.stat().st_mtime_ns for path in project_dir.iterdir()}
    open_project(service, project_dir)
    after = {path: path.stat().st_mtime_ns for path in project_dir.iterdir()}
    assert after == before
