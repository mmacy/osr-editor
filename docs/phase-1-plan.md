# Phase 1 plan — projects and prose

Implementation plan for phase 1 of [the osr-editor spec](spec.md). Phase 1 delivers the home screen, native project create/open/recents, the document service with undo/redo and live diagnostics, and the adventure/town/hooks/level-scope forms. Milestone: create a native project, edit its metadata and town, see content validation react live, and export a stamped document osr-web lists.

Four research facts shape this plan more than any others. First, **`validate_adventure` emits no structured findings** — it accumulates plain strings and raises one `ContentValidationError` with a newline-joined message (`osrlib/crawl/adventure.py:221`), so the diagnostics tier the spec promises requires an editor-owned parser that maps known message shapes to stable codes and addresses, with an honest fallback for lines it doesn't recognize. Second, **pydantic v2's `model_copy(update=...)` skips validators**, so the frozen-model rebuild pattern the content models force is not itself safe — the service must re-validate every candidate document before committing it, which is also exactly how the spec's "a batch that would produce an invalid model is rejected whole" rule gets enforced. Third, **a valid `Adventure` requires at least one dungeon with at least one level** (`min_length=1` at construction), and `validate_adventure` further requires an in-bounds entrance per dungeon — so "create a blank project" must scaffold a starter dungeon, level, and entrance, and doing so makes a fresh project validate-clean from birth. Fourth, **osr-web's listing gate is one line** — parsed JSON object with top-level `kind == "adventure"`, rescanned per request (`osr-web/server/library.py:58`) — while its *playable* bar is `check_document` plus `Adventure.model_validate`; `dump_adventure` output clears both, so the milestone's export needs no new serialization work, only a route.

## Scope

In scope:

- `config.py` — app config via `platformdirs`: the recents list, atomically written, additive schema
- `projects.py` — project-shape detection (native and forge-backed), native create with the starter document and `editor.json` sidecar, open-by-path, recents maintenance
- `store.py` growth — `project_exists` on the protocol (resolving the phase 0 amendment), umask cached at construction
- `ops.py` growth — the first concrete ops (`SetAdventureField`, `SetTownField`, `SetWandering`), the `AnyEditOp` discriminated union, the changed-subtree delta encoding, `can_undo`/`can_redo`
- `documents.py` growth — the working-document service: open-project registry with per-project locks, atomic batch application with re-validation, revision issuance, bounded undo/redo, always-saved persistence, the open-time fidelity diff
- `diagnostics.py` — the content-validation tier: run `validate_adventure`, parse its output into `Finding`s, pin the address grammar
- `app.py` growth — the project and ops routes, their error mappings (including the 409 `stale_revision` body pinned in phase 0), the `PATH` CLI argument
- Export: `POST /projects/{id}/export` writing the stamped document to a user-chosen path
- Frontend: zustand + react-router-dom, the home screen, the project screen (adventure/town/hooks/wandering forms, diagnostics panel, undo/redo, stale-revision recovery), the design language (pencil palette, three type voices, dark mode)
- Type generation updates (route-referenced models leave the injection list) and the test suites for all of the above, green in CI

Out of scope (each with the phase that picks it up): the map editor, `lint.py`, geometry ops and importers, dungeon/level management ops, and the cell/edge segments of the address grammar (phase 2); catalog routes, type-ahead pickers, keyed-content cards, the inline wandering `EncounterTable` d20 form, and publish-to-osr-web with its checkout-path config (phase 3); the monster editor (phase 4); forge-backed opening — phase 1 detects the workdir shape and rejects it with a structured error until the review surface exists (phase 5); conversion (phase 6); aids (phase 7); walk mode (phase 8); docs site and release engineering (phase 9). Per-entity author notes, stocking seeds, and view state are sidecar fields that arrive with their consuming features; phase 1 pins the sidecar envelope and writes only provenance.

## Work items

### 1. App config and recents

