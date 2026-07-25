"""Generate the committed prose fixtures the e2e milestone replays — deterministically.

CI has no live provider, so the committed prose fixtures are recorded here through
forge's own `RecordingProvider` over a *stub* that returns fixed, plausible prose.
The fixtures key off the request fingerprint, so `scripts/record_prose_fixtures.py`
(a live provider) overwrites them in place with real model prose without moving the
key. Run on a deliberate change to the prompts, schema, or facts assembly:

    uv run python tests/generate_prose_fixtures.py

The scenario mirrors the e2e milestone exactly — a native "Stocking demo" project
with a blank area "99" and the default (empty) hooks — so the requests the running
editor builds match these fingerprints byte for byte.
"""

import tempfile
from pathlib import Path

from osrforge.contracts.run import TokenUsage
from osrforge.providers.base import ModelRequest, ModelResponse
from osrforge.providers.fixtures import RecordingProvider
from osrlib.crawl.adventure import Adventure

from osreditor.aids import (
    build_area_facts,
    build_area_prose_request,
    build_hooks_facts,
    build_hooks_prose_request,
)
from osreditor.documents import DocumentService
from osreditor.projects import create_native_project, open_project
from osreditor.store import LocalProjectStore

REPO = Path(__file__).resolve().parent.parent
PROSE_DIR = REPO / "tests" / "assets" / "prose"

_AREA_DRAFT = (
    "A low, close room, the air stale with dust and old smoke. Something has nested "
    "in the far corner, and small bones crunch underfoot as you cross the threshold."
)
_HOOKS_DRAFT = [
    "A miller's widow will pay in silver for word of what became of her husband.",
    "Lights have been seen at night among the ruined mill on the moor.",
]


class _Stub:
    """A fixed inner provider so RecordingProvider writes deterministic committed fixtures."""

    def __init__(self, data: object) -> None:
        self.data = data

    def generate(self, request: ModelRequest) -> ModelResponse:
        return ModelResponse(
            data=self.data, usage=TokenUsage(input_tokens=180, output_tokens=64), model_id="fixture-prose-1"
        )


def _milestone_adventure(workspace: Path) -> Adventure:
    """The exact document state the e2e milestone drafts prose against — the real
    starter native project plus one blank area, so the facts match the running editor's."""
    store = LocalProjectStore()
    service = DocumentService(store)
    project_dir = workspace / "stocking-demo.osr"
    create_native_project(store, str(project_dir), "Stocking demo")
    project = open_project(service, project_dir)
    result = service.apply_batch(
        project,
        _create_area_batch(project.revision),
    )
    assert result.revision  # the area landed
    return project.adventure


def _create_area_batch(revision: str):
    from osreditor.ops import OpBatch

    return OpBatch.model_validate(
        {
            "revision": revision,
            "ops": [
                {"op": "create_area", "dungeon_id": "dungeon-1", "level_number": 1, "area_id": "1", "cells": [[0, 0]]}
            ],
        }
    )


def main() -> None:
    """Record the committed area-description and hooks fixtures."""
    PROSE_DIR.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory() as workspace:
        adventure = _milestone_adventure(Path(workspace))
    RecordingProvider(_Stub({"description": _AREA_DRAFT}), PROSE_DIR).generate(
        build_area_prose_request(build_area_facts(adventure, "dungeon-1", 1, "1"))
    )
    RecordingProvider(_Stub({"hooks": _HOOKS_DRAFT}), PROSE_DIR).generate(
        build_hooks_prose_request(build_hooks_facts(adventure))
    )
    for path in sorted(PROSE_DIR.glob("*.json")):
        print(f"wrote {path.relative_to(REPO)}")


if __name__ == "__main__":
    main()
