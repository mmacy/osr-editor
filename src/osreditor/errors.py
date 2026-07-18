"""The osr-editor exception hierarchy.

The family rule, adopted verbatim from osrlib and osr-forge: programmer misuse
raises stdlib `ValueError`/`TypeError`; the typed hierarchy below is for runtime
failures of the work itself. The hierarchy grows additively — later phases add
their members under [`OsrEditorError`][osreditor.errors.OsrEditorError].
"""

__all__ = [
    "ArtifactNotFoundError",
    "OsrEditorError",
]


class OsrEditorError(Exception):
    """Base class for all osr-editor exceptions."""


class ArtifactNotFoundError(OsrEditorError):
    """A project artifact requested from a store does not exist."""
