"""Conversion sessions: the registry, the state machine, the worker, and cooperative cancellation.

One `ConversionSession` per workdir, minted by the API and held on `app.state`
for the process lifetime. Sessions are in-memory by design — the workdir's
`run.json` is the durable record, so a server restart loses a progress view and
nothing else; the workdir resumes.

Two kinds, one surface. A **pdf** session runs `estimate()` — which really
preprocesses into the destination, because the licensing invariant forbids
persisting module text anywhere else — then, on confirm, resumes the chain from
survey. A **workdir** session starts from whatever `run.json` already says.
There is no `convert()` call anywhere in the editor: estimate-then-resume covers
a new conversion, and `rerun` covers every other, reading the workdir's own
`source.pdf` when it has to start at preprocess.

Cancellation is cooperative and lands exactly on stage boundaries. Forge emits
`running` before each step *outside* any try block, so raising
[`ConversionCancelledError`][osreditor.errors.ConversionCancelledError] from the
progress callback unwinds between stages: the stage in flight always finished,
`run.json` never records a stage the chain abandoned mid-write, and the resume
picks up at the first incomplete stage.

The runnable bodies ([`run_estimate`][osreditor.conversions.run_estimate],
[`run_chain`][osreditor.conversions.run_chain]) are plain functions the thread
wrapper calls, so the suites drive them synchronously — no sleeping tests, no
flaky threads; the threaded path is covered once by the Playwright suite's real
server.
"""

import secrets
import threading
from collections.abc import Callable, Mapping
from pathlib import Path
from typing import Literal

from osrforge.contracts.run import RunMeta, Stage, StageStatus
from osrforge.convert import ConversionResult, StageEvent
from osrforge.estimate import CostEstimate
from osrforge.providers.base import ModelProvider
from osrforge.settings import ConversionSettings
from pydantic import BaseModel, ConfigDict

from osreditor import forge
from osreditor.config import RecentEntry, load_config, record_recent, save_config
from osreditor.documents import RUN_ARTIFACT, DocumentService
from osreditor.errors import (
    ConversionCancelledError,
    ConversionDestinationExistsError,
    ConversionDestinationInvalidError,
    ConversionInProgressError,
    ConversionNotFoundError,
    ConversionStateInvalidError,
    ForgeRerunInvalidError,
    ProjectExistsError,
    ProjectNotFoundError,
)
from osreditor.projects import utc_now_iso
from osreditor.store import ProjectStore

__all__ = [
    "MODEL_STAGES",
    "PAGES_PREFIX",
    "SOURCE_ARTIFACT",
    "STAGE_ORDER",
    "ConversionKind",
    "ConversionRegistry",
    "ConversionSession",
    "ConversionStageRow",
    "ConversionState",
    "ConversionStateName",
    "begin_run",
    "bind",
    "check_destination",
    "first_incomplete_stage",
    "needs_provider",
    "new_session_id",
    "open_session",
    "request_cancel",
    "require_run_meta",
    "require_runnable",
    "run_chain",
    "run_estimate",
    "seed_stage_rows",
    "settings_from",
    "spawn",
    "validate_settings_updates",
    "validate_stage",
]

STAGE_ORDER: tuple[Stage, ...] = (
    Stage.PREPROCESS,
    Stage.SURVEY,
    Stage.CONTENT,
    Stage.MONSTERS,
    Stage.GEOMETRY,
    Stage.ASSEMBLE,
)
"""Every stage a row is rendered for, in `run.json` order.

Geometry has no independent run — it completes inside every assembly — but it
carries a `run.json` status, so it carries a row.
"""

SOURCE_ARTIFACT = "source.pdf"
PAGES_PREFIX = "pages"

MODEL_STAGES = frozenset({Stage.SURVEY, Stage.CONTENT, Stage.MONSTERS})
"""The stages that call a provider; forge requires one exactly when the resumed chain contains any."""

ConversionKind = Literal["pdf", "workdir"]
ConversionStateName = Literal["estimating", "estimated", "ready", "running", "completed", "failed", "cancelled"]

