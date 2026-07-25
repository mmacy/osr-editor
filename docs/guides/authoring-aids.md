# Authoring aids

Three aids fill a blank module faster. Each applies its results as ordinary, undoable op batches — no special state to reconcile, and in a forge-backed project each translates to reasoned overrides like any other edit.

## SRD stocking

**Roll SRD stocking** rolls a room's contents from osrlib's stocking procedure — the same one the engine plays. Right-click a blank room for a single roll, or sweep a level's unstocked rooms in one undo step from the map toolbar.

Every roll is reproducible from a seed recorded in the project's sidecar: re-roll a room and only that room changes, and undo restores the rooms while the dice stay advanced — so a re-roll always yields fresh content, and the same project replayed from its seeds yields the same rooms. The stream keys follow your areas through every re-keying, key for key.

The stocking report says what landed and what the dice left you, with honest follow-up badges for the hand-work the SRD leaves to the referee: a special to describe, an NPC party to place (with its rolled kind and count), a trap to design, a monster whose type carries no lair treasure. A monster room's treasure is the encounter's own lair hoard; the encounter card's lair-hoard toggle expresses the treasure-absent rooms the SRD rolls.

![The stocking report listing what the dice rolled into each swept room](../assets/screenshots/stocking-report-light.png#only-light)
![The stocking report listing what the dice rolled into each swept room](../assets/screenshots/stocking-report-dark.png#only-dark)

## Previews

Previews show what a declaration will produce without committing anything — pure reads over osrlib's generators and tables:

- Sample treasure hoards for a treasure card: letters or the unguarded band, basic or expert tier, with resolved magic-item names.
- An encounter's sampled counts, resolved stat table, and per-sample XP.
- Derive-from-HD in the monster editor: XP, the THAC0/attack-bonus pair, and the save band filled from the hit dice.

## The prose assistant

The prose assistant drafts read-aloud area descriptions and adventure hooks. **Draft with assistant** appears only when a model provider is configured — the same `OSRFORGE_FOUNDRY_*` environment [conversion](converting-a-pdf.md) reads — and is otherwise absent, not disabled.

The draft renders beside your current text with its token usage on every draft; nothing changes until you accept it, and acceptance commits as an ordinary batch you can undo. The call is synchronous and abandonable — close the panel and nothing happened.

![The prose assistant's drafted read-aloud description, with the token usage shown on every draft](../assets/screenshots/prose-assistant-light.png#only-light)
![The prose assistant's drafted read-aloud description, with the token usage shown on every draft](../assets/screenshots/prose-assistant-dark.png#only-dark)
