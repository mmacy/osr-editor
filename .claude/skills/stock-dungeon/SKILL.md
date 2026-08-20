---
name: stock-dungeon
description: Stock a dungeon level in an osr-editor adventure — areas, keyed encounters, traps, treasure, gates, triggers, quests, and bundled content — against an XP budget, written canonically and validated, then playtested to victory through scripted osrlib sessions. Use when asked to stock, populate, or key a level or module, or to verify an authored adventure plays to completion.
---

# Stock a dungeon

Turn a drawn map into a playable adventure. The document is osrlib's pydantic models — the schema authority is the sibling checkout at `../osrlib-python`. Build plain JSON payloads and let the models validate them; never hand-mirror a schema.

Workflow: read the schema → reconstruct the geometry → budget the XP → design and author → validate and write canonically → playtest to victory → tune and repeat.

## 1. Read the schema

In `../osrlib-python/src/osrlib/`:

| File | What it defines |
| --- | --- |
| `crawl/dungeon.py` | `LevelSpec`, `AreaSpec`, `FeatureSpec` (caches, tricks), `KeyedEncounter`, `TrapSpec`/`TrapEffect`, `WanderingSpec`, edges and doors |
| `crawl/gates.py` | `GateSpec` and the condition union (`has_item`, `flag_equals`, `effect_active`) |
| `crawl/triggers.py` | Event patterns, `TriggerSpec`, the `@party` / `@first` selectors |
| `crawl/quests.py` | `QuestSpec`, `ObjectiveSpec`, `TriggerClause` |
| `crawl/commands.py` | `ConsequenceCommand` — the only commands a trigger or quest reward may issue |
| `crawl/narrative.py` | `NarrativeBlock` beats and which carrier reads which |
| `data/monsters.json` | Shipped monster ids and XP values |
| `core/tables.py` | `EncounterTable` (a custom wandering table needs exactly 20 d20 rows) |

## 2. Reconstruct the geometry

The level's `edges` map is the single spatial truth. Keys are `"x,y:north"` or `"x,y:west"` — one entry per physical edge; an absent edge is wall.

- Carved cells = every cell touching an open or door edge.
- Rooms = flood-fill carved cells crossing only *open* edges; each door-bounded region is a room, and the door edges give you the connectivity graph.
- Render an ASCII map before designing anything, and note the `entrance` cell.
- Key rooms as `AreaSpec`s; cells in no area are corridor. Decide deliberately whether door-threshold cells belong to a room (they control when `area_entered` fires).

## 3. Budget the XP

The XP rule (`GameSession.award_adventure_xp`): on return to town, `(defeated monster XP + treasure valuation delta in gp) // living members`.

- Coins count by value; valuables by `value_gp`. Magic items and mundane gear count **zero** — so quest keys and plot items are bundled gear (no XP), and the budget rides entirely on coins and valuables.
- Quest rewards `AwardXP(character_id="@party", amount=N)` pay N to *each* living member, prime-requisite modified, on top of the split.
- Formula: `target_xp_per_member × party_size ≤ placed coin+valuable gp + keyed monster XP`, then add per-member quest awards. Overshoot 15–25% — parties miss caches, drop coin ballast, and die.
- Keep it deterministic: `count_fixed` on keyed monsters, `hoard=False`, hand-placed caches. Monsters still carry generated treasure at spawn; treat that as uncounted bonus.

## 4. Design conventions

