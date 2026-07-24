"""The osr-forge bridge: open gates, assemble/check/rerun wrappers, conversion, error surfacing.

The one module that runs forge code against a materialized workdir — the seam
rule: no other code calls `ProjectStore.materialize` or imports forge's
operational modules. Imports are pinned per the phase 5 and 6 research: the
facade names from `osrforge`; `rerun`, `RUNNABLE_STAGES`, and `KNOB_STAGES`
from `osrforge.convert`; `render_previews` from `osrforge.assemble`; the
provider classes from their `osrforge.providers` homes; contracts from their
`osrforge.contracts` homes — documented, stable module homes outside the
five-name facade by forge's own design, with the `>=0.1,<0.2` pin containing
the interim risk. `convert` is deliberately *not* imported: no editor path
calls it. `estimate()` leaves the workdir preprocess-warm, so a new conversion
is estimate-then-`rerun(SURVEY)`, and every other resume is `rerun` over the
workdir's own `source.pdf`.

Most operations here are synchronous in-request: assembly is "pure … no model
calls" by forge's contract, and `check`'s smoke delve is deterministic and
hard-capped. The two that are not — [`estimate_pdf`][osreditor.forge.estimate_pdf]
and [`run_chain`][osreditor.forge.run_chain] — are called only from a
conversion session's worker thread, which is why they carry no HTTP error
mapping: their failures are session state. Every `OsrForgeError` crossing the
bridge surfaces with forge's own message verbatim — forge writes entry-naming,
remedy-bearing messages by design and the editor never paraphrases them.
"""

import importlib.util
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path

import yaml
from osrforge import assemble, check, estimate
from osrforge.assemble import AssembleResult, render_previews
from osrforge.contracts.overrides import Overrides, load_overrides
from osrforge.contracts.report import ExtractionReport, LintFinding
from osrforge.contracts.run import RunMeta, Stage
from osrforge.convert import KNOB_STAGES, RUNNABLE_STAGES, ConversionResult, OnProgress, rerun
from osrforge.errors import OverrideError, ProviderError
from osrforge.estimate import CostEstimate
from osrforge.providers.base import ModelProvider
from osrforge.providers.fixtures import FixtureProvider
from osrforge.providers.foundry import FoundryProvider, FoundrySettings
from osrforge.settings import ConversionSettings
from osrforge.workdir import Workdir
from osrlib.crawl.adventure import Adventure
from pydantic import ValidationError

from osreditor.errors import (
    ForgeOverrideInvalidError,
    ForgeRerunInvalidError,
    ForgeWorkdirIncompleteError,
    ForgeWorkdirInvalidError,
    ProviderNotConfiguredError,
)
from osreditor.providers import (
    API_KEY_ENV,
    DEPLOYMENT_ENV,
    ENDPOINT_ENV,
    EffectiveProvider,
    ProviderFieldStatus,
    ProviderStatus,
    ResolvedField,
)

__all__ = [
    "KNOB_STAGES",
    "RUNNABLE_STAGES",
    "CostEstimate",
    "ForgeOpenState",
    "assemble_workdir",
    "build_provider",
    "check_workdir",
    "entra_available",
    "estimate_pdf",
    "open_workdir_state",
    "provider_status",
    "read_overrides_bytes",
    "read_overrides_value",
    "read_run_meta",
    "render_workdir_previews",
    "rerun_assemble",
    "run_chain",
]


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

    Never a model stage: `rerun(…, Stage.ASSEMBLE)` needs no provider and is
    forge's documented correction-loop re-assembly — the fast path of the
    correction loop, which is why it stays synchronous while every other stage
    runs through a conversion session. The editor
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


def estimate_pdf(pdf_path: Path, workdir: Path, settings: ConversionSettings | None) -> CostEstimate:
    """Price a conversion: forge's `estimate()`, which really preprocesses into the workdir.

    Deliberately unmapped. Its only caller is a conversion session's runner, on
    a worker thread whose request answered long ago — a `PdfError` (encrypted,
    over a cap, not a module) is session state carrying forge's message
    verbatim, never an HTTP error.

    The side effect is the point: `estimate` renders every page and writes a
    `run.json` with preprocess `completed` and everything else `pending`, so
    the workdir is warm and the confirm is `rerun(…, Stage.SURVEY)` rather than
    a second full conversion.

    Args:
        pdf_path: The source module PDF.
        workdir: The workdir root to create or rebuild.
        settings: The pipeline settings, or `None` for forge's defaults.

    Returns:
        The estimate — the band, not the point value, is forge's contract.

    Raises:
        osrforge.errors.PdfError: If preprocessing rejects the source.
    """
    return estimate(pdf_path, workdir, settings)