_ACTIVE_STATES = frozenset({"estimating", "running"})
"""The two states that hold a worker; everything else is idle.

Idle is the whole runnable test: `estimated` and `ready` are the first run,
`failed` and `cancelled` are the resume, and `completed` is the pipeline
panel's next rerun — one workdir keeps one session across every stage a human
asks it to redo.
"""


class ConversionStageRow(BaseModel):
    """One stage's row: the stage, and forge's own status entry for it.

    `status` is forge's whole `StageStatus` — state, error, timestamps, and
    token usage — rather than a hand-picked subset, so the conversion screen
    renders the same shape the pipeline panel already renders from
    `run.json`. A live `running` row carries no timestamps because forge has
    not written one yet; every other row is re-read from disk.
    """

    model_config = ConfigDict(frozen=True)

    stage: Stage
    status: StageStatus


class ConversionState(BaseModel):
    """The poll answer, and every conversion route's response.

    `estimate` is forge's own frozen `CostEstimate` dataclass riding the
    OpenAPI surface directly — pydantic serializes stdlib dataclasses, and a
    hand-written mirror of a forge contract is exactly what the family rule
    forbids.
    """

    model_config = ConfigDict(frozen=True)

    id: str
    kind: ConversionKind
    state: ConversionStateName
    workdir_path: str
    pdf_path: str | None
    estimate: CostEstimate | None
    stages: tuple[ConversionStageRow, ...]
    error: str | None
    project_id: str | None


def seed_stage_rows(run: RunMeta | None) -> tuple[ConversionStageRow, ...]:
    """Build the stage rows from `run.json`, or all-pending when there is none yet.

    Args:
        run: The run metadata, or `None` before preprocess has written any.

    Returns:
        One row per stage, in `run.json` order.
    """
    return tuple(
        ConversionStageRow(
            stage=stage,
            status=(run.stages.get(stage) or StageStatus()) if run is not None else StageStatus(),
        )
        for stage in STAGE_ORDER
    )


def first_incomplete_stage(run: RunMeta) -> Stage:
    """Return the stage a resume should start from.

    Args:
        run: The run metadata.

    Returns:
        The first runnable stage whose status is not `completed`; assemble when
        every stage is complete, since re-assembling is the only thing left to
        do.
    """
    for stage in forge.RUNNABLE_STAGES:
        status = run.stages.get(stage)
        if status is None or status.status != "completed":
            return stage
    return Stage.ASSEMBLE


class ConversionSession:
    """One conversion's working state, guarded by its own lock.

    Mutable by design, like [`OpenProject`][osreditor.documents.OpenProject]:
    the worker writes it and the poll reads it, so every read and mutation runs
    under `lock`.
    """

    def __init__(
        self,
        session_id: str,
        kind: ConversionKind,
        workdir: Path,
        run: RunMeta | None,
        pdf_path: Path | None = None,
        settings: ConversionSettings | None = None,
        project_id: str | None = None,
    ) -> None:
        """Bundle a new session's state.

        Args:
            session_id: The server-minted opaque id.
            kind: `"pdf"` for new-from-PDF, `"workdir"` for a resume.
            workdir: The resolved workdir root.
            run: The workdir's current run metadata, when it has one.
            pdf_path: The source PDF (pdf kind).
            settings: The requested pipeline knobs (pdf kind); afterwards the
                `run.json` echo governs.
            project_id: The open project this session is bound to, if any.
        """
        self.id = session_id
        self.kind: ConversionKind = kind
        self.workdir = workdir
        self.pdf_path = pdf_path
        self.settings = settings
        self.project_id = project_id
        self.state: ConversionStateName = "estimating" if kind == "pdf" else "ready"
        self.estimate: CostEstimate | None = None
        self.stages = seed_stage_rows(run)
        self.error: str | None = None
        self.cancel = threading.Event()
        self.lock = threading.Lock()

    @property
    def active(self) -> bool:
        """Whether the session is doing work right now (`estimating` or `running`)."""
        with self.lock:
            return self.state in _ACTIVE_STATES

    def snapshot(self) -> ConversionState:
        """Return the session's current state as the API surface carries it.

        Returns:
            The immutable state model.
        """
        with self.lock:
            return ConversionState(
                id=self.id,
                kind=self.kind,
                state=self.state,
                workdir_path=str(self.workdir),
                pdf_path=str(self.pdf_path) if self.pdf_path is not None else None,
                estimate=self.estimate,
                stages=self.stages,
                error=self.error,
                project_id=self.project_id,
            )

    def refresh_stages(self) -> None:
        """Re-seed the rows from `run.json` — the disk's truth, at every stage boundary and terminal state."""
        run = _read_run(self.workdir)
        with self.lock:
            self.stages = seed_stage_rows(run)

    def mark_running(self, stage: Stage) -> None:
        """Patch one row to `running` in memory; forge writes its own status as the stage starts."""
        with self.lock:
            self.stages = tuple(
                ConversionStageRow(stage=row.stage, status=StageStatus(status="running")) if row.stage is stage else row
                for row in self.stages
            )