- OSE stocking distribution as a target: roughly a third of rooms with monsters, a few trapped, a few specials, the rest empty with flavor.
- `stance="attacks"` for mindless undead and vermin (no friendly-skeleton reaction rolls); `aware=True` for posted guards; leave reaction unpinned where parley makes sense.
- Gate vs trigger: a gate is a live predicate on a door's or transition's `requires` (the door that wants the key); a trigger fires on an event and issues consequences (the lever that opens the portcullis, usually by writing a flag a gate reads). Every flag a condition reads needs a writer — the editor lint checks this.
- No blockers beyond a TPK: a gate's key must be reachable without passing its own gate. Locked doors yield only to a thief's `PickLock` (`ForceDoor` is for stuck doors), so never lock or gate the only route to anything a quest requires. `validate_adventure` checks references; the editor lint checks reachability.
- Narrative beats by carrier: gate → `refusal`/`success`; trigger → `fired` (referee) and `journal` (players); quest → `offer`/`completion`; objective → `offer`/`progress`. Authored-thing prose stays in the stative register (see `AGENTS.md`).
- Bundled ids must not collide with shipped catalogs. Cheapest custom boss: `model_dump` a shipped template, patch id, name, hit dice, THAC0, attack bonus, morale, XP.

## 5. Write canonically and validate

Author through a re-runnable script, not hand-edited JSON:

```python
from osrlib.crawl.adventure import Adventure, validate_adventure
from osrlib.data import load_equipment, load_monsters
from osreditor.documents import dump_adventure, load_adventure

adventure = Adventure.model_validate(payload)
validate_adventure(adventure, load_monsters(), load_equipment())  # the publish gate
data = dump_adventure(adventure)
assert dump_adventure(load_adventure(data)) == data  # byte-stable canonical form
doc_path.write_bytes(data)
```

Then open the project and require zero lint findings:

```python
from osreditor.documents import DocumentService
from osreditor.store import LocalProjectStore
from osreditor.projects import open_project
from osreditor.lint import lint_adventure

project = open_project(DocumentService(LocalProjectStore()), project_dir)
assert not lint_adventure(project.adventure)
```

The `editor.json` sidecar is view state only — leave it alone. Tuning passes re-run the script over its own output, so keep it idempotent.

## 6. Playtest to completion

The proof of no blockers is a scripted session reaching `victory`:

```python
session = GameSession.new(party, adventure, seed=seed)
session.register_listener(Interpreter(session))  # required, or triggers and quests never fire
```

Party via `create_character` (arcane casters need `starting_spell_ids`; class requirements fail on bad rolls — retry draws). Drive with `EnterDungeon`, `MoveParty`, `OpenDoor`, `TakeTreasure`, `TravelToTown`, etc.; resolve battles with `ResolveBattleRound` and per-member `BattleDeclaration`s.

Engine facts a driver must respect (all learned the hard way):

- Only the front rank melees; missiles fire from the back beyond 5'. Adapt each round's declarations from the rejection codes (`not_in_front_rank`, `out_of_reach`, `out_of_range`) instead of precomputing legality.
- Sleep is the level-1 win button against anything not undead. Memorize each town visit (`Rest` a night, then `PrepareSpells`); spend one per dangerous battle, never on trash.
- Green slime is weapon-immune — throw `oil_flask` via `use_item` declarations or walk away. Turn undead handles skeleton and zombie packs.
- Evade wandering encounters (`session.encounter.kind == "wandering"`) while still in `encounter` mode; a hostile reaction opens battle directly with no evade window.
- Everything needs light (`requires_light`): carry torch lots, relight reactively.
- Max load is 1,600 coins per member and overload zeroes movement — drop copper/silver ballast, carry gems (weight 1).
- Treasure XP pays the living only, and raising the dead is unfundable for members who died poor (mmacy/osrlib-python#73). Drive to survive: retreat to town on fresh deaths, heal, buy plate, never descend to the finale understrength.
- Expect TPKs; report them honestly; sweep master seeds until one expedition completes. The deliverable is a victory-mode run plus the XP verdict for the class the budget targeted.

## 7. Tune from evidence

Re-run the full write path after every change. Calibration points from playtesting: party-wide trap damage multi-kills level-1 parties (2d6 gas is an execution, 1d6 a lesson); a boss plus three 2 HD retainers walls any depleted party (two is a fight); single-target save-or-die is fair exactly where the thief can find and remove it.
