# osr-editor

A local GUI application for creating and modifying adventure modules playable by [osrlib](https://github.com/mmacy/osrlib-python)-powered games. osr-editor authors the same stamped `adventure.json` documents that [osr-forge](https://github.com/mmacy/osr-forge) produces and [osr-web](https://github.com/mmacy/osr-web) plays: a FastAPI backend that holds the working document as real osrlib model objects, serving a React frontend to the browser.

**Development status: pre-alpha.** Phase 0 of [the spec](docs/spec.md) is in place — the two-toolchain skeleton, canonical document serialization, and the locked API contracts. There is no editing UI yet.

## Requirements

- Python ≥ 3.14 and [uv](https://docs.astral.sh/uv/)
- Node.js (LTS, see `frontend/.nvmrc`) — development only; users of the published package will never need node

## Quickstart

Build the frontend once, then run the editor:

```console
cd frontend && npm ci && npm run build && cd ..
uv sync
uv run osr-editor
```

`osr-editor` serves on `http://127.0.0.1:8630` and opens your browser. Flags: `--port` to change the port, `--no-browser` to suppress the browser launch.

## Development

The dev loop runs the two halves side by side:

```console
# terminal one — the backend
uv run osr-editor --no-browser

# terminal two — the frontend with hot reload
cd frontend && npm run dev
```

Vite serves the frontend on its own port and proxies `/api` to the backend on 8630.

### The full local gauntlet

Everything CI runs, runnable locally:

```console
# backend
uv sync --locked
uv run ruff format --check
uv run ruff check
uv run pyright
uv run pytest

# frontend (from frontend/)
npm ci
npx prettier --check .
npx eslint .
npx tsc -b
npx vitest run
npm run build

# generated types (from the repo root; fails CI on drift)
uv run scripts/generate_types.py

# end to end (from frontend/, after npm run build)
npx playwright test
```

### Type generation

TypeScript types in `frontend/src/types/generated/` are generated from the pydantic models by `uv run scripts/generate_types.py`. Never hand-edit them; CI regenerates and fails on drift.

### Working against unreleased sibling checkouts

Dependencies resolve from PyPI. When a phase needs unreleased osrlib or osr-forge surface, flip the dependency to an editable path source in `pyproject.toml` for the duration:

```toml
[tool.uv.sources]
osrlib = { path = "../osrlib-python", editable = true }
```

Revert before merging — CI resolves `uv sync --locked` from PyPI.

## License

MIT. osr-editor ships no game content — osrlib carries the OGL data. Modules you author or convert are yours and stay in your project directories.
