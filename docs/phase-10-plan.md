# Phase 10 plan — screenshots in the guides

Implementation plan for phase 10 of [the osr-editor spec](spec.md): the published guides gain screenshots of the real editor, captured by an automated Playwright harness whose failure is a CI failure. The milestone is a reader who has never launched the editor seeing every surface the guides describe — and a UI change that invalidates a screenshot failing the build rather than shipping a caption that lies.

Phase 9 deferred exactly this, and named both the trigger and the mechanism: *"a stale screenshot of a living UI is a lie with a caption, and the revisit trigger is named (a 1.0 site, or evidence readers bounce without them); if that trigger fires, Playwright already automates the capture"* (`phase-9-plan.md:31`). The owner has fired the trigger. That deferral is not relitigated here — it is honored: this plan's center of gravity is the staleness gate, not the images. A screenshot in this repository is not a committed PNG; it is *a scripted, asserted UI state that a PR must be able to reproduce*.

Like phase 9, this phase adds no editor behavior. Unlike phase 9, it adds no packaging surface either: its deliverables are a test harness, a check script, one CI job, and prose.

Seven research facts shape this plan more than any others, each verified against this tree rather than recalled:

1. **`strict: true` already fails the docs build on a missing image — verified empirically (2026-07-24).** Appending `![missing shot](assets/nope.png)` to `docs/index.md` aborts `uv run mkdocs build --strict` with *"contains a link 'assets/nope.png', but the target is not found among documentation files."* The site's `validation:` block (`mkdocs.yml:56-64`) makes every unresolved reference an error. A deleted or renamed screenshot therefore cannot reach the published site, and the existing **docs** job in `ci.yml:156` is already that gate — this phase adds no configuration to earn it.
2. **Material's `#only-light` / `#only-dark` image suffixes survive strict validation — verified empirically (2026-07-24).** The concern was real: `validation.links.anchors: warn` (`mkdocs.yml:64`) plus `strict: true` could have rejected `shot.png#only-light` as an unresolvable anchor. A probe build referencing both suffixes against a real PNG produced no anchor warning and no abort. mkdocs-material 9.7.7 is installed and implements the feature in its own CSS, so the theme-swapped images need **no plugin, no extension, and no `extra_css`**.
3. **The app's dark mode is a pure media query, and the map canvas subscribes to it.** `frontend/src/index.css:32` is `@media (prefers-color-scheme: dark)` with no class toggle anywhere, and the map — a `<canvas>` painted through `getContext('2d')` (`map-canvas.tsx:87`) — selects between `LIGHT_THEME` and `DARK_THEME` (`map/render.ts:28,41`) through `usePrefersDark()`, which listens for `matchMedia` change events (`map-editor.tsx:135-149`). Playwright's `colorScheme` emulation drives exactly that media query, so both the chrome and the canvas flip with **zero app changes**. This is what makes the two-theme capture nearly free rather than a feature request against the frontend.
4. **Capturing the home screen naively would publish the owner's real local paths — and `HOME` redirection fixes it on every platform, verified empirically (2026-07-24).** `config.py:71` resolves recents through `platformdirs.user_config_path("osr-editor")` with no environment override, and `home-screen.tsx:162,183` renders each recent's full `recent.path` in the card. The e2e suite's existing `XDG_CONFIG_HOME` redirect (`playwright.config.ts:22-24`) carries the comment *"macOS platformdirs ignores this"* — harmless for tests, a privacy leak for a published image. Setting `HOME` to a scratch directory relocates the config path on macOS (`/tmp/fakehome/Library/Application Support/osr-editor`) and, by the same mechanism, on Linux. The harness therefore curates its own recents on every platform without touching `config.py`.
5. **The fixtures for every hard surface already exist and are zero-network.** `tests/fixtures/forge_workdir` is a complete forge workdir raising twelve flags across five areas of *The Millstone Warrens* (`forge.spec.ts:14,46-60`) — the whole forge-backed review guide, with no conversion run. `tests/assets/minimod` carries the PDF plus the committed page renders the fixtures were recorded against, and `conversion.spec.ts` already fabricates a warm workdir from them. `tests/assets/prose` holds the recorded prose exchanges the assistant replays, fingerprinted against a *"Stocking demo"* project with a blank area 1 (`aids.spec.ts:8-10`). `tests/assets/opd/nominal.json` drives the import dialog's converter notes. No new fixture is authored in this phase, and the "no network in tests" invariant holds unchanged.
6. **The e2e specs have duplicated their helpers four times over.** `createProject`, `openMap`, `cellCenter`, `edgePoint`, and `drag` appear near-identically in `map.spec.ts:35-77`, `stocking.spec.ts:35-75`, `monsters.spec.ts:37-45`, and `aids.spec.ts:29-60`, each re-deriving cell geometry from `CELL_SIZE`/`RESET_MARGIN` (`map/view.ts:7,10`). A capture harness that needs the same gestures must not become the fifth copy. Greenfield discipline applies: extract them once, update every call site, let the suites be the safety net.
7. **The map view is only deterministic after an explicit reset.** `resetView()` (`map/view.ts:43`) and the **Reset zoom** button pin the transform, and every existing map spec clicks it before computing cell coordinates. A screenshot taken without it captures whatever pan and zoom the preceding gestures left behind — the difference between a reproducible image and a random one.

