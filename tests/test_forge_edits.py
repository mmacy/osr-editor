"""Override-level edits: monster resolution, exclusivity, reasons, entry removal — and the routes around them."""

import shutil
from pathlib import Path

import pytest
import yaml
from fastapi.testclient import TestClient
from osrforge.contracts.overrides import StatBlockOverride

from osreditor.app import create_app
from osreditor.overrides import StatBlockPatch


@pytest.fixture
def client() -> TestClient:
    return TestClient(create_app())


@pytest.fixture
def forge_project(client: TestClient, forge_workdir: Path) -> dict:
    response = client.post("/api/projects/open", json={"path": str(forge_workdir)})
    assert response.status_code == 200, response.text
    return response.json()


def post_edits(client: TestClient, project: dict, *edits: dict, revision: str | None = None) -> dict:
    response = client.post(
        f"/api/projects/{project['id']}/forge/overrides",
        json={"revision": revision if revision is not None else project["revision"], "edits": list(edits)},
    )
    assert response.status_code == 200, response.text
    return response.json()


def test_statblock_patch_mirrors_forge(forge_workdir: Path) -> None:
    # The drift guard: the patch is forge's StatBlockOverride shape minus
    # reason, pinned by field-set equality against the installed forge.
    assert set(StatBlockPatch.model_fields) == set(StatBlockOverride.model_fields) - {"reason"}


def test_remap_resolves_an_unresolved_name(client: TestClient, forge_project: dict, forge_workdir: Path) -> None:
    body = post_edits(
        client,
        forge_project,
        {"edit": "set_monster_remap", "name": "rat king", "template_id": "giant_rat"},
    )
    assert body["forge"]["report"]["monsters"]["unresolved"] == []
    entry = yaml.safe_load((forge_workdir / "overrides.yaml").read_text())["monsters"]["rat king"]
    assert entry == {"template_id": "giant_rat", "reason": "remapped to giant_rat"}
    # One undo step: the remap reverts whole.
    undo = client.post(f"/api/projects/{forge_project['id']}/undo")
    assert undo.status_code == 200
    assert undo.json()["forge"]["report"]["monsters"]["unresolved"] == ["rat king"]


def test_unknown_name_fails_loudly_with_forges_message(
    client: TestClient, forge_project: dict, forge_workdir: Path
) -> None:
    response = client.post(
        f"/api/projects/{forge_project['id']}/forge/overrides",
        json={
            "revision": forge_project["revision"],
            "edits": [{"edit": "set_monster_remap", "name": "never extracted", "template_id": "goblin"}],
        },
    )
    assert response.status_code == 422
    body = response.json()["error"]
    assert body["code"] == "forge_override_invalid"
    # Forge's own message names the entry and lists the cache's unresolved names.
    assert "never extracted" in body["message"]
    assert "rat king" in body["message"]
    # The snapshot restored: no overrides file survives the failed commit.
    assert (forge_workdir / "overrides.yaml").read_bytes() == b""


def test_template_patch_lands_pre_mapping(client: TestClient, forge_project: dict) -> None:
    body = post_edits(
        client,
        forge_project,
        {"edit": "set_template_patch", "name": "mill wisp", "patch": {"morale": 9, "xp": 35}},
    )
    template = next(t for t in body["delta"][0]["value"]["monsters"] if t["id"] == "mill_wisp")
    assert template["morale"] == 9
    assert template["xp"] == 35
    record = next(c for c in body["forge"]["report"]["monsters"]["custom"] if c["id"] == "mill_wisp")
    # The patched fields are printed now, so they leave the derived list.
    assert "xp" not in record["derived"]


def test_remap_and_patch_are_exclusive_per_name(client: TestClient, forge_project: dict, forge_workdir: Path) -> None:
    result = post_edits(
        client,
        forge_project,
        {"edit": "set_template_patch", "name": "rat king", "patch": {"ac": "5", "hit_dice": "3", "hp": 14}},
    )
    data = yaml.safe_load((forge_workdir / "overrides.yaml").read_text())
    assert "rat king" in data["monster_templates"]
    # Committing a remap for the same normalized name deletes the patch.
    post_edits(
        client,
        forge_project,
        {"edit": "set_monster_remap", "name": "Rat  King", "template_id": "giant_rat"},
        revision=result["revision"],
    )
    data = yaml.safe_load((forge_workdir / "overrides.yaml").read_text())
    assert "monster_templates" not in data
    # The entry keeps the caller's spelling; forge matches under normalization.
    assert [key.casefold().split() for key in data["monsters"]] == [["rat", "king"]]


