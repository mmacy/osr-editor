# Projects

A project is a directory. The editor works on two kinds, and tells you which you have by what it finds inside.

## Native projects

A native project holds the adventure document itself:

```text
mill.osr/
├── adventure.json   # the stamped osrlib document — the deliverable
└── editor.json      # the editor's sidecar — never the deliverable
```

`adventure.json` is the whole adventure: a schema-stamped osrlib document that `osr-web` plays and any osrlib-powered game loads. The editor holds it in memory as real osrlib model objects and writes it back canonically serialized on every commit.

`editor.json` is the sidecar for everything that helps you author but is not the adventure: persisted view state, per-entity author notes, review marks, and the seeded RNG streams behind reproducible SRD stocking. Deleting it loses your notes and view state, never your adventure.

## Forge-backed projects

A forge-backed project is an [osr-forge](https://mmacy.github.io/osr-forge/) workdir — a directory with `run.json` — and the contract flips: the editor never writes `adventure.json` there. Your edits become reasoned `overrides.yaml` entries, and the draft re-assembles through forge's own pure loop, so re-running forge yourself reproduces the session's artifacts byte for byte. The one editor file a workdir carries is the same `editor.json` sidecar. [Forge-backed review](forge-backed-review.md) covers the whole loop.

## Always saved, always one undo step

There is no save button. A committed edit persists immediately and atomically; the revision token in every commit means a stale client gets a conflict answer, never a silent overwrite. Every commit — whether it changed one word of prose or landed an entire imported level — is exactly one undo step, and undo history survives the session.

![The project chrome: the sections rail beside the adventure form, with the revision token and the undo and redo controls](../assets/screenshots/project-chrome-light.png#only-light)
![The project chrome: the sections rail beside the adventure form, with the revision token and the undo and redo controls](../assets/screenshots/project-chrome-dark.png#only-dark)

## Git-friendly documents

The editor serializes canonically: the same document always produces the same bytes, and a no-op session over a document the editor wrote produces a byte-identical file. A foreign document — one authored by hand or by another tool — normalizes once, on the first write, and is stable from then on. The practical consequence: `git diff` on a project directory shows you what actually changed, and nothing else.

## Validity while you work

The editor enforces model validity by construction — you cannot commit an edit that produces an unloadable document. Everything softer is a diagnostic: a dangling monster reference or an unreachable area renders as a navigable finding and stays legal while editing. Only [publish](import-export-publish.md) demands a clean validation pass.

![The diagnostics panel listing a navigable finding while the document stays editable](../assets/screenshots/diagnostics-panel-light.png#only-light)
![The diagnostics panel listing a navigable finding while the document stays editable](../assets/screenshots/diagnostics-panel-dark.png#only-dark)