def _read_run(workdir: Path) -> RunMeta | None:
    """Read a workdir's run metadata, answering `None` when it has none or it does not parse."""
    try:
        return forge.read_run_meta(workdir)
    except OSError, ValueError:
        return None


class ConversionRegistry:
    """Every conversion session this process has minted, indexed by id and by workdir.

    One workdir maps to one session, however many surfaces ask: the new-from-PDF
    dialog, the incomplete-workdir open, and the pipeline panel's rerun all land
    on the same object. Terminal sessions stay — single-user, bounded by use,
    and reload-proof.
    """

    def __init__(self) -> None:
        """Build an empty registry."""
        self._lock = threading.Lock()
        self._by_id: dict[str, ConversionSession] = {}
        self._by_workdir: dict[str, ConversionSession] = {}

    def get(self, conversion_id: str) -> ConversionSession:
        """Return the session with `conversion_id`.

        Args:
            conversion_id: The server-minted session id.

        Returns:
            The session.

        Raises:
            ConversionNotFoundError: If no session has that id.
        """
        with self._lock:
            session = self._by_id.get(conversion_id)
        if session is None:
            raise ConversionNotFoundError(f"no conversion with id {conversion_id!r}")
        return session

    def find(self, workdir: Path) -> ConversionSession | None:
        """Return the session currently indexed for a workdir path, in any state.

        The recovery lookup: every surface that hits a busy conflict comes here
        rather than guessing.

        Args:
            workdir: The resolved workdir root.

        Returns:
            The session, or `None`.
        """
        with self._lock:
            return self._by_workdir.get(str(workdir))

    def active_for(self, workdir: Path) -> ConversionSession | None:
        """Return the workdir's session only while it is `estimating` or `running`.

        Args:
            workdir: The resolved workdir root.

        Returns:
            The active session, or `None`.
        """
        session = self.find(workdir)
        return session if session is not None and session.active else None

    def get_or_create(self, workdir: Path, factory: Callable[[], ConversionSession]) -> tuple[ConversionSession, bool]:
        """Return the workdir's session, minting one under the registry lock on a miss.

        Atomic by construction — the same discipline `get_or_open` uses for
        projects: two surfaces asking at once get the *same* session, never two
        racing workers over one directory.

        Args:
            workdir: The resolved workdir root.
            factory: Builds the session; called only on a miss.

        Returns:
            The session, and whether this call minted it.
        """
        with self._lock:
            existing = self._by_workdir.get(str(workdir))
            if existing is not None:
                return existing, False
            session = factory()
            self._by_id[session.id] = session
            self._by_workdir[str(session.workdir)] = session
            return session, True

    def register_new(self, factory: Callable[[], ConversionSession], workdir: Path) -> ConversionSession:
        """Mint a session for a workdir, superseding a terminal predecessor and refusing an active one.

        The pdf kind's registration: a fresh conversion replaces whatever
        terminal session the path last held, but two workers may never render
        into one directory at once — so the exclusivity test and the
        registration happen under one lock rather than as a check-then-act.

        Args:
            factory: Builds the session.
            workdir: The resolved workdir root.

        Returns:
            The registered session.

        Raises:
            ConversionInProgressError: If the path already holds an active
                session.
        """
        with self._lock:
            existing = self._by_workdir.get(str(workdir))
            if existing is not None and existing.active:
                raise ConversionInProgressError(f"a conversion is already running over {workdir}")
            session = factory()
            self._by_id[session.id] = session
            self._by_workdir[str(session.workdir)] = session
            return session


