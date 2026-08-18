# Quests

A quest is the goal the engine tracks for your module: recover the idol, and the adventure is won. The quest list lives in the **Quests** section below the [triggers](triggers.md), and the two share a vocabulary on purpose — every clause in a quest is built from the same patterns and conditions a trigger uses, and every reward is one of the same nine referee commands.

A quest has a required **name** (the words the player's quest log shows), an optional **activation** clause, one or more **objectives**, optional **rewards**, a completion rule of **all** or **any**, and the one field behind victory: **concludes the adventure**.

![The quest detail editor: the name, the activation clause, and the first objective with its completion clause, hidden toggle, and beats](../assets/screenshots/quest-detail-light.png#only-light)
![The quest detail editor: the name, the activation clause, and the first objective with its completion clause, hidden toggle, and beats](../assets/screenshots/quest-detail-dark.png#only-dark)

## Creating a quest

**New quest** collects exactly what a quest must have to exist: an id, the name, and the first objective's completion pattern. A quest without a name or without an objective is not a valid document shape — under the *all* rule an objective-less quest would be born complete — so the dialog won't create one. Everything else is detail-editor work; the first objective is minted `objective-1`, and you rename it there.

## Activation, or the standing charge

A quest with no activation clause is a **standing charge**: active from the session's first moment, on the party's list before they take a step. Two honest consequences follow from there being no activation moment: the engine never journals the quest's offer text (there is no moment to journal it at), though the quest still shows in the player's quest log from the start.

**Add activation** turns activation into an event the party crosses — entering the dungeon, taking a specific item, any of the seven patterns — optionally narrowed by conditions. When an activation clause matches, the quest activates and the engine journals its offer text at that moment. Removing the clause returns the quest to a standing charge.

## Objectives

Each objective is a thing the party can accomplish, with a completion clause built from the same pattern-plus-conditions shape. Order matters everywhere it shows: objectives keep their authored order in the quest log, in the engine's walk, and — under the *any* rule — in which objective's landing completes the quest.

- The **name** is the quest log's label. It is optional; an unnamed objective shows as its id everywhere a label shows.
- Objective **ids** are unique within their quest (two different quests may reuse an id), and the editor refuses a duplicate as you type it.
- A quest keeps at least one objective — the editor never removes the last one.

### Hidden objectives and reveals

A **hidden** objective stays off the player's list until it is revealed. There are two ways out of hiding:

- When a **reveal clause** — the same clause shape again — matches, the engine surfaces the objective and journals its *offer* text at that moment.
- Completing a hidden objective reveals it. A hidden objective with no reveal clause is a perfectly normal shape: it surfaces by being done.

A reveal clause only makes sense on a hidden objective, so unticking **Hidden** clears the reveal clause in the same gesture.

Because the engine reads an objective's offer text only at its reveal, a born-visible objective's offer is read at no moment — author the *progress* beat for objectives that start on the list.

## Rewards

Rewards are the same nine commands a trigger's consequences use, under the same rules: recipients are the whole party or the first living character (never a typed character id), and the engine issues them in authored order when the quest completes.

One ordering fact is worth knowing for a concluding quest: the victory transition happens *before* the engine issues the rewards. Grants, awards, and flag writes still land — the epilogue paying out — but spawns and placements are dropped, because the session is already over and there is nothing left to fight or walk.

## All, any, and concluding the adventure

**Completion** is *all* (every objective) or *any* (the first to land — when one moment would complete several, the first in authored order counts).

**Concludes the adventure** marks the quest whose completion ends the adventure in victory: the engine switches to the victory state and journals the quest's *completion* text with it. Author one concluding quest per module — the engine caps nothing, but once the first one completes the session is over, and a second concluding quest can only ever add a journal line.

## The two beats, journaled as themselves

A quest's narrative block holds **offer** (shown and journaled at activation) and **completion** (shown and journaled at quest completion). An objective's block holds **offer** (at reveal) and **progress** (at its completion). The engine shows and journals each beat on its own lifecycle event, as itself — there is no separate journal voice to author, which is why the editor offers none. When a foreign document's block holds text in a beat the engine never reads for a quest (a `journal` or `fired` line), the editor flags it by name with a one-click clear.

Speaker and guidance are on every narrative block, as always.

## The advisory lints

Two advisory checks watch the quest layer, joining the [three on the trigger layer](triggers.md#the-advisory-lints). Warnings by construction — they never block publishing:

- **Unpriced treasure rewards** (`quest_reward_unpriced`) — the quest's rewards grant treasure the XP machinery will never price, with no XP award beside them. Granted items always count zero toward XP under the engine's valuation rule; granted coins on a *concluding* quest land after victory, where the return-to-town award never runs. Either way the players get the loot but never the experience — add an **Award XP** reward if the payment is meant to count. (The game prices granted coins on a non-concluding quest at the next return to town, so those are not flagged.)
- **A key nothing places** (`key_not_placed`) — a door or stair gate names a bundled item that no treasure cache holds and no trigger or non-concluding quest reward grants. The party can buy shipped items in town, but a bundled item exists only where you put it — and a concluding quest's grant doesn't count, because it lands after the adventure is already over. The finding sits on the gate that can't be satisfied.

## What lives in saves

A quest's lifecycle state — activated, revealed, completed — lives in the play session's save, keyed by quest and objective ids, not in your document. Renaming a quest orphans it in existing saves: loading a save replaces the session's quest state wholesale, so the renamed quest has no entry at all — the engine skips it silently, and it never activates, never appears in the quest log, and never advances in that save. Renaming an objective orphans one level down — under the *all* rule, a quest with a renamed objective can never complete from an old save. Fresh sessions are unaffected. This is the game engine's own posture, and the editor does not attempt to repair old saves.

## In converted projects

The [forge-backed](forge-backed-review.md) posture is the same as for triggers: no forge-assembled document can hold quests, the gap is [osr-forge#39](https://github.com/mmacy/osr-forge/issues/39), and the Quests section offers **Detach to a native project** in place.
