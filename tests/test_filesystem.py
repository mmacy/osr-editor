"""Path entry: tilde expansion everywhere a path is named, and the browse route the pickers walk."""

import os
import stat
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from osreditor.app import create_app
from osreditor.config import MAX_PICKER_LOCATIONS, load_config
from osreditor.filesystem import browse_directory, display_path, expand_user_path
from osreditor.projects import classify_artifact_names


@pytest.fixture
def client() -> TestClient:
    return TestClient(create_app())


@pytest.fixture
def home(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    """A scratch home, so no test reads the developer's real one."""
    target = tmp_path / "home"
    target.mkdir()
    monkeypatch.setenv("HOME", str(target))
    monkeypatch.setenv("USERPROFILE", str(target))
    return target


def entry_names(listing: dict) -> list[str]:
    return [entry["name"] for entry in listing["entries"]]


def test_expansion_makes_a_tilde_path_absolute(home: Path) -> None:
    assert expand_user_path("~/adventures/mill.osr") == str(home / "adventures" / "mill.osr")
    assert expand_user_path("~") == str(home)


def test_expansion_strips_the_whitespace_a_paste_carries() -> None:
    assert expand_user_path("  /tmp/mill.osr\n") == "/tmp/mill.osr"


def test_expansion_leaves_an_absolute_path_alone() -> None:
    assert expand_user_path("/tmp/mill.osr") == "/tmp/mill.osr"


def test_expansion_leaves_an_unknown_user_untouched() -> None:
    # Nothing to expand to, so the caller's absolute check refuses it with the
    # string the user actually typed.
    assert expand_user_path("~nosuchuser42/mill.osr") == "~nosuchuser42/mill.osr"


def test_display_shortens_home_back_to_a_tilde(home: Path) -> None:
    assert display_path(home / "adventures" / "mill.osr", home) == "~/adventures/mill.osr"
    assert display_path(home, home) == "~"
    assert display_path(Path("/tmp/mill.osr"), home) == "/tmp/mill.osr"


def test_browse_lists_directories_first_then_files_case_insensitively(home: Path) -> None:
    (home / "Zeta").mkdir()
    (home / "alpha").mkdir()
    (home / "beta.txt").touch()
    (home / "Alpha.txt").touch()
    listing = browse_directory(str(home))
    assert [entry.name for entry in listing.entries] == ["alpha", "Zeta", "Alpha.txt", "beta.txt"]


def test_browse_hides_dot_entries_until_asked(home: Path) -> None:
    (home / ".hidden").mkdir()
    (home / "visible").mkdir()
    assert [entry.name for entry in browse_directory(str(home)).entries] == ["visible"]
    assert [entry.name for entry in browse_directory(str(home), show_hidden=True).entries] == [".hidden", "visible"]


def test_browse_marks_native_and_forge_projects(home: Path) -> None:
    (home / "mill.osr").mkdir()
    (home / "mill.osr" / "adventure.json").write_text("{}", encoding="utf-8")
    (home / "cellar.forge").mkdir()
    # A workdir holds an assembled adventure.json too; forge must still win.
    (home / "cellar.forge" / "adventure.json").write_text("{}", encoding="utf-8")
    (home / "cellar.forge" / "run.json").write_text("{}", encoding="utf-8")
    (home / "sketches").mkdir()
    types = {entry.name: entry.project_type for entry in browse_directory(str(home)).entries}
    assert types == {"cellar.forge": "forge", "mill.osr": "native", "sketches": None}


def test_browse_classification_shares_the_detection_rule() -> None:
    # The browser probes for the marker names rather than listing artifacts, so
    # the rule itself must be the one detection applies.
    assert classify_artifact_names({"run.json", "adventure.json"}) == "forge"
    assert classify_artifact_names({"adventure.json"}) == "native"
    assert classify_artifact_names(set()) is None


def test_browse_of_a_file_lists_its_parent(home: Path) -> None:
    (home / "notes.md").touch()
    listing = browse_directory(str(home / "notes.md"))
    assert listing.path == home.as_posix()
    assert "notes.md" in [entry.name for entry in listing.entries]


def test_browse_of_a_path_that_does_not_exist_lands_on_the_nearest_ancestor(home: Path) -> None:
    (home / "adventures").mkdir()
    listing = browse_directory(str(home / "adventures" / "not-yet" / "deeper.osr"))
    assert listing.path == (home / "adventures").as_posix()


def test_browse_without_a_path_lists_home(home: Path) -> None:
    listing = browse_directory(None)
    assert listing.path == home.as_posix()
    assert listing.display_path == "~"
    assert listing.home == home.as_posix()


def test_browse_reports_the_parent_until_the_root(home: Path) -> None:
    assert browse_directory(str(home)).parent == home.parent.as_posix()
    assert browse_directory("/").parent is None


def test_browse_expands_a_tilde_path(home: Path) -> None:
    (home / "adventures").mkdir()
    assert browse_directory("~/adventures").path == (home / "adventures").as_posix()


def test_browse_reads_a_relative_path_against_home(home: Path) -> None:
    # The pickers only ever send absolute paths, but a hand-typed relative one
    # must not resolve against the server's working directory.
    (home / "adventures").mkdir()
    assert browse_directory("adventures").path == (home / "adventures").as_posix()


def test_browse_drops_a_broken_symlink_rather_than_failing(home: Path) -> None:
    (home / "real").mkdir()
    (home / "dangling").symlink_to(home / "gone")
    names = [entry.name for entry in browse_directory(str(home)).entries]
    assert "real" in names
    # is_dir() answers False for a dangling link rather than raising, so it lists
    # as an ordinary file; what matters is that the browse survived it.
    assert "dangling" in names


@pytest.mark.skipif(os.geteuid() == 0, reason="root reads unreadable directories")
def test_browse_of_an_unreadable_directory_answers_path_not_readable(client: TestClient, home: Path) -> None:
    walled = home / "walled"
    walled.mkdir()
    walled.chmod(0o000)
    try:
        response = client.get("/api/fs", params={"path": str(walled)})
        assert response.status_code == 422
        assert response.json()["error"]["code"] == "path_not_readable"
    finally:
        walled.chmod(stat.S_IRWXU)


def test_browse_route_answers_the_listing(client: TestClient, home: Path) -> None:
    (home / "adventures").mkdir()
    (home / "adventures" / "mill.osr").mkdir()
    (home / "adventures" / "mill.osr" / "adventure.json").write_text("{}", encoding="utf-8")
    response = client.get("/api/fs", params={"path": "~/adventures"})
    assert response.status_code == 200
    listing = response.json()
    assert listing["display_path"] == "~/adventures"
    assert listing["home"] == home.as_posix()
    assert entry_names(listing) == ["mill.osr"]
    assert listing["entries"][0]["display_path"] == "~/adventures/mill.osr"
    assert listing["entries"][0]["project_type"] == "native"


def test_browse_route_takes_the_hidden_toggle(client: TestClient, home: Path) -> None:
    (home / ".config").mkdir()
    assert entry_names(client.get("/api/fs", params={"path": str(home)}).json()) == []
    listing = client.get("/api/fs", params={"path": str(home), "show_hidden": True}).json()
    assert entry_names(listing) == [".config"]


def test_create_accepts_a_tilde_destination(client: TestClient, home: Path) -> None:
    response = client.post("/api/projects", json={"path": "~/adventures/mill.osr", "name": "The mill"})
    assert response.status_code == 201, response.text
    assert response.json()["path"] == str(home / "adventures" / "mill.osr")
    assert (home / "adventures" / "mill.osr" / "adventure.json").is_file()


def test_open_accepts_a_tilde_path(client: TestClient, home: Path) -> None:
    client.post("/api/projects", json={"path": "~/mill.osr", "name": "The mill"})
    response = client.post("/api/projects/open", json={"path": "~/mill.osr"})
    assert response.status_code == 200, response.text
    assert response.json()["path"] == str(home / "mill.osr")


def test_export_accepts_a_tilde_destination(client: TestClient, home: Path) -> None:
    project = client.post("/api/projects", json={"path": "~/mill.osr", "name": "The mill"}).json()
    response = client.post(f"/api/projects/{project['id']}/export", json={"path": "~/exports/mill.json"})
    assert response.status_code == 200, response.text
    assert response.json()["path"] == str(home / "exports" / "mill.json")
    assert (home / "exports" / "mill.json").is_file()


def test_publish_accepts_a_tilde_checkout_path(client: TestClient, home: Path) -> None:
    checkout = home / "osr-web"
    (checkout / "adventures").mkdir(parents=True)
    project = client.post("/api/projects", json={"path": "~/mill.osr", "name": "The mill"}).json()
    response = client.post(
        f"/api/projects/{project['id']}/publish",
        json={"mode": "copy", "checkout_path": "~/osr-web"},
    )
    assert response.status_code == 200, response.text
    assert Path(response.json()["path"]).is_relative_to(checkout)


def test_importer_sniff_accepts_a_tilde_path(client: TestClient, home: Path) -> None:
    (home / "maps").mkdir()
    (home / "maps" / "dungeon.json").write_text("{}", encoding="utf-8")
    response = client.post("/api/importers/sniff", json={"path": "~/maps/dungeon.json"})
    assert response.status_code == 200, response.text


def test_conversion_lookup_expands_a_tilde_workdir(client: TestClient, home: Path) -> None:
    # No session exists for it; what matters is that the tilde reached the
    # registry as an expanded path rather than being refused as a bad request.
    response = client.get("/api/conversions", params={"workdir": "~/workdirs/cellar.forge"})
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "unknown_conversion"


def test_a_picker_reopens_where_its_scope_last_chose(client: TestClient, home: Path) -> None:
    (home / "adventures").mkdir()
    remembered = client.post(
        "/api/fs/location",
        json={"scope": "open-project-path", "path": "~/adventures"},
    )
    assert remembered.status_code == 200, remembered.text
    assert remembered.json() == {"scope": "open-project-path", "path": str(home / "adventures")}

    # A browse with no path of its own falls back to that scope's location.
    listing = client.get("/api/fs", params={"scope": "open-project-path"}).json()
    assert listing["path"] == (home / "adventures").as_posix()


def test_each_scope_remembers_its_own_location(client: TestClient, home: Path) -> None:
    (home / "adventures").mkdir()
    (home / "exports").mkdir()
    client.post("/api/fs/location", json={"scope": "open-project-path", "path": "~/adventures"})
    client.post("/api/fs/location", json={"scope": "export-path", "path": "~/exports"})
    assert client.get("/api/fs", params={"scope": "open-project-path"}).json()["display_path"] == "~/adventures"
    assert client.get("/api/fs", params={"scope": "export-path"}).json()["display_path"] == "~/exports"


def test_an_explicit_path_beats_the_remembered_location(client: TestClient, home: Path) -> None:
    (home / "adventures").mkdir()
    (home / "elsewhere").mkdir()
    client.post("/api/fs/location", json={"scope": "export-path", "path": "~/adventures"})
    listing = client.get("/api/fs", params={"path": "~/elsewhere", "scope": "export-path"}).json()
    assert listing["display_path"] == "~/elsewhere"


def test_an_unknown_scope_falls_through_to_home(client: TestClient, home: Path) -> None:
    assert client.get("/api/fs", params={"scope": "never-used"}).json()["path"] == home.as_posix()


def test_a_remembered_location_that_has_since_vanished_walks_up(client: TestClient, home: Path) -> None:
    gone = home / "adventures" / "archive"
    gone.mkdir(parents=True)
    client.post("/api/fs/location", json={"scope": "export-path", "path": str(gone)})
    gone.rmdir()
    listing = client.get("/api/fs", params={"scope": "export-path"}).json()
    assert listing["path"] == (home / "adventures").as_posix()


def test_re_recording_a_scope_updates_it_rather_than_growing_the_map(client: TestClient, home: Path) -> None:
    for name in ("first", "second"):
        (home / name).mkdir()
        client.post("/api/fs/location", json={"scope": "export-path", "path": str(home / name)})
    assert load_config().picker_locations == {"export-path": str(home / "second")}


def test_the_location_map_is_capped_against_client_minted_scopes(client: TestClient, home: Path) -> None:
    for index in range(MAX_PICKER_LOCATIONS + 5):
        client.post("/api/fs/location", json={"scope": f"scope-{index}", "path": str(home)})
    locations = load_config().picker_locations
    assert len(locations) == MAX_PICKER_LOCATIONS
    # The oldest went first, and the newest are all still there.
    assert "scope-0" not in locations
    assert f"scope-{MAX_PICKER_LOCATIONS + 4}" in locations


def test_a_malformed_scope_is_refused(client: TestClient, home: Path) -> None:
    response = client.post("/api/fs/location", json={"scope": "../../etc", "path": str(home)})
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "request_invalid"


def test_a_relative_location_is_refused(client: TestClient) -> None:
    response = client.post("/api/fs/location", json={"scope": "export-path", "path": "adventures"})
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "request_invalid"


def test_a_relative_path_is_still_refused(client: TestClient) -> None:
    response = client.post("/api/projects/open", json={"path": "adventures/mill.osr"})
    assert response.status_code == 422
    body = response.json()["error"]
    assert body["code"] == "request_invalid"
    assert "must be absolute" in body["details"]["errors"][0]["message"]
