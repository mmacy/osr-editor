# Forge-backed review

Open an [osr-forge](https://mmacy.github.io/osr-forge/) workdir — a directory with `run.json` — and the editor becomes the graphical correction loop the forge spec anticipated: the draft on the map, the report beside it, the source pages behind it.

## The contract

In a forge-backed project the editor writes exactly one artifact of its own, the `editor.json` sidecar. Everything else honors forge's assembly purity: your edits become merged, reasoned `overrides.yaml` entries, and the draft re-assembles through forge's own pure `assemble()` — never a hand-patched `adventure.json`, `report.json`, or preview. Re-running forge yourself reproduces the session's artifacts byte for byte, and a symlink publish republishes live on every correction.

Undo and redo work on the same terms: each step is a snapshot pair of the overrides file and the reason ledger, so history is honest about what the correction record looked like at every point.

## Review

**Review** lists `report.json`'s flags as a work list. Selecting a row jumps to the flagged area with its printed pages rendered alongside, and each flag has its own dismissal mark — reviewed-and-fine is recorded, not remembered.

![The review queue listing twelve flags across five areas, each with its confidence and flag kind](../assets/screenshots/review-queue-light.png#only-light)
![The review queue listing twelve flags across five areas, each with its confidence and flag kind](../assets/screenshots/review-queue-dark.png#only-dark)

Correction happens against the page. Here a different conversion — *The Root Cellar of Old Wenna* — has a flagged area open with the printed page it came from rendered beside it:

![A flagged area open beside its printed source page, in a second converted module](../assets/screenshots/source-pages-light.png#only-light)
![A flagged area open beside its printed source page, in a second converted module](../assets/screenshots/source-pages-dark.png#only-dark)

The page is a viewer, not a thumbnail. It opens fitted to the pane, and from there it moves like the map: drag the page to pan it, wheel or pinch to zoom about the pointer, **Fit page** to frame the whole page again, **Reset page zoom** for full size. When the printed block is what you are reading, [drag the pane wider](map-editor.md#sizing-the-panels) — the width is remembered with the rest of the project's layout.

Every edit you commit gets an auto-drafted, page-anchored reason: redrawing geometry writes explicit wall seals over stale synthesized openings, importing a level lands as `geometry:` overrides, drawing past the derived extent grows it by rule. Machine drafts are badged until a human composes the reason — the record stays reviewable either way.

## Corrections

**Corrections** is that reviewable record: every `overrides.yaml` entry with its reason inline-editable and per-entry removal. It is the answer to "what did we change about this conversion, and why" — the same answer a colleague re-running forge from the workdir would reconstruct.

![The corrections panel listing an overrides entry with its inline, editable reason](../assets/screenshots/corrections-panel-light.png#only-light)
![The corrections panel listing an overrides entry with its inline, editable reason](../assets/screenshots/corrections-panel-dark.png#only-dark)

## Monster resolution

**Monster resolution** offers each unresolved or custom monster name the two corrections forge defines, as an either/or per name: remap to a catalog monster, or correct the printed stat block in the page's own notation (pre-mapping, per forge's contract). The Monsters section stays present as a review view of the derived bundle.

![The monster resolution panel offering remap or stat-block correction for an unresolved name](../assets/screenshots/monster-resolution-light.png#only-light)
![The monster resolution panel offering remap or stat-block correction for an unresolved name](../assets/screenshots/monster-resolution-dark.png#only-dark)

## Pipeline

**Pipeline** renders `run.json`'s per-stage status and token usage, runs the on-demand playability check (findings clear on the next change — stale lint about a changed draft is worse than none), re-runs assembly with its knob, and reaches every other stage with progress and cancellation — see [converting a PDF](converting-a-pdf.md) for stage reruns.

## Detach

Some edits have no override vocabulary: new dungeons or levels, wandering tables, resizing. The editor blocks these in place and offers **detach** — the recorded, one-way crossing to a native project, with provenance written down and author notes moved across. After detach the project is yours entirely; the workdir stays behind, unchanged, still reproducible.