## Scope

In scope:

- A capture harness under `tests/screenshots/`, wired as Playwright projects in `frontend/playwright.config.ts` with its own server, curated `HOME`, pinned viewport, and a light/dark project pair
- The shared e2e helper module fact 6 requires, with the four existing specs migrated onto it
- The shot list below — 22 shots across the landing page, the quickstart, and all seven guides — each one an asserted UI state, not a bare capture
- The captured PNGs committed under `docs/assets/screenshots/`, referenced from the guides with Material's theme suffixes and sentence-case captions
- `scripts/check_screenshots.py` — the docs↔assets consistency and weight-budget guard
- A **screenshots** CI job that runs the harness and fails when a shot cannot be produced, and uploads the freshly captured set as an artifact for human eyeballing
- The `AGENTS.md` capture runbook: the one command that regenerates, and the rule that a PR changing a screenshotted surface re-captures in the same PR
- The phase 10 roadmap entry in `docs/spec.md` and the CHANGELOG bullet

Out of scope (each with where it goes): **Pixel-diff regression gating** — rejected on evidence, not taste: the app uses system font stacks only (`index.css:56-58`, *"System stacks only — no bundled webfonts"*), so macOS-captured PNGs and CI's Linux rendering differ on glyph rasterization in every text-bearing shot, and a pixel gate would fail on cosmetic noise while teaching the team to ignore it. The gate this phase ships fails on *structural* drift — a renamed control, a restructured panel, a state that no longer reaches the screen — which is the failure that actually makes a caption lie. The revisit trigger is named: if the capture is ever moved to a container that renders identically to CI, byte-comparison becomes viable and this decision should be reopened in that change's own plan. **Screenshots in the README** — PyPI renders it far from the repository and would need absolute raw-GitHub URLs, a second staleness surface with no gate over it; the README keeps its product-map role from phase 9 item 7 and links to the site. **Animated GIFs or video** — the gestures the guides describe (drag a room, click-cycle an edge) are genuinely motion, and motion would teach them better, but the artifact is unreviewable in a diff, unbounded in weight, and has no staleness gate at all; the trigger for reopening is a guide whose prose demonstrably cannot carry a gesture. **Annotated or callout-overlaid images** — an overlay is authored content that drifts independently of the UI beneath it; the caption and surrounding prose carry the pointing, and `attr_list` is already available if a future change wants sizing. **A screenshot of the walk-mode surface** — it does not exist (`backlog.md`). **New editor behavior of any kind, including a config-path override** — fact 4's `HOME` redirect makes the tempting `OSR_EDITOR_CONFIG_DIR` addition unnecessary, and the app surface stays frozen exactly as phase 9 left it.

## Work items

### 1. The shared e2e helpers

`tests/e2e/helpers.ts` — a new module exporting the gestures fact 6 found duplicated: `createProject(page, dir, name)`, `openMap(page)`, `resetView(page)`, `cellCenter(page, x, y)`, `edgePoint(page, x, y)`, `drag(page, from, to)`, and `drawRoom(page, a, b)`. The four existing specs drop their private copies and import from it; behavior does not change, and the existing suites passing unchanged is the proof. `cellCenter` and `edgePoint` keep deriving from `CELL_SIZE`/`RESET_MARGIN` rather than hardcoding pixels, and `resetView` wraps the **Reset zoom** click fact 7 makes mandatory. `tests/e2e/tsconfig.json` already covers the directory, so the type check (`npx tsc -p ../tests/e2e`, `ci.yml:148`) extends to the module for free.

### 2. The capture harness

`tests/screenshots/` — a Playwright testDir beside the e2e suite, sharing its helpers and its zero-network posture. `frontend/playwright.config.ts` grows per-project `testDir` overrides:

- `e2e` — the existing chromium project, `testDir: '../tests/e2e'`, unchanged behavior.
- `shots-light` and `shots-dark` — `testDir: '../tests/screenshots'`, `viewport: { width: 1280, height: 800 }`, `deviceScaleFactor: 2`, `colorScheme: 'light' | 'dark'`, and `reducedMotion: 'reduce'`.

The shots projects run against **their own server on port 8632** — not the e2e server on 8631 — because the capture needs the curated `HOME` of fact 4 and the e2e suite must keep the recents posture it has. `webServer` grows a second entry: the same `uv run osr-editor --no-browser --port 8632` command with `HOME` pointed at `frontend/test-results/shots-home` and `XDG_CONFIG_HOME` at a scratch path beneath it, plus `UV_CACHE_DIR` pinned to the real cache so the redirected `HOME` cannot trigger a dependency re-download. The harness seeds that config with three curated recents — plausible adventure names at plausible paths (`~/adventures/the-mill-on-the-moor.osr` and kin) — so the home-screen shot shows a furnished editor and never a `/var/folders/` path.

Every shot obeys four rules, and the rules are the gate:

1. **Assert before capture.** A shot named `stocking-menu` asserts the menu's items are visible before it fires. The capture is the *last* statement of a test that has already proven the state — which is what makes the CI job's green a claim about the picture and not merely about the file.
2. **Reset the view before any map shot** (fact 7).
3. **Clip to the subject unless the layout is the point.** `locator.screenshot()` on the panel, dialog, or menu under discussion; full-window `page.screenshot()` only for the five shots whose subject is the whole arrangement. This is the weight control and it is also the better image.
4. **`animations: 'disabled'`, `caret: 'hide'`** on every capture, so a blinking cursor or an in-flight transition cannot vary the output.

Slugs are written once, as the PNG path each test targets: `docs/assets/screenshots/<slug>-light.png` under `shots-light`, `-dark.png` under `shots-dark`. There is deliberately **no manifest file**: the docs reference a slug, mkdocs strict fails when the file is absent (fact 1), and item 4's orphan check fails when a file no page references appears. The two directions pin each other with nothing to keep in sync.

### 3. The shot list

Twenty-two shots. Each names its page, its state, and the fixture it needs; every one is reachable from the existing zero-network fixtures of fact 5.

**Landing and quickstart** — `map-editor-hero` (full window; the demo adventure's stocked level 1 with the inspector — `index.md`), `home-screen` (full window; curated recents, **New adventure**, **Open project**, **Convert a PDF**), `new-adventure-dialog`, `first-room` (the room tool's rectangle just dropped on the blank grid), `stocking-context-menu`, `export-dialog`.

**Projects** — `project-chrome` (full window; the Adventure/Town/Monsters sections beside the map, revision token visible), `diagnostics-panel` (findings listed and navigable, the validity-tiers claim made visible).

**The map editor** — `map-toolbar` (the tool palette, clipped), `map-lint-markers` (full window; an unreachable area and an unpaired transition marked on the canvas with the panel beside), `level-chrome` (the dungeon and level pickers).

**Stocking and keyed content** — `area-content-cards` (encounter, treasure, and trap cards on one area), `map-key-glyphs` (hollow versus stocked key numbers with the `F` filter dimming), `wandering-table` (the inline d20 editor).

**The monster editor** — `monsters-section` (the bundled-template list), `monster-detail` (the stat-block editor).

**Forge-backed review** — `review-queue` (the twelve flags), `source-pages` (a flagged area with its printed page alongside — the shot that carries the whole guide), `corrections-panel` (overrides with their reasons), `monster-resolution`.

**Converting a PDF** — `estimate-card` (the cost gate before anything is spent), `pipeline-panel` (the per-stage table).

