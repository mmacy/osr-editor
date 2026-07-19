"""The osr-editor exception hierarchy.

The family rule, adopted verbatim from osrlib and osr-forge: programmer misuse
raises stdlib `ValueError`/`TypeError`; the typed hierarchy below is for runtime
failures of the work itself. The hierarchy grows additively — later phases add
their members under [`OsrEditorError`][osreditor.errors.OsrEditorError].
"""

__all__ = [
    "ArtifactNotFoundError",
    "DocumentPayloadInvalidError",
    "ImportSourceInvalidError",
    "ImporterNotFoundError",
    "InvalidProjectError",
    "OpInvariantError",
    "OpRejectedError",
    "OpTargetNotFoundError",
    "OsrEditorError",
    "ProjectExistsError",
    "ProjectNotFoundError",
    "ProjectPathNotFoundError",
    "ProjectTypeUnsupportedError",
    "RedoStackEmptyError",
    "StaleRevisionError",
    "UndoStackEmptyError",
]


class OsrEditorError(Exception):
    """Base class for all osr-editor exceptions."""


class ArtifactNotFoundError(OsrEditorError):
    """A project artifact requested from a store does not exist."""


class ProjectNotFoundError(OsrEditorError):
    """No open project has the requested id (typically a stale id after a server restart)."""


class ProjectPathNotFoundError(OsrEditorError):
    """The requested project path names no directory at all."""


class InvalidProjectError(OsrEditorError):
    """The directory exists but matches neither project shape."""


class ProjectTypeUnsupportedError(OsrEditorError):
    """The directory is a recognized project shape this release cannot open (a forge workdir)."""


class ProjectExistsError(OsrEditorError):
    """The create target is an existing non-empty directory."""


class StaleRevisionError(OsrEditorError):
    """A batch named a revision that is no longer current.

    Attributes:
        current_revision: The revision the client must refetch against.
    """

    def __init__(self, message: str, *, current_revision: str) -> None:
        """Build the error.

        Args:
            message: What went wrong.
            current_revision: The revision the client must refetch against.
        """
        super().__init__(message)
        self.current_revision = current_revision


class UndoStackEmptyError(OsrEditorError):
    """Undo was requested with nothing to undo."""


class RedoStackEmptyError(OsrEditorError):
    """Redo was requested with nothing to redo."""


class OpRejectedError(OsrEditorError):
    """A batch would produce an invalid model and was rejected whole.

    Attributes:
        errors: One `{"path", "message"}` entry per offending field, the path an
            RFC 6901 JSON Pointer into the adventure payload.
    """

    def __init__(self, message: str, *, errors: list[dict[str, str]]) -> None:
        """Build the error.

        Args:
            message: What went wrong.
            errors: One `{"path", "message"}` entry per offending field.
        """
        super().__init__(message)
        self.errors = errors


class OpTargetNotFoundError(OsrEditorError):
    """An op's target is not in the document.

    Covers every targeting miss in the vocabulary: an unknown dungeon, an
    unknown level, an unknown area id, or a position with no transition on it.
    """


class OpInvariantError(OsrEditorError):
    """An op violated an editor-enforced semantic invariant and was rejected at commit.

    The invariants the ops enforce ahead of re-validation: duplicate ids, an
    occupied transition cell, removing the last dungeon or level, a
    non-canonical edge key, an out-of-bounds cell, an explicit wall entry, and
    a resize that would strand existing content. The message names the
    violation.

    Attributes:
        offenders: Present only when the violation enumerates a list (the
            `ResizeLevel` rejection): one `{"address", "message"}` entry per
            stranded item, the address in the diagnostics address grammar.
    """

    def __init__(self, message: str, *, offenders: list[dict[str, str]] | None = None) -> None:
        """Build the error.

        Args:
            message: The violated invariant.
            offenders: One `{"address", "message"}` entry per stranded item,
                when the violation enumerates a list.
        """
        super().__init__(message)
        self.offenders = offenders


class ImporterNotFoundError(OsrEditorError):
    """No registered geometry importer has the requested format id."""


class ImportSourceInvalidError(OsrEditorError):
    """An importer's load could not produce geometry from the source path.

    Wraps whatever the importer raised — an unreadable path, a sniff-negative
    source, a document that fails to load — with the importer's own message.
    """


class DocumentPayloadInvalidError(OsrEditorError):
    """A document's payload failed model validation at load time.

    Typed at the load site rather than mapping `pydantic.ValidationError`
    app-wide, so an internal validation bug in some future route can never
    masquerade as a document problem.

    Attributes:
        errors: One `{"path", "message"}` entry per offending location, the
            path an RFC 6901 JSON Pointer into the payload.
    """

    def __init__(self, message: str, *, errors: list[dict[str, str]]) -> None:
        """Build the error.

        Args:
            message: What went wrong.
            errors: One `{"path", "message"}` entry per offending location.
        """
        super().__init__(message)
        self.errors = errors
