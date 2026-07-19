"""The bridge to osr-forge: open gates, the assemble/check/rerun wrappers, the diagnostics tier.

This is the one module that calls [`ProjectStore.materialize`][osreditor.store.ProjectStore.materialize]
(the seam rule) and the one that imports osr-forge's file-based entry points.
Assembly is "pure … no model calls" by forge's contract and `check`'s smoke delve
is deterministic and hard-capped, so every bridge call runs synchronously in the
request thread — no worker exists until phase 6's conversion needs one.

Every `OsrForgeError` crossing the bridge surfaces with forge's own message
verbatim: forge writes entry-naming, remedy-bearing messages by design, and the
editor never paraphrases them. The mapping from forge's exceptions to the editor's
error vocabulary lives here.
"""

from dataclasses import dataclass, field
from pathlib import Path

import yaml
from osrforge import assemble, check
from osrforge.contracts.overrides import Overrides, load_overrides
from osrforge.contracts.report import ExtractionReport, LintFinding
from osrforge.contracts.run import RunMeta, Stage
from osrforge.convert import ConversionResult, rerun
from osrforge.errors import OverrideError
from osrforge.workdir import Workdir
from osrlib.crawl.adventure import Adventure
from pydantic import ValidationError

from osreditor.addresses import area_address, dungeon_address, level_address
from osreditor.errors import (
    ForgeOverrideInvalidError,
    ForgeRerunInvalidError,
    ForgeWorkdirIncompleteError,
    ForgeWorkdirInvalidError,
)
from osreditor.ops import Finding
from osreditor.store import ProjectStore

__all__ = [
    "OVERRIDES_ARTIFACT",
    "ForgeAssembly",
    "ForgeProjectState",
    "ForgeSnapshot",
    "assemble_workdir",
    "check_workdir",
    "forge_findings",
    "open_workdir_state",
    "read_overrides_bytes",
    "rerun_assemble",
]

OVERRIDES_ARTIFACT = "overrides.yaml"


@dataclass(frozen=True)
class ForgeSnapshot:
    """One point in a forge project's history: the `overrides.yaml` bytes and the machine-draft set.

    The document is derived state, and `auto_reasons` is derived state of the
    same commit, so undo restores the reason text and its auto/human flag
    together — never the drift of one restored without the other.
    """

    overrides_yaml: bytes
    auto_reasons: tuple[str, ...]


def _empty_snapshots() -> list[ForgeSnapshot]:
    return []


@dataclass
class ForgeProjectState:
    """A forge project's live working state, riding on the open project beside the document.

    The assembled `Adventure` and the diagnostics live on the open project (as
    for a native project); this carries the forge-only state: the report, the run
    metadata, the current `Overrides` value and its raw bytes, and the
    snapshot-pair undo/redo stacks.
    """

    report: ExtractionReport
    run: RunMeta
    overrides: Overrides
    overrides_yaml: bytes
    undo_stack: list[ForgeSnapshot] = field(default_factory=_empty_snapshots)
    redo_stack: list[ForgeSnapshot] = field(default_factory=_empty_snapshots)


# The model-stage chain assemble depends on, in pipeline order — the first
# incomplete one names the stage the incomplete-workdir refusal points at.
_REQUIRED_STAGES: tuple[Stage, ...] = (Stage.PREPROCESS, Stage.SURVEY, Stage.CONTENT, Stage.MONSTERS)


@dataclass(frozen=True)
class ForgeAssembly:
    """One assembly's product: the assembled document, its report, and the current run metadata.

    The `Overrides` model and the raw `overrides.yaml` bytes are carried
    alongside so the open flow and the commit protocol can snapshot them.
    """

    adventure: Adventure
    report: ExtractionReport
    run: RunMeta
    overrides: Overrides
    overrides_yaml: bytes


