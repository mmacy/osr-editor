# osr-editor specification

A local GUI application for creating and modifying adventure modules playable by [osrlib](https://github.com/mmacy/osrlib-python)-powered games. osr-editor authors the same stamped `adventure.json` documents that [osr-forge](https://github.com/mmacy/osr-forge) produces and [osr-web](https://github.com/mmacy/osr-web) plays, and it is the graphical review-and-correction tool the forge spec anticipated its consumers would build. It runs as a local web app: a FastAPI backend that imports osrlib and osr-forge, serving a React frontend to the browser.

## Vision

One tool for the whole module lifecycle: convert a PDF module with osr-forge, review and correct the draft on a graph-paper map beside the scanned pages, or author an adventure from a blank grid — then validate it, walk it, and publish it to osr-web. The editor never reimplements rules or invents formats; osrlib's pydantic models are the schema, osrlib's validators are the referee, and osr-forge's artifacts are the conversion contract. The editor's job is to make those contracts directly manipulable.

Two principles govern everything:

**The backend is authoritative.** The FastAPI process holds the working document as real osrlib model objects. The frontend sends edit operations and renders what comes back — updated state plus live diagnostics. TypeScript types are generated from the pydantic models' JSON Schema, so the frontend is typed against the same source of truth it never re-implements.

**Forge output stays reproducible.** A module converted by osr-forge is corrected through `overrides.yaml`, never by hand-editing generated output — the editor is an overrides-authoring surface over forge's pure `assemble`/`check` loop. Direct editing is for native projects; crossing from one world to the other is an explicit, recorded act.

## Non-goals

- **No hosting, multi-user, or auth.** Single-user, localhost-only, one process. Publishing to PyPI (a later phase) ships the same local tool, not a service. The design still keeps the door open rather than building into a corner: every route resolves its caller through a single auth dependency that today returns the local user, and persistence sits behind the `ProjectStore` protocol — the two seams a hosted future would swap (see future extensions).
- **No rules implementation.** Validation, generation, and play all call osrlib. The one narrow exception is the SRD stocking procedure (see authoring aids), which consumes osrlib's shipped tables because osrlib doesn't yet ship the generator; it's a candidate to upstream.
- **No party or pregen authoring.** `adventure.json` has no party surface and osr-web imports parties only from saves. Future work, contingent on the ecosystem growing a pregen surface (already an open question in the forge spec).
- **No save editing.** Saves are session runtime owned by osrlib and the games.
- **No SRD catalog editing.** Shipped osrlib data is immutable; bespoke monsters are adventure-bundled `MonsterTemplate`s, exactly as osrlib 1.2 defines them.
- **No art assets.** The adventure model carries prose, not images; the editor renders maps from geometry. Forge-workdir page images appear in review UI but are never part of the deliverable.
- **No pixel-perfect map import.** Inherited from forge: geometry comes from the connection graph and human correction, not automated cartography matching.

## The two project types

A project is a directory on disk. The editor recognizes two shapes and adapts the whole UI to which one is open:

**Native project** — a directory containing a stamped `adventure.json` (the deliverable) and `editor.json` (editor-only sidecar: view state, per-entity author notes, stocking seeds, provenance; its own additive-only `schema_version`). Created from scratch in the editor, or by detaching from a forge workdir. Edits mutate the document directly (through the document service). Conventional name `<name>.osr/`, but any directory matching the shape opens.

**Forge-backed project** — an osr-forge workdir (`<name>.forge/`), detected by the presence of `run.json` and `stages/`. The editor never writes `adventure.json` here; every edit becomes an `overrides.yaml` entry and the editor re-runs `osrforge.assemble()` — pure, deterministic, and fast by forge's contract — so the draft, `report.json`, and previews always reflect the current corrections. The review UI shows report flags, per-area confidence, the workdir's rendered PDF pages, and SVG previews beside the live map. The editor keeps its `editor.json` sidecar in the workdir root too — an editor file, not a forge artifact; forge reads only its own files. A workdir whose conversion never completed opens into the pipeline view (per-stage status, resume, rerun) rather than review, since review requires an assemblable workdir.

**Detach** converts a forge-backed project to a native one: the current assembled `Adventure` is written as a new native project, with provenance (source workdir path, forge and osrlib versions, date) recorded in `editor.json`. Detaching is for edits `overrides.yaml` cannot express — adding a whole dungeon or level, changing a `WanderingSpec`, bundling a monster the module never mentions — and the editor offers it in place when such an edit is attempted, warning that the forge re-run loop is severed. Map correction is deliberately *not* on that list: geometry is one of forge's override kinds, so redrawing a level's rooms, walls, and doors stays inside the reproducible loop (see forge-backed editing).

## Documents and versioning

- The deliverable is `stamp_document("adventure", Adventure.model_dump(mode="json"))` — the same de facto document kind forge writes and osr-web checks with `check_document(document, "adventure")`. osrlib owns the envelope (`kind`, `schema_version`, `engine_version`, `payload`).
- On open, an older `schema_version` is accepted (osrlib's rule) and the document is re-stamped at current versions on next write; a newer one fails fast with osrlib's own error, surfaced with the remedy (upgrade osrlib).
- Additive osrlib growth *within* a schema version is guarded too: on open, the editor re-serializes the parsed payload and takes a one-way structural diff against the source — keys present in the source but absent from the re-serialization. Any such field triggers a prominent warning before the first write — an always-saved editor would otherwise silently drop fields a newer osrlib authored — with the upgrade remedy named. The reverse direction (defaults the pinned models add to an older document) is normal normalization, not loss, and warns nothing.
- Native-project serialization is canonical — pydantic field order, 2-space indent, `ensure_ascii=False`, trailing newline — so a no-op session over a document the editor wrote produces no diff and projects live happily in git. A document stamped by an older engine normalizes on its first write (the re-stamp rule plus any additive model defaults), one honest diff rather than byte identity that cannot hold.
- The editor is **always-saved**: a committed operation persists immediately (native: rewrite `adventure.json`; forge-backed: rewrite `overrides.yaml` and re-assemble). There is no dirty state and no save button; undo/redo is the safety net in-session, and git is the safety net across sessions (project directories are plain, diff-friendly files by design).

## Architecture

```text
osr-editor/
├── src/osreditor/          # Python package: FastAPI app + document service
│   ├── app.py              # routes, per-project locks, static serving
│   ├── projects.py         # project detection, open/create, recents
│   ├── store.py            # ProjectStore protocol + local filesystem store
│   ├── documents.py        # working-document store, ops, undo/redo, revisions
│   ├── ops.py              # edit-operation vocabulary (typed pydantic models)
│   ├── lint.py             # live structural lint (forge finding vocabulary)
│   ├── overrides.py        # op → overrides.yaml translation for forge-backed mode
│   ├── forge.py            # osr-forge bridge: assemble, check, rerun, convert, estimate
│   ├── aids.py             # stocking, treasure/encounter preview, prose assist
│   ├── walk.py             # walk-mode sessions over osrlib GameSession
│   ├── publish.py          # export + publish-to-osr-web
│   └── static/             # built frontend (generated at build time, shipped in wheel)
├── frontend/               # React + TypeScript + Vite source
│   └── src/types/generated/  # TS types generated from pydantic JSON Schema
├── scripts/                # type generation, dev orchestration
├── tests/                  # pytest; tests/e2e/ Playwright
└── docs/                   # this spec; mkdocs site later
```

- **Backend:** FastAPI + uvicorn, importing `osrlib` and `osrforge` directly. One in-memory working document per open project, guarded by a per-project lock (osr-web's proven pattern). Long-running work (conversion) runs on a worker thread with cooperative cancellation — a cancel raises out of the `on_progress` callback at the next stage boundary, so completed stages persist and no artifact write is ever interrupted mid-file; everything else is synchronous request/response.
- **Storage:** every project artifact read and write goes through a `ProjectStore` protocol (list, read, write artifacts by project) — forge's `ModelProvider` seam, applied to persistence. The local filesystem store ships; blob or database stores are later drop-ins. Forge operations always run against a locally materialized workdir (osr-forge is file-based), so a remote store syncs workdirs down and back rather than teaching forge about remotes — the same archive-the-workdir pattern osr-web's planned conversion worker uses.
- **Frontend:** React + TypeScript + Vite, with UI chrome built from shadcn/ui components (vendored Radix primitives, styled with Tailwind CSS) — pre-built parts for the panels, forms, dialogs, and trees that make up most of the editor, themed rather than hand-built. The map pane is the one fully bespoke surface: a 2D `<canvas>`. State management is chosen at phase-plan time (a small store like zustand; not spec-relevant).
- **Type generation:** a `uv run` script emits JSON Schema from the osrlib models and the editor's own API models, and generates TypeScript declarations into `frontend/src/types/generated/`. CI regenerates and fails on diff — the same drift discipline as osrlib's SRD pipeline.
- **Transport:** REST over `fetch`, polling for long-running progress (conversion, walk sessions are request/response anyway) — the osr-web precedent; no WebSockets.
- **Dev loop:** Vite dev server proxies `/api` to the backend; production and the wheel serve the built `static/` directly, so runtime needs Python only. Node is a development-time dependency exclusively.

## The document service

The heart of the backend, and the editor's echo of osrlib's own commands-in/events-out philosophy: **operations in, state and diagnostics out.**

- An **edit operation** is a typed pydantic model naming a domain action, not a JSON patch: `SetAdventureField`, `SetTownField`, `AddDungeon`, `AddLevel`, `ResizeLevel`, `SetEntrance`, `SetEdges` (a batch of canonical edge-key → `Edge | None` assignments), `CreateArea`, `SetAreaCells`, `SetAreaField`, `RemoveArea`, `SetEncounter`, `AddFeature`, `SetFeatureField`, `RemoveFeature`, `SetTrap`, `SetTreasure`, `SetWandering`, `AddTransition`, `RemoveTransition`, `AddMonsterTemplate`, `SetMonsterTemplate`, `RemoveMonsterTemplate`, and kin. The vocabulary grows additively.
- Operations post in **batches** that apply atomically and form one undo step, so a compound gesture (draw a rectangle room = create area + open interior edges) is a single unit of work and a single Ctrl+Z.
- Because osrlib content models are frozen, applying an op rebuilds the affected subtree and produces a new `Adventure` value. Undo/redo is a bounded in-memory stack of document values (documents are small — the largest known is ~300 KB); nothing clever, nothing persisted.
- Every batch returns the new **revision id**, the changed subtree, and refreshed **diagnostics**. Requests carry the revision they were computed against; a stale revision is rejected with 409, which makes a second browser tab safe rather than silently destructive.
- A batch that would produce an invalid model (a pydantic validator fails) is rejected whole with the validator's message mapped to the offending field — the document in memory is never invalid at the model level. Cross-reference problems (a dangling `template_id`, an out-of-bounds transition target) are *legal to have* while editing and surface as diagnostics instead; `validate_adventure` cleanliness is the publish gate, not an editing precondition.
- `ResizeLevel` shrinking below existing content is rejected listing every offender (areas, features, transitions, entrance) rather than auto-mutating them.

### Diagnostics

Three tiers, recomputed live after every batch and rendered in a persistent diagnostics panel with click-to-navigate:

1. **Model validity** — enforced by construction (see above); the panel never shows these because they can't be committed.
2. **Content validation** — `validate_adventure(adventure, load_monsters(), load_equipment())`, every error listed with location.
3. **Structural lint** — an editor-owned, incremental implementation of the static graph checks, using forge's finding vocabulary where the checks coincide (`edge_invalid`, `area_unreachable`, `orphan_cell`, `secret_only_access`, `transition_unpaired`) plus editor-only findings (`area_overlap` — overlapping area cells are legal but almost always a mistake). The editor owns this engine because live-per-edit lint needs to be in-process and incremental; forge's batch `check()` (including its smoke delve) additionally runs for forge-backed projects and its findings merge into the same panel.

## The map editor

The primary surface: a top-down grid per level, rendered as literal graph paper. osrlib's spatial model shapes the tools — all cells of a `width × height` level exist; an edge absent from the map is a wall; only `open` passages and doors are authored, always under the canonical north/west edge key.

Tools:

- **Room** — drag a rectangle: creates an `AreaSpec` over those cells and opens interior edges, one undo step. The area is immediately keyed (next free id) and selected for content editing.
- **Corridor** — drag a path: opens the edges along it. Corridor cells are simply cells in no area, per osrlib's convention.
- **Wall/door** — click an edge to cycle wall → open → door; a door inspector sets `normal`/`secret`, `stuck`, `locked`, `starts_open`. Drag to paint edges in a line.
- **Area** — lasso or paint cells into an existing or new area; areas render as tinted regions with their key numbers, like a printed module map.
- **Entrance** — place the level's entrance cell (validation requires at least one per dungeon).
- **Transition** — click the source cell, pick kind (stairs up/down, trapdoor, chute), then pick the target dungeon/level/cell and facing on a target-level picker. Stairs offer auto-reciprocal creation; trapdoors and chutes are one-way by rule.
- **Import geometry** — bring a level's grid in from outside: copy from another project's level, or read an external map format through a geometry importer (below). Either way the map editor doubles as a standalone map designer — draw a level in a scratch project, then swap it into the real module. In a forge-backed project the import lands as a `geometry:` override, so even a wholesale replacement map stays inside the reproducible correction loop.
- **Select/inspect** — click anything to open its editor panel; hover shows the cell/edge ref.

Level management: tabs per level within a dungeon, dungeon switcher above; add/remove/resize levels and dungeons with the invariants (unique ids, unique level numbers, min one of each) enforced by the ops. Map glyphs follow classic module-map conventions — door ticks on walls, "S" in the gap for secret doors, stair treads, arrows for one-way drops — so the on-screen map reads like the maps these modules were printed with.

### Geometry importers

Import is a seam, not a feature list. A `GeometryImporter` is a small protocol — a `format_id`, a label, `sniff(path)`, and an import call returning an editor-defined `ImportedGeometry` payload: one or more levels of cells, edges, and doors, plus whatever else the source knows — keyed areas with names and descriptions, an entrance, transitions, module title and description offered for adoption. Importers register through a Python entry-point group (`osreditor.importers`), so a converter for any map format is an installable package that never touches editor code; the built-in import-from-project tool is itself the first implementation, which keeps the protocol honest. Imported geometry lands as ordinary op batches — undoable, immediately linted, a starter map rather than a locked artifact — and each importer owns its format's judgment calls (grid scale onto 10' cells, coordinate normalization, door-type mapping), flagging what it guessed.

The motivating external target is Watabou's One Page Dungeon JSON export, whose shape — room rectangles, doors with position/direction/type, keyed positioned notes, a title and story — maps almost one-to-one onto cells, door edges, keyed areas, and adventure metadata. That converter is future work (see future extensions); the seam ships first.

## Content editing

Stocking is map-first — the map is the picker, and no workflow ever starts from a long id list:

- **Click an area to open it; right-click for the stocking menu.** The context menu offers exactly what the area can hold — add or edit the encounter, features, trap, treasure, or description, or roll SRD stocking for the room (see authoring aids) — with entries reflecting current state: an area that already has an encounter shows edit and remove, not add.
- **The area panel reads like a printed keyed entry**, not a form of forms: description prose up top, then one compact card per content kind — encounter, treasure, trap, features — each summarizing itself in module notation ("3d4 orcs", "treasure type C", "poison needle: save vs. poison or 1d4"). Empty kinds are single-click adds, cards expand in place to edit, and removal is the card's own action; the deep forms (the trap builder, the monster editor) appear only inside an expanded card.
- **The map shows stocking state at a glance.** Area key numbers render hollow for empty rooms and filled for stocked ones, with small glyphs for encounter, trap, and treasure presence; hovering an area shows its one-line contents. Next/previous-area keys walk rooms in key order, and a filter dims everything but unstocked rooms — stocking a big dungeon is a walk through it, not a spreadsheet session.
- **Pickers are type-ahead, never scroll-lists.** The monster picker searches the effective catalog as you type, surfaces this adventure's bundled and recently used monsters first, and takes the count inline; the equipment picker works the same way.

A drag-from-palette toolbox can layer onto this later without changing the model; it is explicitly not required for 1.0.

The field-level contracts behind the cards:

- **Prose** — name and description, in a serif editor sized for reading aloud. Per-area author notes live in the sidecar, never the deliverable.
- **Encounter** — monsters as `template_id` + count (dice or fixed, exactly one, per the model), with a searchable picker over the effective catalog (shipped SRD plus this adventure's bundled templates); pinned alignment (constrained to the template's options), `aware`, and pinned `stance`.
- **Features** — treasure caches, construction tricks, and custom features, bound to the whole area or a specific cell; item ids picked from the equipment catalog; coins and named valuables on forms mirroring `Coins` and `ValuableSpec`.
- **Traps** — a builder over `TrapSpec`/`TrapEffect`: room traps on areas, treasure traps on caches (the split is enforced by the models), trigger, affects, and the composable effect fields — damage, volley, save, condition + duration, fall, slide transition, and the `manual` prose fallback for what B/X leaves to the referee.
- **Treasure** — `AreaTreasureSpec`: treasure-type letters or the unguarded roll, exactly one.

Level scope: `WanderingSpec` (chance-in-six, interval, and the optional inline `EncounterTable` override on a d20 row form with osrlib's cover-1-to-20 rule enforced live). Adventure scope: name, description, hooks, and the town (name, description, services, per-dungeon travel turns).

## The monster editor

Full stat-block authoring over `MonsterTemplate`, in scope for 1.0 as a first-class surface:

- **Create from scratch** or **clone-and-modify** any catalog monster (the fastest route to "like an orc, but…").
- The form covers the whole model: AC pair (with the attack-roll-required coupling the validator enforces), hit dice (count/die/modifier/asterisks or fixed hp), THAC0 and attack bonus, attack routines built as ordered lists of attacks (count, name, damage dice or fixed, by-weapon, effect tags), movement modes, the five saves plus save-as, morale with alternates, alignment options, XP with role notes, number appearing (dungeon/lair), treasure refs, abilities (tag, name, prose, `manual` flag, params), defenses (harmed-only-by, reductions, energy defenses, condition immunities), and categories. Editor-authored templates set `page` to the empty string, forge's own convention for unpaged blocks.
- Bundled templates live on `Adventure.monsters`; the id-collision rule (never shadow the shipped catalog) is enforced as an op-level rejection with a rename prompt — the models can't see the shipped catalog, and a collision is never intentional, so the editor refuses it at commit instead of letting it linger as a diagnostic. `validate_adventure` remains the authoritative gate.
- In forge-backed projects the correction surface is a *printed-notation* form whose fields are exactly forge's `StatBlockOverride` (AC as printed — "5 [14]" — hit dice as "3+1", attack lines as written), because `monster_templates:` patches land pre-mapping by forge's contract and reviewing against the printed page is the point. The report's `derived` list badges the mapped fields; a derived field with no raw counterpart (treasure, notably) is corrected by a `monsters:` remap, an encounter replacement, or detach — never by hand-editing mapped output.

## Forge-backed editing

The correction loop, graphical: open a workdir and the editor shows the assembled draft on the map, the report beside it, and the source pages behind it.

- **Review queue** — `report.json` flags rendered as a work list: per-area confidence, `geometry_synthesized`, `monster_unresolved:<name>`, `monster_custom`, `connection_ambiguous`, `transition_guessed`, `treasure_unparsed`, `page_unreadable`, and module-scope flags. Selecting a flag navigates to the area with its `source_pages` rendered alongside (the workdir's `pages/*.png`), so correction happens against the printed page. SVG previews are available for eyeballing whole-level geometry.
- **Edits are overrides.** Every committed batch translates to `overrides.yaml` entries — `areas:` field replacements, area add/remove, `geometry:` (cells, edges, entrance, transitions), `monsters:` remaps, `monster_templates:` patches, and town/module metadata — then re-assembles and refreshes the report. Forge's rules are honored mechanically: every entry must take effect (assembly failures surface with the failing entry), monster keys normalize the way forge normalizes them, area adds carry the required name/description/cells, and the `monsters:`-vs-`monster_templates:` exclusivity is enforced at edit time rather than discovered at assembly.
- **Map correction is the flagship case.** Forge's own spec expects synthesized geometry not to match the printed map; redrawing rooms, walls, doors, and transitions on the graph paper — or importing a level drawn in a scratch project — writes `geometry:` entries, no detach required. The translation is a diff against the deterministically recomputed synthesized geometry: forge merges overrides *over* it per canonical key, so the editor emits explicit `wall` entries sealing every stale synthesized opening, and a level import emits `areas:` adds alongside the geometry. Two residues are documented behavior, not bugs: freed corridor floor remains floor (forge has no corridor-removal override), and level dimensions are derived (the bounding box of the final plan), so a forge-backed level never shrinks below the synthesized floor plan's extent — a truly clean-slate map is what detach is for.
- **Reasons** — every override entry carries a `reason`. The editor auto-drafts one from the op ("room 7 cells redrawn to match p. 14") and the corrections panel lists every entry with its reason editable, because the file remains the human-readable, git-reviewable record forge designed it to be. Successive edits to the same address merge into its single entry (forge allows one per address, duplicate keys rejected), and the auto-drafted reason is latest-wins — the corrections panel is where a human composes a better one.
- **Undo** in forge-backed mode is snapshots of `overrides.yaml` — the document is derived state.
- **Stage controls** — run `check`, regenerate previews, and `rerun <stage>` with `--set` knobs from a pipeline panel showing `run.json` per-stage status and token usage; the knob→owning-stage guard is forge's, surfaced with its remedy.
- The general rule: any op whose translation has no override kind blocks in place with the detach offer — `WanderingSpec` changes, adding or removing a dungeon or level, renaming dungeon or level ids, `ResizeLevel` (dimensions are derived state in forge-backed mode), bundling a monster the module never mentions.

## Conversion

In scope from 1.0: the editor is the front door to the pipeline, not just the back office.

- **New from PDF** — pick a PDF, pick or confirm the provider, and the editor runs `osrforge.estimate()` first, presenting the page count and rough cost as a confirmation gate (the forge spec's intended host behavior).
- On confirm, `convert()` runs on a worker thread with `on_progress` streamed to a progress view — stage transitions, token usage, per-stage status. Cancellation is cooperative and takes effect at the next stage boundary, so completed stages persist (forge's own resume semantics) and `rerun` picks up where it stopped; the editor never hard-kills mid-stage, which is what keeps `run.json` consistent. On success the project opens directly into the review queue.
- **Provider configuration** reads the same environment the forge CLI reads (Foundry endpoint, deployment, key or Entra ID). A settings panel shows detected provider status and lets values be set for the session; secrets are never written to editor config on disk.

## Validation, playtesting, and publishing

- **Live diagnostics** are always on (see the document service).
- **Walk mode** (a staged phase, not first playable): a real seeded `GameSession` over the current draft, driven from the map — a party marker moved with the movement keys, doors opened, searches rolled, transitions taken, with the referee-visibility event feed alongside so authored traps, encounters, and secrets can be verified to fire. Encounters are noted and evaded rather than fought (forge's smoke-delve convention); full combat belongs to osr-web. Walk sessions are throwaway: nothing persists, and the working document is never touched.
- **Publish to osr-web** — with a configured osr-web checkout, publish places the stamped document in its `adventures/` directory (symlink to the project by default, so saves republish live; copy as the alternative). Publishing gates on content validation passing; lint warnings prompt but don't block (secret-only access is sometimes the point). Export writes the stamped JSON anywhere.

## Authoring aids

All three ship in 1.0; all three apply their results as ordinary op batches (undoable, editable, no special state):

- **SRD stocking** — roll room contents for an empty area, or sweep a level's empty areas, using the SRD stocking, unguarded-treasure, and wandering tables shipped in osrlib's data, driven by a seeded RNG recorded in the sidecar (re-roll advances it; results are reproducible). This is the one rules procedure the editor implements, because osrlib ships the tables but defers the generator; upstreaming it to osrlib later is the expected end state.
- **Treasure and encounter preview** — sample what authored content actually yields: N example hoards for a treasure-type letter via osrlib's generator, rolled counts and a stat summary for an encounter. Pure preview; never mutates the document.
- **Prose assistant** — optional, model-backed drafting of area descriptions and hooks from the authored facts (name, encounter, features, treasure, adventure tone), through the same `ModelProvider` interface and provider configuration as conversion. Suggestions are inserted only on explicit accept, token usage is displayed, and the feature is absent (not broken) when no provider is configured.

## Design language

Graph paper and pencil — the drafting table these modules were born on:

- The aesthetic is scoped where it earns its keep: the map pane is literal graph paper — cream field, fine grid, pencil-weight walls, classic glyphs. The chrome around it is quiet, conventional tooling built from the component library, sharing the palette and type voices but never cosplaying as paper; the map reads as the artifact.
- Dark mode is graphite-on-slate — same language, inverted values — honoring `prefers-color-scheme`.
- Three type voices, matching the family convention: a humanist sans for UI, a serif for module prose (descriptions read as they'd be read aloud), monospace for dice, ids, and mechanics.
- All UI strings are sentence case.
- Red is reserved for destructive actions and errors; validation warnings use the pencil palette.

## Configuration

- App config via `platformdirs` (recents, osr-web checkout path, UI preferences). No secrets on disk; provider credentials come from the environment.
- CLI: `osr-editor [PATH] [--port 8630] [--no-browser]` — serve, open the browser to the home screen (recents, new adventure, open project or workdir, convert PDF), or straight into the project at `PATH`. Default port 8630 (osr-web convention-adjacent, non-colliding).

## API surface

All under `/api`, JSON, localhost only. Representative, not exhaustive:

```text
GET  /projects                        # recents + detected type
POST /projects                        # create native project
POST /projects/open                   # open by path (native or forge workdir)
GET  /projects/{id}                   # document, revision, diagnostics, report (forge-backed)
POST /projects/{id}/ops               # atomic op batch @ revision → revision, delta, diagnostics
POST /projects/{id}/undo | /redo
POST /projects/{id}/publish | /export
GET  /catalogs/{monsters|equipment|spells|classes|tables}
POST /projects/{id}/aids/{stock|preview|prose}
POST /projects/{id}/forge/{assemble|check|rerun|detach}
GET  /projects/{id}/forge/pages/{n}   # workdir page image
POST /conversions                     # estimate → confirm token → run
GET  /conversions/{id}                # progress poll
POST /projects/{id}/walk              # start/drive/end walk sessions
```

Error conventions follow the family pattern: structured rejections for editing conflicts (409 on stale revision), 422 for malformed requests, osrlib/forge typed errors mapped with their remedies attached.

Every route resolves its caller through one FastAPI auth dependency whose shipped implementation returns the single local user unconditionally. It exists so a hosted future changes one function, not every handler; no other code assumes there is exactly one user.

## Technology decisions

- **Python ≥ 3.14** (the ecosystem floor), `uv`, `ruff`, `pyright`, `pytest`.
- **Dependencies:** `osrlib` (`>=1.2,<2`), `osr-forge` (`>=0.1,<0.2` — 0.x pin, additive-artifact fence noted), `fastapi`, `uvicorn`, `pyyaml`, `platformdirs`. Dev-only: the node toolchain (React, TypeScript, Vite, Tailwind CSS, shadcn/ui as vendored source, vitest, Playwright). During development, sibling checkouts wire in as editable path sources per family practice; published builds pin PyPI ranges. The forge bridge also uses forge's public module-level `rerun` and preview regeneration, which sit outside its promised facade today; promoting them into the facade is a forge-side task recorded to land with phase 5, and the 0.x pin contains the interim risk.
- **Package** `osr-editor`, import `osreditor`, console script `osr-editor`. PyPI name availability is verified in phase 0; if taken, `osredit` is the fallback, decided then without ceremony.
- **The wheel ships the built frontend** in `src/osreditor/static/`; a build hook (or release CI step) runs the Vite build. Users never need node.
- **License** MIT. The editor ships no game content — osrlib carries the OGL data; the release audit machine-checks the dist like forge's does.

## Testing strategy

- **Backend unit tests (pytest):** op application and rejection per invariant, undo/redo, canonical-serialization byte-stability (write → reopen → no-op → write, byte-identical, for documents the editor wrote under the pinned osrlib), lint findings against fixture adventures (asserting parity with forge's finding ids on shared cases), op→override translation goldens, override reason drafting, publish gating.
- **Round-trip fixtures:** original, editor-authored adventures committed as fixtures — a small complete module and a doors-and-transitions torture case — exercised through open, edit, undo, save, validate. No retail-derived document is ever committed (the licensing fence in `AGENTS.md`); sibling-checkout documents like osr-web's bundled B3 may be opened in local development testing but never enter the repository.
- **Forge integration:** the full forge-backed loop (open workdir → edit → assemble → check) against `FixtureProvider`-recorded workdirs; conversion progress plumbing tested the same way, zero network.
- **Frontend unit tests (vitest):** the edge-key math mirror, gesture reducers (rectangle → op batch), map hit-testing.
- **End-to-end (Playwright):** the core loops as smoke — create adventure, draw a room and corridor and door, key an encounter from the catalog, validate clean, export; open a fixture workdir, correct a flagged area, see the override written and the report refresh.
- **Compatibility:** golden `adventure.json` outputs are loaded against the pinned osrlib in CI (forge's discipline), so an osrlib upgrade that shifts document semantics fails loudly here first.
- **CI:** ruff, pyright, pytest, generated-type drift check, tsc, vitest, eslint, Playwright smoke.

## Future extensions

Named so the systems around them grow the right seams — these are directions, not commitments:

- **Quests.** Neither the adventure document nor osr-web has a quest surface today, and osrlib deliberately leaves quest systems to games, built on its session flags and event listeners. When the ecosystem grows an authored quest model — definitions, triggers bound to areas, cells, or flags, rewards issued as referee commands — the editor's growth path is already the design: osrlib owns the schema, the generated types pick it up, the ops vocabulary grows additively, triggers place on the map the way transitions do, and diagnostics lint dangling quest references the way they lint monster ids. The open-fields fidelity guard (see documents and versioning) keeps an older editor from silently eating a newer document in the meantime.
- **Map-format converter plugins.** The `GeometryImporter` entry-point seam ships in 1.0; converters beyond import-from-project are separate installable packages, built as demand strikes without touching editor code. First on the list: Watabou's One Page Dungeon JSON export, which would turn OPD's endlessly generated dungeons into one-click starter maps.
- **Hosted deployment.** The auth dependency and the `ProjectStore` protocol are the two seams; nothing else assumes locality.
- **Party and pregen authoring**, as scoped in the non-goals — contingent on the ecosystem growing a pregen surface.

## Roadmap

Each phase ends with working, tested, documented software.

**Phase 0 — scaffolding and contracts.** Repo layout, uv + node toolchains, CI, FastAPI and Vite skeletons wired together, pydantic→TypeScript type generation with the drift gate, canonical serialization, stamped-document round-trip on an original fixture (write, reopen, no-op save, byte-identical), PyPI name verification. The revision/ops/diagnostics envelope, the auth dependency stub, and the `ProjectStore` protocol are locked here so every later surface obeys them from birth.

**Phase 1 — projects and prose.** Home screen, native project create/open/recents, the document service with undo/redo and live diagnostics, adventure/town/hooks/level-scope forms. Milestone: create a native project, edit its metadata and town, see content validation react live, export a stamped document osr-web lists.

**Phase 2 — the map editor.** The graph-paper canvas and the full tool set: rooms, corridors, edges and doors, areas, entrance, transitions, multi-level and multi-dungeon management, lint live on the map, and the `GeometryImporter` protocol with import-from-project as its first implementation. Milestone: author a two-level dungeon's complete geometry from a blank grid, lint clean, and play its empty halls in osr-web.

**Phase 3 — keyed content.** The map-first stocking flow — context menu, keyed-entry cards, stocking badges with next-unstocked navigation, type-ahead pickers — over the full content surface: encounters, features, traps, treasure, wandering. Milestone: hand-author a small complete adventure — keyed encounters, a trapped treasure cache, a secret door — publish it, and play it through in osr-web.

**Phase 4 — the monster editor.** The full stat-block surface: create, clone-and-modify, bundled-template management, collision handling. Milestone: a bespoke monster authored in the editor is encountered and fought in osr-web.

**Phase 5 — forge-backed projects.** Workdir open and detection, the review queue over report flags with source pages and SVG previews, op→override translation with reasons, the assemble/check loop, stage controls with rerun knobs, detach. Milestone: take a real converted workdir from flagged draft to publishable entirely in the GUI, with `overrides.yaml` as the reviewable record.

**Phase 6 — conversion.** New-from-PDF: provider settings, estimate and cost confirmation, subprocess convert with live progress, landing in the review queue. Milestone: PDF to published adventure without touching the CLI.

**Phase 7 — authoring aids.** SRD stocking with seeded re-rolls, treasure and encounter previews, the prose assistant behind provider detection. Milestone: stock a blank level from the SRD tables, punch up its descriptions with the assistant, and publish.

**Phase 8 — walk mode.** The embedded GameSession playtest: party marker on the map, movement/doors/searches/transitions, referee event feed, evade-encounters convention. Milestone: walk a converted module end to end and watch its traps and encounters fire where the pages said they would.

**Phase 9 — documentation and release.** Docs site (mkdocs-material), README, packaging audit, tag-driven trusted publishing, PyPI release as `osr-editor` 0.1.0 (Development Status :: 4 — Beta), matching the family's release engineering.
