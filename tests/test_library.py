"""The content library's backend: projection goldens, source opens, the stash act, stash opens."""

import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from osrlib.crawl.content_pack import ContentPack
from osrlib.crawl.dungeon import Direction, Position, TransitionSpec, TrapEffect, TrapSpec, WanderingSpec
from osrlib.versioning import SCHEMA_VERSION

from osreditor.app import create_app
from osreditor.documents import DocumentService, OpenProject
from osreditor.errors import (
    ForgeWorkdirIncompleteError,
    InvalidProjectError,
    OpTargetNotFoundError,
    ProjectPathNotFoundError,
    StaleRevisionError,
    StashPackNotFoundError,
)
from osreditor.library import (
    open_source,
    open_stash_pack,
    pack_from_adventure,
    stash_level,
    stash_pack_for_level,
    wandering_is_authored,
)
from osreditor.ops import OpBatch
from osreditor.projects import open_project
from osreditor.store import LocalProjectStore
from test_small_module import build_small_module

SMALL_MODULE_PATH = Path(__file__).parent / "fixtures" / "small_module.json"

LEVEL_1 = "dungeon:mill-caves/level:1"
LEVEL_2 = "dungeon:mill-caves/level:2"


@pytest.fixture
def service() -> DocumentService:
    return DocumentService(LocalProjectStore())


def open_small_module(service: DocumentService, tmp_path: Path) -> OpenProject:
    project_dir = tmp_path / "small.osr"
    service.store.write_artifact(str(project_dir), "adventure.json", SMALL_MODULE_PATH.read_bytes())
    return open_project(service, project_dir)


def batch(project: OpenProject, *ops: dict) -> OpBatch:
    return OpBatch.model_validate({"revision": project.revision, "ops": list(ops)})


# --- the projection ----------------------------------------------------------


def test_projection_sections_and_entries_carry_address_ids_in_order() -> None:
    pack = pack_from_adventure(build_small_module())
    assert pack.id == ""
    assert pack.name == "The Mill on the Moor"
    assert [section.id for section in pack.sections] == [LEVEL_1, LEVEL_2]
    assert [section.label for section in pack.sections] == ["The mill caves level 1", "The mill caves level 2"]
    assert [entry.id for entry in pack.sections[0].entries] == [
        f"{LEVEL_1}/area:1",
        f"{LEVEL_1}/area:2",
        f"{LEVEL_1}/area:3",
    ]
    assert [entry.id for entry in pack.sections[1].entries] == [f"{LEVEL_2}/area:4", f"{LEVEL_2}/area:5"]


def test_projection_carries_content_and_strips_nothing_else() -> None:
    pack = pack_from_adventure(build_small_module())
    guard_post = pack.sections[0].entries[0]
    assert guard_post.name == "The guard post"
    assert guard_post.encounter is not None
    assert [keyed.template_id for keyed in guard_post.encounter.monsters] == ["orc", "skeleton"]
    sifting_room = pack.sections[0].entries[1]
    assert sifting_room.trap is not None and sifting_room.treasure is not None
    cache_room = pack.sections[0].entries[2]
    assert cache_room.treasure is not None and len(cache_room.features) == 1
    # The trapped cache rides inside its feature, coupling intact.
    assert cache_room.features[0].trap is not None


def test_projection_closure_is_exactly_the_referenced_bundled_template() -> None:
    pack = pack_from_adventure(build_small_module())
    assert [template.id for template in pack.monsters] == ["drowned-miller"]


def test_projection_drops_an_unreferenced_bundled_template() -> None:
    module = build_small_module()
    spare = module.monsters[0].model_copy(update={"id": "never-keyed"})
    module = module.model_copy(update={"monsters": (*module.monsters, spare)})
    pack = pack_from_adventure(module)
    assert [template.id for template in pack.monsters] == ["drowned-miller"]


def test_projection_strips_feature_cells() -> None:
    module = build_small_module()
    dungeon = module.dungeons[0]
    level = dungeon.levels[0]
    area = level.areas[2]
    bound = area.features[0].model_copy(update={"cell": Position((4, 0))})
    doctored_area = area.model_copy(update={"features": (bound,)})
    doctored_level = level.model_copy(update={"areas": (*level.areas[:2], doctored_area)})
    module = module.model_copy(
        update={"dungeons": (dungeon.model_copy(update={"levels": (doctored_level, *dungeon.levels[1:])}),)}
    )
    pack = pack_from_adventure(module)
    assert pack.sections[0].entries[2].features[0].cell is None


