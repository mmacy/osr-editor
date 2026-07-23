"""The osr-forge bridge: open gates, assemble/check/rerun wrappers, error surfacing.

The one module that runs forge code against a materialized workdir — the seam
rule: no other code calls `ProjectStore.materialize` or imports forge's
operational modules. Imports are pinned per the phase 5 research: the facade
names from `osrforge`; `rerun` from `osrforge.convert`; contracts from their
`osrforge.contracts` homes — documented, stable module homes outside the
five-name facade by forge's own design, with the `>=0.1,<0.2` pin containing
the interim risk.

Every operation here is synchronous in-request: assembly is "pure … no model
calls" by forge's contract, and `check`'s smoke delve is deterministic and
hard-capped, so no worker thread exists until phase 6's conversion needs one.
Every `OsrForgeError` crossing the bridge surfaces with forge's own message
verbatim — forge writes entry-naming, remedy-bearing messages by design and
the editor never paraphrases them.
"""

from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path

import yaml
from osrforge import assemble, check
from osrforge.assemble import AssembleResult
from osrforge.contracts.overrides import Overrides, load_overrides
from osrforge.contracts.report import ExtractionReport, LintFinding
from osrforge.contracts.run import RunMeta, Stage
from osrforge.convert import ConversionResult, rerun
from osrforge.errors import OverrideError
from osrforge.workdir import Workdir
from osrlib.crawl.adventure import Adventure
from pydantic import ValidationError

from osreditor.errors import (
    ForgeOverrideInvalidError,
    ForgeRerunInvalidError,
    ForgeWorkdirIncompleteError,
    ForgeWorkdirInvalidError,
)

__all__ = [
    "ForgeOpenState",
    "assemble_workdir",
    "check_workdir",
    "open_workdir_state",
    "read_overrides_bytes",
    "read_overrides_value",
    "read_run_meta",
    "rerun_assemble",
]

_RUN_REMEDY = (
    "A forge workdir is a directory whose run.json parses as forge's RunMeta; "
    "repair or regenerate run.json with osr-forge, then reopen."
)
_INCOMPLETE_REMEDY = "Complete the conversion from the CLI (osrforge rerun <stage>), then reopen."


@dataclass(frozen=True)
class ForgeOpenState:
    """Everything a forge-backed open yields: the workdir plus forge's current artifacts, freshly assembled.

    Attributes:
        workdir: The materialized workdir root.
        run: The `run.json` metadata, re-read after assembly's stage tracking.
        overrides: The loaded correction file (empty when the file is absent).
        overrides_bytes: The raw `overrides.yaml` bytes as on disk (`b""` when
            absent) — the forge undo stack's snapshot currency.
        adventure: The just-assembled draft.
        report: The just-written extraction report.
    """

    workdir: Path
    run: RunMeta
    overrides: Overrides
    overrides_bytes: bytes
    adventure: Adventure
    report: ExtractionReport


def read_run_meta(workdir: Path) -> RunMeta:
    """Re-read `run.json` — every assembly updates its stage tracking.

    Args:
        workdir: The workdir root.

    Returns:
        The current run metadata.
    """
    return Workdir(workdir).read_run()


def read_overrides_bytes(workdir: Path) -> bytes:
    """Read the raw `overrides.yaml` bytes; a missing file is the empty snapshot.

    Args:
        workdir: The workdir root.

    Returns:
        The file's bytes, or `b""` when it does not exist.
    """
    path = Workdir(workdir).overrides_yaml
    return path.read_bytes() if path.exists() else b""


def read_overrides_value(workdir: Path) -> Overrides:
    """Load the overrides model from the workdir's current file.

    Used after an undo restores snapshot bytes — the snapshot assembled
    before, so it always loads.

    Args:
        workdir: The workdir root.

    Returns:
        The loaded overrides.
    """
    return load_overrides(Workdir(workdir).overrides_yaml)


def _load_overrides_checked(workdir: Workdir) -> Overrides:
    """Load the correction file, mapping its full failure set to the override-invalid error.

    Loading here, before `assemble()` re-loads internally, is what lets the
    bridge tell an overrides problem from a stage-cache problem: after this
    succeeds, a `ValidationError` out of `assemble()` can only be a cache's.
    """
    try:
        return load_overrides(workdir.overrides_yaml)
    except (OverrideError, ValidationError, yaml.YAMLError) as error:
        raise ForgeOverrideInvalidError(str(error)) from error


