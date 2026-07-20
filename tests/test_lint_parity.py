"""The cross-implementation lint-parity suite — phase 2's pinned deferral, retired here.

For each shared fixture (and doctored variants), fabricate a minimal workdir
around the stamped document, run forge's own `check()`, and assert the five
shared static checks agree with `lint_adventure` — ids, severities, messages,
and locations under the address mapping. The citations phase 2 pinned stop
being the contract; this running comparison becomes it. Delve findings are
excluded (no editor counterpart), as is `area_overlap` (the editor extension).
"""

from pathlib import Path

import pytest
from osrforge import check
from osrforge.contracts.report import ExtractionReport, ModuleInfo, MonsterSummary, ValidationResult
from osrforge.contracts.run import TokenUsage
from osrforge.workdir import Workdir, write_json_artifact
from osrlib.crawl.adventure import Adventure
from osrlib.crawl.dungeon import Edge, EdgeKind
from osrlib.versioning import stamp_document

from osreditor.diagnostics import forge_findings
from osreditor.lint import lint_adventure
from test_lint import build_torture_adventure
from test_small_module import build_small_module

SHARED_CHECKS = {"edge_invalid", "area_unreachable", "orphan_cell", "secret_only_access", "transition_unpaired"}


def fabricate_check_workdir(tmp_path: Path, adventure: Adventure) -> Path:
    """The minimal workdir `check()` needs: the stamped document plus a minimal report."""
    root = tmp_path / "parity.forge"
    root.mkdir()
    workdir = Workdir(root)
    write_json_artifact(workdir.adventure_json, stamp_document("adventure", adventure.model_dump(mode="json")))
    report = ExtractionReport(
        module=ModuleInfo(title=adventure.name, pages=0),
        validation=ValidationResult(passed=True),
        monsters=MonsterSummary(resolved=0),
        usage=TokenUsage(),
    )
    write_json_artifact(workdir.report_json, report)
    return root


def assert_parity(tmp_path: Path, adventure: Adventure) -> None:
    """Run both implementations and compare the shared checks.

    Ids, severities, messages, and order must agree exactly. Locations agree
    under a refinement relation: forge's location grammar stops at area/level
    grain by contract, while the editor's `orphan_cell` and
    `transition_unpaired` addresses navigate to the exact cell — the editor
    address must equal the mapped forge address or extend it with segments.
    """
    workdir = fabricate_check_workdir(tmp_path, adventure)
    forge_shared = tuple(finding for finding in forge_findings(check(workdir)) if finding.code in SHARED_CHECKS)
    editor_shared = tuple(finding for finding in lint_adventure(adventure) if finding.code in SHARED_CHECKS)
    forge_rows = [(f.code, f.severity, f.message) for f in forge_shared]
    editor_rows = [(f.code, f.severity, f.message) for f in editor_shared]
    assert forge_rows == editor_rows
    for forge_finding, editor_finding in zip(forge_shared, editor_shared, strict=True):
        assert forge_finding.address is not None and editor_finding.address is not None
        assert editor_finding.address == forge_finding.address or editor_finding.address.startswith(
            f"{forge_finding.address}/"
        )


def doctored_variants(base: Adventure) -> list[Adventure]:
    """Structural breakages that exercise every shared check."""
    variants: list[Adventure] = []

    def with_level_edges(edges: dict[str, Edge | None]) -> Adventure:
        dungeon = base.dungeons[0]
        level = dungeon.levels[0]
        merged = dict(level.edges)
        for key, value in edges.items():
            if value is None:
                merged.pop(key, None)
            else:
                merged[key] = value
        new_level = level.model_copy(update={"edges": merged})
        new_dungeon = dungeon.model_copy(update={"levels": (new_level, *dungeon.levels[1:])})
        return base.model_copy(update={"dungeons": (new_dungeon, *base.dungeons[1:])})

    # edge_invalid: a malformed key, a non-canonical key, an out-of-bounds key.
    variants.append(with_level_edges({"not-a-key": Edge(kind=EdgeKind.OPEN)}))
    variants.append(with_level_edges({"1,1:south": Edge(kind=EdgeKind.OPEN)}))
    variants.append(with_level_edges({"999,999:north": Edge(kind=EdgeKind.OPEN)}))
    # area_unreachable + orphan_cell: seal the entrance area shut by walling
    # every canonical edge on the first level.
    dungeon = base.dungeons[0]
    level = dungeon.levels[0]
    sealed_level = level.model_copy(update={"edges": {}})
    sealed_dungeon = dungeon.model_copy(update={"levels": (sealed_level, *dungeon.levels[1:])})
    variants.append(base.model_copy(update={"dungeons": (sealed_dungeon, *base.dungeons[1:])}))
    # transition_unpaired: drop every transition from the first level, leaving
    # any second level's stairs pointing at a silent partner.
    bare_level = level.model_copy(update={"transitions": ()})
    bare_dungeon = dungeon.model_copy(update={"levels": (bare_level, *dungeon.levels[1:])})
    variants.append(base.model_copy(update={"dungeons": (bare_dungeon, *base.dungeons[1:])}))
    return variants


@pytest.mark.parametrize("builder", [build_torture_adventure, build_small_module], ids=["torture", "small-module"])
def test_clean_fixture_parity(tmp_path: Path, builder) -> None:
    assert_parity(tmp_path, builder())


@pytest.mark.parametrize("builder", [build_torture_adventure, build_small_module], ids=["torture", "small-module"])
def test_doctored_variant_parity(tmp_path: Path, builder) -> None:
    for index, variant in enumerate(doctored_variants(builder())):
        subdir = tmp_path / f"variant-{index}"
        subdir.mkdir()
        assert_parity(subdir, variant)


def test_doctored_variants_actually_fire_every_shared_check(tmp_path: Path) -> None:
    # The parity assertion is vacuous if the variants produce nothing; prove
    # the sweep covers the whole shared vocabulary at least once.
    fired: set[str] = set()
    for builder in (build_torture_adventure, build_small_module):
        fired.update(finding.code for finding in lint_adventure(builder()))
        for variant in doctored_variants(builder()):
            fired.update(finding.code for finding in lint_adventure(variant))
    assert fired >= SHARED_CHECKS
