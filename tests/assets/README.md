# Test assets

Vendored assets, with provenance and license recorded here. Assets live outside
the built distribution — the osr-editor wheel ships no game content.

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

**The re-vendor rule.** A forge version bump re-vendors this directory
alongside it, from the newly locked revision, in the same change. `pages/` and
`fixtures/` are one stranded set — regenerating the PDF, bumping pypdfium2 or
Pillow, or editing a forge prompt or schema invalidates them together.
Nothing here is silently tolerant of drift: `FixtureProvider` checks the
artifact schema version and the request fingerprint and raises
`ProviderError`/`FixtureMissError` on a mismatch, so a stale set fails the
suite rather than replaying a wrong answer.
