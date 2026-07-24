"""Record the prose-assistant fixtures against a live provider.

Run deliberately, with `OSRFORGE_FOUNDRY_*` set, to (re)record the committed
prose fixtures a live model produces:

    uv run python scripts/record_prose_fixtures.py

It wraps the resolved live provider in forge's `RecordingProvider` and drives the
*same* `build_*_prose_request` path the route uses, over the committed fixture
adventures at pinned targets, writing `tests/assets/prose/`. CI never runs this —
it replays the committed fixtures through `FixtureProvider` with zero network. A
prompt, schema, or facts-assembly change moves the fingerprint and strands the
old fixtures (`FixtureMissError` names the miss); re-recording is the remedy.

The committed fixtures may be regenerated deterministically without a network by
`tests/generate_prose_fixtures.py` (a stub provider), so CI is never blocked on
credentials; this script overwrites those in place with real model prose, keyed
by the identical request fingerprint.
"""

from pathlib import Path

from osrforge.providers.fixtures import RecordingProvider

from osreditor.aids import (
    build_area_facts,
    build_area_prose_request,
    build_hooks_facts,
    build_hooks_prose_request,
)
from osreditor.documents import load_adventure
from osreditor.forge import build_provider
from osreditor.providers import ProviderSessionSettings, resolve_provider

REPO = Path(__file__).resolve().parent.parent
PROSE_DIR = REPO / "tests" / "assets" / "prose"

# The pinned recording targets: (fixture adventure, area target or None for hooks).
# Kept in step with tests/generate_prose_fixtures.py so both scripts write the
# same fingerprints.
_AREA_TARGETS: tuple[tuple[str, str, int, str], ...] = (
    ("small_module.json", "millstone-warrens", 1, "1"),
)


def main() -> None:
    """Record every pinned prose fixture through the live provider."""
    provider = build_provider(resolve_provider(ProviderSessionSettings()))
    recorder = RecordingProvider(provider, PROSE_DIR)
    for fixture_name, dungeon_id, level_number, area_id in _AREA_TARGETS:
        adventure = load_adventure((REPO / "tests" / "fixtures" / fixture_name).read_bytes())
        request = build_area_prose_request(build_area_facts(adventure, dungeon_id, level_number, area_id))
        recorder.generate(request)
        print(f"recorded {request.tag} for {fixture_name} {dungeon_id}/{level_number}/{area_id}")
    hooks_adventure = load_adventure((REPO / "tests" / "fixtures" / "small_module.json").read_bytes())
    recorder.generate(build_hooks_prose_request(build_hooks_facts(hooks_adventure)))
    print("recorded prose.hooks for small_module.json")


if __name__ == "__main__":
    main()
