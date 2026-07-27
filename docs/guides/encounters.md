# Encounters

An area's encounter is the monsters keyed to it — what the party meets when they first walk in. The card is one of the four in the area panel; see [stocking and keyed content](stocking-and-keyed-content.md) for the flow around it.

## The encounter card

Each line names a monster and a count. Pick monsters through the type-ahead picker, which ranks the adventure's own bundled templates first, then this session's recent picks, then the shipped catalog in its own order — so a bespoke monster is always a keystroke away and a dangling id is never authored. **Create monster…** in the picker starts a new template without leaving the card ([the monster editor](monster-editor.md)).

A count is a fixed number or a dice expression: `4` for four orcs, `2d4` when you want the roll to happen at play time. Lines remove individually, and the last line can't go — an encounter with no monsters isn't a thing the model allows, so remove the encounter itself instead.

Three pins sit under the lines, each of them a choice to override what the engine would otherwise roll:

- **Alignment** fixes the spawn alignment for templates that offer more than one. The options offered are the intersection across the encounter's monsters, so a mixed group only offers alignments all of them can take.
- **Stance** pins the reaction outright — pick one and no reaction roll happens. Leave it at none for the ordinary rolled reaction.
- **Aware** means the monsters expect intruders. They never roll surprise.

**Preview** samples the encounter: rolled counts, the resolved stat table, and per-sample XP, without committing anything. See [authoring aids](authoring-aids.md).

## Where a monster's treasure comes from

**Lair hoard** is on by default, and it means the engine generates the keyed monsters' own treasure the first time the encounter spawns. Key four orcs and you have keyed their type D hoard with them — you do not add a treasure card for it.

Worth knowing about how that hoard is built:

- **It rolls per encounter line, not per monster.** One line of four orcs rolls type D once. Two separate orc lines roll it twice.
- **Nothing lands in your document.** The hoard is generated at play time and dropped on the area's first cell, so `adventure.json` records the encounter and nothing else. The area's [treasure card](treasure.md) generates *separately* on first entry, which is why putting the monsters' own letters there would double the hoard.
- **Only lair treasure is gated by the checkbox.** Treasure types that monsters carry individually, or that a group carries between them, generate at spawn either way — the toggle governs the lair cache alone.
- **Some monsters have no lair treasure at all.** Their type yields no hoard letters, so the checkbox has nothing to generate. SRD stocking reports this as a follow-up rather than quietly substituting an unguarded roll.

Untick it for the treasure-absent monster room: the SRD's stocking procedure puts treasure on only some monster rooms, and without the toggle a keyed encounter would always bring its letters along. That's exactly what **Roll SRD stocking** does when a room rolls monsters but the treasure die fails.

Use the treasure card alongside an encounter only when the room holds something *beyond* what the monsters are guarding.

## Wandering monsters

Level properties hold the inline d20 wandering-table editor, seeded from osrlib's compiled level-band table — start from the book's table and bend it to the level. Each row names a monster and a count expression through the same pickers the cards use.

![The level properties dialog with the inline d20 wandering-monster table](../assets/screenshots/wandering-table-light.png#only-light)
![The level properties dialog with the inline d20 wandering-monster table](../assets/screenshots/wandering-table-dark.png#only-dark)