def test_set_reason_marks_the_entry_human_composed(
    client: TestClient, forge_project: dict, forge_workdir: Path
) -> None:
    result = post_edits(
        client,
        forge_project,
        {"edit": "set_monster_remap", "name": "rat king", "template_id": "giant_rat"},
    )
    sidecar = client.get(f"/api/projects/{forge_project['id']}").json()["sidecar"]
    assert "monsters:rat king" in sidecar["auto_reasons"]
    post_edits(
        client,
        forge_project,
        {"edit": "set_reason", "kind": "monsters", "key": "rat king", "reason": "The rat king is a giant rat per p. 2."},
        revision=result["revision"],
    )
    entry = yaml.safe_load((forge_workdir / "overrides.yaml").read_text())["monsters"]["rat king"]
    assert entry["reason"] == "The rat king is a giant rat per p. 2."
    sidecar = client.get(f"/api/projects/{forge_project['id']}").json()["sidecar"]
    assert "monsters:rat king" not in sidecar["auto_reasons"]


def test_remove_entry_removes_at_entry_grain(client: TestClient, forge_project: dict, forge_workdir: Path) -> None:
    result = post_edits(
        client,
        forge_project,
        {"edit": "set_monster_remap", "name": "rat king", "template_id": "giant_rat"},
    )
    post_edits(
        client,
        forge_project,
        {"edit": "remove_entry", "kind": "monsters", "key": "rat king"},
        revision=result["revision"],
    )
    assert not yaml.safe_load((forge_workdir / "overrides.yaml").read_text())


def test_set_reason_on_an_unknown_entry_is_a_targeting_miss(client: TestClient, forge_project: dict) -> None:
    response = client.post(
        f"/api/projects/{forge_project['id']}/forge/overrides",
        json={
            "revision": forge_project["revision"],
            "edits": [{"edit": "set_reason", "kind": "areas", "key": "nowhere/1/1", "reason": "x"}],
        },
    )
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "op_target_not_found"


def test_edits_are_revision_guarded(client: TestClient, forge_project: dict) -> None:
    response = client.post(
        f"/api/projects/{forge_project['id']}/forge/overrides",
        json={
            "revision": "r0",
            "edits": [{"edit": "set_monster_remap", "name": "rat king", "template_id": "giant_rat"}],
        },
    )
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "stale_revision"


def test_forge_routes_reject_native_projects(client: TestClient, tmp_path: Path) -> None:
    state = client.post("/api/projects", json={"path": str(tmp_path / "demo.osr"), "name": "Demo"}).json()
    response = client.post(
        f"/api/projects/{state['id']}/forge/overrides",
        json={
            "revision": state["revision"],
            "edits": [{"edit": "set_monster_remap", "name": "x", "template_id": "y"}],
        },
    )
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "project_not_forge"


# --- check, rerun, pages, previews -------------------------------------------


def test_check_merges_findings_and_marks_checked(client: TestClient, forge_project: dict) -> None:
    response = client.post(f"/api/projects/{forge_project['id']}/forge/check")
    assert response.status_code == 200
    body = response.json()
    assert body["forge"]["checked"] is True
    assert body["revision"] == forge_project["revision"]  # the document is unchanged
    codes = {finding["code"] for finding in body["diagnostics"]["forge"]}
    assert "secret_only_access" in codes
    assert all(finding["source"] == "forge" for finding in body["diagnostics"]["forge"])
    # The delve findings arrive only through this tier.
    assert any(finding["code"].startswith("delve_") for finding in body["diagnostics"]["forge"])


def test_check_findings_wipe_on_the_next_commit(client: TestClient, forge_project: dict) -> None:
    client.post(f"/api/projects/{forge_project['id']}/forge/check")
    body = post_edits(
        client,
        forge_project,
        {"edit": "set_monster_remap", "name": "rat king", "template_id": "giant_rat"},
    )
    # Re-assembly wipes findings by forge's design; the tier honestly empties.
    assert body["diagnostics"]["forge"] == []
    assert body["forge"]["checked"] is False
    assert body["forge"]["report"]["findings"] == []


