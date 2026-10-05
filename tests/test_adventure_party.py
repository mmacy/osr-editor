"""Acceptance tests for editing the party an adventure is written for: chunk `adventure-party`.

`SetAdventureField` grows a `party` field that takes a whole osrlib
`PartySpec` or `None`. A native project sets and clears `Adventure.party`
like any other adventure field. A forge-backed project blocks the edit with
the detach offer, because the pinned osr-forge's `ModuleOverride` has no
`party` field to translate it into.
"""

import json
from pathlib import Path

import pytest
from osrlib.crawl.adventure import PartySpec
from pydantic import ValidationError

from osreditor.documents import DocumentService, OpenProject
from osreditor.errors import OpUnsupportedForgeError
from osreditor.ops import OpBatch, SetAdventureField, SubtreeChange
from osreditor.projects import create_native_project, open_project
from osreditor.store import LocalProjectStore
from test_overrides import batch as forge_batch
from test_overrides import open_forge

STUB = pytest.mark.xfail(reason="chunk: adventure-party", raises=NotImplementedError, strict=True)

PARTY = PartySpec(min_level=1, max_level=3, min_size=6, max_size=8)
PARTY_JSON = {"min_level": 1, "max_level": 3, "min_size": 6, "max_size": 8}
BLOCKED_MESSAGE = "the adventure party has no override kind"


@pytest.fixture
def service() -> DocumentService:
    return DocumentService(LocalProjectStore())


@pytest.fixture
def project(service: DocumentService, tmp_path: Path) -> OpenProject:
    project_dir = tmp_path / "demo.osr"
    create_native_project(service.store, str(project_dir), "Demo")
    return open_project(service, project_dir)


def batch(project: OpenProject, *ops: SetAdventureField) -> OpBatch:
    return OpBatch(revision=project.revision, ops=ops)


def saved_payload(service: DocumentService, project: OpenProject) -> dict:
    return json.loads(service.store.read_artifact(str(project.path), "adventure.json"))["payload"]


class TestThePartyField:
    @STUB
    def test_takes_a_party_spec(self) -> None:
        assert SetAdventureField(field="party", value=PARTY).value == PARTY

    @STUB
    def test_parses_a_party_from_json(self) -> None:
        parsed = OpBatch.model_validate(
            {"revision": "r1", "ops": [{"op": "set_adventure_field", "field": "party", "value": PARTY_JSON}]}
        )
        assert parsed.ops[0] == SetAdventureField(field="party", value=PARTY)

    @STUB
    def test_takes_none_to_clear(self) -> None:
        assert SetAdventureField(field="party", value=None).value is None

    @STUB
    @pytest.mark.parametrize("value", ["levels 1 to 3", ("levels 1 to 3",)])
    def test_rejects_a_string_or_a_tuple(self, value: str | tuple[str, ...]) -> None:
        with pytest.raises(ValidationError):
            SetAdventureField(field="party", value=value)

    def test_rejects_a_range_party_spec_rejects(self) -> None:
        with pytest.raises(ValidationError):
            OpBatch.model_validate(
                {
                    "revision": "r1",
                    "ops": [
                        {
                            "op": "set_adventure_field",
                            "field": "party",
                            "value": {"min_level": 3, "max_level": 1, "min_size": None, "max_size": None},
                        }
                    ],
                }
            )

    def test_the_other_fields_still_reject_none(self) -> None:
        for field in ("name", "description", "hooks"):
            with pytest.raises(ValidationError):
                SetAdventureField(field=field, value=None)

    def test_the_other_fields_reject_a_party(self) -> None:
        with pytest.raises(ValidationError):
            SetAdventureField(field="hooks", value=PARTY)


class TestNativeProject:
    @STUB
    def test_sets_the_party_and_persists_it(self, service: DocumentService, project: OpenProject) -> None:
        result = service.apply_batch(project, batch(project, SetAdventureField(field="party", value=PARTY)))
        assert project.adventure.party == PARTY
        assert result.delta == (SubtreeChange(path="/party", value=PARTY_JSON),)
        payload = saved_payload(service, project)
        assert payload["party"] == PARTY_JSON
        keys = list(payload)
        assert keys.index("party") == keys.index("hooks") + 1

    @STUB
    def test_clears_the_party(self, service: DocumentService, project: OpenProject) -> None:
        service.apply_batch(project, batch(project, SetAdventureField(field="party", value=PARTY)))
        result = service.apply_batch(project, batch(project, SetAdventureField(field="party", value=None)))
        assert project.adventure.party is None
        assert result.delta == (SubtreeChange(path="/party", value=None),)
        assert saved_payload(service, project)["party"] is None

    @STUB
    def test_undo_and_redo_the_party(self, service: DocumentService, project: OpenProject) -> None:
        service.apply_batch(project, batch(project, SetAdventureField(field="party", value=PARTY)))
        service.undo(project)
        assert project.adventure.party is None
        service.redo(project)
        assert project.adventure.party == PARTY

    @STUB
    def test_the_party_survives_reopening(self, service: DocumentService, project: OpenProject) -> None:
        service.apply_batch(project, batch(project, SetAdventureField(field="party", value=PARTY)))
        written = service.store.read_artifact(str(project.path), "adventure.json")
        reopened = open_project(DocumentService(LocalProjectStore()), project.path)
        assert reopened.adventure.party == PARTY
        assert service.store.read_artifact(str(project.path), "adventure.json") == written


class TestForgeBackedProject:
    @STUB
    @pytest.mark.parametrize("value", [PARTY_JSON, None], ids=["set", "clear"])
    def test_a_party_edit_blocks_with_the_detach_offer(self, forge_workdir: Path, value: dict | None) -> None:
        service, project = open_forge(forge_workdir)
        with pytest.raises(OpUnsupportedForgeError) as excinfo:
            service.apply_batch(
                project, forge_batch(project, {"op": "set_adventure_field", "field": "party", "value": value})
            )
        assert excinfo.value.op == "set_adventure_field"
        assert excinfo.value.address == "adventure"
        assert str(excinfo.value) == BLOCKED_MESSAGE
        assert not (forge_workdir / "overrides.yaml").exists()
        assert project.revision == "r1"

    @STUB
    def test_a_party_edit_rejects_the_whole_batch(self, forge_workdir: Path) -> None:
        service, project = open_forge(forge_workdir)
        with pytest.raises(OpUnsupportedForgeError):
            service.apply_batch(
                project,
                forge_batch(
                    project,
                    {"op": "set_adventure_field", "field": "name", "value": "Renamed"},
                    {"op": "set_adventure_field", "field": "party", "value": PARTY_JSON},
                ),
            )
        assert not (forge_workdir / "overrides.yaml").exists()
        assert project.adventure.name != "Renamed"