def test_projection_keeps_a_slide_traps_transition_verbatim() -> None:
    module = build_small_module()
    dungeon = module.dungeons[0]
    level = dungeon.levels[0]
    slide = TrapSpec(
        kind="room",
        trigger="enter",
        effect=TrapEffect(
            transition=TransitionSpec(
                kind="chute",
                position=(3, 0),
                to_dungeon_id="elsewhere",
                to_level_number=9,
                to_position=(0, 0),
                to_facing=Direction.SOUTH,
            )
        ),
    )
    doctored_area = level.areas[1].model_copy(update={"trap": slide})
    doctored_level = level.model_copy(update={"areas": (level.areas[0], doctored_area, level.areas[2])})
    module = module.model_copy(
        update={"dungeons": (dungeon.model_copy(update={"levels": (doctored_level, *dungeon.levels[1:])}),)}
    )
    entry = pack_from_adventure(module).sections[0].entries[1]
    assert entry.trap is not None and entry.trap.effect.transition is not None
    assert entry.trap.effect.transition.to_dungeon_id == "elsewhere"


def test_projection_carries_wandering_exactly_when_authored() -> None:
    pack = pack_from_adventure(build_small_module())
    # Level 1 sits on RAW defaults and contributes no wandering entry.
    assert pack.sections[0].wandering is None
    assert pack.sections[1].wandering is not None


def test_a_chance_only_wandering_spec_is_authored() -> None:
    assert not wandering_is_authored(WanderingSpec())
    assert wandering_is_authored(WanderingSpec(chance_in_six=2))
    assert wandering_is_authored(WanderingSpec(interval_turns=3))


def test_entry_key_order_is_the_maps_walk_order() -> None:
    module = build_small_module()
    dungeon = module.dungeons[0]
    level = dungeon.levels[0]
    lair = level.areas[0].model_copy(update={"id": "lair", "encounter": None})
    tenth = level.areas[1].model_copy(update={"id": "10", "trap": None, "treasure": None})
    doctored_level = level.model_copy(update={"areas": (lair, tenth, level.areas[2])})
    module = module.model_copy(
        update={"dungeons": (dungeon.model_copy(update={"levels": (doctored_level, *dungeon.levels[1:])}),)}
    )
    section = pack_from_adventure(module).sections[0]
    # Numeric ids numerically first, then the rest lexicographically.
    assert [entry.id.rsplit(":", 1)[1] for entry in section.entries] == ["3", "10", "lair"]


# --- source opens ------------------------------------------------------------


def test_current_project_source_projects_revision_consistently_from_memory(
    service: DocumentService, tmp_path: Path
) -> None:
    project = open_small_module(service, tmp_path)
    state = open_source(service, project.path)
    assert state.habitat == "project"
    assert state.identity == str(project.path)
    assert state.pack.sections[0].entries[0].name == "The guard post"
    service.apply_batch(
        project,
        batch(
            project,
            {
                "op": "set_area_field",
                "dungeon_id": "mill-caves",
                "level_number": 1,
                "area_id": "1",
                "field": "name",
                "value": "Renamed post",
            },
        ),
    )
    refreshed = open_source(service, project.path)
    assert refreshed.pack.sections[0].entries[0].name == "Renamed post"


def test_a_second_native_project_opens_through_the_store(service: DocumentService, tmp_path: Path) -> None:
    source_dir = tmp_path / "other.osr"
    service.store.write_artifact(str(source_dir), "adventure.json", SMALL_MODULE_PATH.read_bytes())
    before = sorted(service.store.list_artifacts(str(source_dir)))
    state = open_source(service, source_dir)
    assert state.habitat == "project"
    assert state.label == "The Mill on the Moor"
    assert [template.id for template in state.pack.monsters] == ["drowned-miller"]
    assert state.findings == ()
    # A source open is a read: no project registers, nothing is written.
    assert service.open_at(source_dir.resolve()) is None
    assert sorted(service.store.list_artifacts(str(source_dir))) == before


def test_a_forge_workdir_source_assembles_current_first(service: DocumentService, forge_workdir: Path) -> None:
    state = open_source(service, forge_workdir)
    assert state.habitat == "project"
    assert state.identity == str(forge_workdir.resolve())
    assert state.pack.sections
    # Assembly's writes are forge's own artifacts; the editor writes nothing —
    # the scoped assertion, not a false absolute.
    assert not (forge_workdir / "editor.json").exists()
    assert service.open_at(forge_workdir.resolve()) is None


