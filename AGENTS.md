# Agent guide for osr-editor

osr-editor is a local GUI application for creating and modifying adventure modules playable by [osrlib](https://github.com/mmacy/osrlib-python)-powered games: a FastAPI backend that imports osrlib and [osr-forge](https://github.com/mmacy/osr-forge), serving a React frontend. It authors stamped `adventure.json` documents directly (native projects) and corrects forge conversions through `overrides.yaml` (forge-backed projects).

## Start here

- `docs/spec.md` is the single source of truth. Read it before any implementation work. It is decision-complete: architecture, contracts, interaction models, and a phased roadmap. Implement in phase order.
- osrlib (checked out at `~/repos/osrlib-python`, published as `osrlib`) is the schema and rules authority. The adventure document *is* osrlib's pydantic models; loading, validation, and play go through `check_document`, `Adventure.model_validate`, and `validate_adventure`. Never re-implement or fork osrlib's rules or validation — the two sanctioned exceptions (the live structural lint, the SRD stocking procedure) are pinned in the spec with rationale.
- osr-forge (checked out at `~/repos/osr-forge`, published as `osr-forge`) is the conversion authority: workdir layout, `overrides.yaml` schema, report flag and finding vocabularies. When a forge-contract question comes up, its spec and code are the authority; verify against them rather than working from memory.
- osr-web (checked out at `~/repos/osr-web`) is the reference consumer; "publish" means satisfying its `adventures/` discovery rules.
- Frontend types under `frontend/src/types/generated/` are generated from the pydantic models. Never hand-edit them and never hand-write a TypeScript mirror of an osrlib schema.

## The phase loop

Each roadmap phase in `docs/spec.md` ships as one PR on branch `phase-N`, and "implement phase N" means running the whole loop end to end, unprompted: research, plan, implement, rubber-duck, revise until SOLID, open the PR. The workflow deliberately deviates from osrlib-python's `AGENTS.md` in one way — there is no separate plan PR; the implementing agent works up the plan when picking up the phase. Everything else keeps parity.

1. **Research first:** the phase's roadmap entry and every contract it touches in `docs/spec.md`, the prior phase plans in `docs/`, the existing code, and the osrlib and osr-forge surfaces the phase consumes. Hazards found during research (model validators, forge normalization rules, frozen-model rebuild patterns) belong in the plan so they're pinned before implementation, not rediscovered during it.
2. **Plan:** write `docs/phase-N-plan.md`, structured like the sibling projects' phase plans — intro with the spec milestone, scope (in and out, naming the phase that picks up each deferral), work items, sequencing, definition of done. Plans are decision-complete: every choice the implementation would otherwise guess at is pinned with a rationale. Commit it first (`add phase N implementation plan`) so the plan-then-code story stays legible in history.
3. **Implement to the plan** with tests green. The plan is the contract — when implementation reveals the plan was wrong or silent, amend the plan on the same branch (`amend phase N plan: ...`) so plan and code never diverge.
4. **Rubber-duck the result** (below) — the implementation against the plan, and the plan against the spec — revise until SOLID, then open the PR.

### The rubber-duck loop

- Spawn a fresh subagent as a skeptical senior reviewer. Give it an ordered reading list — the spec, prior plans, this file, the artifact under review, the relevant code, and the osrlib or osr-forge models and docs the work touches — and require evidence: every finding must quote the spec, the code, or the artifact, be ranked blocking vs non-blocking, and the review must end in a verdict (SOLID or NEEDS REVISION) plus a verified-good list of claims it actively checked.
- The reviewer's mandate covers design hygiene, not just spec fidelity: it must hunt for the greenfield anti-patterns below (back-compat shims, dual import paths, deprecation scaffolding, dead accommodation code) and flag any it finds.
- Judge findings on the merits. Verify disputed claims against the spec, osrlib, osr-forge, or the code yourself; push back on findings that are wrong instead of deferring to the duck. Address what survives and commit as `address rubber-duck review findings` (plan corrections as `amend phase N plan: ...`).
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
- **Always-saved, canonically serialized.** A committed op persists immediately; a no-op session produces a byte-identical document.
- **Validity tiers.** Model validity is enforced by construction; dangling references are diagnostics, legal while editing; `validate_adventure` cleanliness gates publish, not editing.
- **Forge output stays reproducible.** In a forge-backed project the editor writes `overrides.yaml` and re-runs `assemble` — it never writes `adventure.json`, `report.json`, or previews in a workdir. Assembly purity is forge's core invariant and the editor honors it absolutely.
- **Seams stay honest.** Auth goes through the single auth dependency, persistence through `ProjectStore`, external map formats through `GeometryImporter` entry points, model access through forge's `ModelProvider`. No code outside a seam may assume single-user, local filesystem, a map format, or a vendor.
- **No secrets on disk.** Provider credentials come from the environment; editor config never stores them.
- **No network in tests.** Conversion and LLM paths test against forge's `FixtureProvider` recordings; live model calls never run in CI.

## Testing expectations

- Run `pytest` before committing. The backbone suites are op application/rejection, undo/redo, canonical-serialization byte-stability, lint findings, and op→override translation goldens.
- Frontend logic under vitest; core loops under Playwright, headless in CI.
- Golden `adventure.json` fixtures load against the pinned osrlib in CI, so an upstream change in document semantics fails loudly here first. Test fixtures use freely licensed or original material only — no retail module content enters the repository.

## Releasing

Release engineering lands in phase 9 and mirrors the siblings: version in `pyproject.toml` alone, tag-driven `release.yml` with trusted publishing, dist audit, fresh-venv smoke tests. Changelog discipline applies from the first phase: a PR that changes user-visible behavior adds its bullet to the `[Unreleased]` section of `CHANGELOG.md` in the same PR.

## Licensing

Package code is MIT. osr-editor ships no game content — osrlib carries the OGL data. Modules users author or convert are theirs and stay in their project directories; no editor feature may persist module content outside the user's project or workdir.
