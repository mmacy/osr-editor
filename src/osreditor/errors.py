"""The osr-editor exception hierarchy.

The family rule, adopted verbatim from osrlib and osr-forge: programmer misuse
raises stdlib `ValueError`/`TypeError`; the typed hierarchy below is for runtime
failures of the work itself. The hierarchy grows additively — later phases add
their members under [`OsrEditorError`][osreditor.errors.OsrEditorError].
"""

__all__ = [
    "ArtifactNotFoundError",
    "DocumentPayloadInvalidError",
    "ForgeOverrideInvalidError",
    "ForgePageNotFoundError",
    "ForgeRerunInvalidError",
    "ForgeWorkdirIncompleteError",
    "ForgeWorkdirInvalidError",
    "ImportSourceInvalidError",
    "ImporterNotFoundError",
    "InvalidProjectError",
    "NotAForgeProjectError",
    "OpInvariantError",
    "OpRejectedError",
    "OpTargetNotFoundError",
    "OpUnsupportedForgeError",
    "OsrEditorError",
    "OsrWebCheckoutInvalidError",
    "OsrWebNotConfiguredError",
    "ProjectExistsError",
    "ProjectNotFoundError",
    "ProjectPathNotFoundError",
    "PublishBlockedError",
    "PublishDestinationExistsError",
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


class ForgeWorkdirInvalidError(OsrEditorError):
    """A forge workdir cannot be opened: `run.json` does not parse, or a stage cache is missing or stale.

    Carries forge's own message verbatim when the failure is forge's — the
    editor never paraphrases the entry-naming, remedy-bearing messages forge
    writes by design.
    """


class ForgeWorkdirIncompleteError(OsrEditorError):
    """A forge workdir's monsters stage is not `completed`, so it cannot be assembled.

    The message names the pending or failed stage; the remedy points at the CLI
    `osrforge rerun <stage>` until phase 6 makes resume graphical.
    """


class ForgeOverrideInvalidError(OsrEditorError):
    """A workdir's `overrides.yaml` cannot be loaded or applied.

    Covers the full `load_overrides` failure set (an `OverrideError` naming an
    entry, the contract's `ValidationError`, a `yaml.YAMLError`) and every
    applying `OverrideError` — all with forge's own message verbatim.
    """


class ForgeRerunInvalidError(OsrEditorError):
    """A forge `rerun` refused: a knob→owning-stage drift, a stage precondition, a missing cache.

    Every `ValueError` from `rerun` maps here with its message verbatim — the
    guard's message already carries its remedy, and the editor never
    discriminates forge's errors by message-sniffing.
    """


class OpUnsupportedForgeError(OsrEditorError):
    """A batch names an op with no override kind — blocked in a forge project, with the detach offer.

    Attributes:
        op: The op's discriminator code.
        address: The op's target address in the diagnostics address grammar,
            or `None` when the op is not address-scoped.
    """

    def __init__(self, message: str, *, op: str, address: str | None) -> None:
        """Build the error.

        Args:
            message: What is blocked and why.
            op: The op's discriminator code.
            address: The op's target address, or `None`.
        """
        super().__init__(message)
        self.op = op
        self.address = address


class ForgePageNotFoundError(OsrEditorError):
    """A requested source page or level preview is absent from the workdir.

    Normal for a licensed subset or a lean workdir — a page a conversion never
    captured, or a preview for a level forge did not render.
    """


class NotAForgeProjectError(OsrEditorError):
    """A forge-only route was called on a native project — a client bug the seam guards."""


class OsrWebNotConfiguredError(OsrEditorError):
    """Publish was requested with no osr-web checkout configured and none in the request."""


class OsrWebCheckoutInvalidError(OsrEditorError):
    """The checkout path fails the shape test: not a directory containing `adventures/`."""


class PublishBlockedError(OsrEditorError):
    """Publish was requested while the validation tier is non-empty.

    Attributes:
        findings: The blocking findings, serialized — the dialog renders them
            with the diagnostics panel's own click-to-navigate rows.
    """

    def __init__(self, message: str, *, findings: list[dict[str, object]]) -> None:
        """Build the error.

        Args:
            message: What went wrong.
            findings: The blocking findings, serialized.
        """
        super().__init__(message)
        self.findings = findings


class PublishDestinationExistsError(OsrEditorError):
    """The publish destination is occupied and the request did not set overwrite.

    Also raised *with* overwrite when the occupant is a real (non-symlink)
    directory: that is somebody's content, and the editor never removes it.
    """


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
