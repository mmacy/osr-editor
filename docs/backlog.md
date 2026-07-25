# Backlog

Features cut from `docs/spec.md` and deferred indefinitely. Nothing here is committed scope: the spec is still the single source of truth for what osr-editor is, and an item lands on the roadmap only when the owner moves it there and a phase plan is written for it. Entries keep enough of the removed design that restoring one is an editing job, not a redesign.

## Walk mode

**Status:** deferred indefinitely (2026-07-24). Removed from `docs/spec.md` before any of it was implemented — it had been roadmap phase 9, with no plan document and no code.

**What it was.** An embedded playtest surface: a real seeded osrlib `GameSession` over the current working draft, driven from the map. A party marker moved with the movement keys, doors opened, searches rolled, transitions taken, with the referee-visibility event feed alongside so authored traps, encounters, and secrets could be verified to fire where the author placed them. Encounters were noted and evaded rather than fought, following osr-forge's smoke-delve convention; full combat belongs to osr-web. Walk sessions were throwaway — nothing persisted, and the working document was never touched.

**Its milestone.** Walk a converted module end to end and watch its traps and encounters fire where the pages said they would.

**What it would have cost.** One backend module (`src/osreditor/walk.py`, walk-mode sessions over `GameSession`), one route (`POST /api/projects/{id}/walk` — start, drive, and end sessions; request/response, no polling or WebSockets needed), and a map-pane mode on the frontend with the event feed beside it.

**Why the deferral is cheap.** Nothing shipped depends on it. The rules are osrlib's — `GameSession` and its event listeners exist and are exercised by osr-web, so no seam in this repo was carrying walk mode's weight and none needs to be kept warm for it. Playtesting stays available the way every phase milestone has used it: publish to an osr-web checkout and play the module there.

**If it comes back.** Restore the spec bullet under validation and publishing, the `walk.py` line in the architecture tree, and the API-surface route, then write the phase plan against whatever the roadmap's tail looks like then. The osrlib version pinned at that time is the authority on the `GameSession` surface — verify against it rather than against the description above, which is a record of the design as of the deferral, not of osrlib's current API.