def test_an_incomplete_workdir_source_refuses_with_the_stage_remedy(
    service: DocumentService, warm_workdir: Path
) -> None:
    with pytest.raises(ForgeWorkdirIncompleteError, match="survey"):
        open_source(service, warm_workdir)


def test_a_non_project_source_refuses(service: DocumentService, tmp_path: Path) -> None:
    empty = tmp_path / "empty"
    empty.mkdir()
    with pytest.raises(InvalidProjectError):
        open_source(service, empty)
    with pytest.raises(ProjectPathNotFoundError):
        open_source(service, tmp_path / "nowhere")


def test_source_open_route_answers_the_source_state(tmp_path: Path) -> None:
    client = TestClient(create_app())
    source_dir = tmp_path / "other.osr"
    source_dir.mkdir()
    (source_dir / "adventure.json").write_bytes(SMALL_MODULE_PATH.read_bytes())
    response = client.post("/api/sources/open", json={"path": str(source_dir)})
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["habitat"] == "project"
    assert body["label"] == "The Mill on the Moor"
    assert [section["id"] for section in body["pack"]["sections"]] == [LEVEL_1, LEVEL_2]
    assert body["findings"] == []


# --- the stash act -----------------------------------------------------------


def test_stash_captures_the_level_at_the_verified_revision(service: DocumentService, tmp_path: Path) -> None:
    project = open_small_module(service, tmp_path)
    sidecar = stash_level(service, project, project.revision, "mill-caves", 2)
    assert sidecar.stash_counter == 1
    wrapper = sidecar.stash[0]
    assert wrapper.pack_id == "stash-1"
    assert wrapper.label.startswith("The mill caves level 2 — ")
    assert wrapper.label.removeprefix("The mill caves level 2 — ") == wrapper.created_at[:10]
    document = wrapper.document
    assert isinstance(document, dict) and document["kind"] == "content_pack"
    pack = ContentPack.from_document(document)
    assert pack.id == "stash-1"
    assert [section.id for section in pack.sections] == [LEVEL_2]
    assert pack.sections[0].wandering is not None
    assert [template.id for template in pack.monsters] == ["drowned-miller"]
    # Persisted in the same critical section.
    written = json.loads((project.path / "editor.json").read_text())
    assert written["stash"][0]["pack_id"] == "stash-1"


def test_stash_excludes_level_scope_features_and_unauthored_wandering(service: DocumentService, tmp_path: Path) -> None:
    project = open_small_module(service, tmp_path)
    sidecar = stash_level(service, project, project.revision, "mill-caves", 1)
    document = sidecar.stash[0].document
    assert isinstance(document, dict)
    pack = ContentPack.from_document(document)
    section = pack.sections[0]
    # Level 1's chalk warning is level-scope and geometry-bound: not captured.
    assert all(feature.id != "feature-2" for entry in section.entries for feature in entry.features)
    # Level 1 sits on RAW wandering defaults: no wandering entry captured.
    assert section.wandering is None
    # The area-scope cache feature is captured, cell binding stripped.
    cache_entry = section.entries[2]
    assert [feature.id for feature in cache_entry.features] == ["feature-1"]


def test_a_stale_stash_refuses_before_any_capture(service: DocumentService, tmp_path: Path) -> None:
    project = open_small_module(service, tmp_path)
    stale = project.revision
    service.apply_batch(
        project,
        batch(
            project,
            {
                "op": "set_area_field",
                "dungeon_id": "mill-caves",
                "level_number": 1,
                "area_id": "1",
                "field": "name",
                "value": "Moved on",
            },
        ),
    )
    with pytest.raises(StaleRevisionError):
        stash_level(service, project, stale, "mill-caves", 1)
    assert project.sidecar.stash == ()
    assert project.sidecar.stash_counter == 0


def test_a_missing_stash_target_is_a_targeting_miss(service: DocumentService, tmp_path: Path) -> None:
    project = open_small_module(service, tmp_path)
    with pytest.raises(OpTargetNotFoundError):
        stash_level(service, project, project.revision, "mill-caves", 9)
    with pytest.raises(OpTargetNotFoundError):
        stash_level(service, project, project.revision, "no-such-dungeon", 1)
    assert project.sidecar.stash_counter == 0


def test_the_counter_stays_monotonic_across_a_delete(service: DocumentService, tmp_path: Path) -> None:
    from osreditor.sidecar import RemoveStashPack

    project = open_small_module(service, tmp_path)
    stash_level(service, project, project.revision, "mill-caves", 1)
    service.apply_sidecar_patch(project, (RemoveStashPack(pack_id="stash-1"),))
    assert project.sidecar.stash == ()
    sidecar = stash_level(service, project, project.revision, "mill-caves", 1)
    # A dead pack's id is never re-minted: its copy records must not be inherited.
    assert sidecar.stash[0].pack_id == "stash-2"
    assert sidecar.stash_counter == 2


