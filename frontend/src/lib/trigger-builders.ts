// The Quests section's trigger op builders, mirroring item-builders: pure
// functions from the committed document to op batches, so every commit
// computes its whole next spec against what is actually committed and the
// section logic stays vitest-testable. A builder answering [] skips the
// batch — the trigger vanished under a queued gesture.
import type { Adventure, AnyEditOp, ConsequenceCommand, TriggerPattern, TriggerSpec } from '@/types'

// The forge-mode flow-entry message, verbatim the server's blocked-op table
// entry: client-side routing opens the dialog before anyone builds a trigger
// just to be refused, and the server's op_unsupported_forge stays the
// authority for any batch that arrives.
export const TRIGGER_BLOCKED_MESSAGE =
  'triggers have no override kind — the overrides vocabulary has no authored-layer surface'

// The party selectors, pinned as frontend constants: they are osrlib module
// constants (PARTY_SELECTOR, FIRST_LIVING_SELECTOR), not schema, so the
// generated types cannot carry them. The selector control writes exactly
// these two literals — a literal character_id is unauthorable.
export const PARTY_SELECTOR = '@party'
export const FIRST_LIVING_SELECTOR = '@first'

export const SELECTOR_LABELS: Record<string, string> = {
  [PARTY_SELECTOR]: 'Whole party',
  [FIRST_LIVING_SELECTOR]: 'First living character',
}

// The enum option lists — runtime lists of the generated string-literal
// unions, membership pinned by `satisfies` (the content-builders discipline).
export const PATTERN_KINDS = [
  'area_entered',
  'level_entered',
  'dungeon_entered',
  'town_entered',
  'item_acquired',
  'monster_defeated',
  'flag_set',
] as const satisfies readonly TriggerPattern['pattern_type'][]

export const PATTERN_KIND_LABELS: Record<TriggerPattern['pattern_type'], string> = {
  area_entered: 'Entering an area',
  level_entered: 'Entering a level',
  dungeon_entered: 'Entering a dungeon',
  town_entered: 'Arriving in town',
  item_acquired: 'Acquiring an item',
  monster_defeated: 'Defeating a monster',
  flag_set: 'A flag is written',
}

export const COMMAND_KINDS = [
  'grant_item',
  'grant_coins',
  'award_xp',
  'set_flag',
  'spawn_monsters',
  'spawn_npc_party',
  'set_door_state',
  'place_party',
  'advance_time',
] as const satisfies readonly ConsequenceCommand['command_type'][]

export const COMMAND_KIND_LABELS: Record<ConsequenceCommand['command_type'], string> = {
  grant_item: 'Grant an item',
  grant_coins: 'Grant coins',
  award_xp: 'Award XP',
  set_flag: 'Set a flag',
  spawn_monsters: 'Spawn monsters',
  spawn_npc_party: 'Spawn an NPC party',
  set_door_state: 'Set a door state',
  place_party: 'Place the party',
  advance_time: 'Advance time',
}

export function findTrigger(document: Adventure, triggerId: string): TriggerSpec | null {
  return document.triggers.find((trigger) => trigger.id === triggerId) ?? null
}

// The create dialog's and the map gestures' prefill: the next free
// `trigger-<n>` over the trigger namespace alone (quest ids are a separate
// namespace and impose nothing).
export function nextTriggerId(document: Adventure): string {
  const taken = new Set(document.triggers.map((trigger) => trigger.id))
  let n = 1
  while (taken.has(`trigger-${n}`)) n += 1
  return `trigger-${n}`
}

// A complete, empty-bodied spec around a pattern — the create dialog's and
// the map gestures' shape: everything else is detail-editor work, and no
// fake references are ever seeded.
export function seedTrigger(id: string, when: TriggerPattern): TriggerSpec {
  return { id, when, conditions: [], repeatable: false, consequences: [], narrative: null }
}

// The map's one-gesture placements: an area trigger bound to the clicked
// area, a level trigger bound to the level tab's level.
export function seedAreaTrigger(
  document: Adventure,
  dungeonId: string,
  levelNumber: number,
  areaId: string,
): TriggerSpec {
  return seedTrigger(nextTriggerId(document), {
    pattern_type: 'area_entered',
    dungeon_id: dungeonId,
    level_number: levelNumber,
    area_id: areaId,
  })
}

export function seedLevelTrigger(
  document: Adventure,
  dungeonId: string,
  levelNumber: number,
): TriggerSpec {
  return seedTrigger(nextTriggerId(document), {
    pattern_type: 'level_entered',
    dungeon_id: dungeonId,
    level_number: levelNumber,
  })
}

