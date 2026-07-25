# The map editor

Every level renders as graph paper, and the tool set works directly on it.

## The tools

- **Select** (`V`) inspects anything — areas, door edges, transitions — and drives the inspector panel.
- **Room** (`R`) drags a rectangle into a keyed area with its interior edges opened.
- **Corridor** (`C`) opens passages along a dragged path.
- **Wall/door** (`W`) click-cycles an edge wall → open → door, and drags to paint. The door inspector sets normal or secret, stuck, locked, and starts-open.
- **Area** (`A`) paints cells into the selected area or a new one.
- **Entrance** (`E`) places the level entrance.
- **Transition** (`T`) places stairs, trapdoors, and chutes with a target-level picker — stairs offer reciprocal creation in the same undo step.

Pan with space-drag or middle-drag, zoom with the wheel, reset to 100% with `0`. `Delete` removes the selection; `Esc` cancels a gesture.

![The map editor tool palette: select, room, corridor, wall and door, area, entrance, and transition](../assets/screenshots/map-toolbar-light.png#only-light)
![The map editor tool palette: select, room, corridor, wall and door, area, entrance, and transition](../assets/screenshots/map-toolbar-dark.png#only-dark)

## Levels and dungeons

An adventure holds any number of dungeons, each with any number of levels. The map chrome manages both: create, rename, and renumber (renames cascade through every reference in one undo step), and resize a level — with the offenders listed first when a shrink would strand geometry.

![The level and dungeon chrome, with the level picker and level properties](../assets/screenshots/level-chrome-light.png#only-light)
![The level and dungeon chrome, with the level picker and level properties](../assets/screenshots/level-chrome-dark.png#only-dark)

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