# --- stash opens -------------------------------------------------------------


def test_stash_open_vets_and_answers_the_source_shape(service: DocumentService, tmp_path: Path) -> None:
    project = open_small_module(service, tmp_path)
    stash_level(service, project, project.revision, "mill-caves", 2)
    state = open_stash_pack(project, "stash-1")
    assert state.habitat == "stash"
    assert state.identity == "stash-1"
    assert state.label == project.sidecar.stash[0].label
    assert state.findings == ()
    expected = stash_pack_for_level(
        project.adventure, "mill-caves", 2, pack_id="stash-1", name=project.sidecar.stash[0].label
    )
    assert state.pack == expected


def test_a_dangling_stash_pack_opens_with_findings(service: DocumentService, tmp_path: Path) -> None:
    project = open_small_module(service, tmp_path)
    # Removing the bundled template leaves the level 2 encounter dangling —
    # legal while editing, and the stash captures the document as it stands.
    service.apply_batch(project, batch(project, {"op": "remove_monster_template", "template_id": "drowned-miller"}))
    stash_level(service, project, project.revision, "mill-caves", 2)
    state = open_stash_pack(project, "stash-1")
    codes = {finding.code for finding in state.findings}
    assert "pack.encounter.unknown_monster" in codes


def test_an_unknown_stash_id_is_not_found(service: DocumentService, tmp_path: Path) -> None:
    project = open_small_module(service, tmp_path)
    with pytest.raises(StashPackNotFoundError):
        open_stash_pack(project, "stash-9")


def test_stash_routes_round_trip_and_refuse_a_newer_engine_pack(tmp_path: Path) -> None:
    client = TestClient(create_app())
    project_dir = tmp_path / "small.osr"
    project_dir.mkdir()
    (project_dir / "adventure.json").write_bytes(SMALL_MODULE_PATH.read_bytes())
    state = client.post("/api/projects/open", json={"path": str(project_dir)}).json()
    stashed = client.post(
        f"/api/projects/{state['id']}/library/stash",
        json={"revision": state["revision"], "dungeon_id": "mill-caves", "level_number": 2},
    )
    assert stashed.status_code == 200, stashed.text
    assert stashed.json()["stash"][0]["pack_id"] == "stash-1"
    opened = client.post(f"/api/projects/{state['id']}/library/stash/open", json={"pack_id": "stash-1"})
    assert opened.status_code == 200, opened.text
    assert opened.json()["habitat"] == "stash"
    missing = client.post(f"/api/projects/{state['id']}/library/stash/open", json={"pack_id": "stash-9"})
    assert missing.status_code == 404
    assert missing.json()["error"]["code"] == "stash_pack_not_found"
    # A pack a newer engine stamped refuses by name with the upgrade remedy —
    # while the listing wrapper keeps naming it.
    sidecar_path = project_dir / "editor.json"
    contents = json.loads(sidecar_path.read_text())
    contents["stash"][0]["document"]["schema_version"] = SCHEMA_VERSION + 1
    sidecar_path.write_text(json.dumps(contents))
    reopened = TestClient(create_app())
    fresh = reopened.post("/api/projects/open", json={"path": str(project_dir)}).json()
    assert fresh["sidecar"]["stash"][0]["pack_id"] == "stash-1"
    refused = reopened.post(f"/api/projects/{fresh['id']}/library/stash/open", json={"pack_id": "stash-1"})
    assert refused.status_code == 409
    assert refused.json()["error"]["code"] == "schema_version_newer"
    assert refused.json()["error"]["remedy"]


def test_a_stale_stash_route_answers_the_pinned_409(tmp_path: Path) -> None:
    client = TestClient(create_app())
    project_dir = tmp_path / "small.osr"
    project_dir.mkdir()
    (project_dir / "adventure.json").write_bytes(SMALL_MODULE_PATH.read_bytes())
    state = client.post("/api/projects/open", json={"path": str(project_dir)}).json()
    response = client.post(
        f"/api/projects/{state['id']}/library/stash",
        json={"revision": "r99", "dungeon_id": "mill-caves", "level_number": 1},
    )
    assert response.status_code == 409
    body = response.json()["error"]
    assert body["code"] == "stale_revision"
    assert body["details"]["current_revision"] == state["revision"]
