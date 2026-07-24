"""The conversion session machinery: the state machine, the runners, and cooperative cancellation.

The runners are driven synchronously here — they are plain functions the thread
wrapper calls — so nothing sleeps and nothing is flaky. The threaded path is
covered once, by the Playwright suite's real server.
"""

from collections.abc import Callable
from pathlib import Path

import pytest
from osrforge.contracts.run import RunMeta, Stage, StageStatus
from osrforge.providers.base import ModelProvider, ModelRequest, ModelResponse
from osrforge.providers.fixtures import FixtureProvider
from osrforge.settings import ConversionSettings

import osreditor.forge
from osreditor.config import load_config
from osreditor.conversions import (
    ConversionRegistry,
    ConversionSession,
    begin_run,
    check_destination,
    first_incomplete_stage,
    needs_provider,
    new_session_id,
    open_session,
    request_cancel,
    require_run_meta,
    require_runnable,
    run_chain,
    run_estimate,
    validate_settings_updates,
    validate_stage,
)
from osreditor.documents import DocumentService
from osreditor.errors import (
    ConversionDestinationExistsError,
    ConversionDestinationInvalidError,
    ConversionInProgressError,
    ConversionNotFoundError,
    ConversionStateInvalidError,
    ForgeRerunInvalidError,
    ProjectExistsError,
)
from osreditor.store import LocalProjectStore


@pytest.fixture
def service() -> DocumentService:
    return DocumentService(LocalProjectStore())


def pdf_session(pdf: Path, workdir: Path, settings: ConversionSettings | None = None) -> ConversionSession:
    return ConversionSession(
        session_id=new_session_id(), kind="pdf", workdir=workdir, run=None, pdf_path=pdf, settings=settings
    )


def workdir_session(workdir: Path, project_id: str | None = None) -> ConversionSession:
    from osreditor.forge import read_run_meta

    return ConversionSession(
        session_id=new_session_id(),
        kind="workdir",
        workdir=workdir,
        run=read_run_meta(workdir),
        project_id=project_id,
    )


def stage_states(session: ConversionSession) -> dict[str, str]:
    return {row.stage.value: row.status.status for row in session.snapshot().stages}


class CancellingProvider:
    """Replays fixtures, then raises the session's cancel flag after a chosen tag."""

    def __init__(self, inner: ModelProvider, session: ConversionSession, after_tag: str) -> None:
        self.inner = inner
        self.session = session
        self.after_tag = after_tag
        self.tags: list[str] = []

    def generate(self, request: ModelRequest) -> ModelResponse:
        response = self.inner.generate(request)
        self.tags.append(request.tag)
        if request.tag == self.after_tag:
            self.session.cancel.set()
        return response


# --- the pdf lifecycle --------------------------------------------------------


def test_the_estimate_prices_the_conversion_and_leaves_the_workdir_warm(minimod_pdf: Path, tmp_path: Path) -> None:
    session = pdf_session(minimod_pdf, tmp_path / "minimod.forge")
    run_estimate(session)

    state = session.snapshot()
    assert state.state == "estimated"
    assert state.estimate is not None
    estimate = state.estimate
    assert estimate.page_count == 5
    # Never exact token goldens: text-layer extraction rides pdfium versions.
    # What is pinned is coherence — the totals are the parts.
    assert estimate.text_tokens > 0 and estimate.image_tokens > 0
    assert estimate.input_tokens == (
        estimate.survey_input_tokens + estimate.content_input_tokens + estimate.monsters_input_tokens
    )
    assert estimate.output_tokens == (
        estimate.survey_output_tokens + estimate.content_output_tokens + estimate.monsters_output_tokens
    )
    assert estimate.usd > 0

    # The workdir is real, resumable, and preprocess-warm — forge's own docstring
    # names `rerun survey` as the next step, and that is what confirm does.
    assert stage_states(session) == {
        "preprocess": "completed",
        "survey": "pending",
        "content": "pending",
        "monsters": "pending",
        "geometry": "pending",
        "assemble": "pending",
    }
    assert (session.workdir / "pages" / "0001.png").is_file()
    assert first_incomplete_stage(require_run_meta(session)) is Stage.SURVEY


