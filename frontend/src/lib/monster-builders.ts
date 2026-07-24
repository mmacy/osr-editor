// The Monsters section's op builders, mirroring content-builders: pure
// functions from the committed document to op batches, so every commit
// computes its whole next template against what is actually committed and the
// section logic stays vitest-testable. A builder answering [] skips the batch
// — the template vanished under a queued gesture.
import type {
  Adventure,
  AnyEditOp,
  DamageKey,
  Element,
  MonsterAttack,
  MonsterTemplate,
} from '@/types'

// The forge-mode flow-entry message, verbatim the server's blocked-op table
// entry: client-side routing opens the dialog before anyone fills a dialog
// just to be refused, and the server's op_unsupported_forge stays the
// authority for any batch that arrives.
export const BUNDLED_TEMPLATE_BLOCKED_MESSAGE =
  'bundled monster templates have no override kind — assembly derives them from the monsters stage'

// The defense selects' enum option lists — runtime lists of the generated
// string-literal unions, membership pinned by `satisfies` and exhaustiveness
// by the type-level suite (the content-builders discipline).
export const DAMAGE_KEYS = [
  'silver',
  'magic',
  'fire',
  'cold',
  'holy',
] as const satisfies readonly DamageKey[]

export const ELEMENTS = [
  'fire',
  'cold',
  'lightning',
  'acid',
  'gas',
  'poison',
  'steam',
] as const satisfies readonly Element[]

export function findMonsterTemplate(
  document: Adventure,
  templateId: string,
): MonsterTemplate | null {
  return document.monsters.find((template) => template.id === templateId) ?? null
}

// A fresh attack line for the routines editor: a by-weapon strike, valid by
// shape (name is the only required content).
export function emptyMonsterAttack(): MonsterAttack {
  return {
    count: 1,
    name: 'weapon',
    damage: null,
    fixed_damage: null,
    fixed_damage_options: [],
    by_weapon: true,
    by_weapon_modifier: 0,
    effects: [],
  }
}

// The create dialog's seed: a model-valid stock 1-HD block the form then
// edits — osrlib-derived where derivable (the 1 HD attack row, the 1-3 save
// band, 10 XP), neutral where authored (unarmoured 9 [10], morale 7, one
// by-weapon attack, 120' (40')). `page=""` is the spec's pinned
// editor-authored convention (forge's own marker for unpaged blocks) and
// `overrides_applied=[]` is SRD-compiler provenance, meaningless here —
// neither surfaces in the form.
export function seedMonsterTemplate(id: string, name: string): MonsterTemplate {
  return {
    id,
    name,
    page: '',
    intro: '',
    ac: 9,
    ac_ascending: 10,
    ac_alternates: [],
    attack_roll_required: true,
    hit_dice: { count: 1, die: 8, modifier: 0, asterisks: 0, average_hp: null, fixed_hp: null },
    attacks: [{ attacks: [emptyMonsterAttack()] }],
    thac0: 19,
    attack_bonus: 0,
    movement: [{ rate_feet: 120, encounter_rate_feet: 40, descriptor: null }],
    saves: {
      values: { death: 12, wands: 13, paralysis: 14, breath: 15, spells: 16 },
      save_as: '1',
    },
    morale: 7,
    morale_alternates: [],
    alignment: { options: ['neutral'], usual: null },
    xp: 10,
    xp_notes: [],
    number_appearing: {
      dungeon: { dice: '1d6', fixed: null, see_below: false },
      lair: { dice: '1d6', fixed: null, see_below: false },
    },
    treasure: {
      letters: [],
      parenthetical: [],
      extra_gp: 0,
      multiplier: 1,
      special: [],
      see_below: false,
    },
    abilities: [],
    defenses: { harmed_only_by: [], reductions: [], energy: {}, condition_immunities: [] },
    categories: [],
    overrides_applied: [],
  }
}

