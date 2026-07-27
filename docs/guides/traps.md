# Traps

A trap is built from composable parts rather than picked from a list, because B/X traps are one-off contraptions. Set the parts that apply and leave the rest alone; an unset part isn't part of the trap. The card is one of the four in the area panel; see [stocking and keyed content](stocking-and-keyed-content.md) for the flow around it.

## Where a trap lives decides its kind

There are two kinds and the builder never asks which one you want:

- A **room trap** is the area's own trap — the pit in the floor, the scything blade across the doorway. It's the trap card in the area panel.
- A **treasure trap** guards a cache. It's the **Trap this cache** action inside a treasure cache [feature](features.md), and it protects that cache specifically.

The kind follows from where you added it, and the models enforce the split, so a trap can never end up filed as the wrong sort. The only visible consequence is the default trigger: a room trap defaults to triggering on entry, a treasure trap on opening.

## The trap's shape

**Trigger** is `enter` or `open`. **Affects** is the `triggerer` alone or the whole `party` — the difference between the character who stepped on the plate and everyone standing in the room when it goes off.

## The effect

Every field below is optional, and a trap is the sum of the ones you set. Nothing stops you combining them: a dart volley that also poisons is a damage roll, a volley count, a save, and a condition on one trap.

- **Damage** — the dice rolled on a hit.
- **Volley** — how many of it, for the trap that fires a spray of darts rather than one. Available only once damage is set, since a volley of nothing is nothing; clearing the damage clears the volley with it.
- **Save** — the category the victim saves against (`death`, `wands`, `paralysis`, `breath`, or `spells`), with a **Modifier** for the trap that's easier or harder to dodge and **On save** choosing whether a success `negates` the effect outright or takes `half`.
- **Save or die** — the classic lethal trap. It takes precedence over damage: a victim who doesn't save is killed, and the damage dice never roll.
- **Condition** — what the victim is left with: `poisoned`, `paralysed`, `asleep`, `blind`, `petrified`, and the rest of osrlib's condition vocabulary. **Duration** and **Unit** say for how long — a fixed number or a dice expression, in `round`, `turn`, or `day`. Both are available only once a condition is set, and clearing the condition clears them.
- **Fall** — the drop in feet, for the pit.
- **Slide** — where the chute dumps them: pick the destination dungeon, level, cell, and facing, the same target gesture the map's transition tool uses. A slide is authored as a chute from the trap's own cell, so it's one-way by osrlib's rules. Note that it moves the *whole party* whatever **Affects** says — the party has one location — so a slide on a triggerer-only trap still takes everyone down the chute.
- **Manual effect** — prose, for what the rules leave to the referee. Everything B/X describes and no field above can express goes here. The engine carries it and never automates it, so it is a note to the human running the game rather than a mechanic.

The builder holds those dependencies by construction rather than validating after the fact, so the trap you're editing is a legal trap at every keystroke — which is why the dependent fields disable instead of complaining.

## Removing one

**Remove trap** on the card takes the room trap away; a cache's trap has its own **Remove the trap** inside the feature. Either is one undo step, like every other edit.
