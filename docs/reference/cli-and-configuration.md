# The CLI and configuration

## The command

```console
osr-editor [PATH] [--port PORT] [--no-browser]
```

- `PATH` — optional project directory to open straight away, skipping the home screen. Must exist and be a directory. A leading `~` expands, so a quoted `osr-editor "~/adventures/mill.osr"` works as well as the unquoted form your shell expands.
- `--port PORT` — the port to serve on. Defaults to `8630`.
- `--no-browser` — suppress the automatic browser launch. The editor still serves; open `http://127.0.0.1:PORT/` yourself.

The editor binds loopback only (`127.0.0.1`) — it is a local application, not a network service. It holds the terminal until stopped with `Ctrl-C`.

## App config

App config lives at `platformdirs.user_config_path("osr-editor") / "config.json"`:

- macOS: `~/Library/Application Support/osr-editor/config.json`
- Linux: `~/.config/osr-editor/config.json`

It holds the recents list (the ten most recently opened projects), the osr-web checkout path once publish has collected it, and the directory each path field's picker was last used in — which is what makes **Browse** reopen where you left off, per field, across restarts. It is a convenience cache, not user data: deleting it clears the recents, the publish target, and the picker locations, and loses nothing else. A corrupted file never fails boot — the editor logs a warning and resets it.

No credential is ever written to it. Provider configuration comes from the environment — see [converting a PDF](../guides/converting-a-pdf.md).

## Project files

Everything that is yours lives in your project directory, described in [projects](../guides/projects.md): the adventure document (`adventure.json`) and the editor sidecar (`editor.json`), or a forge workdir's own artifacts plus the sidecar.