def assemble_workdir(path: Path) -> AssembleResult:
    """Run forge's `assemble()` with the editor's error mapping.

    Args:
        path: The workdir root.

    Returns:
        The assembled draft and its report, as written to the workdir.

    Raises:
        ForgeOverrideInvalidError: If `overrides.yaml` cannot load or an entry
            cannot take effect — forge's message verbatim; forge fails before
            any artifact write, so the workdir is untouched.
        ForgeWorkdirInvalidError: If a stage cache is missing or stale — the
            hand-repair remedy, since the editor never produces such a workdir.
    """
    workdir = Workdir(path)
    _load_overrides_checked(workdir)
    try:
        return assemble(path)
    except OverrideError as error:
        raise ForgeOverrideInvalidError(str(error)) from error
    except ValueError as error:
        # ValidationError is a ValueError; after the pre-load above, either
        # way this is a cache problem, not an overrides problem.
        raise ForgeWorkdirInvalidError(str(error)) from error


def open_workdir_state(path: Path) -> ForgeOpenState:
    """Run the open gates in order, then assemble — the forge-backed open.

    Open re-assembles, and that writes: workdir artifacts are derived build
    products forge itself rewrites on every `assemble`, and rebuilding on open
    is the correctness-first posture (the artifacts on disk may be stale
    against a hand-edited `overrides.yaml`; forge pins "no automatic staleness
    detection"). The write is forge's own — stage tracking in `run.json`,
    byte-stable artifacts — never the editor's.

    Args:
        path: The materialized workdir root.

    Returns:
        The open state, freshly assembled.

    Raises:
        ForgeWorkdirInvalidError: If `run.json` does not parse as `RunMeta`,
            or assembly finds a missing or stale stage cache.
        ForgeWorkdirIncompleteError: If the monsters stage is not `completed`
            — the message names the pending or failed stage.
        ForgeOverrideInvalidError: If `overrides.yaml` cannot load or an entry
            cannot take effect.
    """
    workdir = Workdir(path)
    try:
        run = workdir.read_run()
    except (OSError, ValueError) as error:
        raise ForgeWorkdirInvalidError(f"run.json does not parse as forge run metadata: {error}") from error
    incomplete = _first_incomplete_model_stage(run)
    if incomplete is not None:
        stage, status = incomplete
        raise ForgeWorkdirIncompleteError(
            f"the workdir's {stage.value} stage is {status} — the conversion never completed"
        )
    result = assemble_workdir(path)
    return ForgeOpenState(
        workdir=path,
        run=workdir.read_run(),
        overrides=load_overrides(workdir.overrides_yaml),
        overrides_bytes=read_overrides_bytes(path),
        adventure=result.adventure,
        report=result.report,
    )


def _first_incomplete_model_stage(run: RunMeta) -> tuple[Stage, str] | None:
    """The first not-completed stage up through monsters, or `None` when assemblable.

    `assemble()` itself gates only on the monsters stage, but naming the
    *first* incomplete stage in chain order is the honest remedy — rerunning
    monsters over a failed survey would not help.
    """
    for stage in (Stage.PREPROCESS, Stage.SURVEY, Stage.CONTENT, Stage.MONSTERS):
        status = run.stages.get(stage)
        state = status.status if status is not None else "pending"
        if state != "completed":
            return stage, state
    return None


def check_workdir(path: Path) -> tuple[LintFinding, ...]:
    """Run forge's `check()` — the two-tier playability check, findings merged into `report.json`.

    The rewrite of `report.json` is forge's own write, through forge's code.

    Args:
        path: The workdir root (assembled — the editor keeps it so).

    Returns:
        The findings, exactly as merged into the rewritten report.

    Raises:
        ForgeWorkdirInvalidError: If `adventure.json` or `report.json` is
            missing — unreachable through the editor, which assembles at open.
    """
    try:
        return check(path)
    except ValueError as error:
        raise ForgeWorkdirInvalidError(str(error)) from error


def rerun_assemble(path: Path, settings_updates: Mapping[str, object] | None) -> ConversionResult:
    """Re-run the assemble stage with optional assembly-owned knob updates.

    Never a model stage in phase 5: `rerun(…, Stage.ASSEMBLE)` needs no
    provider and is forge's documented correction-loop re-assembly. The editor
    never discriminates forge's `ValueError`s by message-sniffing — every one
    maps to the single rerun-invalid code with the message verbatim; the
    knob→owning-stage guard's message already carries its remedy.

    Args:
        path: The workdir root.
        settings_updates: Settings knobs to update in the `run.json` echo, or
            `None` for a plain re-assembly.

    Returns:
        Forge's conversion result.

    Raises:
        ForgeRerunInvalidError: If forge's `rerun` rejects the request — a
            knob owned by an upstream stage, a stage precondition failure.
        ForgeOverrideInvalidError: If an override entry cannot take effect.
        pydantic.ValidationError: If a settings update names an unknown knob
            or an invalid value (the API layer's `request_invalid` channel).
    """
    try:
        return rerun(path, Stage.ASSEMBLE, settings_updates=settings_updates)
    except OverrideError as error:
        raise ForgeOverrideInvalidError(str(error)) from error
    except ValidationError:
        raise
    except ValueError as error:
        raise ForgeRerunInvalidError(str(error)) from error
