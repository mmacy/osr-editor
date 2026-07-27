# Features

A feature is a keyed detail with a location — the loose flagstone, the sealed alcove, the chest under the altar. Where the other cards each hold one thing, an area holds as many features as it needs. Its card is one of the four in the area panel, reached the way [stocking](stocking-and-keyed-content.md) reaches all of them.

## What a feature is

Every feature carries an **id**, a **kind**, and a **description**. The id is yours to name and is what the rest of the document refers to; a duplicate, empty, or reserved id is refused inline, right where you typed it, rather than at save time. The description is the prose the referee reads.

The three kinds say what the feature is for, and the kind is load-bearing rather than a label:

- `treasure_cache` — a specific stash: named items, counted coins, valuables, and optionally [a trap guarding it](traps.md). This is the only kind the party can open and take from at the table.
- `construction_trick` — the dungeon doing something: the sliding wall, the rotating room, the sinking floor.
- `custom` — everything else worth keying.

Set the kind first, because the contents fields below show on every feature while only a cache can be opened. Items and coins on a trick or a custom feature are prose describing the room, not loot anyone can pick up. Changing a cache to another kind also drops its trap, in the same undo step.

## Where a feature sits

A feature is bound either to its area as a whole or to one particular cell. **Pick cell…** opens a thumbnail of the level to click the cell on; **Bind to area** takes the binding back off, leaving the feature attached to the area rather than a square of it.

Cell binding is what lets a big room hold several distinct features — the fountain at one end, the collapsed shaft at the other. It also decides who can reach one: a cell-bound feature is only interactable by a party standing on that cell, while an area-bound feature is reachable anywhere in the room. Bind a trapped cache to its cell, so the party has to be standing at the chest to open it.

## What a cache holds

A cache's contents are authored explicitly rather than rolled:

- **Items** come from osrlib's equipment catalog through the type-ahead picker, so the ids are always real. Added items list as chips; each removes on its own.
- **Coins** are counted per denomination — pp, gp, ep, sp, cp.
- **Valuables** are named things with a gold value, for the gems, jewellery, and objets the module names outright.

**Trap this cache** adds a treasure trap, built with the same [trap builder](traps.md) as a room trap and pinned to the treasure kind because of where it lives. It appears on treasure caches only. **Remove the trap** takes it off again.

That explicitness is the difference from the [treasure card](treasure.md): a treasure declaration hands the room to the tables, while a cache feature is you saying exactly what's there.

## Level features

Not every keyed detail belongs to a room. A trick in a corridor, a cache in a dead-end passage, an inscription on a stair landing — these live at level scope, in **Level features** in the level properties dialog, using the same feature cards.

The one difference is the add flow: a level feature has no area to fall back on, so **Add feature…** asks for the cell first, on the same level thumbnail, and commits once you've clicked it. This is also the surface where a lint finding about a level feature, or a resize that would strand one, gets resolved.
