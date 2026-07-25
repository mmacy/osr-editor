# Quickstart

Two commands put you in the editor:

```console
uv tool install osr-editor
osr-editor
```

The browser opens to the home screen. Everything below happens in it.

## The home screen

The home screen offers your recent projects, **New adventure**, **Open project** by path, and **Convert a PDF**. Pass a project directory on the command line — `osr-editor ~/adventures/mill.osr` — to skip the home screen and open it straight away.

![The osr-editor home screen on first run, offering new adventure, open project, and convert a PDF](../assets/screenshots/home-screen-light.png#only-light)
![The osr-editor home screen on first run, offering new adventure, open project, and convert a PDF](../assets/screenshots/home-screen-dark.png#only-dark)

## A first adventure

**New adventure** asks for two things: the adventure's name and a destination directory. Create it, and the editor writes a project directory holding the adventure document (`adventure.json`) and the editor's sidecar (`editor.json`), then opens the project. That directory is the whole project — copy it, back it up, or put it in git.

![The new adventure dialog asking for an adventure name and a destination directory](../assets/screenshots/new-adventure-dialog-light.png#only-light)
![The new adventure dialog asking for an adventure name and a destination directory](../assets/screenshots/new-adventure-dialog-dark.png#only-dark)

From here the editor is always saved: every edit you commit persists to `adventure.json` immediately, canonically serialized, and every commit is one undo step. There is no save button to forget.

The **Adventure** and **Town** sections hold the module's prose — description, hooks, the town — and the map holds everything spatial.

## A first room

On the map, press `R` for the room tool and drag a rectangle. That one gesture creates a keyed area with its interior edges opened — a room, ready for content. Press `V` to switch back to select and click the room to inspect it.

![A single room drawn on the blank graph-paper grid with the room tool](../assets/screenshots/first-room-light.png#only-light)
![A single room drawn on the blank graph-paper grid with the room tool](../assets/screenshots/first-room-dark.png#only-dark)

Right-click a cell of the room for the stocking menu: add a description, an encounter, treasure, a trap, or features. Each card commits through type-ahead pickers over osrlib's shipped catalogs, so you never author a dangling reference. Or let the dice do it: **Roll SRD stocking** fills a blank room from the same stocking procedure the game engine plays.

![The right-click stocking menu offering description, encounter, treasure, trap, and features](../assets/screenshots/stocking-context-menu-light.png#only-light)
![The right-click stocking menu offering description, encounter, treasure, trap, and features](../assets/screenshots/stocking-context-menu-dark.png#only-dark)

Live diagnostics run as you work. Structural lint (an unreachable area, an unpaired transition) and content validation (a dangling monster reference in a document you imported) render as navigable findings, legal while editing — only publish demands a clean document.

## Export

**Export** writes the stamped `adventure.json` to any path you choose — the exact document an osrlib-powered game loads. If you keep an [osr-web](https://github.com/mmacy/osr-web) checkout, **Publish** places the adventure in its `adventures/` directory instead, as a live symlink or a snapshot copy — see [import, export, and publish](../guides/import-export-publish.md).

![The export dialog, ready for a destination path](../assets/screenshots/export-dialog-light.png#only-light)
![The export dialog, ready for a destination path](../assets/screenshots/export-dialog-dark.png#only-dark)

## Where next

- [Projects](../guides/projects.md) — the two project types and the always-saved model.
- [The map editor](../guides/map-editor.md) — the full geometry tool set.
- [Converting a PDF](../guides/converting-a-pdf.md) — point the editor at a module PDF and review the result.
