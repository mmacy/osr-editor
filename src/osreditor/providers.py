"""The editor-side provider configuration: environment detection, session overrides, the merged config.

The spec's posture, mechanically: *provider credentials come from the
environment; editor config never stores them*. Session values live in
[`ProviderSessionStore`][osreditor.providers.ProviderSessionStore] on
`app.state` and nowhere else — the config file schema does not grow, and no
response model carries key bytes.

The three `OSRFORGE_FOUNDRY_*` names are editor-owned constants here rather
than imports: forge exposes them only as private module constants
(`_ENDPOINT_ENV` and kin), its documented public mapping is the three names
themselves, and its own `from_env` raises on a missing variable instead of
reporting per-field sources — which is exactly what a settings dialog needs.
Detecting configuration is therefore the editor's job, and the seam rule stays
intact: nothing here imports forge.
"""

import os
import threading
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Literal

from pydantic import BaseModel, ConfigDict

__all__ = [
    "API_KEY_ENV",
    "DEPLOYMENT_ENV",
    "ENDPOINT_ENV",
    "EffectiveProvider",
    "FieldSource",
    "ProviderFieldStatus",
    "ProviderKind",
    "ProviderSessionSettings",
    "ProviderSessionStore",
    "ProviderSettingsRequest",
    "ProviderStatus",
    "ResolvedField",
    "resolve_provider",
]

ENDPOINT_ENV = "OSRFORGE_FOUNDRY_ENDPOINT"
"""The Foundry endpoint variable the forge CLI reads."""

DEPLOYMENT_ENV = "OSRFORGE_FOUNDRY_DEPLOYMENT"
"""The Foundry deployment variable the forge CLI reads."""

API_KEY_ENV = "OSRFORGE_FOUNDRY_API_KEY"
"""The Foundry key variable; absent means Entra ID auth is inferred."""

ProviderKind = Literal["foundry", "fixtures"]
"""Which provider to build.

`fixtures` is typed API surface, not dialog UI: forge built `FixtureProvider`
for "unit tests, CI, and host-app integration tests", and the editor's
Playwright suite is its consumer, setting it through the same typed route the
dialog uses. The dialog renders the Foundry fields only — no end-user
affordance exists for a kind no end user holds recordings for.
"""

FieldSource = Literal["env", "session"]
"""Where a resolved field's value came from."""


class ProviderSessionSettings(BaseModel):
    """The in-memory session overrides — every field optional, none ever persisted."""

    model_config = ConfigDict(frozen=True)

    kind: ProviderKind | None = None
    endpoint: str | None = None
    deployment: str | None = None
    api_key: str | None = None
    fixtures_dir: str | None = None


class ProviderSettingsRequest(BaseModel):
    """A set-or-clear request over the session settings.

    Three-state per field, read off `model_fields_set`: an absent field is left
    alone, an explicit `null` clears the session override (falling back to the
    environment), and a value sets it.
    """

    model_config = ConfigDict(frozen=True)

    kind: ProviderKind | None = None
    endpoint: str | None = None
    deployment: str | None = None
    api_key: str | None = None
    fixtures_dir: str | None = None


class ProviderFieldStatus(BaseModel):
    """One configured field: its value and where that value came from."""

    model_config = ConfigDict(frozen=True)

    value: str | None = None
    source: FieldSource | None = None


class ProviderStatus(BaseModel):
    """What `GET /api/provider` answers — presence and provenance, never a secret.

    `api_key_present` and `api_key_source` are the whole truth this surface
    tells about the key: the bytes never leave the process, and the type-level
    suite pins that no field named `api_key` exists here at all.
    """

    model_config = ConfigDict(frozen=True)

    kind: ProviderKind
    endpoint: ProviderFieldStatus
    deployment: ProviderFieldStatus
    api_key_present: bool
    api_key_source: FieldSource | None
    entra_available: bool
    configured: bool
    fixtures_dir: ProviderFieldStatus


@dataclass(frozen=True)
class ResolvedField:
    """One merged field: the winning value and the source it won from."""

    value: str | None
    source: FieldSource | None


@dataclass(frozen=True)
class EffectiveProvider:
    """The merged provider configuration a provider is built from."""

    kind: ProviderKind
    endpoint: ResolvedField
    deployment: ResolvedField
    api_key: ResolvedField
    fixtures_dir: ResolvedField


class ProviderSessionStore:
    """The session's provider overrides, held in memory for the process lifetime.

    Lives on `app.state`. Updates are read-modify-write over a frozen model, so
    they run under a lock — sync endpoints run in FastAPI's threadpool and two
    dialogs could submit at once.
    """

    def __init__(self) -> None:
        """Start with no overrides at all — the environment alone."""
        self._lock = threading.Lock()
        self._settings = ProviderSessionSettings()

    @property
    def settings(self) -> ProviderSessionSettings:
        """The current session overrides."""
        with self._lock:
            return self._settings

    def update(self, request: ProviderSettingsRequest) -> ProviderSessionSettings:
        """Apply a set-or-clear request, answering the new session settings.

        Args:
            request: The fields to set or clear; unmentioned fields are kept.

        Returns:
            The new session settings.
        """
        changes = {name: getattr(request, name) for name in request.model_fields_set}
        with self._lock:
            self._settings = self._settings.model_copy(update=changes)
            return self._settings


def _from_env(environ: Mapping[str, str], name: str) -> str | None:
    """Read one variable, treating empty as absent — forge's own `from_env` reading."""
    return environ.get(name) or None


def _merge(session_value: str | None, env_value: str | None) -> ResolvedField:
    """Field-wise merge: a session value wins over its environment counterpart."""
    if session_value:
        return ResolvedField(value=session_value, source="session")
    if env_value:
        return ResolvedField(value=env_value, source="env")
    return ResolvedField(value=None, source=None)


def resolve_provider(session: ProviderSessionSettings, environ: Mapping[str, str] | None = None) -> EffectiveProvider:
    """Merge the session overrides over the environment.

    Args:
        session: The session overrides.
        environ: The environment to read; `None` reads `os.environ`.

    Returns:
        The effective configuration, each field carrying its source.
    """
    env = os.environ if environ is None else environ
    return EffectiveProvider(
        kind=session.kind or "foundry",
        endpoint=_merge(session.endpoint, _from_env(env, ENDPOINT_ENV)),
        deployment=_merge(session.deployment, _from_env(env, DEPLOYMENT_ENV)),
        api_key=_merge(session.api_key, _from_env(env, API_KEY_ENV)),
        # No environment counterpart: the fixtures kind is typed test surface,
        # and its directory only ever arrives through the provider route.
        fixtures_dir=_merge(session.fixtures_dir, None),
    )
