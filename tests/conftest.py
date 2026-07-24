"""Shared fixtures: config isolation, so no test ever touches the developer's real config."""

import shutil
from datetime import UTC, datetime
from pathlib import Path

import pytest
from osrforge.contracts.run import RunMeta, Stage, StageStatus
from osrforge.settings import ConversionSettings
from osrforge.workdir import Workdir

import osreditor.config

FORGE_WORKDIR_FIXTURE = Path(__file__).parent / "fixtures" / "forge_workdir"
MINIMOD_ASSETS = Path(__file__).parent / "assets" / "minimod"
MINIMOD_PAGE_COUNT = 5


@pytest.fixture(autouse=True)
def isolated_config(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    target = tmp_path / "test-config" / "config.json"
    monkeypatch.setattr(osreditor.config, "config_path", lambda: target)
    return target


@pytest.fixture
def forge_workdir(tmp_path: Path) -> Path:
    """A temp copy of the committed forge workdir.

    Forge operations write artifacts into the workdir (`assemble` rewrites
    `adventure.json`, `report.json`, previews, and `run.json` stage tracking),
    so no test ever runs one against the committed tree.
    """
    target = tmp_path / "millstone.forge"
    shutil.copytree(FORGE_WORKDIR_FIXTURE, target)
    return target


def fabricate_warm_workdir(root: Path) -> Path:
    """Build the estimate's product: a preprocess-completed workdir over the committed renders.

    The editor-side twin of forge's own `minimod_workdir`. The pages are the
    committed renders the fixtures were recorded against — never a fresh
    render, because request fingerprints hash the page bytes and PNG
    byte-stability across pdfium/Pillow versions is explicitly not forge's
    contract. `source.pdf` rides along because a real estimated workdir has
    one (it is what `rerun preprocess` reads); re-running preprocess against it
    would re-render the pages and strand the fixtures, which is honest and
    exactly why no suite does.

    Args:
        root: The workdir root to create.

    Returns:
        The workdir root.
    """
    workdir = Workdir(root)
    workdir.root.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(MINIMOD_ASSETS / "minimod.pdf", workdir.source_pdf)
    workdir.pages_dir.mkdir()
    for path in (MINIMOD_ASSETS / "pages").iterdir():
        shutil.copyfile(path, workdir.pages_dir / path.name)
    stages = {stage: StageStatus() for stage in Stage}
    stages[Stage.PREPROCESS] = StageStatus(
        status="completed",
        started_at=datetime(2026, 7, 9, 12, 0, 0, tzinfo=UTC),
        finished_at=datetime(2026, 7, 9, 12, 0, 5, tzinfo=UTC),
    )
    workdir.write_run(
        RunMeta(
            source_sha256="00" * 32,
            source_bytes=1,
            page_count=MINIMOD_PAGE_COUNT,
            settings=ConversionSettings(),
            stages=stages,
        )
    )
    return root


@pytest.fixture
def warm_workdir(tmp_path: Path) -> Path:
    """A fabricated estimated-but-unconfirmed workdir — the conversion suites' entry state."""
    return fabricate_warm_workdir(tmp_path / "minimod.forge")


@pytest.fixture
def minimod_pdf() -> Path:
    """The vendored 5-page source module."""
    return MINIMOD_ASSETS / "minimod.pdf"


@pytest.fixture
def encrypted_pdf() -> Path:
    """The vendored password-protected PDF — the wrong-file failure case."""
    return MINIMOD_ASSETS / "encrypted.pdf"


@pytest.fixture
def minimod_fixtures() -> Path:
    """The recorded survey and content exchanges `FixtureProvider` replays."""
    return MINIMOD_ASSETS / "fixtures"
