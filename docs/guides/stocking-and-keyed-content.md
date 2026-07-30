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

Reading a whole room doesn't take a click: rest the pointer on a stocked or named area under the select tool and a hover card raises beside it — the area's id and name, its description, and one line per carried kind — then drops the moment the pointer leaves. The card never takes the pointer, so clicking through it works exactly as if it weren't there, and it stays out of the way while you draw: the drawing tools, an armed library entry, and a drag from the library all keep it down.

![The hover card raised beside a stocked area, listing its encounter and treasure](../assets/screenshots/area-hover-card-light.png#only-light)
![The hover card raised beside a stocked area, listing its encounter and treasure](../assets/screenshots/area-hover-card-dark.png#only-dark)

## The content cards

The area panel reads like a printed keyed entry rather than a form of forms: the description up top, then one card per content kind. A card that holds nothing is a single-click add; a card that holds something summarizes itself in module notation and expands in place to edit. Removal is the card's own action, and every change commits as an ordinary undoable batch the moment you make it.

The cards commit through type-ahead pickers over osrlib's shipped catalogs — monsters (bundled templates first, then this session's recent picks), equipment, and treasure-type letters — so the editor never authors a dangling reference. Foreign documents' danglers stay legal, diagnosed, and navigable.

![The area panel's encounter card, collapsed to its module notation, above an expanded treasure card](../assets/screenshots/area-content-cards-light.png#only-light)
![The area panel's encounter card, collapsed to its module notation, above an expanded treasure card](../assets/screenshots/area-content-cards-dark.png#only-dark)

One page per kind:

- [Encounters](encounters.md) — monster lines and counts, the reaction and awareness pins, the lair hoard, and the level's wandering table.
- [Treasure](treasure.md) — treasure type letters or the unguarded band roll, and which one a room wants.
- [Traps](traps.md) — the composable trap builder, for room traps and for trapped caches.
- [Features](features.md) — keyed details, caches, and tricks, at area scope or level scope.
