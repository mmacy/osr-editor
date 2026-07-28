# Authoring aids

Three aids fill a blank module faster. Each applies its results as ordinary, undoable op batches — no special state to reconcile, and in a forge-backed project each translates to reasoned overrides like any other edit.

## SRD stocking

**Roll SRD stocking** rolls a room's contents from osrlib's stocking procedure — the same one the engine plays. Right-click a blank room for a single roll, or sweep a level's unstocked rooms in one undo step from the map toolbar.

Every roll is reproducible from a seed recorded in the project's sidecar: re-roll a room and only that room changes, and undo restores the rooms while the dice stay advanced — so a re-roll always yields fresh content, and the same project replayed from its seeds yields the same rooms. The stream keys follow your areas through every re-keying, key for key.

The stocking report says what landed and what the dice left you, with honest follow-up badges for the hand-work the SRD leaves to the referee: a special to describe, an NPC party to place (with its rolled kind and count), a trap to design, a monster whose type carries no lair treasure. A monster room's treasure is the encounter's own lair hoard — see [where a monster's treasure comes from](encounters.md#where-a-monsters-treasure-comes-from) for what the roll does and doesn't write.

![The stocking report listing what the dice rolled into each swept room](../assets/screenshots/stocking-report-light.png#only-light)
![The stocking report listing what the dice rolled into each swept room](../assets/screenshots/stocking-report-dark.png#only-dark)

## Previews

Previews show what a declaration will produce without committing anything — pure reads over osrlib's generators and tables:

- Sample treasure hoards for a treasure card: letters or the unguarded band, basic or expert tier, with any magic item the roll produced named under its line.
- An encounter's sampled counts, resolved stat table, and per-sample XP.
- Derive-from-HD in the monster editor: XP, the THAC0/attack-bonus pair, and the save band filled from the hit dice.

### Reading a treasure preview

**Preview sample hoards** rolls the card's declaration three times and lists what each roll produced. The three lines are three independent hoards, not one hoard broken into parts — they show the spread a letter or [the unguarded band](treasure.md#treasure-types-or-the-unguarded-band) covers, which is what you want to know before building a room around it. The declaration itself is already committed by the time you can preview it; changing it is one more undoable batch.

Each line reads `coins · valuables · magic · total`, and the trailing figure is the **whole hoard's value in gold**, not a gold-coin count. A line reading `200 sp · 0 valuable(s) · 0 magic · 20 gp` is 200 silver and nothing else — worth 20 gp at ten silver to the gold. The total counts coins and valuables; magic items carry no gp value in it.

The magic the roll produced is named beneath its line, one item per row: the item's catalog name, a leading count only when the roll produced more than one of it (`3 × Potion of Healing`), and the charges in parentheses only for an item that carries a charge count (`Wand of Fire Balls (7 charges)`). A hoard that rolled no magic shows nothing under its line. Gems and jewellery stay a count — the wand is what decides a room, and three gem values rarely do.

**Expert tier** switches which magic-item tables a roll draws from, Basic or Expert. Coins, gems, and jewellery are unaffected, so on a hoard that rolls no magic the toggle changes nothing. It's a control on the preview alone — the card stores letters or the unguarded flag, and the tier the hoard is finally rolled at is the game's.

Previewing rolls fresh dice each time and touches neither the document nor the stocking seeds, so a preview never costs you a re-roll.

## The prose assistant

The prose assistant drafts read-aloud area descriptions and adventure hooks. **Draft with assistant** appears only when a model provider is configured — the same `OSRFORGE_FOUNDRY_*` environment [conversion](converting-a-pdf.md) reads — and is otherwise absent, not disabled.

The draft renders beside your current text with its token usage on every draft; nothing changes until you accept it, and acceptance commits as an ordinary batch you can undo. The call is synchronous and abandonable — close the panel and nothing happened.

![The prose assistant's drafted read-aloud description, with the token usage shown on every draft](../assets/screenshots/prose-assistant-light.png#only-light)
![The prose assistant's drafted read-aloud description, with the token usage shown on every draft](../assets/screenshots/prose-assistant-dark.png#only-dark)
