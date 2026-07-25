"""Record the prose-assistant fixtures against a live provider.

Run deliberately, with `OSRFORGE_FOUNDRY_*` set, to (re)record the committed
prose fixtures a live model produces:

    uv run python scripts/record_prose_fixtures.py

It wraps the resolved live provider in forge's `RecordingProvider` and drives the
*same* `build_*_prose_request` path the route uses, over the *same* scenario
`tests/generate_prose_fixtures.py` builds (a native "Stocking demo" project with a
blank area 1, and the default empty hooks — keep the two in step). Because the
fixtures key off the request fingerprint, this overwrites the committed
stub-recorded fixtures in place with real model prose — the key does not move. CI
never runs this; it replays the committed fixtures through `FixtureProvider` with
zero network. A prompt, schema, or facts-assembly change moves the fingerprint and
strands the old fixtures (`FixtureMissError` names the miss); re-recording is the
remedy.
"""

import tempfile
from pathlib import Path

from osrforge.providers.fixtures import RecordingProvider
from osrlib.crawl.adventure import Adventure

from osreditor.aids import (
    build_area_facts,
    build_area_prose_request,
    build_hooks_facts,
    build_hooks_prose_request,
)
from osreditor.documents import DocumentService
from osreditor.forge import build_provider
from osreditor.ops import OpBatch
from osreditor.projects import create_native_project, open_project
from osreditor.providers import ProviderSessionSettings, resolve_provider
from osreditor.store import LocalProjectStore

PROSE_DIR = Path(__file__).resolve().parent.parent / "tests" / "assets" / "prose"


def _milestone_adventure(workspace: Path) -> Adventure:
    """The starter "Stocking demo" native project plus a blank area 1 — the e2e's scenario."""
    store = LocalProjectStore()
    service = DocumentService(store)
    project_dir = workspace / "stocking-demo.osr"
    create_native_project(store, str(project_dir), "Stocking demo")
    project = open_project(service, project_dir)
    service.apply_batch(
        project,
        OpBatch.model_validate(
            {
                "revision": project.revision,
                "ops": [
                    {
                        "op": "create_area",
                        "dungeon_id": "dungeon-1",
                        "level_number": 1,
                        "area_id": "1",
                        "cells": [[0, 0]],
                    }
                ],
            }
        ),
    )
    return project.adventure


def main() -> None:
    """Record the area-description and hooks fixtures through the live provider."""
    provider = build_provider(resolve_provider(ProviderSessionSettings()))
    recorder = RecordingProvider(provider, PROSE_DIR)
    with tempfile.TemporaryDirectory() as workspace:
        adventure = _milestone_adventure(Path(workspace))
    recorder.generate(build_area_prose_request(build_area_facts(adventure, "dungeon-1", 1, "1")))
    recorder.generate(build_hooks_prose_request(build_hooks_facts(adventure)))
    print(f"recorded the area-description and hooks fixtures into {PROSE_DIR}")


if __name__ == "__main__":
    main()
