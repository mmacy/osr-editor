"""App config: round-trip, cap-and-dedup, corrupt-file reset, atomic write."""

import json
from pathlib import Path

from osreditor.config import MAX_RECENTS, AppConfig, RecentEntry, load_config, record_recent, save_config


def entry(path: str, name: str = "Adventure") -> RecentEntry:
    return RecentEntry(path=path, name=name, type="native", last_opened_at="2026-07-18T00:00:00Z")


def test_round_trip(tmp_path: Path) -> None:
    target = tmp_path / "config.json"
    config = AppConfig(recents=(entry("/projects/a"), entry("/projects/b")))
    save_config(config, target)
    assert load_config(target) == config


def test_missing_file_is_first_run(tmp_path: Path) -> None:
    assert load_config(tmp_path / "never-written.json") == AppConfig()


def test_corrupt_file_resets_to_empty(tmp_path: Path) -> None:
    target = tmp_path / "config.json"
    target.write_text("{not json", encoding="utf-8")
    assert load_config(target) == AppConfig()


def test_wrong_shape_resets_to_empty(tmp_path: Path) -> None:
    target = tmp_path / "config.json"
    target.write_text(json.dumps({"schema_version": "nope", "recents": 3}), encoding="utf-8")
    assert load_config(target) == AppConfig()


def test_record_recent_deduplicates_by_path_and_moves_to_front() -> None:
    config = AppConfig(recents=(entry("/projects/a"), entry("/projects/b")))
    updated = record_recent(config, entry("/projects/b", name="Renamed"))
    assert [recent.path for recent in updated.recents] == ["/projects/b", "/projects/a"]
    assert updated.recents[0].name == "Renamed"


def test_record_recent_caps_the_list() -> None:
    config = AppConfig(recents=tuple(entry(f"/projects/{n}") for n in range(MAX_RECENTS)))
    updated = record_recent(config, entry("/projects/new"))
    assert len(updated.recents) == MAX_RECENTS
    assert updated.recents[0].path == "/projects/new"
    assert all(recent.path != f"/projects/{MAX_RECENTS - 1}" for recent in updated.recents)


def test_save_leaves_no_temp_file(tmp_path: Path) -> None:
    target = tmp_path / "config.json"
    save_config(AppConfig(recents=(entry("/projects/a"),)), target)
    assert [path.name for path in tmp_path.iterdir()] == ["config.json"]


def test_save_creates_parent_directories(tmp_path: Path) -> None:
    target = tmp_path / "nested" / "config.json"
    save_config(AppConfig(), target)
    assert load_config(target) == AppConfig()
