"""Provider configuration: the merge matrix, status probing, and provider construction."""

from pathlib import Path

import pytest
from osrforge.errors import ProviderError
from osrforge.providers.fixtures import FixtureProvider
from osrforge.providers.foundry import FoundryProvider

import osreditor.forge as forge_bridge
from osreditor.errors import ProviderNotConfiguredError
from osreditor.forge import build_provider, provider_status
from osreditor.providers import (
    API_KEY_ENV,
    DEPLOYMENT_ENV,
    ENDPOINT_ENV,
    ProviderSessionSettings,
    ProviderSessionStore,
    ProviderSettingsRequest,
    resolve_provider,
)

ENV = {
    ENDPOINT_ENV: "https://env.example.invalid/",
    DEPLOYMENT_ENV: "env-deployment",
    API_KEY_ENV: "env-key",
}


def request(**fields: object) -> ProviderSettingsRequest:
    return ProviderSettingsRequest.model_validate(fields)


# --- the merge matrix ---------------------------------------------------------


def test_environment_alone_resolves_with_env_sources() -> None:
    effective = resolve_provider(ProviderSessionSettings(), ENV)
    assert effective.kind == "foundry"
    assert (effective.endpoint.value, effective.endpoint.source) == (ENV[ENDPOINT_ENV], "env")
    assert (effective.deployment.value, effective.deployment.source) == ("env-deployment", "env")
    assert (effective.api_key.value, effective.api_key.source) == ("env-key", "env")


def test_session_alone_resolves_with_session_sources() -> None:
    session = ProviderSessionSettings(endpoint="https://session.example.invalid/", deployment="session-deployment")
    effective = resolve_provider(session, {})
    assert (effective.endpoint.value, effective.endpoint.source) == ("https://session.example.invalid/", "session")
    assert (effective.deployment.value, effective.deployment.source) == ("session-deployment", "session")
    assert effective.api_key == effective.api_key.__class__(value=None, source=None)


def test_session_wins_field_by_field_over_the_environment() -> None:
    effective = resolve_provider(ProviderSessionSettings(deployment="session-deployment"), ENV)
    # Only the overridden field moves; its neighbours keep the environment.
    assert (effective.deployment.value, effective.deployment.source) == ("session-deployment", "session")
    assert (effective.endpoint.value, effective.endpoint.source) == (ENV[ENDPOINT_ENV], "env")
    assert (effective.api_key.value, effective.api_key.source) == ("env-key", "env")


def test_an_empty_environment_variable_reads_as_absent() -> None:
    effective = resolve_provider(ProviderSessionSettings(), {**ENV, ENDPOINT_ENV: ""})
    assert effective.endpoint.value is None
    assert effective.endpoint.source is None


def test_fixtures_dir_has_no_environment_counterpart() -> None:
    effective = resolve_provider(ProviderSessionSettings(kind="fixtures", fixtures_dir="/tmp/fx"), ENV)
    assert effective.kind == "fixtures"
    assert (effective.fixtures_dir.value, effective.fixtures_dir.source) == ("/tmp/fx", "session")


# --- the session store --------------------------------------------------------


def test_the_session_store_sets_clears_and_keeps_unmentioned_fields() -> None:
    store = ProviderSessionStore()
    store.update(request(endpoint="https://a.example.invalid/", api_key="secret"))
    assert store.settings.endpoint == "https://a.example.invalid/"
    # An unmentioned field is untouched...
    store.update(request(deployment="d"))
    assert store.settings.endpoint == "https://a.example.invalid/"
    assert store.settings.api_key == "secret"
    # ...and an explicit null clears, falling back to the environment.
    store.update(request(api_key=None))
    assert store.settings.api_key is None
    assert resolve_provider(store.settings, ENV).api_key.source == "env"


# --- status probing -----------------------------------------------------------