def test_check_findings_map_locations_onto_the_address_grammar(client: TestClient, forge_project: dict) -> None:
    body = client.post(f"/api/projects/{forge_project['id']}/forge/check").json()
    area_scoped = [f for f in body["diagnostics"]["forge"] if f["code"] == "secret_only_access"]
    assert area_scoped
    for finding in area_scoped:
        assert finding["address"].startswith("dungeon:millstone-warrens/level:")
        assert "/area:" in finding["address"]
    delve = next(finding for finding in body["diagnostics"]["forge"] if finding["code"].startswith("delve_"))
    assert delve["address"] == "dungeon:millstone-warrens"


def test_rerun_applies_an_assembly_owned_knob(client: TestClient, forge_project: dict) -> None:
    response = client.post(
        f"/api/projects/{forge_project['id']}/forge/rerun", json={"settings": {"unresolved_fallback": "omit"}}
    )
    assert response.status_code == 200
    body = response.json()
    assert body["forge"]["run"]["settings"]["unresolved_fallback"] == "omit"
    # Under omit the rat king's stand-in is gone: the encounter drops.
    area = body["delta"][0]["value"]["dungeons"][0]["levels"][1]["areas"][1]
    assert area["encounter"] is None


def test_rerun_surfaces_the_upstream_knob_guard_verbatim(client: TestClient, forge_project: dict) -> None:
    response = client.post(f"/api/projects/{forge_project['id']}/forge/rerun", json={"settings": {"render_dpi": 300}})
    assert response.status_code == 422
    body = response.json()["error"]
    assert body["code"] == "forge_rerun_invalid"
    assert "rerun preprocess instead" in body["message"]


def test_rerun_rejects_an_unknown_knob_as_request_invalid(client: TestClient, forge_project: dict) -> None:
    response = client.post(f"/api/projects/{forge_project['id']}/forge/rerun", json={"settings": {"bogus": 1}})
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "request_invalid"


def test_pages_serve_through_the_store_with_404s(client: TestClient, forge_project: dict) -> None:
    response = client.get(f"/api/projects/{forge_project['id']}/forge/pages/1")
    assert response.status_code == 200
    assert response.headers["content-type"] == "image/png"
    assert response.content.startswith(b"\x89PNG")
    missing = client.get(f"/api/projects/{forge_project['id']}/forge/pages/99")
    assert missing.status_code == 404
    assert missing.json()["error"]["code"] == "forge_page_not_found"


def test_previews_serve_through_the_store_with_404s(client: TestClient, forge_project: dict) -> None:
    response = client.get(f"/api/projects/{forge_project['id']}/forge/previews/millstone-warrens/1")
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("image/svg+xml")
    assert b"<svg" in response.content
    missing = client.get(f"/api/projects/{forge_project['id']}/forge/previews/millstone-warrens/9")
    assert missing.status_code == 404
    assert missing.json()["error"]["code"] == "forge_page_not_found"


# --- detach -------------------------------------------------------------------