def new_session_id() -> str:
    """Mint an opaque session id.

    Returns:
        A fresh hex token, the same shape project ids use.
    """
    return secrets.token_hex(8)


def check_destination(store: ProjectStore, path: Path, allow_existing: bool) -> None:
    """Refuse a new-from-PDF destination that would silently supersede somebody's work.

    Five outcomes, the family's overwrite pattern: a nonexistent or empty
    directory proceeds; an existing forge workdir needs `allow_existing`,
    because the *estimate itself* re-renders `pages/` and resets `run.json` to
    preprocess-only; an interrupted preprocess's residue needs the same
    handshake; a non-empty directory that is anything else is somebody's
    content and is never touched; a path that is not a directory at all cannot
    become one.

    The residue case earns its own branch because the editor causes it. Forge
    copies `source.pdf` into the destination *before* it opens the PDF, so a
    rejected source — encrypted, over a page cap, corrupt — leaves a directory
    holding `source.pdf` and possibly a partial `pages/`, with no `run.json`.
    Without this branch the obvious next act (pick the right file, keep the
    prefilled destination) would be refused as somebody else's content, and the
    only remedy would be deleting by hand a directory the editor itself made.

    Args:
        store: The store to probe through.
        path: The resolved destination.
        allow_existing: Whether the caller has confirmed superseding a workdir.

    Raises:
        ConversionDestinationInvalidError: If the path exists and is not a
            directory.
        ConversionDestinationExistsError: If the path is a forge workdir or an
            interrupted preprocess's residue, and `allow_existing` is false.
        ProjectExistsError: If the path is a non-empty directory that is
            neither.
    """
    # The one probe the artifact seam cannot express: a *file* at the path is
    # indistinguishable from a missing directory through `project_exists`.
    if path.exists() and not path.is_dir():
        raise ConversionDestinationInvalidError(f"{path} is not a directory")
    key = str(path)
    if not store.project_exists(key):
        return
    artifacts = store.list_artifacts(key)
    if not artifacts:
        return
    run = _read_run(path) if RUN_ARTIFACT in artifacts else None
    if run is None:
        if not _is_preprocess_residue(artifacts):
            raise ProjectExistsError(f"directory {path} already exists and is not empty")
        if allow_existing:
            return
        raise ConversionDestinationExistsError(
            f"{path} holds an interrupted conversion's rendered pages", completed=False
        )
    if allow_existing:
        return
    monsters = run.stages.get(Stage.MONSTERS)
    raise ConversionDestinationExistsError(
        f"{path} is already a forge workdir",
        completed=monsters is not None and monsters.status == "completed",
    )


def _is_preprocess_residue(artifacts: list[str]) -> bool:
    """Whether a run.json-less directory holds nothing but what an interrupted preprocess writes."""
    return all(name == SOURCE_ARTIFACT or name.startswith(f"{PAGES_PREFIX}/") for name in artifacts)


def validate_stage(stage: Stage) -> Stage:
    """Reject a stage with no independent run, before any thread spawns.

    Forge's own guard says the same thing inside the chain and stays the
    backstop; pre-checking here is what keeps a rejectable request an HTTP
    rejection instead of a session failure.

    Args:
        stage: The requested stage.

    Returns:
        The stage.

    Raises:
        ForgeRerunInvalidError: If the stage is not in forge's
            `RUNNABLE_STAGES`.
    """
    if stage not in forge.RUNNABLE_STAGES:
        runnable = ", ".join(member.value for member in forge.RUNNABLE_STAGES)
        raise ForgeRerunInvalidError(f"stage {stage.value!r} has no independent run; choose one of: {runnable}")
    return stage