def test_the_estimate_records_the_workdir_in_recents_under_the_pdf_stem(minimod_pdf: Path, tmp_path: Path) -> None:
    session = pdf_session(minimod_pdf, tmp_path / "cellar.forge")
    run_estimate(session)
    recents = load_config().recents
    assert [(entry.name, entry.type, entry.path) for entry in recents] == [
        ("minimod", "forge", str(tmp_path / "cellar.forge"))
    ]


def test_a_rejected_source_lands_in_failed_with_forges_message(encrypted_pdf: Path, tmp_path: Path) -> None:
    session = pdf_session(encrypted_pdf, tmp_path / "nope.forge")
    run_estimate(session)
    state = session.snapshot()
    assert state.state == "failed"
    assert state.error is not None
    # Forge's message verbatim — no editor paraphrase, no HTTP error involved.
    assert "corrupt or password-protected" in state.error
    assert state.estimate is None
    # Nothing was recorded: there is no resumable workdir here.
    assert load_config().recents == ()


def test_a_page_cap_breach_is_the_same_session_failure(minimod_pdf: Path, tmp_path: Path) -> None:
    session = pdf_session(minimod_pdf, tmp_path / "capped.forge", ConversionSettings(max_pages=2))
    run_estimate(session)
    state = session.snapshot()
    assert state.state == "failed"
    assert state.error is not None and "over the 2-page limit" in state.error


# --- the chain ----------------------------------------------------------------


def test_confirm_then_run_completes_the_chain_over_the_warm_workdir(
    service: DocumentService, warm_workdir: Path, minimod_fixtures: Path
) -> None:
    session = workdir_session(warm_workdir)
    assert session.snapshot().state == "ready"
    begin_run(session)
    run_chain(session, service, Stage.SURVEY, FixtureProvider(minimod_fixtures), None)

    state = session.snapshot()
    assert state.state == "completed"
    assert state.error is None
    # The rows are in run.json order, and every one is the disk's truth.
    assert [row.stage.value for row in state.stages] == [
        "preprocess",
        "survey",
        "content",
        "monsters",
        "geometry",
        "assemble",
    ]
    assert all(row.status.status == "completed" for row in state.stages)
    survey = next(row for row in state.stages if row.stage is Stage.SURVEY)
    assert survey.status.usage is not None and survey.status.usage.input_tokens > 0
    assert survey.status.finished_at is not None
    assert (warm_workdir / "adventure.json").is_file()
    assert (warm_workdir / "report.json").is_file()


def test_the_full_loop_product_opens_into_review(
    service: DocumentService, warm_workdir: Path, minimod_fixtures: Path
) -> None:
    from osreditor.projects import open_project

    session = workdir_session(warm_workdir)
    begin_run(session)
    run_chain(session, service, Stage.SURVEY, FixtureProvider(minimod_fixtures), None)

    project = open_project(service, warm_workdir)
    assert project.type == "forge"
    assert project.forge is not None
    assert project.adventure.name == "The Root Cellar of Old Wenna"
    assert project.forge.report.module.pages == 5


def test_a_failing_chain_lands_in_failed_with_forges_message(
    service: DocumentService, warm_workdir: Path, tmp_path: Path
) -> None:
    # An empty fixture directory: the survey's first request has nothing to
    # replay, and forge's FixtureMissError message names the miss.
    empty = tmp_path / "no-fixtures"
    empty.mkdir()
    session = workdir_session(warm_workdir)
    begin_run(session)
    run_chain(session, service, Stage.SURVEY, FixtureProvider(empty), None)
    state = session.snapshot()
    assert state.state == "failed"
    assert state.error is not None and "no fixture for tag 'survey'" in state.error
    assert stage_states(session)["survey"] == "failed"


