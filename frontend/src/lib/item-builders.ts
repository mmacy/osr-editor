// The Items section's op builders, mirroring monster-builders: pure functions
// from the committed document to op batches, so every commit computes its
// whole next template against what is actually committed and the section
// logic stays vitest-testable. A builder answering [] skips the batch — the
// template vanished under a queued gesture.
import type {
  Adventure,
  AnyEditOp,
  ArmourCategory,
  ArmourTemplate,
  ConditionSpec,
  GateSpec,
  ItemTemplate,
  Material,
  MissileRanges,
  WeaponQuality,
  WeaponTemplate,
} from '@/types'

// The forge-mode flow-entry message, verbatim the server's blocked-op table
// entry: client-side routing opens the dialog before anyone fills a dialog
// just to be refused, and the server's op_unsupported_forge stays the
// authority for any batch that arrives.
export const BUNDLED_ITEM_BLOCKED_MESSAGE =
  'bundled item templates have no override kind — the overrides vocabulary has no authored-layer surface'

// The gate-value message, mirrored the same way: the value-dependent branch
// the server enforces on requires-carrying set_edges and add_transition.
export const GATE_BLOCKED_MESSAGE =
  'gates have no override kind — the overrides vocabulary has no authored-layer surface'

// The enum option lists — runtime lists of the generated string-literal
// unions, membership pinned by `satisfies` and exhaustiveness by the
// type-level suite (the content-builders discipline).
export const WEAPON_QUALITIES = [
  'blunt',
  'brace',
  'charge',
  'melee',
  'missile',
  'reload',
  'slow',
  'splash',
  'two_handed',
] as const satisfies readonly WeaponQuality[]

export const MATERIALS = ['standard', 'silver'] as const satisfies readonly Material[]

export const ARMOUR_CATEGORIES = ['light', 'heavy'] as const satisfies readonly ArmourCategory[]

export const ITEM_KINDS = [
  'weapon',
  'armour',
  'gear',
  'ammunition',
] as const satisfies readonly ItemTemplate['item_type'][]

export function findItemTemplate(document: Adventure, itemId: string): ItemTemplate | null {
  return document.items.find((template) => template.id === itemId) ?? null
}

// The missile-quality toggle's seed: a neutral ordered three-band spread the
// form then edits — the AC-pair convention at range scale.
export function neutralMissileRanges(): MissileRanges {
  return {
    short: { min_feet: 5, max_feet: 50 },
    medium: { min_feet: 51, max_feet: 100 },
    long: { min_feet: 101, max_feet: 150 },
  }
}

// The create dialog's per-kind seeds: model-valid, every value neutral or
// osrlib-derived. `overrides_applied: []` is SRD-compiler provenance,
// meaningless in editor-authored templates and never surfaced — items have no
// `page`.
export function seedItemTemplate(
  kind: ItemTemplate['item_type'],
  id: string,
  name: string,
): ItemTemplate {
  if (kind === 'weapon') {
    return {
      item_type: 'weapon',
      id,
      name,
      cost_gp: 0,
      weight_coins: 0,
      damage: '1d6',
      qualities: ['melee'],
      missile_ranges: null,
      material: 'standard',
      overrides_applied: [],
    }
  }
  if (kind === 'armour') {
    // The body triple's seed is the unarmoured pair plus light — the monster
    // seed's AC convention.
    return {
      item_type: 'armour',
      id,
      name,
      cost_gp: 0,
      weight_coins: 0,
      ac: 9,
      ac_ascending: 10,
      ac_bonus: null,
      category: 'light',
      overrides_applied: [],
    }
  }
  if (kind === 'gear') {
    return {
      item_type: 'gear',
      id,
      name,
      cost_gp: 0,
      lot_size: 1,
      capacity_coins: null,
      combat: null,
      params: {},
      overrides_applied: [],
    }
  }
  return {
    item_type: 'ammunition',
    id,
    name,
    cost_gp: 0,
    lot_size: 1,
    weight_coins: 0,
    material: 'standard',
    overrides_applied: [],
  }
}

// The armour form's body/shield radio swaps the field sets whole, so the
// model's XOR is unrepresentable to break: body seeds the unarmoured triple,
// shield seeds ac_bonus 1 and clears the triple in the same value.
export function armourModePatch(shield: boolean): Partial<ArmourTemplate> {
  if (shield) return { ac: null, ac_ascending: null, category: null, ac_bonus: 1 }
  return { ac: 9, ac_ascending: 10, category: 'light', ac_bonus: null }
}

// The weapon form's missile toggle: quality and ranges travel together in one
// gesture — present together or absent together, the model's own coupling.
export function missilePatch(template: WeaponTemplate, missile: boolean): Partial<WeaponTemplate> {
  if (missile) {
    if (template.qualities.includes('missile')) return {}
    return { qualities: [...template.qualities, 'missile'], missile_ranges: neutralMissileRanges() }
  }
  return {
    qualities: template.qualities.filter((quality) => quality !== 'missile'),
    missile_ranges: null,
  }
}