- New module `config.py` (a layout addition like phase 0's `errors.py`; the spec's tree is not exhaustive). No sibling precedent exists — osr-web's config surface is env vars plus `.env`, with zero `platformdirs` usage — so this is a new convention, pinned by the spec's configuration section: config lives at `platformdirs.user_config_path("osr-editor") / "config.json"`.
- Shape, additive-only like every editor-owned schema: `{"schema_version": 1, "recents": [...]}`, each recent `{"path", "name", "type", "last_opened_at"}` — absolute project path, display name captured from the adventure payload at open/create, `"native" | "forge"`, ISO-8601 UTC timestamp. Most recent first, deduplicated by path, capped at 10.
- Reads tolerate absence (first run) and corruption — a malformed config logs a warning and resets to empty rather than failing boot; it is a convenience cache, not user data. Writes are atomic (same temp-file-and-replace pattern as the store) because the always-saved editor updates recents on every open.
- New runtime dependency: `platformdirs>=4` (its consuming phase has arrived, per the phase 0 dependency rule).
- The spec's other config keys (osr-web checkout path, UI preferences) arrive with their consuming features — publish in phase 3; no dead keys now.

### 2. Project detection, create, and open

`projects.py`, plus the store growth it needs:

- **Detection** classifies a directory by shape, forge markers first: `run.json` present alongside a `stages/` directory → forge-backed; else a loadable `adventure.json` → native; else not a project. The ordering is load-bearing — a forge workdir *also* contains an assembled `adventure.json` at its root by forge's layout, so checking for the native shape first would silently misclassify every workdir. Detection reads through the `ProjectStore`, never `Path` directly.
- **Store growth**: `project_exists(project_id) -> bool` joins the `ProjectStore` protocol (additive growth, resolving the phase 0 amendment — `list_artifacts` returning `[]` cannot distinguish a typo'd path from an empty project; the open flow needs that distinction to answer "no such directory" versus "not a project"). `LocalProjectStore` implements it as directory existence. Per the other phase 0 amendment, `LocalProjectStore` now caches the process umask once at construction — phase 1 introduces real request concurrency around store writes, and the momentary `os.umask(0)` dance is no longer safely raceless.
- **Create** takes an absolute directory path and an adventure name. It refuses an existing non-empty directory (structured error, no partial writes), then writes the starter document and sidecar and opens the project. The starter `Adventure`, pinned: the requested name; `description=""`, `hooks=()`; `TownSpec(name="")`; one `DungeonSpec(id="dungeon-1", name="")` with one `LevelSpec(number=1, width=30, height=30, entrance=(0, 0))`. Rationale: osrlib requires the dungeon and level at construction (`dungeons` and `levels` both `min_length=1`), and the default entrance makes a fresh project pass `validate_adventure` from birth — phase 1 has no map tool to place one, and a warning the user cannot fix until phase 2 would be hostile. 30×30 is a graph-paper page; the map editor resizes and re-places freely in phase 2.
- **The `editor.json` sidecar**, envelope pinned now because its schema version is a shipped contract: `{"schema_version": 1, "provenance": {"created_by": "osr-editor <version>", "osrlib_version": "<engine_version()>", "created_at": "<ISO-8601 UTC>"}}`. Written once at create; phase 1 has no other sidecar consumer, so open tolerates a missing sidecar (foreign native projects open fine) and never rewrites an existing one. Detach provenance (phase 5) and the other spec'd fields grow additively within schema version 1.
- **Open** resolves the path (symlinks and all — the recents dedup key and the registry index both use the resolved path), classifies it, and for a native project loads the document through `load_adventure`, computes the fidelity diff (work item 4), registers the open project, and updates recents. A forge-backed path is recognized and rejected with a structured error (work item 6) until phase 5; an unrecognized shape or missing directory each get their own error. Opening never writes — normalization (the re-stamp of an older-engine document) happens on the first committed op, exactly the spec's "re-stamped on next write".
- **Recents** are probed at read time: `GET /projects` stats each recent and marks entries whose path has vanished, rather than silently dropping them — the user deleted or moved the directory; say so.

### 3. The op vocabulary and envelope growth

`ops.py` grows exactly the way its phase 0 docstrings promised:

- **First concrete ops**, frozen subclasses of `EditOp` with `op` narrowed to a `Literal`:
    - `SetAdventureField` — `field: Literal["name", "description", "hooks"]`, `value: str | tuple[str, ...]`; a model validator enforces the field/value pairing (`hooks` takes the tuple, the others a string).
    - `SetTownField` — `field: Literal["name", "description", "services", "travel_turns"]`, `value: str | tuple[str, ...] | dict[str, int]`; the same pairing validator, plus an editor-owned `>= 0` guard on `travel_turns` values — osrlib's `dict[str, int]` has no lower bound and would happily persist a negative travel cost.
    - `SetWandering` — `dungeon_id: str`, `level_number: int` (`ge=1`), `wandering: WanderingSpec`. The op carries the full osrlib model, inline `table` included, so the vocabulary is data-complete even though the phase 1 form authors only `chance_in_six` and `interval_turns` — the d20 table form belongs with phase 3's pickers, because a complete inline table requires exactly 20 rows each referencing catalog monsters (`tables.py:428-434`), and authoring those by blind text entry would violate the spec's picker contract.
- **`AnyEditOp`** — the discriminated union over the three, `Field(discriminator="op")`, built exactly as osrlib builds `AnyCommand`. `OpBatch.ops` is retyped to `tuple[AnyEditOp, ...]` — the growth the phase 0 docstring named, not a compatibility break; no shim, no dual type.
- **The changed-subtree delta**, the encoding phase 0 deliberately left to this phase: `SubtreeChange` — `path: str` (an RFC 6901 JSON Pointer into the adventure payload; `""` means the whole document) and `value` (the replacement subtree, serialization-mode JSON). `OpBatchResult` grows `delta: tuple[SubtreeChange, ...]`, applied in order; the service coalesces entries so no entry's path is a descendant of another's. Each op declares its subtree root: `SetAdventureField` → `/name`, `/description`, or `/hooks`; `SetTownField` → `/town`; `SetWandering` → `/dungeons/<i>/levels/<j>/wandering` with indices resolved by the service. Undo and redo answer with the degenerate whole-document delta (`path=""`) — honest and simple; finer undo deltas are an optimization no phase needs yet. Rationale for pointer-plus-value over returning the whole document every time: it honors the spec's "changed subtree" language at trivial cost now, and phase 2's high-frequency map gestures (edge painting) will want small payloads.
- **`OpBatchResult`** also grows `can_undo: bool` and `can_redo: bool`, so the frontend's buttons track the stacks without a second request. Both fields join `ProjectState` (work item 6) for the same reason.

### 4. The document service

`documents.py` grows from serialization module into the working-document service — the spec tree's "working-document store, ops, undo/redo, revisions":

- **The registry.** An `OpenProject` bundles the resolved path, project type, the current `Adventure` value, the revision counter, bounded undo/redo stacks, the fidelity warnings, and its own `threading.Lock`, created eagerly in the constructor — osr-web's proven pattern (`osr-web/server/app.py:65-81`): sync-def endpoints run in FastAPI's threadpool, so threading primitives are correct, and the per-object lock exists before the object is ever published. Project ids are opaque server-minted tokens (`secrets.token_hex(8)`, osr-web's choice). One deliberate divergence, documented in code: osr-web never opens the same object twice, but the editor must — two tabs, one path — so the registry keeps a resolved-path index and open is get-or-create under the registry lock, returning the *same* `OpenProject` and id for the same path. That shared document and revision stream is what makes the 409 contract meaningful. The whole open (load included) runs under the registry lock; single-user, milliseconds, simplicity wins. The registry lives on `app.state`, built in `create_app()` — not module globals like osr-web, because phase 0 chose an app factory and tests must not leak open projects across app instances.
- **Batch application**, under the project lock, atomic by construction:
    1. Resolve each op in order against the candidate document. `SetWandering` naming an unknown dungeon or level is rejected (`op_target_not_found`) before anything is built.
    2. Rebuild the affected subtree bottom-up with nested `model_copy(update=...)` — the idiom osrlib's own tests use pervasively.
    3. Re-validate the whole candidate: `Adventure.model_validate(candidate.model_dump())`. This is not optional hygiene — `model_copy` bypasses every validator and `Field` constraint in pydantic v2, and in-place mutation of a frozen model's dict fields would bypass them too, so the round-trip is the single enforcement point for "the document in memory is never invalid at the model level". The validated instance (not the copy-chain candidate) is what commits.
    4. On `pydantic.ValidationError`, reject the batch whole: 422, code `op_rejected`, `details.errors` a list of `{"path": <JSON Pointer from loc>, "message": ...}` — the validator's message mapped to the offending field, per the spec.
    5. On success: push the previous document onto the undo stack, clear the redo stack, bump the revision, persist (below), recompute diagnostics, coalesce the delta, answer.
- **Revisions** are per-`OpenProject` monotonic counters rendered as strings (`"r1"` at open, incrementing on every commit, undo, and redo). Contractually opaque — the format is this issuer's private choice, per the phase 0 envelope. A batch naming any other revision is rejected 409 `stale_revision` with `details.current_revision`, the body phase 0 pinned. A server restart mints fresh project ids, so no stale revision can ever cross process lifetimes — the old tab 404s and reopens.
- **Always-saved persistence**: every commit, undo, and redo rewrites `adventure.json` through the store (`dump_adventure` bytes, atomic write). No dirty state, no save button. A no-op session writes nothing because opening writes nothing.
- **Undo/redo**: bounded stacks of `Adventure` values, 100 deep, oldest evicted — documents are small (the largest known is ~300 KB; the worst case is ~30 MB of heap, acceptable for a local tool). Empty stack → 409 (`nothing_to_undo` / `nothing_to_redo`); the frontend disables the buttons via `can_undo`/`can_redo`, so hitting these codes means a race, and 409 is the honest answer.
- **The open-time fidelity diff**, the spec's guard against an always-saved editor silently eating a newer osrlib's fields: on open, re-serialize the parsed document (`model_dump(mode="json")`) and walk the *source* payload against it — a key present in the source but absent from the re-serialization, recursively through mappings and pairwise through sequences, is a dropped field. The result is a tuple of JSON Pointers surfaced on `ProjectState` as `dropped_fields`; the frontend shows the prominent warning before the first edit (work item 10). The reverse direction (defaults the pinned models add) warns nothing, per the spec.

### 5. Validation diagnostics and the address grammar

New module `diagnostics.py`, the tier-2 producer:

- **Runner**: call `validate_adventure(adventure, load_monsters(), load_equipment())` after every commit, undo, redo, and at open. The catalogs are `functools.cache`d module singletons in osrlib (`data/__init__.py:144-163`) — cheap to call, no editor-side caching needed. Success → empty `validation` tuple; `ContentValidationError` → parse.
- **Parser**: strip the `"adventure validation failed:"` header, split lines, and map each through an ordered table of regexes matched to osrlib's exact f-string shapes (`adventure.py:115-220`), yielding `Finding(source="validation", code, message, address)`. Pinned codes, one per osrlib check: `bundled_monster_collision`, `travel_unknown_dungeon`, `entrance_missing`, `entrance_out_of_bounds`, `feature_id_conflict`, `feature_id_reserved`, `area_id_conflict`, `area_cell_out_of_bounds`, `encounter_unknown_monster`, `encounter_alignment_invalid`, `feature_unknown_item`, `feature_cell_out_of_bounds`, `feature_needs_cell`, `wandering_unknown_monster`, `transition_out_of_bounds`, `transition_target_unknown`, `transition_target_cell_out_of_bounds`. A line matching no pattern becomes `validation_unclassified` with the message verbatim and no address — findings are never dropped, and an osrlib message change degrades to a less-navigable finding, not a lie.
- The parsing is deliberate, contained fragility — the sanctioned alternative (re-implementing the checks) is forbidden by the no-rules-implementation fence. Three containments: the osrlib pin (`>=1.2,<2`), parser tests that assert every mapped shape against the *installed* osrlib (so an upstream wording change fails CI here first, same discipline as the golden fixture), and the unclassified fallback. Upstreaming structured findings to osrlib is the recorded end state, alongside the stocking generator.
- **The address grammar**, pinned by this first producer within the phase 0 `Finding.address` shape: `/`-joined `kind:value` segments, values percent-encoded (RFC 3986) so arbitrary osrlib ids can never make the grammar ambiguous — forge earns its bare `dungeon/level/area` form by normalizing ids at the source (`osr-forge/contracts/report.py:120-135`); the editor opens documents it didn't author and cannot. Segments: `town`, `monsters`, `dungeon:<id>`, `dungeon:<id>/level:<n>`, `dungeon:<id>/level:<n>/area:<id>`. Examples: `town`; `dungeon:dungeon-1`; `dungeon:dungeon-1/level:2/area:7`. Phase 2 extends with `cell:` and `edge:` segments (osrlib's `cell_ref`/`edge_ref` are the value precedents); the grammar is additive like everything else.
- Tier-3 lint stays an empty tuple — `lint.py` is phase 2's, with the map that makes its findings navigable.

### 6. Routes, errors, and the CLI path argument

`app.py` grows the phase 1 surface; route-adjacent request/response models, per the `StatusResponse` precedent:

- Routes, all behind the auth dependency (the introspection test extends automatically):

    ```text
    GET  /api/projects              # recents (probed), open_at_launch
    POST /api/projects              # create native project → ProjectState, 201
    POST /api/projects/open         # open by path → ProjectState
    GET  /api/projects/{id}         # ProjectState
    POST /api/projects/{id}/ops     # OpBatch → OpBatchResult (200), 409 stale, 422 rejected
    POST /api/projects/{id}/undo    # → OpBatchResult
    POST /api/projects/{id}/redo    # → OpBatchResult
    POST /api/projects/{id}/export  # → ExportResult
    ```

- `ProjectState`: `id`, `path`, `type`, `document` (the full `Adventure`), `revision`, `diagnostics`, `dropped_fields`, `can_undo`, `can_redo`. The full document rides on open/get only; batches answer with deltas.
- Error mapping, each a typed member under `OsrEditorError` with its handler and code: `ProjectNotFoundError` → 404 `unknown_project` (stale id after restart; the frontend goes home and offers the recent), `ProjectPathNotFoundError` → 404 `project_path_not_found`, `InvalidProjectError` → 422 `not_a_project`, `ProjectExistsError` → 409 `project_dir_not_empty`, `StaleRevisionError` → 409 `stale_revision` + `details.current_revision`, `UndoStackEmptyError`/`RedoStackEmptyError` → 409 `nothing_to_undo`/`nothing_to_redo`. A forge-backed open is not an exception case — it's a recognized shape the phase can't serve: 422, code `project_type_unsupported`, message naming the workdir shape, remedy that forge-backed review arrives in a later release. Op rejections (`op_rejected`, `op_target_not_found`) ride the 422 envelope from work item 4.
- **CLI**: the positional `PATH` argument joins `--port` and `--no-browser` — `osr-editor [PATH]`. The CLI fails fast (argparse error) on a nonexistent path; otherwise the resolved path lands in `create_app(open_at_launch=...)` and `GET /api/projects` carries it as `open_at_launch` for the frontend to act on once per load (open, navigate, done — returning to the home screen later does not re-trigger). Accepted flags remain exactly what the phase can honor.

### 7. Export

- `POST /projects/{id}/export` with an absolute destination file path: writes the current document's `dump_adventure` bytes atomically, creating parent directories, overwriting an existing file (an explicit, user-invoked act on a user-chosen destination — the licensing rule's named exception). Returns the written path. Export never gates on validation — the spec reserves that gate for publish (phase 3); export is "write the stamped JSON anywhere".
- The write is direct (the atomic-write helper, not `ProjectStore`) and the route is honestly local: the destination is an arbitrary user filesystem path outside any project, which is not what the store seam abstracts. A hosted future replaces this one handler with a download response; noted in its docstring.
- **The milestone bar, verified against osr-web's actual gates**: to be *listed*, a file needs only to be valid JSON with top-level `kind == "adventure"` dropped at `adventures/*.json` or `adventures/<dir>/adventure.json` — symlinks followed, rescanned on every request, so an export appears without restart (`library.py:74-140`). To be *playable*, it must pass `check_document` then `Adventure.model_validate` (`content.py:197-203`). `dump_adventure` output clears both bars by construction. CI asserts the envelope shape (the listing gate's exact check plus a full `load_adventure` round-trip); the flesh-and-blood osr-web listing is verified manually against the sibling checkout and recorded in the PR, since osr-web is not a CI dependency.