def test_a_failed_session_re_runs(service: DocumentService, warm_workdir: Path, minimod_fixtures: Path) -> None:
    empty = warm_workdir.parent / "no-fixtures"
    empty.mkdir()
    session = workdir_session(warm_workdir)
    begin_run(session)
    run_chain(session, service, Stage.SURVEY, FixtureProvider(empty), None)
    assert session.snapshot().state == "failed"

    require_runnable(session)
    begin_run(session)
    run_chain(session, service, Stage.SURVEY, FixtureProvider(minimod_fixtures), None)
    state = session.snapshot()
    assert state.state == "completed"
    # The re-run cleared the previous attempt's message.
    assert state.error is None


# --- cancellation -------------------------------------------------------------


def test_cancel_takes_effect_at_the_next_stage_boundary_and_the_conversion_resumes(
    service: DocumentService, warm_workdir: Path, minimod_fixtures: Path
) -> None:
    session = workdir_session(warm_workdir)
    begin_run(session)
    provider = CancellingProvider(FixtureProvider(minimod_fixtures), session, after_tag="survey")
    run_chain(session, service, Stage.SURVEY, provider, None)

    state = session.snapshot()
    assert state.state == "cancelled"
    # The stage in flight finished; the next never started.
    assert provider.tags == ["survey"]
    assert stage_states(session) == {
        "preprocess": "completed",
        "survey": "completed",
        "content": "pending",
        "monsters": "pending",
        "geometry": "pending",
        "assemble": "pending",
    }
    # run.json never records a stage the chain abandoned mid-write.
    run = require_run_meta(session)
    assert run.stages[Stage.CONTENT].status == "pending"
    assert run.stages[Stage.CONTENT].started_at is None
    # And the resume picks up exactly there.
    assert first_incomplete_stage(run) is Stage.CONTENT

    require_runnable(session)
    begin_run(session)
    run_chain(session, service, first_incomplete_stage(run), FixtureProvider(minimod_fixtures), None)
    assert session.snapshot().state == "completed"


def test_cancel_during_the_estimate_keeps_the_warm_workdir(minimod_pdf: Path, tmp_path: Path) -> None:
    session = pdf_session(minimod_pdf, tmp_path / "minimod.forge")
    session.cancel.set()
    run_estimate(session)
    state = session.snapshot()
    assert state.state == "cancelled"
    # The pages are rendered and the estimate is known — declining costs nothing
    # and the workdir is honestly resumable.
    assert state.estimate is not None
    assert stage_states(session)["preprocess"] == "completed"
    require_runnable(session)


def test_cancel_is_immediate_while_idle_and_refused_once_terminal(warm_workdir: Path) -> None:
    session = workdir_session(warm_workdir)
    request_cancel(session)
    assert session.snapshot().state == "cancelled"
    with pytest.raises(ConversionStateInvalidError):
        request_cancel(session)


def test_running_from_a_state_that_forbids_it_is_refused(warm_workdir: Path) -> None:
    session = workdir_session(warm_workdir)
    begin_run(session)
    with pytest.raises(ConversionStateInvalidError):
        require_runnable(session)
    with pytest.raises(ConversionStateInvalidError):
        begin_run(session)


# --- the destination guard ----------------------------------------------------


def test_a_nonexistent_or_empty_destination_proceeds(tmp_path: Path) -> None:
    store = LocalProjectStore()
    check_destination(store, tmp_path / "new.forge", allow_existing=False)
    empty = tmp_path / "empty.forge"
    empty.mkdir()
    check_destination(store, empty, allow_existing=False)


def test_an_existing_workdir_needs_the_handshake_and_reports_whether_it_completed(
    forge_workdir: Path, warm_workdir: Path
) -> None:
    store = LocalProjectStore()
    with pytest.raises(ConversionDestinationExistsError) as caught:
        check_destination(store, forge_workdir, allow_existing=False)
    assert caught.value.completed is True

    with pytest.raises(ConversionDestinationExistsError) as warm:
        check_destination(store, warm_workdir, allow_existing=False)
    assert warm.value.completed is False

    # With the flag, both proceed: re-preprocessing in place is forge's own
    # documented rebuild behavior.
    check_destination(store, forge_workdir, allow_existing=True)
    check_destination(store, warm_workdir, allow_existing=True)