def needs_provider(stage: Stage) -> bool:
    """Report whether resuming from `stage` runs any model stage.

    Args:
        stage: The stage the chain will resume from.

    Returns:
        True when the resumed chain contains survey, content, or monsters —
        exactly when forge requires a provider.
    """
    start = forge.RUNNABLE_STAGES.index(stage)
    return any(member in MODEL_STAGES for member in forge.RUNNABLE_STAGES[start:])


def validate_settings_updates(run: RunMeta, stage: Stage, updates: Mapping[str, object]) -> None:
    """Validate knob updates for shape and for stage ownership, before any thread spawns.

    Args:
        run: The workdir's current run metadata (its settings echo is the base).
        stage: The stage the chain will resume from.
        updates: The knob updates.

    Raises:
        pydantic.ValidationError: If a knob is unknown or a value invalid — the
            API layer's `request_invalid` channel.
        ForgeRerunInvalidError: If a knob is owned by a stage upstream of
            `stage`, with forge's own remedy: rerun the owning stage instead.
    """
    if not updates:
        return
    ConversionSettings.model_validate({**run.settings.model_dump(), **updates})
    start = forge.RUNNABLE_STAGES.index(stage)
    for key in updates:
        owner = forge.KNOB_STAGES[key]
        if forge.RUNNABLE_STAGES.index(owner) < start:
            raise ForgeRerunInvalidError(
                f"setting {key!r} belongs to the {owner.value} stage, upstream of {stage.value} — "
                f"rerun {owner.value} instead"
            )


def _record_recent(workdir: Path, name: str) -> None:
    """Push a workdir to the front of the recents list — it is a real, resumable project now."""
    entry = RecentEntry(path=str(workdir), name=name, type="forge", last_opened_at=utc_now_iso())
    save_config(record_recent(load_config(), entry))


def run_estimate(session: ConversionSession) -> None:
    """The pdf kind's first act: preprocess into the workdir and price the conversion.

    Lands the session in `estimated` (or `cancelled`, when the cancel arrived
    while the pages were rendering — the warm workdir is kept either way, since
    it is honestly resumable and the pipeline view handles exactly that shape).
    A `PdfError` — encrypted, over a cap, not a module — lands the session in
    `failed` with forge's message verbatim; the request that spawned this
    worker answered long ago, so a source rejection is session state and never
    an HTTP error.

    The catch is `Exception`, deliberately wider than forge's hierarchy. The
    destination is a path the user typed, so an `OSError` (an unwritable
    parent, a full disk) is entirely reachable — and a worker that dies with
    the session still `estimating` would leave the registry claiming the
    workdir active forever, refusing every open, retry, and cancel until the
    server restarts. Every failure is session state; none is silence.

    Args:
        session: The pdf-kind session, in state `estimating`.
    """
    assert session.pdf_path is not None
    try:
        estimate = forge.estimate_pdf(session.pdf_path, session.workdir, session.settings)
    except Exception as error:
        session.refresh_stages()
        _land(session, "failed", _message(error))
        return
    session.refresh_stages()
    with session.lock:
        session.estimate = estimate
        session.state = "cancelled" if session.cancel.is_set() else "estimated"
    session.cancel.clear()
    _record_recent(session.workdir, session.pdf_path.stem)


