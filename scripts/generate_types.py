"""Generate the committed TypeScript types from the backend's OpenAPI document.

One composed document, one generated artifact, one drift gate: the script takes
`app.openapi()` (FastAPI emits OpenAPI 3.1, which embeds the JSON Schema 2020-12
dialect pydantic v2 speaks), injects the models no route references yet into
`components.schemas`, and runs the pinned openapi-typescript from `frontend/`
to write `frontend/src/types/generated/api.ts`. CI regenerates and fails on any
drift; regenerate locally with `uv run scripts/generate_types.py`.
"""

import json
import subprocess
import sys
import tempfile
from pathlib import Path

from pydantic import BaseModel
from pydantic.json_schema import models_json_schema

from osreditor.app import ApiError, create_app

REPO_ROOT = Path(__file__).resolve().parent.parent
FRONTEND_DIR = REPO_ROOT / "frontend"
OUTPUT_PATH = FRONTEND_DIR / "src" / "types" / "generated" / "api.ts"

# The models no route references yet. Nearly every phase 0 injection became
# route-referenced in phase 1 (Adventure via ProjectState, the envelope models
# via the ops routes) and left per the list's own rule — the collision check
# below enforces it. ApiError stays: it is produced only by exception handlers,
# which never enter app.openapi(), and no route declares error response models
# (per-route `responses={...}` ceremony buys nothing while the frontend parses
# one envelope generically). Injection uses serialization-mode schemas: the
# frontend consumes these shapes as server output, and serialization mode marks
# always-emitted fields required, which is the truth about documents the
# backend dumps.
INJECTED_MODELS: list[type[BaseModel]] = [
    ApiError,
]


def build_openapi_document() -> dict[str, object]:
    """Compose the route surface with the injected model schemas.

    Returns:
        The OpenAPI document with every injected model in `components.schemas`.

    Raises:
        SystemExit: On a schema-name collision between route-referenced and
            injected models (the injection list is stale — trim it).
    """
    document = create_app().openapi()
    _, definitions = models_json_schema(
        [(model, "serialization") for model in INJECTED_MODELS],
        ref_template="#/components/schemas/{model}",
    )
    components = document.setdefault("components", {})
    schemas = components.setdefault("schemas", {})
    for name, schema in sorted(definitions.get("$defs", {}).items()):
        if name in schemas:
            raise SystemExit(
                f"schema name collision on {name!r}: it is route-referenced and injected. "
                "Remove it from INJECTED_MODELS in scripts/generate_types.py."
            )
        schemas[name] = schema
    return document


def main() -> None:
    """Write the OpenAPI document to a temp file and generate the TypeScript types."""
    generator = FRONTEND_DIR / "node_modules" / ".bin" / "openapi-typescript"
    if not generator.exists():
        sys.exit("openapi-typescript is not installed; run `npm ci` in frontend/ first.")
    document = build_openapi_document()
    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile("w", suffix=".json", delete_on_close=False) as handle:
        json.dump(document, handle)
        handle.close()
        subprocess.run(
            [str(generator), handle.name, "--output", str(OUTPUT_PATH)],
            cwd=FRONTEND_DIR,
            check=True,
        )
    print(f"wrote {OUTPUT_PATH.relative_to(REPO_ROOT)}")


if __name__ == "__main__":
    main()
