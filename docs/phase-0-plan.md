# Phase 0 plan — scaffolding and contracts

Implementation plan for phase 0 of [the osr-editor spec](spec.md). Phase 0 delivers the two-toolchain skeleton (uv + node, CI for both), the FastAPI and Vite halves wired together end to end, pydantic→TypeScript type generation with a CI drift gate, canonical document serialization with a stamped round-trip fixture, and PyPI name verification — while locking the three contracts every later phase obeys from birth: the revision/ops/diagnostics envelope, the single auth dependency, and the `ProjectStore` protocol.

Two research facts shape this plan more than any others. First, **osr-web contributes no frontend precedent**: it is a FastAPI server with a dependency-free vanilla-JS client — no Vite, no TypeScript, no node toolchain, no typegen, no CI. The editor's entire node side is greenfield; the reusable sibling patterns are osrlib's regenerate-then-diff drift gate, osr-forge's canonical JSON writer and pyright configuration, and osr-web's static-mount and per-object-lock server patterns. Second, **pydantic v2 emits JSON Schema 2020-12** (`$defs`, `prefixItems` tuples, discriminated unions), which the older draft-07 TypeScript generators mishandle — this drives the typegen tool choice in work item 7.

## Scope

In scope:

- uv project layout (`src/osreditor/`), ruff/pyright/pytest configuration, MIT license, README, CHANGELOG
- node toolchain under `frontend/`: Vite + React + TypeScript, Tailwind CSS, shadcn/ui vendored, eslint + prettier, vitest, Playwright
- GitHub Actions CI covering both toolchains plus the typegen drift gate and a Playwright smoke
- `errors.py` hierarchy root and the structured API error envelope
- `documents.py` — canonical serialization and the stamped-document load/dump, with a committed original fixture proving write → reopen → no-op save → byte-identical and gating osrlib compatibility in CI
- `ops.py` — the locked envelope models: `EditOp` base, `OpBatch`, `OpBatchResult`, `Diagnostics`, `Finding`
- The auth dependency stub in `app.py`, enforced by a route-introspection test
- `store.py` — the `ProjectStore` protocol and the local filesystem store
- `scripts/generate_types.py` and the committed generated types in `frontend/src/types/generated/`
- The wired skeleton: `osr-editor` CLI serves the built frontend; the page renders `/api/status` through generated types
- PyPI name verification for `osr-editor`
- Tests for all of the above, green in CI

Out of scope (each with the phase that picks it up): project open/create/recents, the home screen, `platformdirs` config, the `editor.json` sidecar and its schema version, the `PATH` CLI argument, per-project locks, op application with undo/redo and revision issuance, the first concrete ops and the `AnyEditOp` union, the changed-subtree delta field, the open-time structural-diff fidelity warning, and the frontend state-management choice (all phase 1); the map editor, `lint.py`, and `GeometryImporter` (phase 2); catalog routes and content editing (phase 3); the monster editor (phase 4); the `osr-forge` and `pyyaml` dependencies, `overrides.py`, `forge.py`, and store-side workdir materialization (phase 5); conversion (phase 6); `aids.py` (phase 7); `walk.py` (phase 8); the docs site, `release.yml`, the dist audit, and packaging the built frontend into the wheel (phase 9). The design language (pencil palette, three type voices) lands with the first real UI in phase 1; phase 0 uses stock shadcn theming. The spec's round-trip fixture pair — a small complete module and a doors-and-transitions torture case — arrives once the editor can author them (phases 2–3); phase 0's fixture is hand-built in code.

## Work items

### 1. Python scaffolding

