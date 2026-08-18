# Writing a geometry importer

Import is a seam, not a feature list. A converter for any map format is an installable package that registers through the `osreditor.importers` entry-point group and never touches editor code — the editor's own bundled converters register through that same public group, so the protocol a third party writes against is the one the editor itself lives on.

This page is the whole contract: the protocol, the payload's semantics, the notes discipline, registration, and a complete worked example. The example code is excerpted from [`tests/example_importer.py`](https://github.com/mmacy/osr-editor/blob/main/tests/example_importer.py) in the editor's repository, which the editor's own test suite imports and exercises — the code on this page passes tests, and cannot drift from the code that does.

## The protocol

An importer is a small object: a `format_id`, a human `label`, a cheap `sniff`, and a `load`.

- `format_id` and `label` are nominative — they describe the format interoperated with, never a feature of the editor. `watabou-opd` / "Watabou One Page Dungeon (JSON)" is the bundled precedent.
- `sniff(path)` answers "does this path look like my format" at presence level. It must be bounded — an extension check, a directory-shape check, or one short read of a file's head — and it must never load. Every installed importer's sniff runs against every candidate path the user points the import dialog at, so an expensive sniff punishes everyone.
- `load(path)` produces the payload, or raises `ImportSourceInvalidError` with a human message on anything unloadable. That message is shown to the user verbatim in the import dialog, so write it for a person: say what was wrong and, where you can, what to do about it. Any other exception escaping `load` is an editor bug surfaced as a server error — the structured failure mode is part of the contract.

## The payload's semantics

`load` returns an `ImportedGeometry`: optional adoptable metadata plus one or more `ImportedLevel`s. The semantics that matter:

- **An absent edge is a wall.** Connectivity is the edge set: author one `OPEN` edge per adjacent floor pair (and a `DOOR` edge where a door sits), and author nothing for a cell's rock neighbours. Edge keys are osrlib-canonical — build them with `osrlib.crawl.dungeon.edge_key`, which normalizes direction for you; non-canonical keys are never consulted by the engine, so a hand-rolled key is a silent no-op.
- **`entrance` is optional.** A source with no way in imports without one — note it, and the author places it by hand. A level with no entrance is a diagnostic, not an invalid document.
- **Dangling transition targets are legal but linted.** A `TransitionSpec` requires a whole destination; if your source doesn't describe one, a fabricated destination that cannot accidentally resolve (the bundled One Page Dungeon reader uses an empty dungeon id) is the honest move — it renders as a validation finding until the author resolves or drops it, so publish will not pass it silently.
- **Area ids must survive the op vocabulary.** An import lands as one atomic op batch, and the create-area op rejects an empty id, a duplicate id, and (in forge-backed projects) an id containing a slash — any one of which would fail the entire import. When your format has source-authored ids, run each through `repair_area_id`, which returns a safe id plus the reason it had to change (a ready-made note). The worked example below sidesteps the problem by construction — its ids come from a one-character alphabet — which is also a legitimate design.

## The notes contract

`ImportedLevel.notes` is where an importer confesses. Every guess, drop, and repair the conversion made becomes one note, and the import dialog renders all of them before anything commits — the author decides with the confession in hand, not after.

The discipline that makes notes useful:

- One note per judgment call, counted when repeated ("imported 3 portcullis door(s) as locked doors…"), so a big source doesn't scroll the dialog with duplicates.
- Say what was done *and why the format forced it*: "the editor's door model has no portcullis" teaches the author what to fix by hand.
- Prefer a note over a refusal for anything survivable. An unknown symbol, an unmappable door type, a room the grid can't express exactly — convert what you can, note what you guessed, and reserve `ImportSourceInvalidError` for sources you cannot read at all.

## The worked example

A complete importer for an invented plain-text format: one character per cell, `#` rock, `.` floor, `@` the entrance, digits keyed areas. Small as it is, it exercises the whole contract.

### Identity and sniff

```python
--8<-- "tests/example_importer.py:identity-and-sniff"
```

The sniff is two cheap gates: the extension, then one bounded read checked for plausibility. It never parses — the load is where real work happens, behind the user's explicit choice.

### Load and the failure mode

```python
--8<-- "tests/example_importer.py:load"
```

Everything unreadable becomes `ImportSourceInvalidError` with a message a person can act on. Note what does *not* happen: no partial payload, no silent empty level — the source either converts or refuses honestly.

### The conversion

```python
--8<-- "tests/example_importer.py:convert"
```

Three contract points to see in the walk: the unknown symbol and the second entrance are *judgment-call notes*, not failures; the edge set is built with `edge_key` over adjacent floor pairs only, because an absent edge is already a wall; and a map with no `@` imports with `entrance=None` plus a note telling the author to place one.

## Registration

An importer ships as an ordinary package with one entry point in the `osreditor.importers` group. Each entry is a zero-arg callable returning an importer instance — a class object works exactly like the bundled converters':

```toml
[project]
name = "fieldmap-importer"
version = "1.0.0"
description = "Field map import for osr-editor."
requires-python = ">=3.14"
dependencies = ["osr-editor>=0.1,<1"]

[project.entry-points."osreditor.importers"]
fieldmap = "fieldmap_importer:FieldMapImporter"

[build-system]
requires = ["uv_build>=0.8.22,<0.9.0"]
build-backend = "uv_build"
```

Install the package into the editor's environment and the importer appears in the import dialog — no editor configuration, no registration call. Discovery is defensive on the editor's side: a broken entry point logs a warning and is skipped (a third-party package must never break boot), and a duplicate `format_id` keeps the first registration, so no package can shadow another's format.

## API reference

The seam's exports, rendered from the source of truth. Signatures reference osrlib's spatial types — `Position`, `Edge`, `TransitionSpec` — which are documented in [osrlib's reference](https://mmacy.github.io/osrlib-python/).

::: osreditor.importers.GeometryImporter

::: osreditor.importers.ImportedGeometry

::: osreditor.importers.ImportedLevel

::: osreditor.importers.ImportedArea

::: osreditor.importers.repair_area_id

::: osreditor.importers.discover_importers

::: osreditor.errors.ImportSourceInvalidError