def test_an_occupied_non_workdir_directory_is_never_touched(tmp_path: Path) -> None:
    occupied = tmp_path / "notes"
    occupied.mkdir()
    (occupied / "thesis.txt").write_text("somebody's content", encoding="utf-8")
    with pytest.raises(ProjectExistsError):
        check_destination(LocalProjectStore(), occupied, allow_existing=True)


def test_a_file_destination_cannot_become_a_workdir(tmp_path: Path) -> None:
    target = tmp_path / "notes.txt"
    target.write_text("hello", encoding="utf-8")
    with pytest.raises(ConversionDestinationInvalidError):
        check_destination(LocalProjectStore(), target, allow_existing=True)


# --- the registry -------------------------------------------------------------


def test_one_workdir_holds_one_session_however_many_surfaces_ask(warm_workdir: Path) -> None:
    registry = ConversionRegistry()
    first = open_session(registry, warm_workdir, None)
    second = open_session(registry, warm_workdir, None)
    assert first is second
    assert registry.find(warm_workdir) is first
    assert registry.get(first.id) is first


def test_the_lookup_answers_any_state_and_the_id_miss_is_typed(warm_workdir: Path) -> None:
    registry = ConversionRegistry()
    session = open_session(registry, warm_workdir, None)
    assert registry.active_for(warm_workdir) is None
    begin_run(session)
    assert registry.active_for(warm_workdir) is session
    assert registry.find(warm_workdir) is session
    with pytest.raises(ConversionNotFoundError):
        registry.get("nope")


def test_creating_a_workdir_session_binds_it_to_the_open_project(warm_workdir: Path) -> None:
    registry = ConversionRegistry()
    session = open_session(registry, warm_workdir, "project-1")
    assert session.snapshot().project_id == "project-1"
    # An active session's binding is left alone — it was bound when it started.
    begin_run(session)
    open_session(registry, warm_workdir, None)
    assert session.snapshot().project_id == "project-1"


# --- request validation -------------------------------------------------------


def test_only_forges_runnable_stages_are_accepted() -> None:
    for stage in (Stage.PREPROCESS, Stage.SURVEY, Stage.CONTENT, Stage.MONSTERS, Stage.ASSEMBLE):
        assert validate_stage(stage) is stage
    with pytest.raises(ForgeRerunInvalidError) as caught:
        validate_stage(Stage.GEOMETRY)
    assert "no independent run" in str(caught.value)


def test_a_provider_is_required_exactly_when_the_resumed_chain_has_a_model_stage() -> None:
    assert needs_provider(Stage.PREPROCESS) is True
    assert needs_provider(Stage.SURVEY) is True
    assert needs_provider(Stage.MONSTERS) is True
    assert needs_provider(Stage.ASSEMBLE) is False


def test_a_knob_owned_upstream_is_refused_with_forges_remedy(warm_workdir: Path) -> None:
    run = require_run_meta(workdir_session(warm_workdir))
    validate_settings_updates(run, Stage.MONSTERS, {"custom_monsters": "off"})
    with pytest.raises(ForgeRerunInvalidError) as caught:
        validate_settings_updates(run, Stage.MONSTERS, {"render_dpi": 300})
    assert "belongs to the preprocess stage" in str(caught.value)
    assert "rerun preprocess instead" in str(caught.value)


def test_an_unknown_knob_is_a_malformed_request(warm_workdir: Path) -> None:
    run = require_run_meta(workdir_session(warm_workdir))
    with pytest.raises(ValueError):
        validate_settings_updates(run, Stage.ASSEMBLE, {"not_a_knob": 1})