def test_status_reports_key_presence_and_source_but_never_the_key(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(forge_bridge, "entra_available", lambda: False)
    status = provider_status(resolve_provider(ProviderSessionSettings(api_key="session-secret"), ENV))
    assert status.api_key_present is True
    assert status.api_key_source == "session"
    dumped = status.model_dump(mode="json")
    assert "api_key" not in dumped
    assert "session-secret" not in repr(dumped)


@pytest.mark.parametrize(
    ("session", "env", "entra", "configured"),
    [
        (ProviderSessionSettings(), ENV, False, True),  # endpoint + deployment + key
        (ProviderSessionSettings(), {k: v for k, v in ENV.items() if k != API_KEY_ENV}, True, True),  # Entra path
        (ProviderSessionSettings(), {k: v for k, v in ENV.items() if k != API_KEY_ENV}, False, False),  # no auth
        (ProviderSessionSettings(), {ENDPOINT_ENV: ENV[ENDPOINT_ENV]}, True, False),  # no deployment
        (ProviderSessionSettings(), {}, True, False),  # nothing at all
        (ProviderSessionSettings(kind="fixtures", fixtures_dir="/tmp/fx"), {}, False, True),  # fixtures kind
        (ProviderSessionSettings(kind="fixtures"), ENV, True, False),  # fixtures without a directory
    ],
)
def test_configured_is_can_a_provider_be_built(
    monkeypatch: pytest.MonkeyPatch,
    session: ProviderSessionSettings,
    env: dict[str, str],
    entra: bool,
    configured: bool,
) -> None:
    monkeypatch.setattr(forge_bridge, "entra_available", lambda: entra)
    status = provider_status(resolve_provider(session, env))
    assert status.configured is configured
    assert status.entra_available is entra


def test_entra_availability_is_probed_not_assumed() -> None:
    # Whatever this environment holds, the probe answers a bool rather than
    # raising on a missing parent package.
    assert isinstance(forge_bridge.entra_available(), bool)


# --- building providers -------------------------------------------------------


def test_build_provider_builds_the_fixtures_provider(minimod_fixtures: Path) -> None:
    session = ProviderSessionSettings(kind="fixtures", fixtures_dir=str(minimod_fixtures))
    provider = build_provider(resolve_provider(session, {}))
    assert isinstance(provider, FixtureProvider)
    assert provider.fixture_dir == minimod_fixtures


def test_build_provider_builds_foundry_from_the_merged_config() -> None:
    provider = build_provider(resolve_provider(ProviderSessionSettings(), ENV))
    assert isinstance(provider, FoundryProvider)
    assert provider.settings.endpoint == ENV[ENDPOINT_ENV]
    assert provider.settings.deployment == "env-deployment"
    assert provider.settings.api_key == "env-key"


def test_missing_fields_name_the_field_and_both_of_its_sources() -> None:
    with pytest.raises(ProviderNotConfiguredError) as caught:
        build_provider(resolve_provider(ProviderSessionSettings(), {}))
    assert caught.value.missing == [
        {"field": "endpoint", "env": ENDPOINT_ENV},
        {"field": "deployment", "env": DEPLOYMENT_ENV},
    ]
    message = str(caught.value)
    assert ENDPOINT_ENV in message and DEPLOYMENT_ENV in message
    assert "provider settings" in message


def test_the_fixtures_kind_without_a_directory_refuses() -> None:
    with pytest.raises(ProviderNotConfiguredError) as caught:
        build_provider(resolve_provider(ProviderSessionSettings(kind="fixtures"), ENV))
    assert [entry["field"] for entry in caught.value.missing] == ["fixtures_dir"]


def test_forges_build_time_refusal_surfaces_verbatim(monkeypatch: pytest.MonkeyPatch) -> None:
    # The Entra-extra case: forge infers Entra auth from an absent key and
    # raises at client build with the remedy in the message.
    message = "Entra ID auth needs the azure-identity package — install the osr-forge[entra] extra, or set X"

    def refuse(settings: object) -> FoundryProvider:
        raise ProviderError(message)

    monkeypatch.setattr(forge_bridge, "FoundryProvider", refuse)
    session = ProviderSessionSettings()
    with pytest.raises(ProviderNotConfiguredError) as caught:
        build_provider(resolve_provider(session, {k: v for k, v in ENV.items() if k != API_KEY_ENV}))
    assert str(caught.value) == message
    assert [entry["field"] for entry in caught.value.missing] == ["api_key"]
