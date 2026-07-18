"""The `ProjectStore` protocol and the local filesystem store.

Persistence is a seam — forge's `ModelProvider` idea applied to storage. Every
project artifact read and write goes through
[`ProjectStore`][osreditor.store.ProjectStore]; the local filesystem store ships,
and blob or database stores are later drop-ins. No code outside this seam may
assume a local filesystem.

The surface speaks bytes, not text: byte-identity is the serialization contract,
and encoding policy belongs to `documents.py`. Artifact names are POSIX-style
relative paths (forge workdirs nest `stages/` and `pages/`). Growth is additive:
deletion arrives with the phase that needs it, workdir materialization for forge
operations with phase 5.
"""

import contextlib
import os
import tempfile
from pathlib import Path, PurePosixPath
from typing import Protocol, runtime_checkable

from osreditor.errors import ArtifactNotFoundError

__all__ = [
    "LocalProjectStore",
    "ProjectStore",
]


@runtime_checkable
class ProjectStore(Protocol):
    """Artifact persistence for projects, keyed by an opaque project id."""

    def list_artifacts(self, project_id: str) -> list[str]:
        """List a project's artifact names.

        Args:
            project_id: The project to list.

        Returns:
            Every artifact name in the project, as POSIX-style relative paths.
        """
        ...

    def read_artifact(self, project_id: str, name: str) -> bytes:
        """Read one artifact's bytes.

        Args:
            project_id: The project to read from.
            name: The artifact name, a POSIX-style relative path.

        Returns:
            The artifact's contents.

        Raises:
            ArtifactNotFoundError: If the artifact does not exist.
        """
        ...

    def write_artifact(self, project_id: str, name: str, data: bytes) -> None:
        """Write one artifact's bytes, replacing any existing artifact.

        A committed write is durable and never tears: readers see either the
        old bytes or the new, complete bytes.

        Args:
            project_id: The project to write into.
            name: The artifact name, a POSIX-style relative path.
            data: The artifact's full contents.
        """
        ...


class LocalProjectStore:
    """The shipped store: a project is a directory on the local filesystem.

    The project id *is* the absolute project directory path — a mapping decision
    owned by this store, not the protocol; a remote store maps ids however it
    likes. Writes are atomic (temp file in the target directory, then
    `os.replace`) because an always-saved editor rewrites `adventure.json`
    constantly and must never tear it.
    """

    def _artifact_path(self, project_id: str, name: str) -> Path:
        """Resolve an artifact name inside the project directory, refusing escape.

        Args:
            project_id: The absolute project directory path.
            name: The artifact name, a POSIX-style relative path.

        Returns:
            The artifact's filesystem path.

        Raises:
            ValueError: If `project_id` is not an absolute path, or `name` is
                empty, absolute, or escapes the project directory.
        """
        root = Path(project_id)
        if not root.is_absolute():
            raise ValueError(f"project id must be an absolute directory path, got {project_id!r}")
        relative = PurePosixPath(name)
        if not relative.parts:
            raise ValueError("artifact name must be non-empty")
        if relative.is_absolute() or ".." in relative.parts:
            raise ValueError(f"artifact name {name!r} escapes the project directory")
        return root.joinpath(*relative.parts)

    def list_artifacts(self, project_id: str) -> list[str]:
        """List a project's artifact names.

        Args:
            project_id: The absolute project directory path.

        Returns:
            Every file under the project directory as a sorted POSIX-style
            relative path; a directory that does not exist lists as empty (a
            project with no artifacts), and directories themselves are layout,
            not artifacts.
        """
        root = Path(project_id)
        if not root.is_absolute():
            raise ValueError(f"project id must be an absolute directory path, got {project_id!r}")
        if not root.is_dir():
            return []
        return sorted(path.relative_to(root).as_posix() for path in root.rglob("*") if path.is_file())

    def read_artifact(self, project_id: str, name: str) -> bytes:
        """Read one artifact's bytes.

        Args:
            project_id: The absolute project directory path.
            name: The artifact name, a POSIX-style relative path.

        Returns:
            The artifact's contents.

        Raises:
            ArtifactNotFoundError: If the artifact does not exist.
        """
        path = self._artifact_path(project_id, name)
        try:
            return path.read_bytes()
        except (FileNotFoundError, IsADirectoryError) as error:
            raise ArtifactNotFoundError(f"project {project_id!r} has no artifact {name!r}") from error

    def write_artifact(self, project_id: str, name: str, data: bytes) -> None:
        """Write one artifact's bytes atomically.

        The bytes land in a temp file beside the target, then `os.replace`
        moves it into place — readers see either the old artifact or the new
        one, never a torn write. Parent directories are created as needed.

        Args:
            project_id: The absolute project directory path.
            name: The artifact name, a POSIX-style relative path.
            data: The artifact's full contents.
        """
        path = self._artifact_path(project_id, name)
        path.parent.mkdir(parents=True, exist_ok=True)
        handle, temp_name = tempfile.mkstemp(dir=path.parent, prefix=f".{path.name}.", suffix=".tmp")
        try:
            with os.fdopen(handle, "wb") as temp_file:
                temp_file.write(data)
            os.replace(temp_name, path)
        except BaseException:
            with contextlib.suppress(FileNotFoundError):
                os.unlink(temp_name)
            raise
