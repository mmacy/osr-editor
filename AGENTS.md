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

Each roadmap phase in `docs/spec.md` ships as two PRs — a plan, then an implementation — and both follow the same create → rubber-duck → revise-until-solid → PR loop. "Work up a plan for phase N" or "implement the plan for phase N" means run this loop end to end, unprompted. The full runbook — planning, implementing, and the rubber-duck review loop — is `.claude/skills/phase-loop/SKILL.md`. The workflow mirrors osrlib-python's `AGENTS.md`; keep parity with it unless this file says otherwise.

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
- Frontend logic under vitest; core loops under Playwright, headless in CI. `npx playwright test` takes `--project=e2e` everywhere it is invoked — the capture projects share the config, and an unpinned invocation would start screenshotting.
- Golden `adventure.json` fixtures load against the pinned osrlib in CI, so an upstream change in document semantics fails loudly here first. Test fixtures use freely licensed or original material only — no retail module content enters the repository.

## Documentation screenshots

**A PR that changes a screenshotted surface re-captures in the same PR** (`cd frontend && npm run shots`). This is a convention the tooling does not enforce, and CI never compares pixels — so a cosmetic drift stays green while the committed image quietly ages. The harness, the setup it needs, what the `screenshots` job does and does not prove, and the `scripts/check_screenshots.py` gate are in `.claude/skills/screenshots/SKILL.md`.

## Releasing

The version lives in `pyproject.toml` alone and the bump procedure is: edit the version, run `uv lock`, and nothing else. A PR that changes user-visible behavior adds its `CHANGELOG.md` bullet in the same PR. The full runbook — changelog and link-reference discipline, the annotated tag that drives `release.yml`, the local dry run, recovery, and the 0.1.0 one-time setup provenance — is `.claude/skills/release/SKILL.md`.

## Licensing

Package code is MIT. osr-editor ships no game content — osrlib carries the OGL data. Modules users author or convert are theirs and stay in their project directories; no editor feature may persist module content outside the user's project or workdir, except explicit user-invoked publish and export to destinations the user chooses.
