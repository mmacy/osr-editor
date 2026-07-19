"""App config: the recents list, at `platformdirs.user_config_path("osr-editor") / "config.json"`.

The config file is a convenience cache, not user data: reads tolerate absence
(first run) and corruption (a malformed file logs a warning and resets to empty
rather than failing boot). Writes are atomic — the same temp-file-and-replace
pattern as the store — because the always-saved editor updates recents on every
open. The schema is additive-only within its schema version; phase 3 added the
osr-web checkout path, and the spec's remaining config keys (UI preferences)
arrive with their consuming features.
"""

import contextlib
import json
import logging
import os
import tempfile
from pathlib import Path

import platformdirs
from pydantic import BaseModel, ConfigDict, ValidationError

__all__ = [
    "AppConfig",
    "RecentEntry",
    "config_path",
    "load_config",
    "record_recent",
    "save_config",
]

CONFIG_SCHEMA_VERSION = 1
MAX_RECENTS = 10

logger = logging.getLogger(__name__)


class RecentEntry(BaseModel):
    """One recently opened project: where it is, what to call it, which shape it had."""

    model_config = ConfigDict(frozen=True)

    path: str
    name: str
    type: str
    last_opened_at: str


class AppConfig(BaseModel):
    """The persisted app config: schema version, the recents list, and the publish target.

    `osr_web_checkout` is the osr-web checkout path publish writes into —
    additive schema, absent until the first publish collects it. There is no
    settings screen: the publish dialog collects the path when unconfigured,
    and the backend saves it once its shape test passes (the no-dead-keys
    rule — one route, no dead surface).
    """

    model_config = ConfigDict(frozen=True)

    schema_version: int = CONFIG_SCHEMA_VERSION
    recents: tuple[RecentEntry, ...] = ()
    osr_web_checkout: str | None = None


def config_path() -> Path:
    """Return the config file path, per the spec's `platformdirs` convention.

    Returns:
        `platformdirs.user_config_path("osr-editor") / "config.json"`.
    """
    return platformdirs.user_config_path("osr-editor") / "config.json"


def load_config(path: Path | None = None) -> AppConfig:
    """Load the app config, tolerating absence and corruption.

    A missing file is first run; a malformed one logs a warning and resets to
    empty — the config is a convenience cache, never worth failing boot over.

    Args:
        path: The config file to read; `None` reads [`config_path`][osreditor.config.config_path].

    Returns:
        The parsed config, or an empty one.
    """
    target = config_path() if path is None else path
    try:
        raw = target.read_bytes()
    except FileNotFoundError, NotADirectoryError:
        return AppConfig()
    except OSError as error:
        logger.warning("could not read config at %s (%s); starting empty", target, error)
        return AppConfig()
    try:
        return AppConfig.model_validate(json.loads(raw))
    except (ValueError, ValidationError) as error:
        logger.warning("config at %s is malformed (%s); resetting to empty", target, error)
        return AppConfig()


def save_config(config: AppConfig, path: Path | None = None) -> None:
    """Write the app config atomically.

    Args:
        config: The config to persist.
        path: The config file to write; `None` writes [`config_path`][osreditor.config.config_path].
    """
    target = config_path() if path is None else path
    target.parent.mkdir(parents=True, exist_ok=True)
    data = (json.dumps(config.model_dump(mode="json"), ensure_ascii=False, indent=2) + "\n").encode("utf-8")
    handle, temp_name = tempfile.mkstemp(dir=target.parent, prefix=f".{target.name}.", suffix=".tmp")
    try:
        with os.fdopen(handle, "wb") as temp_file:
            temp_file.write(data)
        os.replace(temp_name, target)
    except BaseException:
        with contextlib.suppress(FileNotFoundError):
            os.unlink(temp_name)
        raise


def record_recent(config: AppConfig, entry: RecentEntry) -> AppConfig:
    """Return a config with `entry` first in the recents, deduplicated by path, capped.

    Args:
        config: The current config.
        entry: The project just opened or created.

    Returns:
        The updated config; the caller persists it with
        [`save_config`][osreditor.config.save_config].
    """
    kept = tuple(recent for recent in config.recents if recent.path != entry.path)
    return config.model_copy(update={"recents": (entry, *kept)[:MAX_RECENTS]})