def read_overrides_bytes(store: ProjectStore, project_id: str) -> bytes:
    """Read the workdir's `overrides.yaml` bytes, or empty bytes when there is no file.

    Args:
        store: The store to read through.
        project_id: The forge project.

    Returns:
        The raw file bytes — the undo-snapshot baseline — or `b""` when absent.
    """
    workdir = store.materialize(project_id)
    path = workdir / OVERRIDES_ARTIFACT
    return path.read_bytes() if path.is_file() else b""


def _gate_workdir(workdir: Path) -> RunMeta:
    """Run the pre-assembly open gates: `run.json` parses, monsters stage completed.

    Args:
        workdir: The materialized workdir root.

    Returns:
        The parsed run metadata.

    Raises:
        ForgeWorkdirInvalidError: If `run.json` does not parse as `RunMeta`.
        ForgeWorkdirIncompleteError: If the monsters stage is not `completed`.
    """
    try:
        run = Workdir(workdir).read_run()
    except (ValidationError, ValueError, OSError) as error:
        raise ForgeWorkdirInvalidError(
            f"{workdir / 'run.json'} does not parse as a forge run — a workdir is a directory whose "
            f"run.json validates: {error}"
        ) from error
    monsters = run.stages.get(Stage.MONSTERS)
    if monsters is None or monsters.status != "completed":
        pending = next(
            (
                stage
                for stage in _REQUIRED_STAGES
                if run.stages.get(stage) is None or run.stages[stage].status != "completed"
            ),
            Stage.MONSTERS,
        )
        raise ForgeWorkdirIncompleteError(
            f"the workdir's {pending.value!r} stage is not completed, so it cannot be assembled — "
            f"run `osrforge rerun {pending.value}` to finish the conversion"
        )
    return run


def _assemble_mapping(workdir: Path) -> ForgeAssembly:
    """Assemble a gated workdir, mapping forge's failures to the editor vocabulary.

    Args:
        workdir: The materialized workdir root, already gated.

    Returns:
        The assembly product.

    Raises:
        ForgeOverrideInvalidError: If `overrides.yaml` cannot be loaded or applied.
        ForgeWorkdirInvalidError: If a stage cache is missing or stale.
    """
    try:
        result = assemble(workdir)
    except OverrideError as error:
        raise ForgeOverrideInvalidError(str(error)) from error
    except (yaml.YAMLError, ValidationError) as error:
        overrides_path = workdir / OVERRIDES_ARTIFACT
        raise ForgeOverrideInvalidError(f"{overrides_path} is not a valid overrides file: {error}") from error
    except ValueError as error:
        raise ForgeWorkdirInvalidError(str(error)) from error
    overrides = load_overrides(workdir / OVERRIDES_ARTIFACT)
    overrides_yaml = (workdir / OVERRIDES_ARTIFACT).read_bytes() if (workdir / OVERRIDES_ARTIFACT).is_file() else b""
    return ForgeAssembly(
        adventure=result.adventure,
        report=result.report,
        run=Workdir(workdir).read_run(),
        overrides=overrides,
        overrides_yaml=overrides_yaml,
    )


def open_workdir_state(store: ProjectStore, project_id: str) -> ForgeAssembly:
    """Gate and assemble a forge workdir for open.

    Open re-assembles, and that writes — workdir artifacts are derived build
    products forge itself rewrites on every `assemble`, and rebuilding on open is
    the correctness-first posture (the artifacts on disk may be stale against a
    hand-edited `overrides.yaml`, and forge pins no automatic staleness
    detection). The write is forge's own, never the editor's.

    Args:
        store: The store the workdir materializes through.
        project_id: The forge project.

    Returns:
        The assembly product: document, report, run, overrides, and raw bytes.

    Raises:
        ForgeWorkdirInvalidError: Unparseable `run.json`, or a missing or stale
            stage cache.
        ForgeWorkdirIncompleteError: The monsters stage is not `completed`.
        ForgeOverrideInvalidError: A broken `overrides.yaml`.
    """
    workdir = store.materialize(project_id)
    _gate_workdir(workdir)
    return _assemble_mapping(workdir)


