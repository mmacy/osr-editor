# Traps

A trap is built from composable parts rather than picked from a list, because B/X traps are one-off contraptions. Set the parts that apply and leave the rest alone; an unset part isn't part of the trap. Its card is one of the four in the area panel, reached the way [stocking](stocking-and-keyed-content.md) reaches all of them.

## Where a trap lives decides its kind

There are two kinds and the builder never asks which one you want:

- A **room trap** is the area's own trap — the pit in the floor, the scything blade across the doorway. It's the trap card in the area panel.
- A **treasure trap** guards a cache. It's the **Trap this cache** action inside a treasure cache [feature](features.md), and it protects that cache specifically.

The kind follows from where you added it, and the models enforce the split, so a trap can never end up filed as the wrong sort. What differs between them is not the builder — both offer the same fields — but which engine path springs the trap, and that has consequences for the trigger.

## The trap's shape

**Trigger** names the springing action, and the default is the one that actually fires. A room trap springs on `enter`; set it to `open` and it never springs at all, because an area has nothing to open. A cache's trap springs when the cache is opened, whatever the field says. Leave the trigger alone unless you have a reason.

A room trap also isn't certain to go off. Entering the cell springs it 2-in-6, the way B/X handles a party walking over a pit, and a trap the party has already found, removed, or sprung never fires again.

**Affects** is the `triggerer` alone or the whole `party` — the difference between the character who stepped on the plate and everyone standing in the room when it goes off.

## The effect

Every field below is optional, and a trap is the sum of the ones you set. Nothing stops you combining them: a dart volley that also poisons is a damage roll, a volley count, a save, and a condition on one trap.

- **Damage** — the dice rolled on a hit.
- **Volley** — how many of it, for the trap that fires a spray of darts rather than one. Available only once damage is set, since a volley of nothing is nothing; clearing the damage clears the volley with it.
- **Save** — the category the victim saves against (`death`, `wands`, `paralysis`, `breath`, or `spells`), with a **Modifier** for the trap that's easier or harder to dodge and **On save** choosing whether a success `negates` the effect outright or takes `half`.
- **Save or die** — the classic lethal trap. It takes precedence over everything else that would happen to the victim: the damage, the fall, and the condition never apply. Pair it with a save set to `negates`. A `half` save does not stop a kill, so **Save or die** with **On save: half** is lethal to everyone the trap catches, saved or not.
- **Condition** — what the victim is left with: `poisoned`, `paralysed`, `asleep`, `blind`, `petrified`, and the rest of osrlib's condition vocabulary. **Duration** and **Unit** say for how long — a fixed number or a dice expression, in `round`, `turn`, or `day`. Both are available only once a condition is set, and clearing the condition clears them.
- **Fall (feet)** — the drop, for the pit.
- **Slide** — where the chute dumps them: pick the destination dungeon, level, cell, and facing, the same target gesture the map's transition tool uses. It relocates the party outright rather than adding a transition to the map, so nothing leads back up. It also applies to the *whole party* whatever the rest of the trap says — the party has one location — so a slide fires on a triggerer-only trap, and fires even when every character saves.
- **Manual effect** — prose, for what the rules leave to the referee. Everything B/X describes and no field above can express goes here. The engine carries it and never automates it, so it is a note to the human running the game rather than a mechanic.

The builder holds those dependencies by construction rather than validating after the fact, so the trap you're editing is a legal trap at every keystroke — which is why the dependent fields disable instead of complaining.

## Removing one

**Remove trap** on the card takes the room trap away; a cache's trap has its own **Remove the trap** inside the feature. Either is one undo step, like every other edit.