// The clone prefill: the next-free `<source-id>-<n>` over the effective
// catalog (shipped plus bundled ids) — the scope the collision invariant
// checks, so a prefill never lands on a rejection.
export function cloneId(sourceId: string, takenIds: ReadonlySet<string>): string {
  let candidate = 1
  while (takenIds.has(`${sourceId}-${candidate}`)) candidate += 1
  return `${sourceId}-${candidate}`
}

// The list's referenced-by count and the remove confirm's honesty: every
// keyed-encounter line plus every inline wandering row naming the template.
export function monsterReferenceCount(document: Adventure, templateId: string): number {
  let count = 0
  for (const dungeon of document.dungeons) {
    for (const level of dungeon.levels) {
      for (const area of level.areas) {
        for (const line of area.encounter?.monsters ?? []) {
          if (line.template_id === templateId) count += 1
        }
      }
      for (const row of level.wandering.table?.rows ?? []) {
        if (row.entry.kind === 'monster' && row.entry.monster_ids.includes(templateId)) count += 1
      }
    }
  }
  return count
}

// The auto-hit toggle's one-gesture rule: disabling the hit roll clears both
// ACs in the same value (the model forbids an AC it never consults);
// re-enabling seeds the unarmoured pair the form then edits.
export function autoHitPatch(attackRollRequired: boolean): Partial<MonsterTemplate> {
  if (attackRollRequired) return { attack_roll_required: true, ac: 9, ac_ascending: 10 }
  return { attack_roll_required: false, ac: null, ac_ascending: null }
}

// An ability param value as the key/value rows commit it: a JSON fragment
// when it parses to a param-typed value (number, boolean, string, flat
// array), else the raw text as a plain string — the client mirror's
// convenience; the server's parse stays the authority.
export function parseAbilityParam(
  text: string,
): number | string | boolean | (number | string)[] | null {
  const trimmed = text.trim()
  if (trimmed === '') return null
  try {
    const parsed: unknown = JSON.parse(trimmed)
    if (typeof parsed === 'number' || typeof parsed === 'string' || typeof parsed === 'boolean') {
      return parsed
    }
    if (
      Array.isArray(parsed) &&
      parsed.every((item) => typeof item === 'number' || typeof item === 'string')
    ) {
      return parsed as (number | string)[]
    }
    return null
  } catch {
    return trimmed
  }
}

export function formatAbilityParam(value: number | string | boolean | (number | string)[]): string {
  if (typeof value === 'string') return value
  return JSON.stringify(value)
}

// --- the ops ---

export function addMonsterTemplateOps(template: MonsterTemplate): AnyEditOp[] {
  return [{ op: 'add_monster_template', template }]
}

export function monsterTemplateSetOps(templateId: string, template: MonsterTemplate): AnyEditOp[] {
  return [{ op: 'set_monster_template', template_id: templateId, template }]
}

// Whole-value replacement with an update computed from the committed template
// — the featureUpdateOps discipline: collection edits (routines, movement
// rows, abilities, defense rows) must compute their next value inside the
// queue, or a payload built from the render-time template queued behind an
// in-flight commit silently reverts it. `null` skips the batch.
export function monsterTemplateUpdateOps(
  document: Adventure,
  templateId: string,
  update: (committed: MonsterTemplate) => Partial<MonsterTemplate> | null,
): AnyEditOp[] {
  const current = findMonsterTemplate(document, templateId)
  if (!current) return []
  const patch = update(current)
  if (patch === null) return []
  return monsterTemplateSetOps(templateId, { ...current, ...patch })
}

// The state-independent form: a patch whose values don't derive from the
// current template (a scalar field, the auto-hit gesture, a rename).
export function monsterTemplatePatchOps(
  document: Adventure,
  templateId: string,
  patch: Partial<MonsterTemplate>,
): AnyEditOp[] {
  return monsterTemplateUpdateOps(document, templateId, () => patch)
}

export function monsterTemplateRemoveOps(templateId: string): AnyEditOp[] {
  return [{ op: 'remove_monster_template', template_id: templateId }]
}