**Authoring aids** — `stocking-report` (the roll's result with its honest follow-up badges), `prose-assistant` (a draft beside the current text with token usage).

Sharp-eyed arithmetic: that is 23 names across the groups because `stocking-context-menu` serves both the quickstart and the stocking guide — one image, two references, which item 4's check explicitly permits.

### 4. The consistency and budget guard

`scripts/check_screenshots.py` — stdlib-only, run as `uv run python scripts/check_screenshots.py`, accumulating every failure before exiting, in the idiom of `scripts/release/check_dist.py`. It parses every published `.md` under `docs/` for `assets/screenshots/*.png` references and asserts: every referenced file exists; every existing file is referenced by at least one page (no orphans, the direction mkdocs cannot check); every referenced shot has **both** a `-light` and a `-dark` twin and carries the matching Material suffix; every image has non-empty alt text; and the directory's total weight stays under **12 MB**, so the repository cannot bloat silently one shot at a time. The script joins the **docs** CI job, where it costs nothing and guards the artifact the job publishes.

### 5. CI

`ci.yml` grows a **screenshots** job, modeled on the existing **e2e** job (`ci.yml:114-153`) — checkout, uv, node, `uv sync --locked`, `npm ci`, `npm run build`, `npx playwright install --with-deps chromium` — then `npx playwright test --project=shots-light --project=shots-dark`. The job fails when any shot's assertions fail or any capture cannot be produced, which is the phase's whole gate. It uploads the captured directory with `actions/upload-artifact@v4` so a reviewer can compare the fresh set against the committed one by eye — the honest complement to declining pixel comparison. The **e2e** job pins `--project=e2e` so the two suites stay separable and the existing job does not silently start capturing.

The job runs on ubuntu only, like **docs**: it proves the harness, and per the out-of-scope note it is explicitly *not* proving the committed bytes. The committed PNGs are captured by the owner on macOS with `npm run shots`; CI's copy differs in font rasterization by design.

### 6. The docs changes

Each of the ten published pages gains its shots inline, placed where the prose already turns to that surface, in the pattern fact 2 verified:

```markdown
![The review queue listing twelve flags](../assets/screenshots/review-queue-light.png#only-light)
![The review queue listing twelve flags](../assets/screenshots/review-queue-dark.png#only-dark)
```

Alt text describes the state, not the file; captions and any surrounding prose stay sentence case. The guides' existing prose is not rewritten — screenshots are added *to* arguments that already work, and any sentence a screenshot makes redundant is cut rather than left to say the same thing twice.

### 7. The runbook, the roadmap, and the changelog

`AGENTS.md` grows a short capture section: `npm run shots` regenerates every PNG (a `package.json` script wrapping the two Playwright projects); the committed images are captured on the owner's machine and CI proves only that the harness still runs; and — the rule that keeps this phase's promise — **a PR that changes a screenshotted surface re-captures in the same PR**, the same discipline the changelog and the generated types already carry. `docs/spec.md` gains the phase 10 roadmap entry, which is what makes `docs/phase-10-plan.md` match the existing `exclude_docs: phase-*-plan.md` pattern (`mkdocs.yml:47-50`) and stay off the published site with no configuration change. `CHANGELOG.md` gains its `[Unreleased]` bullet.

## Sequencing

1. Extract `tests/e2e/helpers.ts` and migrate the four specs; the suites pass unchanged (item 1). This lands first because everything downstream imports it.
2. Wire the config's per-project `testDir`, the second `webServer` with the curated `HOME`, and the light/dark pair; prove the seed with one throwaway shot of the home screen showing curated recents and no real path (item 2).
3. Capture the shot list, group by group, easiest fixtures first: native-project shots, then forge (`tests/fixtures/forge_workdir`), then conversion (the warm workdir), then the prose assistant (`tests/assets/prose`) — the ordering of increasing fixture setup, so a fixture problem surfaces against one group rather than all of them (item 3).
4. `scripts/check_screenshots.py`, seen to fail once on a deliberately orphaned PNG and once on a missing dark twin, before it is wired into the **docs** job (item 4).
5. The **screenshots** CI job and the `--project=e2e` pin (item 5).
6. The docs edits, page by page, with `mkdocs build --strict` green and the pages read end to end in both themes (item 6).
7. The runbook, the roadmap entry, the changelog (item 7).

## Definition of done

- The full standing gate is green, now including the **screenshots** job, and the docs build passes strict with every image resolving.
- The harness produces all 22 shots in both themes from a clean checkout with one command, with no network beyond localhost.
- Every shot is gated by assertions that prove its state before it captures — no test in `tests/screenshots/` consists only of navigation and a capture.
- The guard has been *seen* to fail on an orphaned PNG and on a missing dark twin, not merely written.
- The home-screen shot shows curated recents; no committed image contains a real local path, a temp path, or any personal information.
- The four e2e specs import their gestures from one module, and no helper is defined twice anywhere under `tests/`.
- Every published page that describes a UI surface shows it, in both themes, with alt text; `docs/assets/screenshots/` holds no orphan and stays under the weight budget.
- `AGENTS.md` carries the capture runbook including the re-capture-in-the-same-PR rule; `docs/spec.md` carries the phase 10 entry; `CHANGELOG.md` carries the bullet.
- The phase 9 deferral is closed on its own terms: the screenshots are in the guides, and a UI change that would strand one fails CI rather than shipping a lie with a caption.