- `pyproject.toml`: distribution `osr-editor`, import package `osreditor`, `requires-python = ">=3.14"`, build backend `uv_build` (the family standard — both published siblings use it; note it supports no custom build hooks, so shipping the built frontend in the wheel will use the spec's release-CI-step alternative, phase 9). `[tool.uv.build-backend] module-name = "osreditor"` per osr-forge's hyphenated-name precedent. `[project.scripts] osr-editor = "osreditor.app:main"`.
- Runtime dependencies, only what phase 0 imports: `osrlib>=1.2,<2`, `pydantic>=2` (declared directly — the envelope models import it, osr-forge's precedent), `fastapi>=0.139`, `uvicorn>=0.51` (osr-web's floors). Deliberately absent until their consuming phases: `pyyaml` and `osr-forge` (phase 5), `platformdirs` (phase 1) — the osrlib phase 0 precedent (it declared `pydantic>=2` only) and the greenfield rule that an unread dependency is dead accommodation. Dev group: `pytest`, `ruff`, `pyright`, `httpx` (starlette's `TestClient` requires it).
- Dependencies resolve from PyPI, matching osr-forge (the published-with-CI sibling), not osr-web's committed editable path source — a committed `[tool.uv.sources]` path entry would break `uv sync --locked` in CI and in any clone without sibling checkouts. The spec's editable-checkout practice is the dev-time option: the README documents flipping a source to `{ path = "../osrlib-python", editable = true }` when a phase needs unreleased sibling surface; phase 0 needs nothing unreleased (osrlib 1.2.0 is published).
- Phase 0 module map — the phase-0 subset of the spec's architecture, plus `errors.py` (a layout addition consistent with both siblings; the spec's tree is not exhaustive):

    ```text
    src/osreditor/
    ├── __init__.py          # package docstring only; no facade re-exports
    ├── py.typed
    ├── errors.py            # OsrEditorError hierarchy root
    ├── app.py               # create_app(), auth dependency, /api/status, error handlers, static mount, main()
    ├── documents.py         # canonical serialization; stamped adventure load/dump
    ├── ops.py               # envelope models: EditOp, OpBatch, OpBatchResult, Diagnostics, Finding
    ├── store.py             # ProjectStore protocol + LocalProjectStore
    └── static/              # built frontend (gitignored; produced by the Vite build)
    ```

- Tool config mirrors osr-forge, the stricter sibling: ruff `line-length = 120`, `select = ["E", "F", "W", "I", "D", "UP", "B", "SIM", "RUF"]`, Google docstring convention, per-file `D` ignores for `tests/**` and `scripts/**`; pyright `typeCheckingMode = "standard"` with `strict = ["src"]`; pytest `testpaths = ["tests"]`, `addopts = "-q"`. `.python-version` pinned to 3.14, `uv.lock` committed, `py.typed` from day one.
- `.gitignore`: Python/uv artifacts, `node_modules/`, `src/osreditor/static/`, Vite and Playwright output, `*.osr/` and `*.forge/` scratch projects.
- `CHANGELOG.md` in Keep a Changelog 1.1.0 form with a live `[Unreleased]` section (the family's release tooling extracts sections by this exact heading format); phase 0 adds its bullet. `LICENSE` MIT — the editor ships no game content, so there is no OGL split here; osrlib carries the OGL data.
- README: what osr-editor is, development status, the two-toolchain dev quickstart (work item 8), the full local gauntlet, licensing note.
- **PyPI name verification.** Pre-checked during planning (2026-07-18): `https://pypi.org/pypi/osr-editor/json` and `/osredit/json` both return 404 — the primary name is available. Implementation re-runs the check at PR time and records the result as an amendment to this plan; if `osr-editor` has been taken in the interim, the fallback is `osredit`, decided without ceremony per the spec.

### 2. Frontend scaffolding

All greenfield — no sibling has a node toolchain. Choices are pinned; exact versions are whatever the current stable majors are at implementation time, recorded in the committed `frontend/package-lock.json`.

- **npm** as the package manager (the boring default; no sibling precedent to defer to), lockfile committed. Node LTS pinned in `.nvmrc` and `package.json` `engines`; CI reads `.nvmrc`.
- Vite + React + TypeScript (`tsconfig` `strict: true`). Build output `outDir` is `../src/osreditor/static` with `emptyOutDir` — the backend serves exactly what the wheel will someday ship. Dev server proxies `/api` to `http://localhost:8630`.
- Tailwind CSS (v4 line) and shadcn/ui vendored via its CLI into `frontend/src/components/ui/` — components are committed source, not a dependency, per the spec. Phase 0 vendors only what the status page needs (card, roughly); the pencil palette and type voices are phase 1's, so phase 0 keeps stock shadcn theme tokens.
- eslint (typescript-eslint recommended, flat config) plus prettier with `--check` in CI — the frontend's counterpart to `ruff format --check`. All UI strings sentence case from the first string.
- vitest with jsdom and Testing Library for component smokes; pure-logic tests run in node environment. Playwright config at `frontend/playwright.config.ts` with `testDir: ../tests/e2e` (the spec's tree puts e2e specs in `tests/e2e/`), chromium only, `webServer` running the real console script — `uv run osr-editor --no-browser --port 8631` — against the built static directory, so the smoke exercises the CLI, the static mount, and the API in production shape. Port 8631 avoids colliding with a developer's live instance.
- State management: none in phase 0. The spec assigns the choice to phase-plan time; the phase 1 plan makes it, since the document-holding screens are phase 1's.

### 3. Continuous integration

One workflow on push to main and pull request, four jobs, mirroring the siblings' shapes:

- **backend** — matrix `[ubuntu-latest, macos-latest]`, `fail-fast: false`, `astral-sh/setup-uv@v6` with `python-version: "3.14"`, then the family gate order: `uv sync --locked`, `ruff format --check`, `ruff check`, `pyright`, `pytest`. The second OS is near-free family parity insurance (pydantic-core ships native wheels).
- **frontend** — ubuntu only (no native variance worth a second OS): `actions/setup-node` from `.nvmrc` with npm cache, `npm ci`, `prettier --check`, eslint, `tsc --noEmit`, `vitest run`, `vite build`.
- **types** — the drift gate, osrlib's SRD pattern adapted verbatim: install both toolchains, run `uv run scripts/generate_types.py`, then fail on any drift with `git status --porcelain -- frontend/src/types/generated` — a non-empty status (which catches brand-new untracked outputs a bare `git diff` misses) prints the status and diff and exits 1, with the regeneration command in the failure message.
- **e2e** — ubuntu: both toolchains, `vite build`, `playwright install --with-deps chromium`, `npx playwright test`.

`release.yml`, the docs job, and the tag-driven pipeline are phase 9's, matching the siblings' release engineering.

### 4. Errors and the API error envelope

- `errors.py`: `OsrEditorError(Exception)` root plus `ArtifactNotFoundError` (needed by the store). The hierarchy grows additively; later phases add their members. The family rule adopted verbatim: programmer misuse raises stdlib `ValueError`/`TypeError`; the typed hierarchy is for runtime failures of the work itself.
- The API error envelope, pinned now because every later route inherits it: error responses carry `{"error": {"code": ..., "message": ..., "remedy": ..., "details": ...}}` with `code` a stable snake_case string, `remedy` and `details` optional. `ApiError` is a pydantic model in `app.py` (route-adjacent, like `StatusResponse`); FastAPI exception handlers map typed errors to it. Phase 0 registers the handler machinery and the first concrete mapping — osrlib's `SaveVersionError` (a newer-schema document) maps to a structured response whose `remedy` names the upgrade, per the spec's documents-and-versioning rules — and pins the convention that each later phase maps the osrlib/forge errors its routes can raise. The 409 stale-revision body is specified with the envelope in work item 6.

### 5. Canonical serialization and the stamped round-trip

`documents.py`, the phase's riskiest external contract, built directly on the research findings:

- The canonical writer is byte-compatible with osr-forge's `write_json_artifact` (`osrforge/workdir.py`), which already produces exactly the spec's canonical form: `json.dumps(data, ensure_ascii=False, indent=2, sort_keys=False)` plus a trailing `"\n"`, UTF-8. `sort_keys=False` is the load-bearing half — pydantic dumps fields in declaration order and `json.loads` preserves insertion order, so write → reopen → re-dump is byte-stable with no sorting anywhere. Compatibility matters beyond aesthetics, but its benefit is scoped the way the spec scopes it: under the *same* installed osrlib, a forge-produced `adventure.json` opened as a native project is already canonical, so its first-write normalization is the empty diff. Across different installed versions the re-stamp changes `engine_version` and byte identity cannot hold — exactly the spec's carve-out (a foreign or older-engine document normalizes on first write, one honest diff); the byte-identity promise itself covers only documents the editor wrote, and the fixture assertions below are engine-version-independent for the same reason.
- API, small and total: `canonical_json_bytes(document) -> bytes`; `dump_adventure(adventure) -> bytes` (`stamp_document("adventure", adventure.model_dump(mode="json"))` through the canonical writer); `load_adventure(data: bytes) -> Adventure` (`json.loads` → `check_document(document, "adventure")` → `Adventure.model_validate`). osrlib's errors propagate untranslated — `SaveVersionError` on a newer `schema_version`, `ContentValidationError` on a wrong kind or malformed envelope — and the API layer attaches remedies (work item 4); the editor never re-implements envelope checking.
- Hazards pinned from research so the implementer doesn't rediscover them:
    - `engine_version()` reads installed package metadata — the envelope's `engine_version` is environment-dependent. Tests never assert its literal value (osr-forge's canary asserts `isinstance(..., str)`); the golden-fixture assertions below are constructed to be independent of it.
    - The only dict-typed fields in a monster-free Adventure tree are `LevelSpec.edges` and `TownSpec.travel_turns`; their key order is insertion order and survives the round-trip untouched.
    - No model in the Adventure tree normalizes input — every `@model_validator` is check-only, there are no field serializers, aliases, computed fields, or `default_factory` uses — so `model_dump` output is structurally identical to what was validated. Defaults serialize in full (every level dumps its `wandering` block); that is expected verbosity, not drift.
    - `check_document` accepts an *older* `schema_version` and returns the payload unmigrated — there is no adventure migration path in osrlib; re-stamping on next write is the whole upgrade story, exactly as the spec describes.
- **The committed golden fixture**: one original mini-adventure, hand-built by a fixture-builder function and written once by the canonical writer to `tests/fixtures/` (an editor-written document, so byte-identity legitimately holds). Content requirements, chosen to exercise every phase-0-relevant serialization shape while staying trivially original: a name, a description, one hook; a town with one `travel_turns` entry; one dungeon, one level (about 3×2) with an entrance, two keyed areas, at least two `edges` entries including one door (locking dict insertion order and the `Edge`/`DoorSpec` coupling), one keyed encounter referencing a shipped SRD monster id (the implementer verifies the exact id against `load_monsters()`; ids reference osrlib's own OGL data — no retail content), and an unguarded-treasure area. `monsters=()` keeps the `MonsterTemplate` subtree out of the runtime fixture (typegen still covers it statically, work item 7). The fixture must pass `validate_adventure`.
- Tests:
    - Byte-stability, environment-independent: build → `dump_adventure` → `load_adventure` → `dump_adventure` → byte-identical (both stamps use the same installed engine version).
    - The golden as the osrlib compatibility gate, three assertions: (a) the committed file loads clean — `check_document`, `model_validate`, and `validate_adventure(adventure, load_monsters(), load_equipment())`; (b) `canonical_json_bytes(json.loads(fixture_bytes)) == fixture_bytes` — the formatting contract, checked without re-stamping so it never depends on the installed engine version; (c) the re-dumped *payload* equals the committed payload exactly — an osrlib upgrade that adds or moves fields fails here loudly, which is the spec's compatibility discipline.
    - A doctored envelope with `schema_version` = current + 1 raises `SaveVersionError`; a wrong `kind` raises `ContentValidationError`.

### 6. The locked contracts — envelope, auth, store

**The ops/revision/diagnostics envelope** (`ops.py`), net-new — no sibling has one; its ancestors are osrlib's commands-in/events-out discipline and forge's versioned artifact contracts. All models frozen pydantic v2. Pinned shapes:

- `EditOp` — the frozen base every operation extends, carrying the discriminator field `op: str` (snake_case code, e.g. `set_adventure_field`). The class docstring pins the growth pattern: concrete ops are frozen subclasses with `op` as a `Literal`, joined into a discriminated `AnyEditOp` union exactly as osrlib builds `AnyCommand`; the vocabulary grows additively. The first concrete ops and the union land with the document service in phase 1.
- `OpBatch` — `revision: str` plus `ops: tuple[EditOp, ...]` (min length 1). Semantics pinned in the docstring: a batch applies atomically, forms one undo step, and is computed against the revision it names.
- `OpBatchResult` — `revision: str` (the new revision) plus `diagnostics: Diagnostics`. The revision is an opaque server-issued string; its representation is phase 1's (the issuer's) decision — the envelope locks the type and the opacity, not the format. The spec's changed-subtree delta is deliberately *not* a phase 0 field: its encoding is the document service's central design problem, and pinning a guess now would be worse than the envelope's own additive-growth rule, which lets phase 1 add it. Named here so phase 1 doesn't miss it.
- `Diagnostics` — `validation: tuple[Finding, ...]` and `lint: tuple[Finding, ...]`, the two tiers the spec's panel renders (tier 1, model validity, is unrepresentable by construction — invalid batches are rejected whole and never become state). Forge-check findings merge in phase 5 via an additive `forge` field.
- `Finding` — `source: Literal["validation", "lint", "forge"]`, `code: str`, `message: str`, `address: str | None`. The address grammar (area/cell/edge addressing for click-to-navigate) is pinned by the first producers — phase 1 for validation, phase 2 for lint — as content within the locked shape; forge's `AreaAddress` form and osrlib's `cell_ref`/`edge_ref` are the precedents they draw on.
- The 409 convention, completing work item 4's envelope: a stale-revision rejection is an `ApiError` with `code = "stale_revision"` and `details` carrying the current revision, so a second tab can resync instead of guessing. Serialization round-trip tests lock all of these shapes; behavior tests belong to phase 1's service.

**The auth dependency** (`app.py`): `User` (frozen, `id: str`) and `get_current_user() -> User` returning the local user unconditionally, exposed as `CurrentUser = Annotated[User, Depends(get_current_user)]`. Every `/api` route declares it, starting with `/api/status`. The seam is enforced by test, not convention: a test walks the app's routes and asserts every `/api` route's dependency tree includes `get_current_user` — the hosted future changes one function, and no route can forget the seam without failing CI.

**The `ProjectStore` protocol** (`store.py`), forge's `ModelProvider` seam applied to persistence:

- A `runtime_checkable` `Protocol`, exactly the spec's surface: `list_artifacts(project_id) -> list[str]`, `read_artifact(project_id, name) -> bytes`, `write_artifact(project_id, name, data) -> None`. Bytes, not text — byte-identity is the serialization contract, and encoding policy belongs to `documents.py`. Artifact names are POSIX-style relative paths (forge workdirs nest `stages/` and `pages/`). Growth is additive: deletion arrives with the phase that needs it, workdir materialization for forge operations with phase 5, per the spec's sync-down-and-back design.
- `LocalProjectStore`: the project id *is* the absolute project directory path — a mapping decision owned by this store, not the protocol; a remote store maps ids however it likes. Reads raise `ArtifactNotFoundError` on a missing artifact. Writes are atomic — temp file in the target directory, then `os.replace` — because an always-saved editor rewrites `adventure.json` constantly and must never tear it. Artifact names are validated to resolve inside the project directory (no `..` escape).
- Tests: write/read/list round-trip including a nested name, missing-artifact error, traversal rejection, atomicity smoke (the temp file never survives), and an `isinstance` check under the `runtime_checkable` protocol.

### 7. Type generation and the drift gate

The spec's drift discipline over a net-new pipeline. Tool choice, driven by the schema dialect: pydantic v2 emits JSON Schema 2020-12, whose `prefixItems` tuples (`Position` → `[number, number]`) and `$defs` the older draft-07 generators (json-schema-to-typescript and kin) mishandle — while FastAPI natively emits OpenAPI 3.1, which *embeds* JSON Schema 2020-12, and **openapi-typescript** targets exactly that dialect, is actively maintained, and types the route surface as well as the models. So generation goes through one composed OpenAPI document rather than raw per-model schemas:

- `scripts/generate_types.py` (a `uv run` script): build the app, take `app.openapi()`, and inject the models no phase-0 route references yet via `pydantic.json_schema.models_json_schema` with `ref_template="#/components/schemas/{model}"`, merged into `components.schemas`. The injection list is explicit in the script — `Adventure` (which statically pulls the entire content tree, `MonsterTemplate` subtree included, regardless of what fixtures exercise) plus the envelope models (`OpBatch`, `OpBatchResult`, `Diagnostics`, `Finding`, `EditOp`, `ApiError`); the script fails on any schema-name collision. Injection uses serialization-mode schemas — the frontend consumes these shapes as server output, and serialization mode marks always-emitted fields required, which is the truth about documents the backend dumps. As routes begin referencing a model, it leaves the injection list; route-referenced models come along free.
- The script then runs the pinned openapi-typescript from `frontend/` (`npm exec`) and writes the single committed artifact: `frontend/src/types/generated/api.ts`. The intermediate OpenAPI document is not committed — one generated artifact, one drift gate. `.prettierignore` covers the generated directory: the drift gate, not prettier, owns those bytes, and nobody may hand-edit a generated file to satisfy a formatter. Friendly aliases (`export type Adventure = components["schemas"]["Adventure"]`) live in a tiny hand-written `frontend/src/types/index.ts` — type-checked, so a vanished schema breaks loudly at `tsc` time, and never hand-mirroring a shape (the guide's fence).
- Determinism, so the gate never cries wolf: pydantic's schema output and `app.openapi()` are deterministic; openapi-typescript is pinned exactly in `package-lock.json`; the generated banner carries no timestamps.
- Translation expectations recorded from research: `Position` → `[number, number]`; `edges`/`travel_turns` → `Record<string, ...>`; the `EncounterEntry` discriminated union → a tagged TS union; StrEnums and `Literal`s → string-literal unions with osrlib's exact lowercase wire values; `MonsterAbility.params` degrades to a loose record — acceptable, it is referee-facing prose parameters. Verified two ways: the generated output compiles under `tsc`, and a vitest type-level suite (`expectTypeOf`) pins the load-bearing translations — `Position` is a two-tuple, not `number[]`; `edges` is a `Record`; the encounter union discriminates — so a generator regression on a future version bump fails loudly instead of silently loosening types. The assertion file must sit inside `tsc --noEmit`'s include set (or run under vitest's typecheck mode) — an unchecked type assertion asserts nothing.
- The CI gate is work item 3's **types** job: regenerate, then `git status --porcelain` over the generated directory fails on any modification or new untracked file. During implementation, the gate is proven red once (a deliberate local edit) before trusting it green.

### 8. The wired skeleton

The phase's demonstrable outcome: the two halves talking through generated types.

- `app.py`: `create_app()` factory; `GET /api/status` returning `StatusResponse` — editor version (package metadata), osrlib's `engine_version()`, osrlib's `SCHEMA_VERSION` — behind the auth dependency; the exception handlers from work item 4; last, the static mount (`StaticFiles(html=True)` over `src/osreditor/static/`, osr-web's serving pattern), guarded so a dev backend without a built frontend still boots and serves `/api`.
- `main()`: argparse for `--port` (default 8630, the spec's pin) and `--no-browser`; runs uvicorn on localhost only; opens the browser to the served page unless suppressed. The `PATH` argument is phase 1's, with the home screen — accepted flags are exactly what phase 0 can honor.
- Frontend: a single page that fetches `/api/status` through a thin typed client over the generated types and renders name and versions on a shadcn card — deliberately minimal, replaced by the phase 1 home screen. Sentence case throughout.
- Dev loop, documented in the README: terminal one `uv run osr-editor --no-browser`, terminal two `npm run dev` in `frontend/` (Vite proxies `/api`). No orchestration script until the two-command loop actually chafes — the spec's `scripts/` note anticipates one; it can land in any later phase without ceremony.
- Tests: `TestClient` unit tests for `/api/status` (shape, auth resolution) and the error-envelope mapping — exercised through a throwaway route registered on the test app that raises `SaveVersionError`, since no shipped phase 0 route loads documents; the throwaway route drives the real handler wiring through the `TestClient` rather than invoking the handler directly. A vitest smoke for the status component; the Playwright smoke — launch via the real console script against the built frontend, assert the page shows the backend-reported version — which is also the CLI's integration test.

### 9. Tests

Consolidated from the work items, the phase 0 suite:

- **documents**: canonical-writer byte-stability; the three golden-fixture assertions (load + validate clean, formatting identity, payload identity); newer-schema and wrong-kind error paths.
- **ops envelope**: serialization round-trips for every envelope model; `OpBatch` minimum-length enforcement; frozen-ness.
- **store**: round-trip, nested names, missing-artifact, traversal rejection, atomic-write smoke, protocol `isinstance`.
- **app**: status shape; auth-dependency route introspection; error envelope for a mapped osrlib error via the throwaway test route; static mount serves the built `index.html` when present.
- **frontend (vitest)**: status component renders fetched data; typed client compiles against generated types; type-level assertions on the pinned translations.
- **e2e (Playwright)**: the wired-skeleton smoke.
- All green under `uv run pytest`, `npx vitest run`, and `npx playwright test` locally and in CI.

## Sequencing

1. Python scaffolding, license, CHANGELOG, CI backend job — green on a trivial test before real code lands.
2. `errors.py`, then `documents.py` with the fixture and round-trip tests — the riskiest external contract, retired first.
3. `store.py`, the auth dependency, and the `ops.py` envelope models — the three locks, each with its tests.
4. Frontend scaffolding and the status page; frontend CI job.
5. `scripts/generate_types.py`, the committed generated types, the types CI job; retrofit the frontend client onto the generated types.
6. Playwright smoke and the e2e CI job.
7. README polish, PyPI re-verification recorded, and a final traceability pass: every phase 0 roadmap item maps to code and tests here or to a named deferral above.

## Definition of done

- The full gauntlet passes locally and in CI: `uv sync --locked && uv run ruff format --check && uv run ruff check && uv run pyright && uv run pytest` on both OSes; `npm ci && npx prettier --check . && npx eslint . && npx tsc --noEmit && npx vitest run && npm run build` in `frontend/`; the types job drift-clean; the e2e job green.
- `uv run osr-editor --no-browser` serves the built frontend, and the page renders the backend's status through generated types — the skeletons are wired, not adjacent.
- `dump_adventure` → `load_adventure` → `dump_adventure` is byte-identical in tests, and the committed golden fixture loads, validates, and re-serializes to its committed bytes against the pinned osrlib — the compatibility gate is live from day one.
- The three contracts are locked and enforced: every `/api` route resolves the auth dependency (proven by introspection test), the envelope models round-trip with their semantics documented, and the local `ProjectStore` passes its suite including atomic writes.
- The typegen drift gate was demonstrated red on a deliberate local edit before merging, and `frontend/src/types/generated/api.ts` is committed and current.
- PyPI availability of `osr-editor` is verified and recorded in this plan's amendments.
- Every phase 0 item in the spec's roadmap entry is traceable to code and tests here, or explicitly deferred above with its phase named.