def test_detach_writes_provenance_carries_notes_and_leaves_review_marks(
    client: TestClient, forge_project: dict, forge_workdir: Path, tmp_path: Path
) -> None:
    pid = forge_project["id"]
    client.post(
        f"/api/projects/{pid}/sidecar",
        json={
            "patches": [
                {"action": "set_note", "address": "dungeon:millstone-warrens/level:1/area:2", "text": "Check p. 1"},
                {"action": "dismiss_flag", "address": "millstone-warrens/1/1", "flag": "connection_ambiguous:no target stated"},
            ]
        },
    )
    workdir_before = sorted(p.relative_to(forge_workdir).as_posix() for p in forge_workdir.rglob("*"))
    dest = tmp_path / "detached.osr"
    response = client.post(f"/api/projects/{pid}/forge/detach", json={"path": str(dest)})
    assert response.status_code == 200
    state = response.json()
    assert state["type"] == "native"
    assert state["forge"] is None
    provenance = state["sidecar"]["provenance"]
    assert provenance["source_workdir"] == str(forge_workdir)
    assert provenance["osrforge_version"]
    # Notes carry (addresses are stable across the crossing); review marks and
    # auto_reasons stay behind — forge-review state with no native meaning.
    assert state["sidecar"]["notes"] == {"dungeon:millstone-warrens/level:1/area:2": "Check p. 1"}
    assert state["sidecar"]["review"] == []
    assert state["sidecar"]["auto_reasons"] == []
    # The workdir is untouched (the sidecar there keeps its marks) and the old
    # id drops from the registry.
    workdir_after = sorted(p.relative_to(forge_workdir).as_posix() for p in forge_workdir.rglob("*"))
    assert workdir_after == workdir_before
    assert client.get(f"/api/projects/{pid}").status_code == 404
    # The new project round-trips byte-stable: a reopen and no-op is identity.
    detached_document = (dest / "adventure.json").read_bytes()
    reopened = client.post("/api/projects/open", json={"path": str(dest)})
    assert reopened.status_code == 200
    assert (dest / "adventure.json").read_bytes() == detached_document


def test_detach_refuses_an_occupied_destination(client: TestClient, forge_project: dict, tmp_path: Path) -> None:
    dest = tmp_path / "occupied"
    dest.mkdir()
    (dest / "file.txt").write_text("here first", encoding="utf-8")
    response = client.post(f"/api/projects/{forge_project['id']}/forge/detach", json={"path": str(dest)})
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "project_dir_not_empty"


# --- publish and export -------------------------------------------------------


def make_checkout(tmp_path: Path) -> Path:
    checkout = tmp_path / "osr-web"
    (checkout / "adventures").mkdir(parents=True)
    return checkout


def test_publish_symlink_resolves_to_the_workdir_and_republishes_live(
    client: TestClient, forge_project: dict, forge_workdir: Path, tmp_path: Path
) -> None:
    checkout = make_checkout(tmp_path)
    response = client.post(
        f"/api/projects/{forge_project['id']}/publish",
        json={"mode": "symlink", "name": "millstone", "checkout_path": str(checkout)},
    )
    assert response.status_code == 200, response.text
    link = checkout / "adventures" / "millstone"
    assert link.is_symlink()
    assert link.resolve() == forge_workdir.resolve()
    # osr-web reads adventures/<dir>/adventure.json — the workdir has exactly
    # that file at its root, and a committed correction republishes live.
    before = (link / "adventure.json").read_bytes()
    post_edits(
        client,
        forge_project,
        {"edit": "set_monster_remap", "name": "rat king", "template_id": "giant_rat"},
    )
    assert (link / "adventure.json").read_bytes() != before


def test_publish_copy_and_export_use_forges_bytes_verbatim(
    client: TestClient, forge_project: dict, forge_workdir: Path, tmp_path: Path
) -> None:
    checkout = make_checkout(tmp_path)
    workdir_bytes = (forge_workdir / "adventure.json").read_bytes()
    response = client.post(
        f"/api/projects/{forge_project['id']}/publish",
        json={"mode": "copy", "name": "millstone", "checkout_path": str(checkout)},
    )
    assert response.status_code == 200, response.text
    assert (checkout / "adventures" / "millstone.json").read_bytes() == workdir_bytes
    destination = tmp_path / "exported.json"
    response = client.post(f"/api/projects/{forge_project['id']}/export", json={"path": str(destination)})
    assert response.status_code == 200
    assert destination.read_bytes() == workdir_bytes


def test_a_second_open_of_a_copied_workdir_shares_the_project(client: TestClient, forge_workdir: Path) -> None:
    first = client.post("/api/projects/open", json={"path": str(forge_workdir)}).json()
    second = client.post("/api/projects/open", json={"path": str(forge_workdir)}).json()
    assert second["id"] == first["id"]


def test_fixture_copies_leave_the_committed_tree_untouched(forge_workdir: Path) -> None:
    committed = Path(__file__).parent / "fixtures" / "forge_workdir"
    shutil.rmtree(forge_workdir)
    assert not (committed / "adventure.json").exists()
    assert not (committed / "overrides.yaml").exists()