def run_chain(
    session: ConversionSession,
    service: DocumentService,
    stage: Stage,
    provider: ModelProvider | None,
    settings_updates: Mapping[str, object] | None,
) -> None:
    """Resume the chain from `stage` through assemble, streaming progress into the session.

    Everything rejectable was rejected at the route, so what remains can only
    become session state. The catch is `Exception`, deliberately wider than
    forge's hierarchy plus the `ValueError` stage preconditions: a worker that
    dies with the session still `running` would leave the registry claiming the
    workdir active forever, refusing every open, retry, and cancel until the
    server restarts. One failing act, one honest terminal state.

    A bound session adopts its result through the project's existing assembly
    path — whole-document delta, revision bump, diagnostics recomputed,
    `checked` cleared — and adopts it *before* the terminal state lands, which
    is what makes the busy guard cover adoption too: the moment the state is no
    longer active, a poll can refetch the project and a request can commit
    against it, and both must see the adopted document. A failing chain adopts
    nothing: the project keeps its pre-rerun state and its revision, while the
    disk caches are whatever the chain wrote before failing — honest and
    recoverable, because every later assembly runs against the new caches and
    surfaces forge's error through the snapshot protocol.

    Args:
        session: The session, already moved to `running` by the route.
        service: The document service, for a bound session's adoption.
        stage: The stage to resume from.
        provider: The provider, built at the route when the chain needs one.
        settings_updates: Knob updates for the `run.json` echo, or `None`.
    """

    def on_progress(event: StageEvent) -> None:
        if event.status == "running":
            # Checked on `running` events only, which forge emits outside its
            # own try block: the stage in flight always finishes.
            if session.cancel.is_set():
                raise ConversionCancelledError(f"cancelled before the {event.stage.value} stage")
            session.mark_running(event.stage)
            return
        session.refresh_stages()

    try:
        result = forge.run_chain(session.workdir, stage, provider, settings_updates, on_progress)
        session.refresh_stages()
        _adopt(session, service, result)
    except ConversionCancelledError:
        session.refresh_stages()
        _land(session, "cancelled", None)
        return
    except Exception as error:
        session.refresh_stages()
        _land(session, "failed", _message(error))
        return
    _land(session, "completed", None)


def _message(error: Exception) -> str:
    """The failure text a session carries: forge's message verbatim, or the type when there is none."""
    return str(error) or type(error).__name__


def _land(session: ConversionSession, state: ConversionStateName, error: str | None) -> None:
    """Move a session to a terminal state and release the cancel flag."""
    with session.lock:
        session.state = state
        session.error = error
    session.cancel.clear()


def _adopt(session: ConversionSession, service: DocumentService, result: ConversionResult) -> None:
    """Install a bound session's chain result into its open project; a closed project adopts nothing."""
    with session.lock:
        project_id = session.project_id
    if project_id is None:
        return
    try:
        project = service.get(project_id)
    except ProjectNotFoundError:
        # The project closed under the run (a restart, a detach that slipped
        # the guard). The workdir is correct; there is nothing to adopt into.
        return
    service.adopt_conversion(project, result.adventure, result.report)


def spawn(runner: Callable[..., None], session: ConversionSession, *args: object) -> threading.Thread:
    """Run a session body on a daemon thread.

    The wrapper is deliberately thin: the bodies are plain functions the suites
    call directly, and the only thing threading adds is that the request
    returns while the work runs.

    Args:
        runner: [`run_estimate`][osreditor.conversions.run_estimate] or
            [`run_chain`][osreditor.conversions.run_chain].
        session: The session to run.
        *args: The runner's remaining positional arguments.

    Returns:
        The started thread.
    """
    thread = threading.Thread(target=runner, args=(session, *args), daemon=True, name=f"conversion-{session.id}")
    thread.start()
    return thread


def settings_from(updates: Mapping[str, object]) -> ConversionSettings | None:
    """Validate creation-time knobs into a settings model, or `None` when there are none.

    Args:
        updates: The requested knobs.

    Returns:
        The settings, or `None` for forge's defaults.

    Raises:
        pydantic.ValidationError: If a knob is unknown or a value invalid.
    """
    if not updates:
        return None
    return ConversionSettings.model_validate(updates)