def assemble_workdir(store: ProjectStore, project_id: str) -> ForgeAssembly:
    """Re-assemble a workdir mid-session (a commit's rebuild), mapping forge's failures.

    Unlike [`open_workdir_state`][osreditor.forge.open_workdir_state] this skips
    the pre-assembly gates: an open project has already passed them, and a
    commit changes only `overrides.yaml`, never the stage caches or `run.json`.

    Args:
        store: The store the workdir materializes through.
        project_id: The forge project.

    Returns:
        The assembly product.

    Raises:
        ForgeOverrideInvalidError: A broken or unapplicable `overrides.yaml`.
        ForgeWorkdirInvalidError: A missing or stale stage cache.
    """
    return _assemble_mapping(store.materialize(project_id))


def check_workdir(store: ProjectStore, project_id: str) -> tuple[LintFinding, ...]:
    """Run forge's `check()` over the workdir, returning its findings.

    `check()` rewrites `report.json` with the findings merged (forge's write,
    through forge's code) — the editor refreshes its state from the rewritten
    report afterward.

    Args:
        store: The store the workdir materializes through.
        project_id: The forge project.

    Returns:
        The playability findings.
    """
    return check(store.materialize(project_id))


def rerun_assemble(store: ProjectStore, project_id: str, settings_updates: dict[str, object]) -> ConversionResult:
    """Re-run the assemble stage with settings updates, mapping forge's guard failures.

    Phase 5 reruns the assemble stage only — never a model stage — so no provider
    is required. Forge's own drift guard rejects a settings update whose owning
    stage is upstream of assemble, and its settings validation rejects unknown
    knobs and bad values (a `pydantic.ValidationError` the route maps to
    `request_invalid`).

    Args:
        store: The store the workdir materializes through.
        project_id: The forge project.
        settings_updates: The knob updates to apply.

    Returns:
        The conversion result carrying the refreshed run, adventure, and report.

    Raises:
        ForgeRerunInvalidError: A knob→owning-stage drift, a stage precondition,
            or a missing cache — forge's message verbatim.
        pydantic.ValidationError: An unknown knob or an out-of-range value.
    """
    try:
        return rerun(store.materialize(project_id), Stage.ASSEMBLE, settings_updates=settings_updates)
    except ValidationError:
        # An unknown knob or an out-of-range value — pydantic.ValidationError is a
        # subclass of ValueError, so it must be caught first and propagated to the
        # request_invalid handler, never folded into forge_rerun_invalid.
        raise
    except ValueError as error:
        raise ForgeRerunInvalidError(str(error)) from error


def _finding_address(location: str) -> str:
    """Map a forge finding location onto the editor's address grammar.

    Forge locations are `/`-joined and slash-free in every component but the
    separators: `<dungeon>/<level>/<area>`, `<dungeon>/<level>`, or `<dungeon>`.
    """
    parts = location.split("/")
    if len(parts) == 3:
        return area_address(parts[0], int(parts[1]), parts[2])
    if len(parts) == 2:
        return level_address(parts[0], int(parts[1]))
    return dungeon_address(location)


def forge_findings(report: ExtractionReport) -> tuple[Finding, ...]:
    """Map the report's playability findings into the editor's `forge` diagnostics tier.

    `source="forge"`, `code` the check id, severity and message verbatim, and the
    location grammar mapped onto the editor's address grammar so click-to-navigate
    works unchanged. The delve findings arrive only here — the editor mirrors
    forge's static checks, never the delve.

    Args:
        report: The extraction report, its `findings` populated by a `check` run
            (empty straight from `assemble`).

    Returns:
        One finding per report finding, in report order.
    """
    return tuple(
        Finding(
            source="forge",
            code=finding.id.value,
            severity=finding.severity,
            message=finding.message,
            address=_finding_address(finding.location),
        )
        for finding in report.findings
    )
