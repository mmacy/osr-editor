# The map editor

Every level renders as graph paper, and the tool set works directly on it.

## The tools

- **Select** (`V`) inspects anything — areas, door edges, transitions — and drives the inspector panel. Dragging with it pans the map.
- **Pan** (`H`) binds panning to a plain left-drag, for when holding a chord is the wrong hand.
- **Room** (`R`) drags a rectangle into a keyed area with its interior edges opened.
- **Corridor** (`C`) opens passages along a dragged path.
- **Wall/door** (`W`) click-cycles an edge wall → open → door, and drags to paint. The door inspector sets normal or secret, stuck, locked, and starts-open.
- **Area** (`A`) paints cells into the selected area or a new one.
- **Entrance** (`E`) places the level entrance.
- **Transition** (`T`) places stairs, trapdoors, and chutes with a target-level picker — stairs offer reciprocal creation in the same undo step.

The map moves the way a web map does. Zoom with the wheel or a trackpad pinch, always about the pointer; pan with a two-finger drag, a middle-click-and-hold drag, a space-drag, or a plain left-drag under the select or pan tool. Reset to 100% with `0` or the reset control. `Delete` removes the selection; `Esc` cancels a gesture.

Zoom is proportional to the gesture and **accelerates as you push it**: the first moments of a pinch or a wheel spin stay fine-grained for framing a room, and holding the gesture on ramps the rate up to cross scales quickly. Pause and it returns to fine-grained, so precision is always a fraction of a second away. Nothing coasts after you stop.

A mouse wheel and a trackpad two-finger drag reach the browser as the same event, so the editor tells them apart by the shape of the scroll. If yours is ever read wrong, **ctrl-scroll** (or **cmd-scroll**) always zooms.

![The map editor tool palette: select, pan, room, corridor, wall and door, area, entrance, and transition](../assets/screenshots/map-toolbar-light.png#only-light)
![The map editor tool palette: select, pan, room, corridor, wall and door, area, entrance, and transition](../assets/screenshots/map-toolbar-dark.png#only-dark)

## Levels and dungeons

An adventure holds any number of dungeons, each with any number of levels. The map chrome manages both: create, rename, and renumber (renames cascade through every reference in one undo step), and resize a level — with the offenders listed first when a shrink would strand geometry. **Remove level** discards the level from the row itself; a dungeon's last level can't go, and hovering the dimmed control says why.

**Clear content** strips a level back to its geometry in one undo step, which is what you want after importing a map whose rooms arrive already described. The grid, the walls and doors, the cells they enclose, the entrance, the transitions, and the wandering monsters all stay; area names and descriptions, encounters, traps, treasure, and features go. The dialog counts exactly what it will remove before you commit.

**Also remove the emptied areas** goes one step further: the key numbers go too, and the emptied cells become corridor. The walls and doors that draw the rooms are edges, so the map still reads exactly the same — you get the shape without the keying, ready to re-key as you stock it. The choice sticks for the session, because stripping an imported module is a per-level job.

In a forge-backed project this is an ordinary correction, not a special case: each emptied room becomes one reasoned entry in `overrides.yaml`, so clearing a converted module's prose is a claim you are making about the source — reviewable, and undoable — rather than an edit that escapes the record.

![The level row: the level picker, add level, remove level, clear content, and level properties](../assets/screenshots/level-chrome-light.png#only-light)
![The level row: the level picker, add level, remove level, clear content, and level properties](../assets/screenshots/level-chrome-dark.png#only-dark)

## The live lint

Structural problems render on the map as you work, click-to-navigate down to the offending cell or edge:

- an edge entry that is not canonical or references void (`edge_invalid`) — with a one-click fix for invalid foreign edge keys,
- an area no path reaches (`area_unreachable`),
- a floor cell no area claims and no corridor uses (`orphan_cell`),
- an area reachable only through secret doors (`secret_only_access`),
- a transition without its reciprocal (`transition_unpaired`),
- and two areas claiming the same cell (`area_overlap`).

![An unreachable area marked on the map with the matching finding listed in the diagnostics panel](../assets/screenshots/map-lint-markers-light.png#only-light)
![An unreachable area marked on the map with the matching finding listed in the diagnostics panel](../assets/screenshots/map-lint-markers-dark.png#only-dark)

The first five mirror osr-forge's own playability check exactly — the same fixture suites prove the two implementations agree — so a clean editor lint means a clean forge check. Lint warns and navigates; it never blocks an edit. Secret-only access, in particular, is sometimes the point.

## Imported geometry

**Import geometry** in the map chrome brings a level in from another project, a Watabou One Page Dungeon export, or any format with an installed importer plugin — each landing as one ordinary, undoable op batch. [Import, export, and publish](import-export-publish.md) covers using it; [writing a geometry importer](../reference/writing-a-geometry-importer.md) covers shipping your own.
