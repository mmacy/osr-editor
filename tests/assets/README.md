# Test assets

Vendored and hand-authored assets, with provenance and license recorded here.
Assets live outside the built distribution — the osr-editor wheel ships no game
content.

## minimod/

Vendored verbatim from [osr-forge](https://github.com/mmacy/osr-forge)'s
`tests/assets/minimod/`, at the revision `uv.lock` pins. *The Root Cellar of Old
Wenna* is an original mini-module authored for that repository as a test asset
and dedicated to the public domain under
[CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/); the surrounding
repository is MIT, same owner.

- `minimod.pdf` — 5 pages. Pages 1–3 and 5 carry a text layer; page 4 is a raster
  map image with no text layer.
- `encrypted.pdf` — a 1-page password-protected PDF, the wrong-file failure case
  the conversion suites drive a `PdfError` through.
- `pages/` — the exact page renders and text layers the fixtures were recorded
  against. The warm-workdir helper fabricates from these, never from a fresh
  render: request fingerprints hash the page bytes
  (`osrforge/providers/base.py`), and PNG byte-stability across pdfium and
  Pillow versions is explicitly not forge's contract
  (`osrforge/preprocess.py`), so a fresh render would miss every fixture.
- `fixtures/` — the recorded `survey` and `content` exchanges
  `FixtureProvider` replays. There is no `monsters` fixture and none is needed:
  minimod's whole encounter-name population resolves in the exact tier, so the
  monsters stage makes no model call — a call would fail loudly.

`expected/` is deliberately not vendored: forge owns those byte goldens and
pins them in its own suite.

## opd/

**Original material, hand-authored for this repository — not generator output.**
Both files are synthetic JSON shaped like [Watabou's One Page Dungeon
generator](https://watabou.itch.io/one-page-dungeon) export, written by hand to
drive `osreditor.importers.watabou`. Nothing here was produced by, copied from,
or derived from the generator, and no generator code is vendored anywhere in
this repository. The format and the generator are Watabou's; the author's stated
terms are permissive ("copy, modify, include in your commercial rpg adventures
etc. Attribution is appreciated, but not required"), and hand-authoring the
corpus keeps the question moot either way.

- `nominal.json` — an ordinary small dungeon: rooms, corridors, junction cells,
  plain and secret doors, two keyed notes, the origin entrance. Version `1.2.7`.
- `torture.json` — coverage no single real export offers: all ten door types,
  a rotunda, a backdoor (a second boundary door), a type-8 level transition, an
  unknown door type, negative coordinates throughout, two doors on one cell, two
  doors claiming one edge from opposite cells, a note landing in no rect, a note
  landing in an already-keyed rect, a duplicate `ref`, an empty `ref`, columns,
  water, an `ending` line, and a `version` string from outside the known set.

Real generator exports were used to validate the reader during development and
are deliberately **not** committed: they stay local, and the committed corpus is
ours outright. The payload goldens these drive live in `tests/fixtures/`.

**The re-vendor rule.** A forge version bump re-vendors this directory
alongside it, from the newly locked revision, in the same change. `pages/` and
`fixtures/` are one stranded set — regenerating the PDF, bumping pypdfium2 or
Pillow, or editing a forge prompt or schema invalidates them together.
Nothing here is silently tolerant of drift: `FixtureProvider` checks the
artifact schema version and the request fingerprint and raises
`ProviderError`/`FixtureMissError` on a mismatch, so a stale set fails the
suite rather than replaying a wrong answer.
