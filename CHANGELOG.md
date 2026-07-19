# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Phase 2 — the map editor: the graph-paper canvas with the full geometry tool set (rooms, corridors, walls and doors in every state, areas, entrance, transitions with auto-reciprocal stairs), multi-level and multi-dungeon management with rename/renumber cascades and offender-listing resize, the live structural lint tier (forge's `edge_invalid`, `area_unreachable`, `orphan_cell`, `secret_only_access`, and `transition_unpaired` mirrored exactly, plus the editor-only `area_overlap`) rendered on the map with click-to-navigate down to cells and edges and a one-click fix for invalid foreign edge keys, and the `GeometryImporter` entry-point seam with import-from-project as its first implementation — imported levels land as one undoable op batch.

- Phase 1 — projects and prose: the home screen (recents, new adventure, open by path, `osr-editor PATH`), native project create/open with the `editor.json` sidecar, the document service (atomic op batches with revisions and 409 stale-revision safety, bounded undo/redo, always-saved persistence), live content-validation diagnostics with click-to-navigate addresses, the adventure/town/hooks/wandering forms in the pencil-palette design language, the open-time fidelity warning for documents a newer osrlib wrote, and export of the stamped document to any path.
- Phase 0 scaffolding: the wired FastAPI + Vite skeleton (`osr-editor` serves the built frontend and `/api/status`), canonical adventure serialization with a committed round-trip golden fixture, the locked ops/revision/diagnostics envelope, the auth dependency seam, the `ProjectStore` protocol with a local filesystem store, and pydantic→TypeScript type generation with a CI drift gate.