def test_a_session_with_no_workdir_says_so_rather_than_guessing(tmp_path: Path) -> None:
    session = pdf_session(tmp_path / "missing.pdf", tmp_path / "nothing.forge")
    with pytest.raises(ConversionStateInvalidError) as caught:
        require_run_meta(session)
    assert "no workdir to resume" in str(caught.value)


def test_first_incomplete_stage_falls_back_to_assemble_when_everything_is_done(warm_workdir: Path) -> None:
    run = require_run_meta(workdir_session(warm_workdir))
    completed = RunMeta.model_validate(
        {
            **run.model_dump(),
            "stages": {stage.value: StageStatus(status="completed").model_dump() for stage in Stage},
        }
    )
    assert first_incomplete_stage(completed) is Stage.ASSEMBLE


# --- nothing may wedge a session ---------------------------------------------


def test_a_non_forge_failure_lands_the_session_rather_than_wedging_it(
    service: DocumentService, warm_workdir: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    # The destination is a path the user typed, so an OSError is entirely
    # reachable. A worker that died here would leave the registry claiming the
    # workdir active forever, refusing every open, retry, and cancel.
    def explode(*args: object, **kwargs: object) -> object:
        raise PermissionError(13, "Permission denied", str(warm_workdir))

    monkeypatch.setattr(osreditor.forge, "run_chain", explode)
    session = workdir_session(warm_workdir)
    begin_run(session)
    run_chain(session, service, Stage.SURVEY, None, None)
    state = session.snapshot()
    assert state.state == "failed"
    assert state.error is not None and "Permission denied" in state.error
    assert session.active is False
    require_runnable(session)


def test_a_non_forge_estimate_failure_lands_the_session_too(
    minimod_pdf: Path, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    def explode(*args: object, **kwargs: object) -> object:
        raise OSError(28, "No space left on device")

    monkeypatch.setattr(osreditor.forge, "estimate_pdf", explode)
    session = pdf_session(minimod_pdf, tmp_path / "minimod.forge")
    run_estimate(session)
    assert session.snapshot().state == "failed"
    assert session.active is False


def test_a_message_less_failure_still_names_itself(
    service: DocumentService, warm_workdir: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    def explode(*args: object, **kwargs: object) -> object:
        raise RuntimeError()

    monkeypatch.setattr(osreditor.forge, "run_chain", explode)
    session = workdir_session(warm_workdir)
    begin_run(session)
    run_chain(session, service, Stage.SURVEY, None, None)
    assert session.snapshot().error == "RuntimeError"


# --- previews in the state the control exists for ----------------------------


def test_previews_render_in_the_pre_assemble_state(
    service: DocumentService, warm_workdir: Path, minimod_fixtures: Path
) -> None:
    # Stop after content: survey and content cached, monsters pending, assembly
    # impossible — the one place the standalone control earns its keep.
    session = workdir_session(warm_workdir)
    begin_run(session)
    content_tag = "content.the-root-cellar-of-old-wenna.1.b01"
    provider = CancellingProvider(FixtureProvider(minimod_fixtures), session, after_tag=content_tag)
    run_chain(session, service, Stage.SURVEY, provider, None)
    assert session.snapshot().state == "cancelled"
    assert stage_states(session)["content"] == "completed"
    assert stage_states(session)["monsters"] == "pending"
    assert not (warm_workdir / "adventure.json").exists()

    written = osreditor.forge.render_workdir_previews(warm_workdir)
    assert [path.name for path in written] == ["the-root-cellar-of-old-wenna.1.svg"]
    assert written[0].read_bytes().startswith(b"<svg")
    # Rendered from the caches alone: no assembly happened, and none could.
    assert not (warm_workdir / "adventure.json").exists()


# --- the registry is atomic ---------------------------------------------------


def test_the_registry_mints_at_most_one_session_per_workdir(warm_workdir: Path) -> None:
    registry = ConversionRegistry()
    minted: list[bool] = []
    for _ in range(3):
        session, was_new = registry.get_or_create(
            warm_workdir,
            lambda: ConversionSession(session_id=new_session_id(), kind="workdir", workdir=warm_workdir, run=None),
        )
        minted.append(was_new)
        assert session is registry.find(warm_workdir)
    assert minted == [True, False, False]


def pdf_factory(workdir: Path) -> Callable[[], ConversionSession]:
    return lambda: ConversionSession(session_id=new_session_id(), kind="pdf", workdir=workdir, run=None)


def test_a_fresh_conversion_never_spawns_a_second_worker_over_a_busy_workdir(
    warm_workdir: Path,
) -> None:
    registry = ConversionRegistry()
    busy = registry.get_or_create(warm_workdir, lambda: workdir_session(warm_workdir))[0]
    begin_run(busy)
    # The exclusivity test and the registration are one locked act, so two
    # submitted dialogs can never both render into one directory.
    with pytest.raises(ConversionInProgressError):
        registry.register_new(pdf_factory(warm_workdir), warm_workdir)
    assert registry.find(warm_workdir) is busy


def test_a_fresh_conversion_supersedes_an_idle_session_which_stays_reachable_by_id(
    warm_workdir: Path,
) -> None:
    registry = ConversionRegistry()
    first = registry.get_or_create(warm_workdir, lambda: workdir_session(warm_workdir))[0]
    second = registry.register_new(pdf_factory(warm_workdir), warm_workdir)
    assert second is not first
    assert registry.find(warm_workdir) is second
    # Terminal sessions stay for the process lifetime — a stale tab still polls.
    assert registry.get(first.id) is first


# --- the editor's own failure residue -----------------------------------------


def test_an_interrupted_preprocess_residue_rides_the_same_handshake(tmp_path: Path) -> None:
    # Forge copies source.pdf in before it opens the PDF, so a rejected source
    # leaves exactly this. The editor made it; it must not refuse it as
    # somebody else's content.
    residue = tmp_path / "nope.forge"
    (residue / "pages").mkdir(parents=True)
    (residue / "source.pdf").write_bytes(b"%PDF-1.4\n")
    (residue / "pages" / "0001.png").write_bytes(b"png")
    store = LocalProjectStore()
    with pytest.raises(ConversionDestinationExistsError) as caught:
        check_destination(store, residue, allow_existing=False)
    assert caught.value.completed is False
    check_destination(store, residue, allow_existing=True)


def test_a_residue_with_anything_else_in_it_is_still_somebodys_content(tmp_path: Path) -> None:
    residue = tmp_path / "mixed"
    residue.mkdir()
    (residue / "source.pdf").write_bytes(b"%PDF-1.4\n")
    (residue / "thesis.txt").write_text("mine", encoding="utf-8")
    with pytest.raises(ProjectExistsError):
        check_destination(LocalProjectStore(), residue, allow_existing=True)


# --- the reproducibility invariant survives conversion -------------------------


def test_every_workdir_write_inside_a_session_is_forges_own(
    service: DocumentService, warm_workdir: Path, minimod_fixtures: Path
) -> None:
    # The phase 5 invariant, carried through phase 6: the editor writes
    # overrides.yaml and its own editor.json sidecar and nothing else. A
    # conversion adds no editor write at all — every artifact below is forge's
    # own code writing forge's own files, which is what keeps re-running the
    # chain by hand byte-reproducible.
    session = workdir_session(warm_workdir)
    begin_run(session)
    run_chain(session, service, Stage.SURVEY, FixtureProvider(minimod_fixtures), None)
    assert session.snapshot().state == "completed"

    produced = sorted(path.relative_to(warm_workdir).as_posix() for path in warm_workdir.rglob("*") if path.is_file())
    forge_owned = {"adventure.json", "report.json", "run.json", "source.pdf"}
    unexpected = [
        name for name in produced if name not in forge_owned and not name.startswith(("pages/", "stages/", "previews/"))
    ]
    assert unexpected == []
    # And no editor sidecar exists until a project is actually opened.
    assert "editor.json" not in produced
