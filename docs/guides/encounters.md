# Encounters

An area's encounter is the monsters keyed to it — what the party meets when they first walk in. Its card is one of the four in the area panel, reached the way [stocking](stocking-and-keyed-content.md) reaches all of them.

## The encounter card

Each line names a monster and a count. Pick monsters through the type-ahead picker, which ranks the adventure's own bundled templates first, then this session's recent picks, then the shipped catalog in its own order — so a bespoke monster is always a keystroke away and a dangling id is never authored. **Create monster…** leaves the card for [the monster editor](monster-editor.md) with the create flow already open; the new template then ranks first in every picker. In a forge-backed project **Create monster…** opens the blocked-op dialog instead, which names detach as what unlocks the create flow.

A count is a fixed number or a dice expression: `4` for four orcs, `2d4` when you want the roll to happen at play time. Lines remove individually, and the last line can't go — an encounter with no monsters isn't a thing the model allows, so remove the encounter itself instead.

Three of the controls under the lines are pins — each one a choice to override what the engine would otherwise roll:

- **Alignment** fixes the spawn alignment for templates that offer more than one. The options offered are the intersection across the encounter's monsters, so a mixed group only offers alignments all of them can take.
- **Stance** pins the reaction outright — pick one and no reaction roll happens. Leave it at none for the ordinary rolled reaction.
- **Aware** means the monsters expect intruders. They never roll surprise.

**Preview counts and XP** samples the encounter — rolled counts, the resolved stat table, and per-sample XP — without committing anything. See [authoring aids](authoring-aids.md).

![The expanded encounter card: two monster lines reading 3 × Acolyte and 2d4 × Skeleton, an Add monster button, the alignment select pinned to chaotic beside the stance select pinned to hostile, and the aware and lair hoard checkboxes both ticked](../assets/screenshots/encounter-card-light.png#only-light)
![The expanded encounter card: two monster lines reading 3 × Acolyte and 2d4 × Skeleton, an Add monster button, the alignment select pinned to chaotic beside the stance select pinned to hostile, and the aware and lair hoard checkboxes both ticked](../assets/screenshots/encounter-card-dark.png#only-dark)

An acolyte takes any alignment and a skeleton only chaotic, so `chaotic` is the whole of what that pair's alignment select offers.

## Where a monster's treasure comes from

**Lair hoard** is on by default, and it means the engine generates the keyed monsters' own treasure when it first spawns them. Key four orcs and you have keyed their type D hoard with them — you do not add a treasure card for it.

- **The engine rolls once per encounter line, not per monster.** It rolls type D once for one line of four orcs, and twice for two separate orc lines.
- **Nothing lands in your document.** The hoard is generated at play time and dropped on the area's first cell, so `adventure.json` records the encounter and nothing else. The engine rolls the area's [treasure card](treasure.md) *separately* on first entry, which is why putting the monsters' own letters there would double the hoard.
- **Only lair treasure is gated by the checkbox.** The engine generates what monsters carry individually, and what a group carries between them, at spawn either way — the toggle governs the lair cache alone.
- **Some monsters have no lair treasure at all.** Their type yields no hoard letters, so the engine has nothing to generate. SRD stocking reports this as a follow-up rather than quietly substituting an unguarded roll.

Untick it for the treasure-absent monster room: the SRD's stocking procedure puts treasure on only some monster rooms, and without the toggle a keyed encounter would always bring its letters along. That's exactly what **Roll SRD stocking** does when the dice give a room monsters but the treasure die fails.

Use the treasure card alongside an encounter only when the room holds something *beyond* what the monsters are guarding.

## Wandering monsters

Not every encounter is keyed to a room. A level's wandering monsters are authored one level up, in the level properties dialog, which holds the inline d20 wandering-table editor seeded from osrlib's compiled level-band table — start from the book's table and bend it to the level. Each row names a monster and a count expression through the same pickers the cards use.

![The level properties dialog with the inline d20 wandering-monster table](../assets/screenshots/wandering-table-light.png#only-light)
![The level properties dialog with the inline d20 wandering-monster table](../assets/screenshots/wandering-table-dark.png#only-dark)
