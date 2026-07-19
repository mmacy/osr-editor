"""Forge routes: rerun, source pages, level previews, detach, and forge-aware publish/export."""

import shutil
from pathlib import Path

from fastapi.testclient import TestClient

from osreditor.app import create_app
from osreditor.documents import DocumentService
from osreditor.projects import detach_to_native, open_project
from osreditor.store import LocalProjectStore

FIXTURE = Path(__file__).parent / "fixtures" / "forge_workdir"


def copy_workdir(tmp_path: Path) -> Path:
    workdir = tmp_path / "vault.forge"
    shutil.copytree(FIXTURE, workdir)
    return workdir


def open_forge(tmp_path: Path):
    service = DocumentService(LocalProjectStore())
    return service, open_project(service, copy_workdir(tmp_path))


def open_via_client(client: TestClient, tmp_path: Path) -> dict:
    return client.post("/api/projects/open", json={"path": str(copy_workdir(tmp_path))}).json()


# --- Rerun ---------------------------------------------------------------------


def test_rerun_omit_changes_the_document(tmp_path: Path) -> None:
    service, project = open_forge(tmp_path)
    before = project.revision
    # Level 2's shrine keys the unresolved "drowned one"; under `omit` its
    # best-effort stand-in is dropped rather than substituted.
    service.rerun_forge(project, {"unresolved_fallback": "omit"})
    assert project.revision != before
    shrine = next(a for d in project.adventure.dungeons for lvl in d.levels if lvl.number == 2 for a in lvl.areas)
    assert shrine.encounter is None


def test_rerun_upstream_knob_is_forge_rerun_invalid(tmp_path: Path) -> None:
    client = TestClient(create_app())
    opened = open_via_client(client, tmp_path)
    # custom_monsters is owned by the monsters stage, upstream of assemble.
    response = client.post(f"/api/projects/{opened['id']}/forge/rerun", json={"settings": {"custom_monsters": "off"}})
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "forge_rerun_invalid"


def test_rerun_unknown_knob_is_request_invalid(tmp_path: Path) -> None:
    client = TestClient(create_app())
    opened = open_via_client(client, tmp_path)
    response = client.post(f"/api/projects/{opened['id']}/forge/rerun", json={"settings": {"nonsense_knob": 3}})
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "request_invalid"


# --- Pages and previews --------------------------------------------------------


def test_page_route_serves_png(tmp_path: Path) -> None:
    client = TestClient(create_app())
    opened = open_via_client(client, tmp_path)
    response = client.get(f"/api/projects/{opened['id']}/forge/pages/1")
    assert response.status_code == 200
    assert response.headers["content-type"] == "image/png"
    assert response.content.startswith(b"\x89PNG")


def test_missing_page_is_forge_page_not_found(tmp_path: Path) -> None:
    client = TestClient(create_app())
    opened = open_via_client(client, tmp_path)
    response = client.get(f"/api/projects/{opened['id']}/forge/pages/99")
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "forge_page_not_found"


def test_preview_route_serves_svg(tmp_path: Path) -> None:
    client = TestClient(create_app())
    opened = open_via_client(client, tmp_path)
    response = client.get(f"/api/projects/{opened['id']}/forge/previews/sunken-vault/1")
    assert response.status_code == 200
    assert response.headers["content-type"] == "image/svg+xml"
    assert b"<svg" in response.content


def test_missing_preview_is_forge_page_not_found(tmp_path: Path) -> None:
    client = TestClient(create_app())
    opened = open_via_client(client, tmp_path)
    response = client.get(f"/api/projects/{opened['id']}/forge/previews/sunken-vault/9")
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "forge_page_not_found"


# --- Detach --------------------------------------------------------------------


def test_detach_creates_a_native_project_with_provenance(tmp_path: Path) -> None:
    service, project = open_forge(tmp_path)
    # A note is carried across the crossing; review marks and auto_reasons are not.
    project.sidecar = project.sidecar.model_copy(
        update={"notes": {"dungeon:sunken-vault/level:1/area:1": "Watch the water level."}}
    )
    workdir_path = project.path
    native = detach_to_native(service, project, tmp_path / "detached.osr")

    assert native.type == "native"
    assert native.sidecar.provenance is not None
    assert native.sidecar.provenance.source_workdir == str(workdir_path)
    assert native.sidecar.provenance.osrforge_version
    assert native.sidecar.notes == {"dungeon:sunken-vault/level:1/area:1": "Watch the water level."}
    # Forge-review state stays behind.
    assert native.sidecar.review == ()
    assert native.sidecar.auto_reasons == ()
    # The workdir is untouched and the forge project drops from the registry.
    assert (workdir_path / "run.json").is_file()
    assert workdir_path.is_dir()
    import pytest

    from osreditor.errors import ProjectNotFoundError

    with pytest.raises(ProjectNotFoundError):
        service.get(project.id)


def test_detach_route_returns_the_new_native_state(tmp_path: Path) -> None:
    client = TestClient(create_app())
    opened = open_via_client(client, tmp_path)
    response = client.post(f"/api/projects/{opened['id']}/forge/detach", json={"path": str(tmp_path / "detached.osr")})
    assert response.status_code == 201
    state = response.json()
    assert state["type"] == "native"
    assert state["forge"] is None
    assert state["document"]["name"] == "The Sunken Vault of Ashkar"


# --- Publish and export --------------------------------------------------------


def test_export_copies_forge_bytes_verbatim(tmp_path: Path) -> None:
    client = TestClient(create_app())
    workdir = copy_workdir(tmp_path)
    opened = client.post("/api/projects/open", json={"path": str(workdir)}).json()
    destination = tmp_path / "exported.json"
    response = client.post(f"/api/projects/{opened['id']}/export", json={"path": str(destination)})
    assert response.status_code == 200
    # Byte-for-byte forge's own adventure.json — never a re-serialization.
    assert destination.read_bytes() == (workdir / "adventure.json").read_bytes()


def test_publish_symlink_resolves_to_the_workdir(tmp_path: Path) -> None:
    client = TestClient(create_app())
    workdir = copy_workdir(tmp_path)
    opened = client.post("/api/projects/open", json={"path": str(workdir)}).json()
    checkout = tmp_path / "osr-web"
    (checkout / "adventures").mkdir(parents=True)
    response = client.post(
        f"/api/projects/{opened['id']}/publish",
        json={"mode": "symlink", "name": "vault", "checkout_path": str(checkout)},
    )
    assert response.status_code == 200
    link = checkout / "adventures" / "vault"
    assert link.is_symlink() and link.resolve() == workdir.resolve()
    # osr-web discovers adventures/<dir>/adventure.json — the workdir has exactly that.
    assert (link / "adventure.json").is_file()
