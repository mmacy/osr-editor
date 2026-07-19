# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Phase 3 — keyed content: the map-first stocking flow — the right-click stocking menu, hollow/filled key numbers with encounter/trap/treasure glyphs, module-notation hover summaries, the unstocked filter (`F`) and the `[`/`]` key-order walk — over the full content surface: keyed-encounter, treasure, room-trap, and feature cards in the area panel with type-ahead pickers fed by the new `GET /api/catalogs/*` routes (monsters, equipment, treasure types, encounter tables), the composable trap builder (kind pinned by where the trap lives), the inline d20 wandering-table editor seeded from the compiled level-band table, level-scope features, the content op vocabulary (`set_encounter`, `set_trap`, `set_treasure`, `add_feature`, `set_feature`, `remove_feature`), and publish to osr-web (symlink or snapshot into a checkout's `adventures/`, gated on validation only — lint warns, with a confirm).

- Phase 2 — the map editor: the graph-paper canvas with the full geometry tool set (rooms, corridors, walls and doors in every state, areas, entrance, transitions with auto-reciprocal stairs), multi-level and multi-dungeon management with rename/renumber cascades and offender-listing resize, the live structural lint tier (forge's `edge_invalid`, `area_unreachable`, `orphan_cell`, `secret_only_access`, and `transition_unpaired` mirrored exactly, plus the editor-only `area_overlap`) rendered on the map with click-to-navigate down to cells and edges and a one-click fix for invalid foreign edge keys, and the `GeometryImporter` entry-point seam with import-from-project as its first implementation — imported levels land as one undoable op batch.

- Phase 1 — projects and prose: the home screen (recents, new adventure, open by path, `osr-editor PATH`), native project create/open with the `editor.json` sidecar, the document service (atomic op batches with revisions and 409 stale-revision safety, bounded undo/redo, always-saved persistence), live content-validation diagnostics with click-to-navigate addresses, the adventure/town/hooks/wandering forms in the pencil-palette design language, the open-time fidelity warning for documents a newer osrlib wrote, and export of the stamped document to any path.
- Phase 0 scaffolding: the wired FastAPI + Vite skeleton (`osr-editor` serves the built frontend and `/api/status`), canonical adventure serialization with a committed round-trip golden fixture, the locked ops/revision/diagnostics envelope, the auth dependency seam, the `ProjectStore` protocol with a local filesystem store, and pydantic→TypeScript type generation with a CI drift gate.
