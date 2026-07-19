"""The forge diagnostics tier, the on-demand check route, and the cross-implementation lint parity."""

import shutil
from pathlib import Path

from fastapi.testclient import TestClient
from osrforge import check as forge_check
from osrforge.contracts.report import ExtractionReport, ModuleInfo, MonsterSummary, ValidationResult
from osrforge.contracts.run import TokenUsage

from osreditor.app import create_app
from osreditor.documents import DocumentService, dump_adventure, load_adventure
from osreditor.forge import forge_findings
from osreditor.forge_edits import SetMonsterRemap
from osreditor.lint import lint_adventure
from osreditor.projects import open_project
from osreditor.store import LocalProjectStore

FIXTURE = Path(__file__).parent / "fixtures" / "forge_workdir"
TORTURE = Path(__file__).parent / "fixtures" / "torture_geometry.json"
SMALL = Path(__file__).parent / "fixtures" / "small_module.json"

# The five checks the editor's lint mirrors from forge; the delve findings have
# no editor counterpart and are excluded from the parity comparison.
SHARED_CHECKS = {"edge_invalid", "area_unreachable", "orphan_cell", "secret_only_access", "transition_unpaired"}


def _at_forge_granularity(code: str, address: str | None) -> str | None:
    """Normalize a finding address to forge's own location granularity.

    Forge reports `orphan_cell` and `transition_unpaired` at the level; the editor
    refines both to the cell for navigability. Under the address mapping the two
    agree when the editor's finer address is truncated to its level prefix.
    """
    if code in ("orphan_cell", "transition_unpaired") and address is not None:
        return address.split("/cell:")[0]
    return address


def _shared_findings(findings) -> set:
    return {
        (f.code, f.severity, f.message, _at_forge_granularity(f.code, f.address))
        for f in findings
        if f.code in SHARED_CHECKS
    }


def open_forge(tmp_path: Path):
    workdir = tmp_path / "vault.forge"
    shutil.copytree(FIXTURE, workdir)
    service = DocumentService(LocalProjectStore())
    return service, open_project(service, workdir)


# --- The check route and the forge tier ---------------------------------------


def test_open_forge_tier_is_empty_until_check(tmp_path: Path) -> None:
    _, project = open_forge(tmp_path)
    # Straight from assemble, report.findings is empty by forge's design.
    assert project.diagnostics.forge == ()


def test_check_populates_the_forge_tier(tmp_path: Path) -> None:
    service, project = open_forge(tmp_path)
    result = service.run_forge_check(project)
    # The fixture's delve reports an incomplete finding at the dungeon.
    codes = {finding.code for finding in result.diagnostics.forge}
    assert "delve_incomplete" in codes
    for finding in result.diagnostics.forge:
        assert finding.source == "forge"
    # A dungeon-scope finding maps onto the editor address grammar.
    delve = next(f for f in result.diagnostics.forge if f.code == "delve_incomplete")
    assert delve.address == "dungeon:sunken-vault"
    # Check changes no document — the revision is unchanged and no undo step lands.
    assert result.revision == project.revision
    assert result.delta == ()
    assert result.can_undo is False


def test_a_commit_empties_the_forge_tier(tmp_path: Path) -> None:
    service, project = open_forge(tmp_path)
    service.run_forge_check(project)
    assert project.diagnostics.forge != ()
    # Any forge commit re-assembles, which wipes findings by forge's design.
    service.apply_forge_edits(
        project, project.revision, (SetMonsterRemap(name="drowned one", template_id="hobgoblin"),)
    )
    assert project.diagnostics.forge == ()


def test_check_route_returns_the_refreshed_envelope(tmp_path: Path) -> None:
    client = TestClient(create_app())
    workdir = tmp_path / "vault.forge"
    shutil.copytree(FIXTURE, workdir)
    opened = client.post("/api/projects/open", json={"path": str(workdir)}).json()
    response = client.post(f"/api/projects/{opened['id']}/forge/check")
    assert response.status_code == 200
    codes = {finding["code"] for finding in response.json()["diagnostics"]["forge"]}
    assert "delve_incomplete" in codes


# --- The cross-implementation lint-parity suite -------------------------------


def _fabricate_check_workdir(tmp_path: Path, adventure) -> Path:
    """Write a minimal workdir (adventure.json + report.json) for forge's `check()`."""
    workdir = tmp_path / "check"
    workdir.mkdir(parents=True, exist_ok=True)
    (workdir / "adventure.json").write_bytes(dump_adventure(adventure))
    report = ExtractionReport(
        module=ModuleInfo(title=adventure.name, pages=0),
        validation=ValidationResult(passed=True),
        monsters=MonsterSummary(resolved=0),
        usage=TokenUsage(),
    )
    (workdir / "report.json").write_text(report.model_dump_json(indent=2), encoding="utf-8")
    return workdir


def _forge_shared(tmp_path: Path, adventure) -> set:
    findings = forge_check(_fabricate_check_workdir(tmp_path, adventure))
    report = ExtractionReport(
        module=ModuleInfo(title=adventure.name, pages=0),
        validation=ValidationResult(passed=True),
        monsters=MonsterSummary(resolved=0),
        usage=TokenUsage(),
        findings=findings,
    )
    return _shared_findings(forge_findings(report))


def _editor_shared(adventure) -> set:
    return _shared_findings(lint_adventure(adventure))


def test_lint_parity_on_the_torture_fixture(tmp_path: Path) -> None:
    adventure = load_adventure(TORTURE.read_bytes())
    forge_side = _forge_shared(tmp_path, adventure)
    editor_side = _editor_shared(adventure)
    # The doctored fixture must actually exercise several shared checks.
    assert len(editor_side) >= 3
    assert forge_side == editor_side


def test_lint_parity_on_the_small_module(tmp_path: Path) -> None:
    adventure = load_adventure(SMALL.read_bytes())
    assert _forge_shared(tmp_path, adventure) == _editor_shared(adventure)
