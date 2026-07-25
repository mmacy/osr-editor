# Stocking and keyed content

Stocking is map-first: the map shows you what needs work, and the gestures start from it.

## The stocking menu

Right-click an area cell for the stocking menu: description, encounter, treasure, trap, and features, each offered as add or edit-plus-remove to match what the area already holds. **Roll SRD stocking** appears on blank rooms — see [authoring aids](authoring-aids.md).

![The right-click stocking menu offering description, encounter, treasure, trap, and features](../assets/screenshots/stocking-context-menu-light.png#only-light)
![The right-click stocking menu offering description, encounter, treasure, trap, and features](../assets/screenshots/stocking-context-menu-dark.png#only-dark)

## Reading the map

Key numbers render hollow until an area is stocked (a description or any content) and carry glyphs for encounters, traps, and treasure. Hovering shows the area's one-line contents in module notation. `F` dims stocked areas so the blanks stand out, and `[` / `]` walk areas in key order — with the filter on, the walk visits unstocked areas only.

![Key numbers on the map, hollow where an area is unstocked and glyphed where it carries content](../assets/screenshots/map-key-glyphs-light.png#only-light)
![Key numbers on the map, hollow where an area is unstocked and glyphed where it carries content](../assets/screenshots/map-key-glyphs-dark.png#only-dark)

## The content cards

The area panel's cards commit through type-ahead pickers over osrlib's shipped catalogs — monsters (bundled templates first, then this session's recent picks), equipment, and treasure-type letters — so the editor never authors a dangling reference. Foreign documents' danglers stay legal, diagnosed, and navigable.

![The area panel's encounter card, collapsed to its module notation, above an expanded treasure card](../assets/screenshots/area-content-cards-light.png#only-light)
![The area panel's encounter card, collapsed to its module notation, above an expanded treasure card](../assets/screenshots/area-content-cards-dark.png#only-dark)

- **Encounters** name a monster, a count, and the lair-hoard toggle — a monster room's treasure is the encounter's own lair hoard, and the toggle expresses the treasure-absent monster room the SRD rolls.
- **Treasure** references a treasure type letter or the unguarded band.
- **Traps** build from composable parts, with the trap's kind pinned by where it lives — a room trap and a treasure trap offer different menus.
- **Features** are freeform keyed details, at area scope or level scope.

## Wandering monsters

Level properties hold the inline d20 wandering-table editor, seeded from osrlib's compiled level-band table — start from the book's table and bend it to the level. Each row names a monster and a count expression through the same pickers the cards use.

![The level properties dialog with the inline d20 wandering-monster table](../assets/screenshots/wandering-table-light.png#only-light)
![The level properties dialog with the inline d20 wandering-monster table](../assets/screenshots/wandering-table-dark.png#only-dark)
