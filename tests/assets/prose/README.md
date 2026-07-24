# Prose assistant fixtures

Recorded request/response pairs for the prose assistant, replayed through forge's
`FixtureProvider` so the backend, vitest, and Playwright suites draft prose with
zero network and zero cost. Each file is named `<tag>.<fingerprint[:12]>.json` and
keyed off the request's fingerprint (tag, system prompt, ordered facts, and schema).

## Provenance

These committed fixtures are **stub-recorded** — deterministic, plausible prose
written into the fixtures by `tests/generate_prose_fixtures.py`, so CI is never
blocked on model credentials. `scripts/record_prose_fixtures.py` re-records the
same fingerprints against a live provider (with `OSRFORGE_FOUNDRY_*` set),
overwriting these in place with real model prose; the key does not move because it
depends only on the request, not the response.

## The re-record rule

A change to a prose prompt (`PROSE_AREA_SYSTEM`, `PROSE_HOOKS_SYSTEM`), a schema,
or the facts assembly (`build_area_facts`, `build_hooks_facts`) moves the
fingerprint and strands these fixtures — replay fails loudly with forge's
`FixtureMissError` naming the miss. Re-record with:

```
uv run python tests/generate_prose_fixtures.py   # deterministic stub prose (CI)
uv run python scripts/record_prose_fixtures.py   # real model prose (needs credentials)
```

Both target the same scenario the e2e milestone drafts against — a native
"Stocking demo" project with a blank area `1`, and the default (empty) hooks — so
the running editor's requests match these fingerprints byte for byte.