// --- the map's derived sets ---

// The area ids on one level any area_entered trigger targets — the glyph's
// input, derived per render (triggers are adventure-scope, so the set is
// computed, never stored).
export function triggerAreaIds(
  document: Adventure,
  dungeonId: string,
  levelNumber: number,
): Set<string> {
  const ids = new Set<string>()
  for (const trigger of document.triggers) {
    const when = trigger.when
    if (
      when.pattern_type === 'area_entered' &&
      when.dungeon_id === dungeonId &&
      when.level_number === levelNumber
    ) {
      ids.add(when.area_id)
    }
  }
  return ids
}

// The area_entered triggers targeting one area, in document order — the
// context menu's edit rows.
export function areaTriggersFor(
  document: Adventure,
  dungeonId: string,
  levelNumber: number,
  areaId: string,
): TriggerSpec[] {
  return document.triggers.filter((trigger) => {
    const when = trigger.when
    return (
      when.pattern_type === 'area_entered' &&
      when.dungeon_id === dungeonId &&
      when.level_number === levelNumber &&
      when.area_id === areaId
    )
  })
}

// The level_entered triggers targeting one level, in document order — the
// level tab's marker and the level properties dialog's triggers block.
export function levelTriggersFor(
  document: Adventure,
  dungeonId: string,
  levelNumber: number,
): TriggerSpec[] {
  return document.triggers.filter((trigger) => {
    const when = trigger.when
    return (
      when.pattern_type === 'level_entered' &&
      when.dungeon_id === dungeonId &&
      when.level_number === levelNumber
    )
  })
}

// --- the ops ---

export function addTriggerOps(trigger: TriggerSpec): AnyEditOp[] {
  return [{ op: 'add_trigger', trigger }]
}

export function triggerSetOps(triggerId: string, trigger: TriggerSpec): AnyEditOp[] {
  return [{ op: 'set_trigger', trigger_id: triggerId, trigger }]
}

export function moveTriggerOps(triggerId: string, index: number): AnyEditOp[] {
  return [{ op: 'move_trigger', trigger_id: triggerId, index }]
}

export function removeTriggerOps(triggerId: string): AnyEditOp[] {
  return [{ op: 'remove_trigger', trigger_id: triggerId }]
}

// Whole-value replacement with the next spec computed from the committed one
// inside the queue — the itemTemplateUpdateOps discipline, load-bearing here
// because the consequence list edits sub-parts of a whole-value spec. `null`
// skips the batch.
export function triggerUpdateOps(
  document: Adventure,
  triggerId: string,
  update: (committed: TriggerSpec) => TriggerSpec | null,
): AnyEditOp[] {
  const current = findTrigger(document, triggerId)
  if (!current) return []
  const next = update(current)
  if (next === null) return []
  return triggerSetOps(triggerId, next)
}

// The state-independent form: a patch whose values don't derive from the
// current spec (the repeatable toggle, a rename, a whole new pattern).
export function triggerPatchOps(
  document: Adventure,
  triggerId: string,
  patch: Partial<TriggerSpec>,
): AnyEditOp[] {
  return triggerUpdateOps(document, triggerId, (committed) => ({ ...committed, ...patch }))
}

// --- the door canonicalization ---

// The canonical door reference: osrlib stores door edges under north/west
// keys only and canonicalizes SetDoorState internally — (2, 0, south) and
// (2, 1, north) name the same door. The picker emits the storage-form triple;
// seeding from a foreign value maps south/east onto the neighbouring cell's
// north/west for display.
export interface DoorRef {
  x: number
  y: number
  direction: 'north' | 'east' | 'south' | 'west'
}

export function canonicalDoorRef(ref: DoorRef): DoorRef {
  if (ref.direction === 'south') return { x: ref.x, y: ref.y + 1, direction: 'north' }
  if (ref.direction === 'east') return { x: ref.x + 1, y: ref.y, direction: 'west' }
  return ref
}

// A canonical door ref as its edge key — the lookup into LevelSpec.edges.
export function doorRefKey(ref: DoorRef): string {
  return `${ref.x},${ref.y}:${ref.direction}`
}