def require_runnable(session: ConversionSession) -> None:
    """Refuse a run from a state that does not admit one, before anything else is checked.

    Ordering, not enforcement: this runs first so a client whose session is
    already working gets that answer rather than a knob or provider complaint
    about a request that was never going to run.
    [`begin_run`][osreditor.conversions.begin_run] is the enforcing check.

    Args:
        session: The session.

    Raises:
        ConversionStateInvalidError: If a worker already holds the session.
    """
    with session.lock:
        state = session.state
    if state in _ACTIVE_STATES:
        raise ConversionStateInvalidError(f"conversion {session.id} is {state} and cannot be run")


def require_run_meta(session: ConversionSession) -> RunMeta:
    """Read the workdir's run metadata, or say why this session has nothing to resume.

    Args:
        session: The session.

    Returns:
        The run metadata.

    Raises:
        ConversionStateInvalidError: If the workdir has no readable `run.json`
            — a source rejected before preprocessing ever wrote one.
    """
    run = _read_run(session.workdir)
    if run is None:
        raise ConversionStateInvalidError(
            f"conversion {session.id} has no workdir to resume: the source was rejected before preprocessing"
        )
    return run


def request_cancel(session: ConversionSession) -> None:
    """Raise the cancel flag, or land an idle session in `cancelled` immediately.

    While a chain runs the flag takes effect at the next stage boundary, so the
    stage in flight always finishes; while the estimate runs it is checked when
    preprocess returns, keeping the warm workdir.

    Args:
        session: The session to cancel.

    Raises:
        ConversionStateInvalidError: If the session is already terminal.
    """
    with session.lock:
        state = session.state
        if state in _ACTIVE_STATES:
            session.cancel.set()
            return
        if state not in ("estimated", "ready"):
            raise ConversionStateInvalidError(f"conversion {session.id} is {state} and cannot be cancelled")
        session.state = "cancelled"


def begin_run(session: ConversionSession) -> None:
    """Move a session into `running`, clearing the previous attempt's error and cancel flag.

    Called last, after every rejectable check, so a rejected request never
    leaves a session claiming to run. The state test repeats under the lock
    because this is the transition that must be atomic.

    Args:
        session: The session.

    Raises:
        ConversionStateInvalidError: If a worker claimed the session while the
            request was being validated.
    """
    with session.lock:
        if session.state in _ACTIVE_STATES:
            raise ConversionStateInvalidError(f"conversion {session.id} is {session.state} and cannot be run")
        session.state = "running"
        session.error = None
    session.cancel.clear()


def bind(session: ConversionSession, project_id: str | None) -> None:
    """Bind an idle session to an open project (or unbind it), so its result is adopted.

    Re-resolved at every run, not just at creation, because one workdir keeps
    one session for the process lifetime while the project at its path comes
    and goes: the pdf-kind session that just converted a module is still the
    session for that workdir when the finished conversion is opened and the
    pipeline panel reruns a stage over it. A session that ran unbound would
    complete correctly on disk and adopt nothing, leaving the open project
    showing a document the workdir no longer holds.

    An active session's binding is left alone: it was bound when it started,
    and the busy guard is what keeps that true.

    Args:
        session: The session.
        project_id: The open project's id, or `None`.
    """
    with session.lock:
        if session.state in _ACTIVE_STATES:
            return
        session.project_id = project_id


def open_session(
    registry: ConversionRegistry,
    workdir: Path,
    project_id: str | None,
) -> ConversionSession:
    """Return the workdir's session, minting a workdir-kind one on a miss.

    The idempotency that keeps one workdir on one session however many surfaces
    ask: the incomplete-workdir open, the pipeline panel's rerun, and a reload
    all land here.

    Args:
        registry: The session registry.
        workdir: The resolved workdir root.
        project_id: The open project to bind to, if any.

    Returns:
        The session.
    """
    session, minted = registry.get_or_create(
        workdir,
        lambda: ConversionSession(
            session_id=new_session_id(),
            kind="workdir",
            workdir=workdir,
            run=_read_run(workdir),
            project_id=project_id,
        ),
    )
    if not minted:
        bind(session, project_id)
        return session
    _record_recent(workdir, workdir.stem)
    return session
