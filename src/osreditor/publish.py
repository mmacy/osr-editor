"""Publish into an osr-web checkout: the shape test, the destination write, the collision rules.

Publish is honestly local, like export: a symlink into a user checkout is the
single-user posture, and a hosted future replaces the one route handler that
calls in here. The destination write is the licensing rule's explicit
user-invoked exception — publish writes nothing inside the project itself.

osr-web's discovery rules (verified against its `server/library.py`): the
checkout's `adventures/` directory is rescanned per request, accepting both
`adventures/<name>.json` files and `adventures/<name>/adventure.json`
directories, symlinks followed, entries deduplicated by content digest. Both
published forms therefore work, and the `editor.json` sidecar riding inside a
symlinked project directory is invisible to osr-web — for a child directory it
reads only `adventure.json`.
"""

import os
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, ConfigDict

from osreditor.errors import OsrWebCheckoutInvalidError, PublishDestinationExistsError
from osreditor.store import atomic_write_bytes

__all__ = [
    "PublishMode",
    "PublishResult",
    "check_osr_web_checkout",
    "publish_adventure",
]

PublishMode = Literal["symlink", "copy"]


class PublishResult(BaseModel):
    """Where the adventure was published, and how."""

    model_config = ConfigDict(frozen=True)

    path: str
    mode: PublishMode


def check_osr_web_checkout(path: Path) -> None:
    """Run the shape test: the checkout must be a directory containing `adventures/`.

    `adventures/` is osr-web's discovery root — presence is the entire gate,
    matching the phase 1 posture of classifying by shape, never loadability.

    Args:
        path: The claimed checkout path.

    Raises:
        OsrWebCheckoutInvalidError: If the path is not a directory or has no
            `adventures/` directory.
    """
    if not path.is_dir():
        raise OsrWebCheckoutInvalidError(f"{path} is not a directory")
    if not (path / "adventures").is_dir():
        raise OsrWebCheckoutInvalidError(f"{path} is not an osr-web checkout: it has no adventures/ directory")


def _occupied(candidate: Path) -> bool:
    """Report whether anything occupies a candidate path — a broken symlink included."""
    return candidate.is_symlink() or candidate.exists()


def _clear(candidate: Path) -> None:
    """Remove an occupant ahead of an overwrite — but never a real directory.

    A non-symlink directory is somebody's content (a forge output dir, another
    tool's work); the editor refuses to remove it, with the path named.
    """
    if candidate.is_symlink():
        candidate.unlink()
        return
    if candidate.is_dir():
        raise PublishDestinationExistsError(
            f"{candidate} is a directory the editor will not remove — remove it yourself to publish over it"
        )
    candidate.unlink()


def publish_adventure(
    *,
    checkout: Path,
    project_path: Path,
    document: bytes,
    name: str,
    mode: PublishMode,
    overwrite: bool,
) -> PublishResult:
    """Write one published entry into a checkout's `adventures/` directory.

    Symlink mode links `adventures/<name>` to the project directory, so every
    always-saved commit republishes live; copy mode writes the document bytes
    to `adventures/<name>.json`, a point-in-time snapshot. Both candidate forms
    are probed for collisions, and an overwrite clears *both* before writing
    the requested one — a mode switch must not leave the other form behind, or
    osr-web's digest-deduped scan would list a stale snapshot beside the live
    entry the moment their bytes diverge.

    Args:
        checkout: The osr-web checkout (already shape-tested).
        project_path: The resolved project directory (the symlink target).
        document: The current document's stamped bytes (the copy payload).
        name: The entry name — a plain path component, request-validated.
        mode: `"symlink"` or `"copy"`.
        overwrite: Whether existing occupants may be cleared.

    Returns:
        The published path and mode.

    Raises:
        PublishDestinationExistsError: If a candidate form is occupied and
            `overwrite` is unset, or an occupant is a real directory (never
            removed, even with `overwrite`).
    """
    adventures = checkout / "adventures"
    dir_form = adventures / name
    file_form = adventures / f"{name}.json"
    already_linked = dir_form.is_symlink() and dir_form.resolve() == project_path
    if mode == "symlink" and already_linked and not _occupied(file_form):
        # Re-publishing onto a symlink already resolving to this project is
        # idempotent success — nothing to change, no overwrite required.
        return PublishResult(path=str(dir_form), mode=mode)
    occupants = [candidate for candidate in (dir_form, file_form) if _occupied(candidate)]
    if occupants and not overwrite:
        occupied = ", ".join(str(candidate) for candidate in occupants)
        raise PublishDestinationExistsError(f"the destination is occupied: {occupied}")
    for candidate in occupants:
        _clear(candidate)
    if mode == "symlink":
        os.symlink(project_path, dir_form, target_is_directory=True)
        return PublishResult(path=str(dir_form), mode=mode)
    atomic_write_bytes(file_form, document)
    return PublishResult(path=str(file_form), mode=mode)
