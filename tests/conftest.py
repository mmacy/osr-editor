"""Shared fixtures: config isolation, so no test ever touches the developer's real config."""

from pathlib import Path

import pytest

import osreditor.config


@pytest.fixture(autouse=True)
def isolated_config(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    target = tmp_path / "test-config" / "config.json"
    monkeypatch.setattr(osreditor.config, "config_path", lambda: target)
    return target