### 8. Type generation

- Every phase 0 injected model becomes route-referenced this phase — `Adventure` via `ProjectState`, the envelope models via the ops routes — so `INJECTED_MODELS` empties (each entry leaves per the script's own rule; the mechanism and collision check stay for future phases). `EditOp` drops out of the wire surface entirely: `OpBatch` now carries `AnyEditOp`, and the abstract base serializes nowhere.
- `frontend/src/types/index.ts` grows aliases for the new shapes (`ProjectState`, `RecentProject`, `SubtreeChange`, the ops, `AnyEditOp` as the union member type of `OpBatch["ops"]`); the vitest type-level suite extends: the `AnyEditOp` union discriminates on `op`, `SetWandering` carries a full `WanderingSpec`, `SubtreeChange.value` is loose JSON by design.
- The drift gate is unchanged and stays proven: regenerate, commit, CI fails on any diff.

### 9. Frontend foundations: state, routing, home screen

- **State management, the choice the spec assigned to this plan: zustand.** Rationale: the store is small (one open project, its revision, diagnostics, and a commit queue), zustand is the spec's own named suggestion, it needs no providers or boilerplate, and its vanilla core keeps gesture logic testable in node-environment vitest. Redux-class machinery would be dead weight at this scale.
- **Routing: react-router-dom**, two routes — `/` (home) and `/projects/:id`. A URL-addressable project screen is what makes the second-tab story real (the 409 contract exists for it), and the browser back button behaving correctly in a local web app is table stakes, not polish.
- **The store**: holds `ProjectState`, applies `OpBatchResult`s (revision, diagnostics, `can_undo`/`can_redo`, delta), and owns a single-flight commit queue — batches post strictly sequentially, each carrying the revision from the previous result, so rapid blur-commits can never 409 against themselves. A real 409 (`stale_revision` — the other tab won) triggers refetch of `ProjectState`, wholesale store replacement, and a quiet toast ("Updated from another tab"). Delta application is a tiny RFC 6901 pointer-walk utility (`applyDelta`), unit-tested in vitest; `""` replaces the document.
- **The home screen** replaces the phase 0 status card: recents as cards (name, path, type badge, missing-path state), a new-adventure dialog (adventure name, destination directory path), and open-by-path. Entries the roadmap hasn't reached (open workdir, convert PDF) simply don't exist yet — no disabled teaser buttons; the surface grows when the capability does. `open_at_launch` is honored once per page load. Backend errors render their envelope `message` and `remedy` as toasts.
- New dependencies: `zustand`, `react-router-dom` (current stable majors, recorded in `package-lock.json`, per the phase 0 version rule).

### 10. The project screen

- **Layout**: header (adventure name, undo/redo buttons, export); left sidebar navigation — Adventure, Town, then each dungeon with its levels as a tree; main pane hosts the selected form; the diagnostics panel is persistent (collapsible bottom drawer with a count badge, never fully hidden — the spec's "persistent diagnostics panel").
- **Forms and the commit gesture**: controlled inputs that commit on blur or Enter, one op batch per committed field, change-detected so a focus-and-leave never posts a no-op batch. Each commit is one undo step by construction. The forms: adventure name, description, hooks (an ordered list editor — add, remove, edit, reorder; each change commits the whole tuple); town name, description, services (same list editor), travel turns; wandering per level (chance-in-six as a 0–6 stepper, interval in turns, and a read-only note when an inline table exists on an opened document — the table editor is phase 3's, and phase 1 must not destroy a table it can't author, so `SetWandering` from this form always carries the existing `table` through unchanged).
- **Travel turns is the deliberate dangling-reference surface**: free rows — dungeon id as text, turns as a number — not a picker over existing dungeons. Cross-reference problems are legal while editing, and this is phase 1's authorable path to watching validation react live (type a wrong id → `travel_unknown_dungeon` appears; fix it → it clears). That interaction *is* the milestone's "see content validation react live", and the e2e test walks exactly it.
- **Diagnostics panel**: findings listed with message and location; click navigates by parsing the address grammar — `town` → town form, `dungeon:<id>/level:<n>` → that level's form, adventure-scope → adventure form. Addresses phase 1 can't represent yet (area-level, from opened richer documents) navigate to their level.
- **Fidelity warning**: when `dropped_fields` is non-empty, a prominent dialog before the first edit — the fields a newer osrlib authored, the drop-on-write consequence, the upgrade remedy — with an explicit "edit anyway" acknowledgement. Dismissal is per open, not persisted; the warning is the feature.
- **Undo/redo**: header buttons plus Ctrl/Cmd+Z and Shift+Ctrl/Cmd+Z, disabled per `can_undo`/`can_redo`, applying results through the same store path as batches.
- **Stale project id** (server restarted): any 404 `unknown_project` routes home with a toast; the recent is right there to reopen.
- **Vendored shadcn additions**, roughly: button, input, textarea, label, dialog, alert, badge, tooltip, separator, scroll-area, sonner (toasts) — committed source under `components/ui/`, per the spec.

### 11. Design language

The first real UI, so the spec's design language lands now, scoped exactly as the spec scopes it — the chrome is quiet, conventional tooling; nothing cosplays as paper until the map pane exists:

- **Pencil palette** as Tailwind/shadcn theme tokens in one place (`index.css` theme block): cream paper field, graphite ink, pencil-weight borders for light; graphite-on-slate for dark, honoring `prefers-color-scheme`. Exact values are the implementer's, tuned in that single tokens file; red stays reserved for destructive actions and errors, validation warnings use the pencil palette.
- **Three type voices** as CSS font-family tokens: humanist sans for UI chrome, serif for module prose (the adventure/town description and hooks editors render in it — descriptions read as they'd be read aloud), monospace for ids, dice, and numbers (revision, travel turns, dungeon ids). Pinned to system font stacks — no bundled webfonts in phase 1; the wheel stays lean and offline-correct, and a bundled voice can land later if the system stacks prove too anonymous.
- All UI strings sentence case, enforced in review from the first string (the phase 0 rule, continued).

### 12. Tests

Consolidated from the work items:

- **config**: round-trip, cap-and-dedup, corrupt-file reset, atomic write.
- **projects**: detection of native, forge (markers-first ordering proven against a fixture workdir shape), and non-projects; create (starter document validates clean, sidecar shape, non-empty-dir refusal); open (idempotent same-`OpenProject` for the same path via symlinked and direct routes); recents probe marks missing paths.
- **store**: `project_exists`, cached-umask behavior unchanged under the existing atomic-write suite.
- **ops/service**: apply and reject per op (field pairing, negative travel turns, unknown wandering target); batch atomicity (later op fails → earlier ops discarded); revision issuance and 409 on stale; undo/redo including bounds eviction and empty-stack 409s; always-saved persistence (file bytes equal `dump_adventure` after every commit/undo/redo; open-with-no-ops writes nothing); delta correctness including coalescing and the wandering index resolution; a concurrency smoke (two threads posting batches against one project serialize without corruption).
- **fidelity**: doctored payloads with an extra scalar, an extra nested key, and an extra list element each report the right pointer; a plain older-defaults document reports nothing.
- **diagnostics**: a fixture adventure per finding code asserts code and address against the installed osrlib; an unrecognizable line lands as `validation_unclassified`; address segments percent-encode hostile ids.
- **app**: every new route's shape and error envelope (404/409/422 bodies incl. `stale_revision` details); auth introspection covers the new routes automatically; `open_at_launch` plumbing; export writes loadable bytes and the osr-web listing-gate shape.
- **frontend (vitest)**: `applyDelta` pointer walk; store commit queue serialization and 409 recovery; form commit gesture (blur/Enter/no-change); type-level assertions for the new generated shapes; component smokes for home and project screens.
- **e2e (Playwright)**: the milestone loop — create a project, rename the adventure, add a hook, edit the town, add a travel-turns row with an unknown dungeon id and watch the finding appear, fix it and watch it clear, undo/redo the rename, export, assert the exported file parses with `kind == "adventure"`.

## Sequencing

1. Store growth (`project_exists`, cached umask) and `config.py`, with tests — the foundations both flows stand on.
2. `projects.py` detection/create/open/sidecar/recents with tests; the routes and error mappings that expose them; the home screen can now exist against real endpoints.
3. `ops.py` growth (concrete ops, union, delta, result fields), then the `documents.py` service (registry, locks, apply, undo/redo, persistence, fidelity) with the backbone test suites.
4. `diagnostics.py` runner, parser, and address grammar with its fixture suite; wire into the service.
5. Ops/undo/redo/export routes; CLI `PATH`; full backend suite green.
6. Typegen update (injection list empties), regenerated types committed, aliases and type-level tests.
7. Frontend: store and `applyDelta`, routing, home screen; then the project screen (forms, diagnostics panel, undo/redo, fidelity dialog, 409 recovery); design language tokens throughout; vitest suites.
8. Playwright milestone loop; README updates (PATH usage, config location); CHANGELOG bullet; traceability pass against the roadmap entry and this plan's deferrals.

## Definition of done

- The full phase 0 gauntlet stays green on both toolchains, extended by the new suites; the typegen drift gate passes with the emptied injection list.
- The milestone walk works end to end by hand and in Playwright: create a native project, edit metadata and town, watch a validation finding appear and clear live, undo/redo, export — and the exported file appears in osr-web's list against the sibling checkout (manual, recorded in the PR).
- A fresh project validates clean at birth; opening writes nothing; every commit/undo/redo rewrites `adventure.json` atomically with canonical bytes; a no-op session over an editor-written project produces no diff.
- The 409 contract is real: a stale batch from a second tab is rejected with the pinned body and the tab recovers by refetch, proven in tests.
- The fidelity guard is real: a doctored newer-field document warns before first write with the dropped pointers named, proven in tests.
- Every new `/api` route resolves the auth dependency (introspection test), all envelope growth is additive (phase 0 models changed only by the documented growth points), and no secrets or absolute-path surprises land in config beyond the documented recents shape.
- Every phase 1 item in the spec's roadmap entry is traceable to code and tests here, or explicitly deferred above with its phase named.

## Amendments

Recorded during implementation, per the phase loop's plan-and-code-never-diverge rule.
