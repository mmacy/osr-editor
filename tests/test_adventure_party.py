"""Editing the party an adventure is written for, in native and forge-backed projects.

`SetAdventureField` has a `party` field that takes a whole osrlib
`PartySpec` or `None`. A native project sets and clears `Adventure.party`
like any other adventure field.

The forge-backed tests are the acceptance tests for chunk `forge-party`. In a
forge-backed project a party edit becomes the `party` field of the `module:`
override, the way name, description, and hooks do: a mapping replaces the
survey's party whole, its omitted sizes become null, and an explicit `null`
clears it. The `forge_workdir` fixture's survey states a party (levels 1 to
3, four to six characters), so set, replace, clear, and undo each leave a
different party behind.
"""

import json
from pathlib import Path

import pytest
from osrforge.contracts.overrides import load_overrides
from osrlib.crawl.adventure import PartySpec
from pydantic import ValidationError

from osreditor.documents import DocumentService, OpenProject
from osreditor.ops import OpBatch, SetAdventureField, SubtreeChange
from osreditor.projects import create_native_project, open_project
from osreditor.store import LocalProjectStore
from test_overrides import apply_and_check_roundtrip, open_forge, overrides_data
from test_overrides import batch as forge_batch

PARTY = PartySpec(min_level=1, max_level=3, min_size=6, max_size=8)
PARTY_JSON = {"min_level": 1, "max_level": 3, "min_size": 6, "max_size": 8}
SURVEY_PARTY = PartySpec(min_level=1, max_level=3, min_size=4, max_size=6)
FORGE_PARTY = pytest.mark.xfail(reason="chunk: forge-party", strict=True)


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
    def test_takes_a_party_spec(self) -> None:
        assert SetAdventureField(field="party", value=PARTY).value == PARTY

    def test_parses_a_party_from_json(self) -> None:
        parsed = OpBatch.model_validate(
            {"revision": "r1", "ops": [{"op": "set_adventure_field", "field": "party", "value": PARTY_JSON}]}
        )
        assert parsed.ops[0] == SetAdventureField(field="party", value=PARTY)

    def test_takes_none_to_clear(self) -> None:
        assert SetAdventureField(field="party", value=None).value is None

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
    def test_sets_the_party_and_persists_it(self, service: DocumentService, project: OpenProject) -> None:
        result = service.apply_batch(project, batch(project, SetAdventureField(field="party", value=PARTY)))
        assert project.adventure.party == PARTY
        assert result.delta == (SubtreeChange(path="/party", value=PARTY_JSON),)
        payload = saved_payload(service, project)
        assert payload["party"] == PARTY_JSON
        keys = list(payload)
        assert keys.index("party") == keys.index("hooks") + 1

    def test_clears_the_party(self, service: DocumentService, project: OpenProject) -> None:
        service.apply_batch(project, batch(project, SetAdventureField(field="party", value=PARTY)))
        result = service.apply_batch(project, batch(project, SetAdventureField(field="party", value=None)))
        assert project.adventure.party is None
        assert result.delta == (SubtreeChange(path="/party", value=None),)
        assert saved_payload(service, project)["party"] is None

    def test_undo_and_redo_the_party(self, service: DocumentService, project: OpenProject) -> None:
        service.apply_batch(project, batch(project, SetAdventureField(field="party", value=PARTY)))
        service.undo(project)
        assert project.adventure.party is None
        service.redo(project)
        assert project.adventure.party == PARTY

    def test_the_party_survives_reopening(self, service: DocumentService, project: OpenProject) -> None:
        service.apply_batch(project, batch(project, SetAdventureField(field="party", value=PARTY)))
        written = service.store.read_artifact(str(project.path), "adventure.json")
        reopened = open_project(DocumentService(LocalProjectStore()), project.path)
        assert reopened.adventure.party == PARTY
        assert service.store.read_artifact(str(project.path), "adventure.json") == written


def set_party(value: dict | None) -> dict:
    return {"op": "set_adventure_field", "field": "party", "value": value}


