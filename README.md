# osr-editor

A local GUI application for creating and modifying adventure modules playable by [osrlib](https://github.com/mmacy/osrlib-python)-powered games. osr-editor authors the same stamped `adventure.json` documents that [osr-forge](https://github.com/mmacy/osr-forge) produces and [osr-web](https://github.com/mmacy/osr-web) plays: a FastAPI backend that holds the working document as real osrlib model objects, serving a React frontend to the browser.

**[Documentation](https://mmacy.github.io/osr-editor/)** · **[PyPI](https://pypi.org/project/osr-editor/)** · **[Changelog](https://github.com/mmacy/osr-editor/blob/main/CHANGELOG.md)**

## Install

```console
uv tool install osr-editor
```

Or `pipx install osr-editor`, or `pip install osr-editor`. Python ≥ 3.14; no node toolchain — the published wheel ships the built frontend.

## Quickstart

```console
osr-editor
```

The editor serves on `http://127.0.0.1:8630` and opens your browser to the home screen. Pass a project directory to open it straight away — `osr-editor ~/adventures/mill.osr`. The [quickstart](https://mmacy.github.io/osr-editor/getting-started/quickstart/) takes you from launch to a first exported adventure.

## What it does

- **[Projects](https://mmacy.github.io/osr-editor/guides/projects/)** — always-saved, canonically serialized, git-friendly project directories; every commit is one undo step, and the document on disk is always the artifact the game engine loads.
- **[The map editor](https://mmacy.github.io/osr-editor/guides/map-editor/)** — the full geometry tool set on graph paper: rooms, corridors, walls and doors in every state, areas, entrances, transitions, multi-level and multi-dungeon management, and live structural lint with click-to-navigate findings.
- **[Stocking and keyed content](https://mmacy.github.io/osr-editor/guides/stocking-and-keyed-content/)** — the map-first stocking flow over encounters, treasure, traps, features, and wandering tables, through type-ahead pickers that never author a dangling reference.
- **[The monster editor](https://mmacy.github.io/osr-editor/guides/monster-editor/)** — full stat-block authoring over the adventure's bundled templates: create from scratch or clone any catalog monster, with renames cascading through every reference.
- **[Forge-backed review](https://mmacy.github.io/osr-editor/guides/forge-backed-review/)** — open an osr-forge workdir and correct it graphically: the report as a work list beside the source pages, every edit a reasoned `overrides.yaml` entry on forge's own pure assemble loop.
- **[Converting a PDF](https://mmacy.github.io/osr-editor/guides/converting-a-pdf/)** — the front door to forge's pipeline: price the run first, convert with live progress and cooperative cancel, land in the review queue. No credential is ever written to disk.
- **[Authoring aids](https://mmacy.github.io/osr-editor/guides/authoring-aids/)** — SRD stocking with seeded, reproducible re-rolls; treasure and encounter previews; and the prose assistant, present only when a provider is configured.
- **[Import, export, and publish](https://mmacy.github.io/osr-editor/guides/import-export-publish/)** — geometry in from another project or a Watabou One Page Dungeon export (or any installed [importer plugin](https://mmacy.github.io/osr-editor/reference/writing-a-geometry-importer/)); the stamped document out to any path; publish into an osr-web checkout as a live symlink or a snapshot.

## Development

Working on the editor itself takes both toolchains: Python ≥ 3.14 with [uv](https://docs.astral.sh/uv/), and Node.js (LTS, see `frontend/.nvmrc`). Build the frontend once, then run the editor from the checkout:

```console
cd frontend && npm ci && npm run build && cd ..
uv sync
uv run osr-editor
```

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

# docs
uv run mkdocs build --strict

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

### Releasing

Releases are tag-driven; the runbook lives in [`AGENTS.md`](https://github.com/mmacy/osr-editor/blob/main/AGENTS.md).

## License

MIT. osr-editor ships no game content — osrlib carries the OGL data. Modules you author or convert are yours and stay in your project directories.