// The list's referenced-by count and the remove confirm's honesty: cache
// item_ids at both scopes, has_item gate conditions on doors and transitions,
// and the authored-layer sites a foreign document can carry (item_acquired
// patterns, clause conditions, grant_item consequences) — the exact site set
// the rename cascade rewrites.
export function itemReferenceCount(document: Adventure, itemId: string): number {
  let count = 0
  const countGate = (gate: GateSpec | null | undefined) => {
    if (gate && gate.condition.condition_type === 'has_item' && gate.condition.item_id === itemId) {
      count += 1
    }
  }
  const countCondition = (condition: ConditionSpec) => {
    if (condition.condition_type === 'has_item' && condition.item_id === itemId) count += 1
  }
  for (const dungeon of document.dungeons) {
    for (const level of dungeon.levels) {
      for (const area of level.areas) {
        for (const feature of area.features) {
          count += feature.item_ids.filter((id) => id === itemId).length
        }
      }
      for (const feature of level.features) {
        count += feature.item_ids.filter((id) => id === itemId).length
      }
      for (const edge of Object.values(level.edges)) {
        countGate(edge.door?.requires)
      }
      for (const transition of level.transitions) {
        countGate(transition.requires)
      }
    }
  }
  for (const trigger of document.triggers) {
    if (trigger.when.pattern_type === 'item_acquired' && trigger.when.item_id === itemId) count += 1
    for (const condition of trigger.conditions) countCondition(condition)
    for (const consequence of trigger.consequences) {
      if (consequence.command_type === 'grant_item' && consequence.item_id === itemId) count += 1
    }
  }
  for (const quest of document.quests) {
    const clauses = [
      quest.activation,
      ...quest.objectives.map((objective) => objective.when),
      ...quest.objectives.map((objective) => objective.reveal_when),
    ]
    for (const clause of clauses) {
      if (!clause) continue
      if (clause.pattern.pattern_type === 'item_acquired' && clause.pattern.item_id === itemId) {
        count += 1
      }
      for (const condition of clause.conditions) countCondition(condition)
    }
    for (const reward of quest.rewards) {
      if (reward.command_type === 'grant_item' && reward.item_id === itemId) count += 1
    }
  }
  return count
}

// --- the ops ---

export function addItemTemplateOps(template: ItemTemplate): AnyEditOp[] {
  return [{ op: 'add_item_template', template }]
}

export function itemTemplateSetOps(itemId: string, template: ItemTemplate): AnyEditOp[] {
  return [{ op: 'set_item_template', item_id: itemId, template }]
}

// Whole-value replacement with the next template computed from the committed
// one inside the queue — the monsterTemplateUpdateOps discipline. `null`
// skips the batch.
export function itemTemplateUpdateOps(
  document: Adventure,
  itemId: string,
  update: (committed: ItemTemplate) => ItemTemplate | null,
): AnyEditOp[] {
  const current = findItemTemplate(document, itemId)
  if (!current) return []
  const next = update(current)
  if (next === null) return []
  return itemTemplateSetOps(itemId, next)
}

// The per-kind compute-in-the-queue form: `build` receives the *committed*
// template, narrowed to the kind, and answers the patch — collection edits
// (qualities, ranges, the combat facet, params) must compute their next value
// here, or a payload built from the render-time template queued behind an
// in-flight commit silently reverts it (the monsterTemplateUpdateOps rule).
// A kind mismatch skips (unreachable through the UI — a template's kind is
// never editable — but the guard keeps the builder honest under any queue).
export function itemTemplateKindUpdateOps<K extends ItemTemplate['item_type']>(
  document: Adventure,
  itemId: string,
  kind: K,
  build: (
    committed: Extract<ItemTemplate, { item_type: K }>,
  ) => Partial<Extract<ItemTemplate, { item_type: K }>> | null,
): AnyEditOp[] {
  return itemTemplateUpdateOps(document, itemId, (committed) => {
    if (committed.item_type !== kind) return null
    const narrowed = committed as Extract<ItemTemplate, { item_type: K }>
    const patch = build(narrowed)
    return patch === null ? null : { ...narrowed, ...patch }
  })
}

// The state-independent form: a patch whose values don't derive from the
// current template (a scalar field, the armour-mode gesture, a rename).
export function itemTemplatePatchOps<K extends ItemTemplate['item_type']>(
  document: Adventure,
  itemId: string,
  kind: K,
  patch: Partial<Extract<ItemTemplate, { item_type: K }>>,
): AnyEditOp[] {
  return itemTemplateKindUpdateOps(document, itemId, kind, () => patch)
}

// One quality toggled in or out of a quality set — shared by the weapon form
// and the gear combat facet, always over the committed tuple.
export function toggledQualities(
  qualities: readonly WeaponQuality[],
  quality: WeaponQuality,
  present: boolean,
): WeaponQuality[] {
  if (present) return qualities.includes(quality) ? [...qualities] : [...qualities, quality]
  return qualities.filter((candidate) => candidate !== quality)
}

export function itemTemplateRemoveOps(itemId: string): AnyEditOp[] {
  return [{ op: 'remove_item_template', item_id: itemId }]
}

// A gear param value as the key/value rows commit it: a JSON fragment when it
// parses to a param-typed value (number, boolean), else the raw text as a
// plain string — the monster-ability precedent narrowed to gear's own value
// domain (int | str | bool; no arrays). The client mirror's convenience; the
// server's parse stays the authority.
export function parseGearParam(text: string): number | string | boolean | null {
  const trimmed = text.trim()
  if (trimmed === '') return null
  try {
    const parsed: unknown = JSON.parse(trimmed)
    if (typeof parsed === 'number' || typeof parsed === 'boolean' || typeof parsed === 'string') {
      return parsed
    }
    return null
  } catch {
    return trimmed
  }
}

export function formatGearParam(value: number | string | boolean): string {
  if (typeof value === 'string') return value
  return JSON.stringify(value)
}
