# Agent guide for osr-editor

osr-editor is a local GUI application for creating and modifying adventure modules playable by [osrlib](https://github.com/mmacy/osrlib-python)-powered games: a FastAPI backend that imports osrlib and [osr-forge](https://github.com/mmacy/osr-forge), serving a React frontend. It authors stamped `adventure.json` documents directly (native projects) and corrects forge conversions through `overrides.yaml` (forge-backed projects).

## Start here

- `docs/spec.md` is the single source of truth. Read it before any implementation work. It is decision-complete: architecture, contracts, interaction models, and a phased roadmap. Implement in phase order.
- `docs/backlog.md` records features cut from the spec and deferred indefinitely. It is not scope and never drives implementation; an item leaves it only when the owner puts it back on the roadmap. Read it when you need to know why a capability the spec once described is absent.
- osrlib (checked out at `~/repos/osrlib-python`, published as `osrlib`) is the schema and rules authority. The adventure document *is* osrlib's pydantic models; loading, validation, and play go through `check_document`, `Adventure.model_validate`, and `validate_adventure`. Never re-implement or fork osrlib's rules or validation — the one sanctioned exception (the live structural lint) is pinned in the spec with rationale.
- osr-forge (checked out at `~/repos/osr-forge`, published as `osr-forge`) is the conversion authority: workdir layout, `overrides.yaml` schema, report flag and finding vocabularies. When a forge-contract question comes up, its spec and code are the authority; verify against them rather than working from memory.
- osr-web (checked out at `~/repos/osr-web`) is the reference consumer; "publish" means satisfying its `adventures/` discovery rules.
- Frontend types under `frontend/src/types/generated/` are generated from the pydantic models. Never hand-edit them and never hand-write a TypeScript mirror of an osrlib schema.

## The phase loop

Each roadmap phase in `docs/spec.md` ships as two PRs — a plan, then an implementation — and both follow the same create → rubber-duck → revise-until-solid → PR loop. "Work up a plan for phase N" or "implement the plan for phase N" means run this loop end to end, unprompted. The workflow mirrors osrlib-python's `AGENTS.md`; keep parity with it unless this file says otherwise.

### Planning a phase

1. Research first: the phase's roadmap entry and every contract it touches in `docs/spec.md`, the prior phase plans in `docs/`, the existing code, and the osrlib and osr-forge surfaces the phase consumes. Hazards found during research (model validators, forge normalization rules, frozen-model rebuild patterns) belong in the plan so the implementer doesn't rediscover them.
2. Write `docs/phase-N-plan.md`, structured like the sibling projects' phase plans: intro with the spec milestone, scope (in and out, naming the phase that picks up each deferral), work items, sequencing, definition of done. Plans are decision-complete: every choice an implementer would otherwise guess at is pinned with a rationale.
3. Branch `phase-N-plan`; commit the draft as `add phase N implementation plan (pre-review draft)`.
4. Rubber-duck it (below), revise until SOLID, open the PR.

### Implementing a phase

The same loop on branch `phase-N-impl`: implement to the plan with tests green, commit, rubber-duck the result, and address findings as `address rubber-duck review findings`. The plan is the contract — when implementation reveals the plan was wrong or silent, amend the plan document on the same branch (`amend phase N plan: ...`) so plan and code never diverge.

### The rubber-duck loop

- Spawn a fresh subagent as a skeptical senior reviewer. Give it an ordered reading list — the spec, prior plans, this file, the artifact under review, the relevant code, and the osrlib or osr-forge models and docs the work touches — and require evidence: every finding must quote the spec, the code, or the artifact, be ranked blocking vs non-blocking, and the review must end in a verdict (SOLID or NEEDS REVISION) plus a verified-good list of claims it actively checked.
- The reviewer's mandate covers design hygiene, not just spec fidelity: it must hunt for the greenfield anti-patterns below (back-compat shims, dual import paths, deprecation scaffolding, dead accommodation code) and flag any it finds.
- Judge findings on the merits. Verify disputed claims against the spec, osrlib, osr-forge, or the code yourself; push back on findings that are wrong instead of deferring to the duck. Address what survives and commit as `revise phase N plan per rubber-duck review` (or the address-findings message above).
- Send the revision back to the same reviewer, context intact, for re-verification of each fix. Loop until SOLID. Fold in any sign-off notes.
- Commits tell the honest story — draft, revision(s), sign-off tweaks — and the PR description summarizes the notable decisions plus the review provenance (what the duck found, what changed).

## Toolchain

- Python ≥ 3.14. Package management with `uv` exclusively (`uv add`, `uv sync`, `uv run`) — never `pip`.
- Format with `ruff format`, lint with `ruff check`, type-check with `pyright`, test with `pytest` (not unittest).
- Type hints use built-in generics (`list[str]`, `dict[str, int]`). Do not import `List`/`Dict`/`Tuple` from `typing` and do not use `from __future__ import annotations`.
- Docstrings are Google style, written in Markdown. Maximum line length 120.
- The node toolchain (React, TypeScript, Vite, Tailwind CSS, shadcn/ui as vendored source, vitest, Playwright) is development-only. The wheel ships the built frontend; users never need node.
- Type generation is a `uv run` script; CI regenerates and fails on drift, same discipline as osrlib's SRD data pipeline.
- All user-facing UI strings are sentence case.

## Greenfield discipline

Refactor freely and update every call site — tests are the safety net. No re-exports or aliases kept to preserve an old import path, no deprecation scaffolding, no code kept "just in case" — git history is the archive. The fences that are real belong to others or to shipped artifacts: the stamped adventure document and its `schema_version` rules are osrlib's contract (consume, never fork), `overrides.yaml` and the workdir are osr-forge's contract (write only what its schema defines), and the editor's own `editor.json` sidecar schema is additive-only within its schema version. That last fence is owner-waived while no external consumers exist, mirroring the siblings' posture; the owner's declaration governs.

## Invariants the spec imposes

These are contracts, not suggestions — see the corresponding spec sections before touching related code:

- **The backend is authoritative.** The frontend renders state and sends edit operations; it never re-implements rules, validation, or serialization.
- **Ops in, state and diagnostics out.** Edit batches apply atomically, form one undo step each, and carry revision tokens; a stale revision is a 409, never a silent overwrite.
- **Always-saved, canonically serialized.** A committed op persists immediately; a no-op session over a document the editor wrote produces a byte-identical file (foreign documents normalize on first write).
- **Validity tiers.** Model validity is enforced by construction; dangling references are diagnostics, legal while editing; `validate_adventure` cleanliness gates publish, not editing.
- **Forge output stays reproducible.** In a forge-backed project the editor writes `overrides.yaml` and re-runs `assemble` — it never writes `adventure.json`, `report.json`, or previews in a workdir. Its own `editor.json` sidecar is the one editor file a workdir carries. Assembly purity is forge's core invariant and the editor honors it absolutely.
- **Seams stay honest.** Auth goes through the single auth dependency, persistence through `ProjectStore`, external map formats through `GeometryImporter` entry points, model access through forge's `ModelProvider`. No code outside a seam may assume single-user, local filesystem, a map format, or a vendor.
- **No secrets on disk.** Provider credentials come from the environment; editor config never stores them.
- **No network in tests.** Conversion and LLM paths test against forge's `FixtureProvider` recordings; live model calls never run in CI.

## Testing expectations

- Run `pytest` before committing. The backbone suites are op application/rejection, undo/redo, canonical-serialization byte-stability, lint findings, and op→override translation goldens.
- Frontend logic under vitest; core loops under Playwright, headless in CI.
- Golden `adventure.json` fixtures load against the pinned osrlib in CI, so an upstream change in document semantics fails loudly here first. Test fixtures use freely licensed or original material only — no retail module content enters the repository.

## Releasing

- The version lives in `pyproject.toml` alone; `_editor_version()` reads installed metadata at runtime and no `__version__` symbol exists (osrlib rejected one explicitly, and this repo inherits the rationale). The bump procedure: edit the version, run `uv lock`, and nothing else.
- Changelog discipline applies from the first phase: a PR that changes user-visible behavior adds its bullet to the `[Unreleased]` section of `CHANGELOG.md` in the same PR. Cutting a release renames `[Unreleased]` to `[X.Y.Z] - <date>`, leaves an empty `[Unreleased]` above it, and updates the link-reference block at the bottom of the file (`[Unreleased]` comparing `vX.Y.Z...HEAD`, each version pointing at its release tag). Maintaining that block is part of every release cut — osrlib's own block drifted unmaintained after 1.3.0, and this repo does not repeat that.
- A release is an annotated `vX.Y.Z` tag on the merge commit (`git tag -a vX.Y.Z -m "osr-editor X.Y.Z"`, then push the tag). `release.yml` does the rest: fails fast if the tag doesn't match the pyproject version, re-runs the full standing gate (all four `ci.yml` jobs, duplicated by hand — a tag push triggers no CI run) plus the strict docs build, builds once — the Vite build before `uv build`, the ordering that puts the frontend in the wheel — audits the artifacts with `scripts/release/check_dist.py`, smoke-tests the wheel in a fresh venv on both OSes with `scripts/release/install_smoke.py` (which boots the installed console script and fetches the UI from it), publishes to PyPI via trusted publishing (no tokens anywhere in the repository), and creates the GitHub Release from the tagged version's changelog section.
- The local dry run before tagging starts with the frontend build — a dry run that skips it audits a stale static tree: `cd frontend && npm ci && npm run build && cd ..`, then `uv build`, then `python3 scripts/release/check_dist.py dist X.Y.Z`, then install the wheel into a fresh venv (`uv venv --python 3.14 smoke-venv`, `uv pip install --python smoke-venv/bin/python dist/osr_editor-*.whl`) and run `smoke-venv/bin/python scripts/release/install_smoke.py X.Y.Z`.
- Recovery: any failure before the publish job leaves PyPI untouched — delete the tag, fix on a branch, re-tag. Once publish succeeds, that version's filenames are burned on PyPI and the next attempt is a new version. The docs gate fetches the siblings' `objects.inv` inventories over HTTP at build time — the one named build-time network dependency — so an upstream outage fails the gate before publish, and the same recovery rule covers it.
- One-time setup, completed during the 0.1.0 release (2026-07-24): the PyPI pending trusted publisher for project `osr-editor` (repository `mmacy/osr-editor`, workflow `release.yml`, environment `pypi`), the matching `pypi` environment in the GitHub repo, and the Pages source set to "GitHub Actions". Provenance, recorded honestly the first time: a pending publisher existed before the release naming workflow `package_pub.yml` with no environment constraint; it was replaced during the release with the `release.yml`/`pypi` publisher the workflow actually authenticates as.
- Versioned documentation is not adopted; Pages-from-`main` is the whole deployment. The adoption trigger, carried from the siblings verbatim: the first post-1.0 release whose published docs must describe behavior different from `main` adopts mike or equivalent in that release's own plan. Patch and docs-only releases do not trigger it.

## Licensing

Package code is MIT. osr-editor ships no game content — osrlib carries the OGL data. Modules users author or convert are theirs and stay in their project directories; no editor feature may persist module content outside the user's project or workdir, except explicit user-invoked publish and export to destinations the user chooses.
