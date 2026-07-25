# Install

osr-editor is an application with a console script, so the recommended install is a tool install:

```console
uv tool install osr-editor
```

Or with pipx, or plain pip into an environment of your choosing:

```console
pipx install osr-editor
```

```console
pip install osr-editor
```

Requirements:

- Python ≥ 3.14.
- A browser. The editor serves on localhost and opens your default browser to the editing surface.
- No node toolchain, ever. The published wheel ships the built frontend; node is a development-only concern for people hacking on the editor itself.

Verify the install by launching it:

```console
osr-editor
```

The editor serves on `http://127.0.0.1:8630`, opens your browser to the home screen, and holds the terminal until you stop it with `Ctrl-C`. The [quickstart](quickstart.md) picks up from here.

## Optional: providers for conversion and prose drafting

Everything on the authoring side works offline. Two features reach a language model and appear only when a provider is configured: converting a PDF and the prose assistant. Both read the same `OSRFORGE_FOUNDRY_*` environment the osr-forge CLI reads — see [converting a PDF](../guides/converting-a-pdf.md) for the variables and the rules the editor follows with them.
