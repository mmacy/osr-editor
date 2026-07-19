# osr-editor

A local GUI application for creating and modifying adventure modules playable by [osrlib](https://github.com/mmacy/osrlib-python)-powered games. osr-editor authors the same stamped `adventure.json` documents that [osr-forge](https://github.com/mmacy/osr-forge) produces and [osr-web](https://github.com/mmacy/osr-web) plays: a FastAPI backend that holds the working document as real osrlib model objects, serving a React frontend to the browser.

**Development status: pre-alpha.** Phases 0–3 and 5 of [the spec](docs/spec.md) are in place — the two-toolchain skeleton, canonical document serialization, the locked API contracts, the project/prose surface (create and open native projects, edit adventure and town prose with undo/redo, live content validation, export), the map editor (the full geometry tool set, multi-level and multi-dungeon management, live structural lint, geometry import through the `GeometryImporter` plugin seam), keyed content (the map-first stocking flow over encounters, treasure, traps, features, and wandering tables) with publish to osr-web, and forge-backed review (open an osr-forge workdir and correct its conversion through `overrides.yaml`). The native monster editor (phase 4) arrives in a later release.

### The map tools

On a level's map: **select** (V) inspects anything — areas, door edges, transitions; **room** (R) drags a rectangle into a keyed area with opened interior edges; **corridor** (C) opens passages along a dragged path; **wall/door** (W) click-cycles an edge wall → open → door and drags to paint (the door inspector sets normal/secret, stuck, locked, starts open); **area** (A) paints cells into the selected area or a new one; **entrance** (E) places the level entrance; **transition** (T) places stairs, trapdoors, and chutes with a target-level picker — stairs offer reciprocal creation in the same undo step. Pan with space-drag or middle-drag, zoom with the wheel, reset to 100% with `0`. Delete removes the selection; Esc cancels a gesture.

**Import geometry** (in the map chrome) brings a level in from another project — or any format with an installed importer plugin: importers register through the `osreditor.importers` entry-point group and land their geometry as one ordinary, undoable op batch.

### Stocking from the map

Right-click an area cell for the stocking menu: description, encounter, treasure, trap, and features, each offered as add or edit-plus-remove to match what the area holds. The area panel's cards commit through type-ahead pickers over osrlib's shipped catalogs — monsters (bundled templates first, then this session's recent picks), equipment, and treasure-type letters — so the editor never authors a dangling reference, while foreign documents' danglers stay legal, diagnosed, and navigable. Key numbers render hollow until an area is stocked (a description or any content) and carry glyphs for encounters, traps, and treasure; hovering shows the area's one-line contents in module notation. `F` dims stocked areas, and `[`/`]` walk areas in key order — with the filter on, the walk visits unstocked areas only. Level properties grow the inline d20 wandering-table editor (seeded from the compiled level-band table) and level-scope features.

### Publish to osr-web

**Publish** (beside export) places the adventure in an [osr-web](https://github.com/mmacy/osr-web) checkout's `adventures/` directory — as a live symlink that republishes on every save, or a point-in-time snapshot copy. Publish requires clean validation; lint and forge findings prompt but never block (secret-only access is sometimes the point). The checkout path is collected on first use and saved to the app config once its shape checks out.

### Forge-backed review

Open an [osr-forge](https://github.com/mmacy/osr-forge) workdir — a directory whose `run.json` describes a completed conversion — and the editor corrects the draft through `overrides.yaml` instead of authoring `adventure.json`. It never writes the derived artifacts: every correction writes `overrides.yaml` and re-runs forge's `assemble`, so a post-session `assemble()` reproduces the session's `adventure.json`, `report.json`, and previews byte-for-byte. The **Review** section lists the report's flags per area (and the module) with per-flag dismissal and an honest work-remaining count, and the printed source pages render beside the inspector — correction happens against the page. Editing an area, drawing geometry, or clearing an encounter translates to a merged, reasoned override entry; an edit with no override kind (renaming a dungeon, resizing a level) offers **detach** in place. The **Monsters** section resolves unresolved names — remap through the monster picker, or supply the printed stat block verbatim in the notation form. The **Corrections** section is the reviewable record: every override entry, its reason inline-editable, a machine-draft badge until you compose one. The **Pipeline** section renders `run.json` with an on-demand playability `check` and the assemble-stage rerun knob.

**Detach** crosses a workdir to a new native project — the current assembled document written through the native serializer, provenance and author notes carried over, the forge re-run loop severed. **Publish** and **export** copy forge's own `adventure.json` verbatim; a symlink publish republishes live on every correction.

### Author notes

The area panel and level properties carry a quiet **author notes** field, stored in the `editor.json` sidecar and never in the published deliverable. Notes follow their entity across a rename, renumber, or re-key, and survive undo and redo.

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
