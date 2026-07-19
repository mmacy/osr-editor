# osr-editor

A local GUI application for creating and modifying adventure modules playable by [osrlib](https://github.com/mmacy/osrlib-python)-powered games. osr-editor authors the same stamped `adventure.json` documents that [osr-forge](https://github.com/mmacy/osr-forge) produces and [osr-web](https://github.com/mmacy/osr-web) plays: a FastAPI backend that holds the working document as real osrlib model objects, serving a React frontend to the browser.

**Development status: pre-alpha.** Phases 0–2 of [the spec](docs/spec.md) are in place — the two-toolchain skeleton, canonical document serialization, the locked API contracts, the project/prose surface (create and open native projects, edit adventure and town prose with undo/redo, live content validation, export), and the map editor: a graph-paper canvas with the full geometry tool set (rooms, corridors, walls and doors in every state, areas, entrance, transitions with auto-reciprocal stairs), multi-level and multi-dungeon management, live structural lint rendered on the map with click-to-navigate diagnostics, and geometry import through the `GeometryImporter` plugin seam (import-from-project ships built in). Keyed content, the monster editor, and forge-backed review arrive in later phases.

### The map tools

On a level's map: **select** (V) inspects anything — areas, door edges, transitions; **room** (R) drags a rectangle into a keyed area with opened interior edges; **corridor** (C) opens passages along a dragged path; **wall/door** (W) click-cycles an edge wall → open → door and drags to paint (the door inspector sets normal/secret, stuck, locked, starts open); **area** (A) paints cells into the selected area or a new one; **entrance** (E) places the level entrance; **transition** (T) places stairs, trapdoors, and chutes with a target-level picker — stairs offer reciprocal creation in the same undo step. Pan with space-drag or middle-drag, zoom with the wheel, reset to 100% with `0`. Delete removes the selection; Esc cancels a gesture.

**Import geometry** (in the map chrome) brings a level in from another project — or any format with an installed importer plugin: importers register through the `osreditor.importers` entry-point group and land their geometry as one ordinary, undoable op batch.

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

`osr-editor` serves on `http://127.0.0.1:8630` and opens your browser to the home screen. Pass a project directory to open it straight away — `osr-editor ~/adventures/mill.osr` — or use the home screen's recents, new-adventure, and open-by-path entries. Flags: `--port` to change the port, `--no-browser` to suppress the browser launch.

App config (the recents list) lives at `platformdirs.user_config_path("osr-editor")/config.json` — for example `~/Library/Application Support/osr-editor/config.json` on macOS or `~/.config/osr-editor/config.json` on Linux. It is a convenience cache; deleting it only clears the recents.

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
npx tsc -p ../tests/e2e
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
