"""Path entry: tilde expansion and the read-only directory browsing the pickers walk.

Two jobs, both about how a user *names* a path rather than how the editor stores
one. Neither goes through [`ProjectStore`][osreditor.store.ProjectStore], and
that is deliberate: the store abstracts a project's artifacts, keyed by an opaque
project id, and a path the user is still typing is not an artifact of any
project. Export already writes to arbitrary user-chosen destinations and the
geometry importers already read from them; browsing is the same honestly-local
posture, one step earlier in the same conversation.

Browsing never raises for a path that is missing: a picker is a navigation aid,
not a validator, so an unreachable path resolves to its nearest existing ancestor
and the listing says where it landed. The routes that actually *use* a path keep
their own typed refusals, which is where "no such directory" belongs.
"""

import os
from pathlib import Path

from pydantic import BaseModel, ConfigDict

from osreditor.documents import ADVENTURE_ARTIFACT, RUN_ARTIFACT, ProjectType
from osreditor.errors import PathNotReadableError
from osreditor.projects import classify_artifact_names

__all__ = [
    "DirectoryEntry",
    "DirectoryListing",
    "browse_directory",
    "display_path",
    "expand_user_path",
]


def expand_user_path(value: str) -> str:
    """Expand a leading `~` and strip surrounding whitespace.

    The single expansion point: every request model that names a filesystem path
    runs its value through here before the absolute-path check, so `~/adventures`
    is a first-class way to say a path in every dialog, the CLI's `PATH`
    argument, and the conversion lookup's query string alike.

    Whitespace is stripped because paths arrive pasted, and a trailing newline is
    a far more common accident than a filename that genuinely ends in a space.
    An unknown user (`~nobody/x`) is left exactly as it came — `expanduser` has
    nothing to expand it to, and the caller's absolute-path check then refuses it
    with the string the user typed.

    Args:
        value: The path as the user wrote it.

    Returns:
        The expanded, stripped path.

    Examples:
        ```python
        expand_user_path("~/adventures/mill.osr")  # "/Users/you/adventures/mill.osr"
        expand_user_path("  /tmp/x  ")  # "/tmp/x"
        ```
    """
    return os.path.expanduser(value.strip())


def display_path(path: Path, home: Path | None = None) -> str:
    """Render a path for display, shortening the home directory back to `~`.

    The inverse of [`expand_user_path`][osreditor.filesystem.expand_user_path],
    and the reason the pickers can hand a field `~/adventures/mill.osr` rather
    than a path carrying the account name: what comes back is a path the backend
    accepts verbatim.

    Args:
        path: The absolute path to render.
        home: The home directory; `None` reads the current user's.

    Returns:
        The path with a leading home directory replaced by `~`, or unchanged
        when it lies outside home.
    """
    root = Path.home() if home is None else home
    if path == root:
        return "~"
    if path.is_relative_to(root):
        return f"~/{path.relative_to(root).as_posix()}"
    return path.as_posix()


class DirectoryEntry(BaseModel):
    """One child of a browsed directory."""

    model_config = ConfigDict(frozen=True)

    name: str
    path: str
    display_path: str
    is_directory: bool
    project_type: ProjectType | None = None


class DirectoryListing(BaseModel):
    """One directory's children, plus where the picker is and where it can go.

    `path` is where the browse actually landed, which is not always what was
    asked for: a file lists its parent, and a path that does not exist lists its
    nearest existing ancestor.
    """

    model_config = ConfigDict(frozen=True)

    path: str
    display_path: str
    parent: str | None
    home: str
    entries: tuple[DirectoryEntry, ...]


def _nearest_existing_directory(path: Path) -> Path:
    """Walk up to the first existing directory at or above `path`.

    Args:
        path: The requested path, absolute.

    Returns:
        `path` when it is a directory, its parent when it is a file, and
        otherwise the closest existing ancestor — the filesystem root at worst.
    """
    for candidate in (path, *path.parents):
        if candidate.is_dir():
            return candidate
    return Path(path.anchor or "/")


def _probe_project_type(directory: Path) -> ProjectType | None:
    """Probe one directory for the project marker artifacts.

    Args:
        directory: The directory to probe.

    Returns:
        Its project type, or `None` for an ordinary directory or one that cannot
        be read (a marker that cannot be seen is a marker that is not there).
    """
    markers: set[str] = set()
    for name in (RUN_ARTIFACT, ADVENTURE_ARTIFACT):
        try:
            if (directory / name).is_file():
                markers.add(name)
        except OSError:
            return None
    return classify_artifact_names(markers)


def _entry(child: Path, home: Path) -> DirectoryEntry | None:
    """Build one listing entry, or `None` for a child that cannot be described.

    Args:
        child: The child path.
        home: The home directory, for the display form.

    Returns:
        The entry, or `None` when stat fails — a broken symlink or a race with a
        delete drops out of the listing rather than failing the whole browse.
    """
    try:
        is_directory = child.is_dir()
    except OSError:
        return None
    return DirectoryEntry(
        name=child.name,
        path=child.as_posix(),
        display_path=display_path(child, home),
        is_directory=is_directory,
        project_type=_probe_project_type(child) if is_directory else None,
    )


def browse_directory(path: str | None = None, show_hidden: bool = False, home: Path | None = None) -> DirectoryListing:
    """List a directory for the path pickers.

    Read-only and forgiving by design: `path` may name a file (its parent is
    listed), a directory that does not exist yet (the nearest existing ancestor
    is listed), or nothing at all (home). Only a directory that exists and
    refuses to be read is an error, because that one the user cannot fix by
    navigating.

    Args:
        path: Where to browse; `~` is expanded, and `None` means home.
        show_hidden: Whether to include dot-entries.
        home: The home directory; `None` reads the current user's.

    Returns:
        The listing: directories first, then files, each group sorted
        case-insensitively by name.

    Raises:
        PathNotReadableError: If the resolved directory cannot be listed.
    """
    root = Path.home() if home is None else home
    requested = Path(expand_user_path(path)) if path else root
    if not requested.is_absolute():
        requested = root / requested
    resolved = _nearest_existing_directory(requested)
    try:
        children = list(resolved.iterdir())
    except OSError as error:
        raise PathNotReadableError(f"cannot read the directory {resolved}") from error
    entries: list[DirectoryEntry] = []
    for child in children:
        if not show_hidden and child.name.startswith("."):
            continue
        entry = _entry(child, root)
        if entry is not None:
            entries.append(entry)
    entries.sort(key=lambda item: (not item.is_directory, item.name.casefold()))
    parent = resolved.parent
    return DirectoryListing(
        path=resolved.as_posix(),
        display_path=display_path(resolved, root),
        parent=None if parent == resolved else parent.as_posix(),
        home=root.as_posix(),
        entries=tuple(entries),
    )
