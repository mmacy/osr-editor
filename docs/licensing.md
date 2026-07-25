# Licensing

osr-editor's code is MIT licensed.

## No game content in this package

osr-editor ships no game content. The Old-School Essentials SRD data — monsters, treasure types, the stocking tables — lives in [osrlib](https://mmacy.github.io/osrlib-python/), which carries the Open Game License and its attribution; the editor consumes that catalog through osrlib's own API and bundles none of it. The editor's test fixtures are original, synthetic material.

## Your modules stay yours

Modules you author or convert are yours and stay in your project directories. No editor feature persists module content outside your project or workdir — the two exceptions are the ones you invoke explicitly: export to a path you choose, and publish to an osr-web checkout you configure. Conversion follows the same rule: forge's estimate and pipeline render pages into *your* destination workdir, never anywhere else.

## Interoperated formats

The One Page Dungeon format and generator are [Watabou](https://watabou.itch.io/one-page-dungeon)'s, read under their stated permissive terms ("You can use images created by the generator as you like: copy, modify, include in your commercial rpg adventures etc."). No generator code is vendored; the importer parses a local file you exported.