// The door edges incident to a clicked cell, as canonical refs whose keys
// hold doors on the level — the door picker's offer set: only actual doors
// are offerable, so "names no door" is unrepresentable by the control.
export function doorRefsAt(
  edges: Record<string, { kind: string }>,
  cell: readonly [number, number],
): DoorRef[] {
  const [x, y] = cell
  const candidates: DoorRef[] = [
    { x, y, direction: 'north' },
    { x, y, direction: 'west' },
    canonicalDoorRef({ x, y, direction: 'south' }),
    canonicalDoorRef({ x, y, direction: 'east' }),
  ]
  return candidates.filter((ref) => edges[doorRefKey(ref)]?.kind === 'door')
}

// --- the module-notation summaries ---

// Name resolution for the summaries: surfaces that have the catalogs resolve
// ids to names; a dangling id degrades to itself — the raw id is the honest
// rendering of a reference that resolves to nothing.
export interface SummaryNames {
  itemName?: (id: string) => string
  monsterName?: (id: string) => string
}

function flagValueText(value: string | number | boolean): string {
  return typeof value === 'string' ? `'${value}'` : String(value)
}

export function patternSummary(pattern: TriggerPattern, names: SummaryNames = {}): string {
  switch (pattern.pattern_type) {
    case 'area_entered':
      return `on entering area ${pattern.area_id}, level ${pattern.level_number} of '${pattern.dungeon_id}'`
    case 'level_entered':
      return `on entering level ${pattern.level_number} of '${pattern.dungeon_id}'`
    case 'dungeon_entered':
      return `on entering '${pattern.dungeon_id}'`
    case 'town_entered':
      return 'on arriving in town'
    case 'item_acquired':
      return `on acquiring ${(names.itemName ?? ((id: string) => id))(pattern.item_id)}`
    case 'monster_defeated':
      return `on defeating ${(names.monsterName ?? ((id: string) => id))(pattern.template_id)}`
    case 'flag_set':
      return pattern.value == null
        ? `on flag '${pattern.key}' being written`
        : `on flag '${pattern.key}' set to ${flagValueText(pattern.value)}`
  }
}

function recipientText(characterId: string): string {
  const label = SELECTOR_LABELS[characterId]
  return label ? label.toLowerCase() : `character '${characterId}'`
}

function coinsText(coins: Record<string, number | undefined>): string {
  const parts = (['pp', 'gp', 'ep', 'sp', 'cp'] as const)
    .filter((denomination) => (coins[denomination] ?? 0) > 0)
    .map((denomination) => `${coins[denomination]} ${denomination}`)
  return parts.length > 0 ? parts.join(', ') : 'no coins'
}

export function consequenceSummary(command: ConsequenceCommand, names: SummaryNames = {}): string {
  switch (command.command_type) {
    case 'grant_item': {
      const name = (names.itemName ?? ((id: string) => id))(command.item_id)
      const quantity = command.quantity > 1 ? `${command.quantity}× ` : ''
      return `grant ${quantity}${name} to ${recipientText(command.character_id)}`
    }
    case 'grant_coins':
      return `grant ${coinsText(command.coins)} to ${recipientText(command.character_id)}`
    case 'award_xp':
      return `award ${command.amount} XP to ${recipientText(command.character_id)}`
    case 'set_flag':
      return `set flag '${command.key}' to ${flagValueText(command.value)}`
    case 'spawn_monsters': {
      const name = (names.monsterName ?? ((id: string) => id))(command.template_id)
      const count = command.count_dice ?? String(command.count_fixed ?? '')
      return `spawn ${count} ${name} at ${command.distance_feet} ft`
    }
    case 'spawn_npc_party': {
      const count = command.count_dice ? `${command.count_dice} ` : ''
      return `spawn a ${command.party_kind} NPC party (${count || 'compiled dice '}composition) at ${command.distance_feet} ft`
    }
    case 'set_door_state': {
      const writes = (['open', 'wedged', 'discovered', 'unlocked'] as const)
        .filter((field) => command[field] != null)
        .map((field) => `${field} ${String(command[field])}`)
      const state = writes.length > 0 ? writes.join(', ') : 'no change'
      return `door at (${command.x}, ${command.y}) ${command.direction}, level ${command.level_number} of '${command.dungeon_id}': ${state}`
    }
    case 'place_party':
      return command.location.kind === 'town'
        ? 'place the party in town'
        : `place the party at (${command.location.position?.[0]}, ${command.location.position?.[1]}), level ${command.location.level_number} of '${command.location.dungeon_id}'`
    case 'advance_time':
      return `advance time ${command.n} ${command.unit}${command.n === 1 ? '' : 's'}`
  }
}
