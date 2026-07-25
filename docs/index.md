# osr-editor

A local GUI application for creating and modifying adventure modules playable by [osrlib](https://mmacy.github.io/osrlib-python/)-powered games. osr-editor authors the same stamped `adventure.json` documents that [osr-forge](https://mmacy.github.io/osr-forge/) produces and [osr-web](https://github.com/mmacy/osr-web) plays: a FastAPI backend holds the working document as real osrlib model objects and serves a React frontend to your browser.

There is no separate save step and no separate validate step. Every edit you commit persists immediately, every commit is one undo step, and the document on disk is always the canonically serialized, schema-stamped artifact the game engine loads — so a project directory is safe to keep in git, and a no-op session never touches a byte.

## The family

osr-editor is one of four siblings that share the adventure document as their contract:

- [osrlib](https://mmacy.github.io/osrlib-python/) is the rules engine and schema authority. The adventure document *is* osrlib's pydantic models; the editor never forks its validation.
- [osr-forge](https://mmacy.github.io/osr-forge/) converts module PDFs into adventure documents. The editor is the graphical front door to its pipeline and the correction loop over its output.
- [osr-web](https://github.com/mmacy/osr-web) plays the result in a browser. The editor's publish command places adventures in its `adventures/` directory.
- osr-editor is where the authoring happens: native projects built from a blank map, or forge conversions reviewed and corrected.

## Where to start

- [Install](getting-started/install.md) the package — one command, no node toolchain, ever.
- The [quickstart](getting-started/quickstart.md) takes you from launch to a first exported adventure.
- The [guides](guides/projects.md) go deep on each surface: projects, the map editor, stocking, monsters, forge-backed review, conversion, the authoring aids, and publish.
- [Writing a geometry importer](reference/writing-a-geometry-importer.md) shows how to ship a converter for a new map format as an installable package, without touching editor code.
