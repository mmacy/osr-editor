# Converting a PDF

**Convert a PDF** on the home screen is the front door to [osr-forge](https://mmacy.github.io/osr-forge/)'s pipeline: point the editor at a module PDF and it prices the run, converts the module with live progress, and lands the result in the review queue — no CLI required.

## The cost gate

Point the dialog at a PDF; the destination workdir prefills as `<pdf-dir>/<pdf-stem>.forge` and stays editable. The editor then runs forge's `estimate()` — which really renders every page into that workdir, because module text is never persisted outside your own project — and shows the page count, per-stage token predictions, and the cost: *"converting this 48-page module will cost roughly $X"*. It is a band, not a quote, and the card says so.

Nothing is spent until you confirm. **Not now** keeps the rendered workdir; the home screen lists it and the pipeline view resumes it later.

![The cost gate showing the page count, per-stage token predictions, and the estimated cost](../assets/screenshots/estimate-card-light.png#only-light)
![The cost gate showing the page count, per-stage token predictions, and the estimated cost](../assets/screenshots/estimate-card-dark.png#only-dark)

## The run

Confirming runs the chain on a worker thread with live per-stage progress. **Cancel** is cooperative and takes effect at the next stage boundary — the stage in flight always finishes, so the run record never holds a stage the chain abandoned mid-write, and running again picks up exactly where it stopped. A failure shows forge's own message and keeps every completed stage. On success the workdir opens straight into [forge-backed review](forge-backed-review.md).

## The pipeline view

A workdir whose conversion never completed — declined at the gate, cancelled, or failed — opens into the pipeline view rather than a dead end: the per-stage table, a stage picker defaulting to the first incomplete stage, optional `knob=value` settings, and **regenerate previews** once the survey and content caches exist, so you can eyeball the synthesized geometry before paying for the remaining model stages.

![The pipeline view's stage table for a workdir whose conversion stopped after preprocessing](../assets/screenshots/pipeline-stages-light.png#only-light)
![The pipeline view's stage table for a workdir whose conversion stopped after preprocessing](../assets/screenshots/pipeline-stages-dark.png#only-dark)

Open projects get the same reach from their **Pipeline** panel: assembly stays the fast synchronous path, and any other stage runs with progress and cancellation, adopting the re-assembled document when it lands. Commits pause while it runs, and your undo history survives, replaying corrections against the new caches.

## Provider configuration

Conversion reads the same environment the forge CLI reads:

| Variable | Meaning |
| --- | --- |
| `OSRFORGE_FOUNDRY_ENDPOINT` | The Azure AI Foundry endpoint |
| `OSRFORGE_FOUNDRY_DEPLOYMENT` | The deployment name |
| `OSRFORGE_FOUNDRY_API_KEY` | Optional. Absent means Entra ID auth through `DefaultAzureCredential`, which needs the `osr-forge[entra]` extra |

**Provider settings** (from the convert dialog or the pipeline view) shows what was detected, where each value came from, and whether a provider can be built at all. You can override any field for the session — those values live in memory until the editor closes.

**No credential is ever written to editor config**, and no API response ever includes one: the key surfaces only as "set" or "not set", with its source. This is a contract, not a default.
