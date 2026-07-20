"""Shared fixtures: config isolation, so no test ever touches the developer's real config."""

import shutil
from pathlib import Path

import pytest

import osreditor.config

FORGE_WORKDIR_FIXTURE = Path(__file__).parent / "fixtures" / "forge_workdir"


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