def run_chain(
    workdir: Path,
    stage: Stage,
    provider: ModelProvider | None,
    settings_updates: Mapping[str, object] | None,
    on_progress: OnProgress,
) -> ConversionResult:
    """Resume the conversion chain from `stage` through assemble, streaming stage events.

    Deliberately unmapped, for the same reason as
    [`estimate_pdf`][osreditor.forge.estimate_pdf]: its only caller is the
    session runner, whose catch set lands every failure in session `failed`
    with forge's message verbatim. Mapping here would let an editor-typed error
    escape that catch and wedge a session in `running`. (The phase 5
    assemble-only wrapper keeps its HTTP mappings — it serves a synchronous
    route.)

    Args:
        workdir: The workdir root.
        stage: The stage to resume from.
        provider: The model provider; forge requires one exactly when the
            resumed chain contains a model stage.
        settings_updates: Knob updates for the `run.json` echo, or `None`.
        on_progress: The stage-event callback; raising from it is how the
            editor cancels at a stage boundary.

    Returns:
        Forge's conversion result.

    Raises:
        osrforge.errors.OsrForgeError: Whatever the chain raised.
        ValueError: If a stage precondition or the knob-owner guard rejects.
        pydantic.ValidationError: If a settings update names an unknown knob.
    """
    return rerun(
        workdir,
        stage,
        provider=provider,
        settings_updates=settings_updates,
        on_progress=on_progress,
    )


def render_workdir_previews(path: Path) -> tuple[Path, ...]:
    """Regenerate the SVG previews alone, from the survey and content caches plus `overrides.yaml`.

    Actionable exactly where assembly cannot yet run: a workdir whose content
    stage completed but whose monsters stage has not, so a mid-pipeline pause
    can eyeball geometry before paying for the remaining model stages. The
    route gates on those stages, which makes the `ValueError` mapping below the
    unreachable-through-the-UI backstop.

    Args:
        path: The workdir root.

    Returns:
        The written preview paths, in survey order.

    Raises:
        ForgeWorkdirInvalidError: If the survey or a level's content cache is
            missing.
        ForgeOverrideInvalidError: If an override entry cannot take effect.
    """
    try:
        return render_previews(path)
    except OverrideError as error:
        raise ForgeOverrideInvalidError(str(error)) from error
    except ValueError as error:
        raise ForgeWorkdirInvalidError(str(error)) from error


def entra_available() -> bool:
    """Report whether `azure-identity` is importable — the inferred auth path when no key is present.

    Forge infers Entra ID auth from an absent key and raises a
    remedy-bearing `ProviderError` at client build when the extra is missing;
    probing here lets the settings dialog say so before the user spends a
    conversion finding out.

    Returns:
        True when `azure.identity` can be imported.
    """
    try:
        return importlib.util.find_spec("azure.identity") is not None
    except ImportError, ValueError:
        # A missing parent package raises rather than answering None.
        return False


def _field_status(field: ResolvedField) -> ProviderFieldStatus:
    return ProviderFieldStatus(value=field.value, source=field.source)


def provider_status(effective: EffectiveProvider) -> ProviderStatus:
    """Describe the effective provider configuration — presence and provenance, never a secret.

    Args:
        effective: The merged session-over-environment configuration.

    Returns:
        The status: per-field values and sources, key presence, Entra
        availability, and whether a provider can be built at all.
    """
    entra = entra_available()
    if effective.kind == "fixtures":
        configured = effective.fixtures_dir.value is not None
    else:
        configured = bool(effective.endpoint.value and effective.deployment.value) and (
            effective.api_key.value is not None or entra
        )
    return ProviderStatus(
        kind=effective.kind,
        endpoint=_field_status(effective.endpoint),
        deployment=_field_status(effective.deployment),
        api_key_present=effective.api_key.value is not None,
        api_key_source=effective.api_key.source,
        entra_available=entra,
        configured=configured,
        fixtures_dir=_field_status(effective.fixtures_dir),
    )


def build_provider(effective: EffectiveProvider) -> ModelProvider:
    """Build the configured provider, or say precisely what is missing.

    Two refusals, both `ProviderNotConfiguredError`. A field with no value at
    all is the editor's own message, naming the field and both places it can
    come from. A provider forge itself declines to build — today, exactly the
    "Entra ID auth needs the azure-identity package" case, since the
    constructor performs no I/O — carries forge's message verbatim, because
    that message already names its remedy and paraphrasing it would lose the
    extra's name.

    Args:
        effective: The merged session-over-environment configuration.

    Returns:
        The provider.

    Raises:
        ProviderNotConfiguredError: If a required field is unset, or forge
            declines to build the client.
    """
    if effective.kind == "fixtures":
        if effective.fixtures_dir.value is None:
            raise ProviderNotConfiguredError(
                "the fixtures provider needs a fixtures directory; set it through the provider settings",
                missing=[{"field": "fixtures_dir", "env": ""}],
            )
        return FixtureProvider(Path(effective.fixtures_dir.value))
    missing = [
        {"field": name, "env": env}
        for name, field, env in (
            ("endpoint", effective.endpoint, ENDPOINT_ENV),
            ("deployment", effective.deployment, DEPLOYMENT_ENV),
        )
        if field.value is None
    ]
    if missing:
        named = ", ".join(f"{entry['field']} ({entry['env']})" for entry in missing)
        raise ProviderNotConfiguredError(
            f"the Foundry provider is missing {named} — set the environment variable, "
            "or fill the field in the provider settings",
            missing=missing,
        )
    assert effective.endpoint.value is not None and effective.deployment.value is not None
    settings = FoundrySettings(
        endpoint=effective.endpoint.value,
        deployment=effective.deployment.value,
        api_key=effective.api_key.value,
    )
    try:
        return FoundryProvider(settings)
    except ProviderError as error:
        # Forge's own build-time refusal — inferred Entra auth without the
        # extra. Its message names the remedy; the editor adds nothing.
        raise ProviderNotConfiguredError(str(error), missing=[{"field": "api_key", "env": API_KEY_ENV}]) from error