class TestForgeBackedProject:
    def test_the_draft_carries_the_survey_party(self, forge_workdir: Path) -> None:
        _, project = open_forge(forge_workdir)
        assert project.adventure.party == SURVEY_PARTY

    @FORGE_PARTY
    def test_setting_the_party_writes_the_module_entry(self, forge_workdir: Path) -> None:
        service, project = open_forge(forge_workdir)
        apply_and_check_roundtrip(service, project, set_party(PARTY_JSON))
        assert project.adventure.party == PARTY
        assert (forge_workdir / "overrides.yaml").read_text() == (
            "module:\n"
            "  party:\n"
            "    min_level: 1\n"
            "    max_level: 3\n"
            "    min_size: 6\n"
            "    max_size: 8\n"
            "  reason: module party corrected\n"
        )
        assert project.revision == "r2"

    @FORGE_PARTY
    def test_a_party_without_sizes_replaces_the_survey_party_whole(self, forge_workdir: Path) -> None:
        service, project = open_forge(forge_workdir)
        apply_and_check_roundtrip(
            service, project, set_party({"min_level": 2, "max_level": 4, "min_size": None, "max_size": None})
        )
        # The survey's sizes don't survive: the override replaces the party whole.
        assert project.adventure.party == PartySpec(min_level=2, max_level=4)
        assert overrides_data(forge_workdir)["module"]["party"] == {"min_level": 2, "max_level": 4}

    @FORGE_PARTY
    def test_clearing_the_party_writes_an_explicit_null(self, forge_workdir: Path) -> None:
        service, project = open_forge(forge_workdir)
        apply_and_check_roundtrip(service, project, set_party(None))
        assert project.adventure.party is None
        assert (forge_workdir / "overrides.yaml").read_text() == (
            "module:\n  party: null\n  reason: module party corrected\n"
        )

    @FORGE_PARTY
    def test_a_later_edit_replaces_the_party_in_the_same_entry(self, forge_workdir: Path) -> None:
        service, project = open_forge(forge_workdir)
        service.apply_batch(project, forge_batch(project, set_party(PARTY_JSON)))
        service.apply_batch(project, forge_batch(project, set_party(None)))
        assert project.adventure.party is None
        assert overrides_data(forge_workdir) == {"module": {"party": None, "reason": "module party corrected"}}

    @FORGE_PARTY
    def test_the_party_merges_with_the_other_module_fields(self, forge_workdir: Path) -> None:
        service, project = open_forge(forge_workdir)
        apply_and_check_roundtrip(
            service,
            project,
            {"op": "set_adventure_field", "field": "name", "value": "The Millstone Warrens, revised"},
            set_party(PARTY_JSON),
        )
        module = overrides_data(forge_workdir)["module"]
        assert module["name"] == "The Millstone Warrens, revised"
        assert module["party"] == PARTY_JSON
        assert module["reason"] == "module name, party corrected"

    @FORGE_PARTY
    def test_undo_and_redo_the_party(self, forge_workdir: Path) -> None:
        service, project = open_forge(forge_workdir)
        service.apply_batch(project, forge_batch(project, set_party(PARTY_JSON)))
        written = (forge_workdir / "overrides.yaml").read_bytes()
        service.apply_batch(project, forge_batch(project, set_party(None)))

        service.undo(project)
        assert project.adventure.party == PARTY
        assert (forge_workdir / "overrides.yaml").read_bytes() == written
        service.undo(project)
        assert project.adventure.party == SURVEY_PARTY
        assert (forge_workdir / "overrides.yaml").read_bytes() == b""
        service.redo(project)
        assert project.adventure.party == PARTY
        assert (forge_workdir / "overrides.yaml").read_bytes() == written

    @FORGE_PARTY
    @pytest.mark.parametrize("value", [PARTY_JSON, None], ids=["set", "clear"])
    def test_the_party_survives_reopening(self, forge_workdir: Path, value: dict | None) -> None:
        service, project = open_forge(forge_workdir)
        service.apply_batch(project, forge_batch(project, set_party(value)))
        expected = PARTY if value is not None else None
        module = load_overrides(forge_workdir / "overrides.yaml").module
        assert module is not None and module.party == expected
        assert "party" in module.model_fields_set
        _, reopened = open_forge(forge_workdir)
        assert reopened.adventure.party == expected
