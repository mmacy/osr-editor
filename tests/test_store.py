"""The local project store: round-trips, errors, traversal refusal, atomicity."""

from pathlib import Path

import pytest

from osreditor.errors import ArtifactNotFoundError
from osreditor.store import LocalProjectStore, ProjectStore


def test_write_read_list_round_trip(tmp_path: Path) -> None:
    store = LocalProjectStore()
    project = str(tmp_path)
    store.write_artifact(project, "adventure.json", b"{}\n")
    store.write_artifact(project, "stages/03-geometry.json", b"[]\n")
    assert store.read_artifact(project, "adventure.json") == b"{}\n"
    assert store.read_artifact(project, "stages/03-geometry.json") == b"[]\n"
    assert store.list_artifacts(project) == ["adventure.json", "stages/03-geometry.json"]


def test_write_replaces_existing_artifact(tmp_path: Path) -> None:
    store = LocalProjectStore()
    project = str(tmp_path)
    store.write_artifact(project, "adventure.json", b"old")
    store.write_artifact(project, "adventure.json", b"new")
    assert store.read_artifact(project, "adventure.json") == b"new"


def test_missing_artifact_raises(tmp_path: Path) -> None:
    store = LocalProjectStore()
    with pytest.raises(ArtifactNotFoundError):
        store.read_artifact(str(tmp_path), "absent.json")


def test_missing_project_directory_lists_empty(tmp_path: Path) -> None:
    store = LocalProjectStore()
    assert store.list_artifacts(str(tmp_path / "never-created")) == []


@pytest.mark.parametrize("name", ["../escape.json", "a/../../escape.json", "/etc/passwd", ""])
def test_escaping_artifact_names_are_refused(tmp_path: Path, name: str) -> None:
    store = LocalProjectStore()
    with pytest.raises(ValueError, match="artifact name"):
        store.write_artifact(str(tmp_path), name, b"nope")


def test_relative_project_id_is_refused(tmp_path: Path) -> None:
    store = LocalProjectStore()
    with pytest.raises(ValueError, match="absolute"):
        store.read_artifact("relative/project", "adventure.json")


def test_atomic_write_leaves_no_temp_file(tmp_path: Path) -> None:
    store = LocalProjectStore()
    project = str(tmp_path)
    store.write_artifact(project, "adventure.json", b"x" * 65536)
    assert [path.name for path in tmp_path.iterdir()] == ["adventure.json"]


def test_local_store_satisfies_the_protocol() -> None:
    assert isinstance(LocalProjectStore(), ProjectStore)
