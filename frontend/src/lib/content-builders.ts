// The content cards' op builders: pure functions from the committed document
// to op batches, so every commit patches only its own field against what is
// actually committed (the phase 1 amendment) and the card logic stays
// vitest-testable. A builder answering [] skips the batch — the target
// vanished under a queued gesture.
import { parseDice } from '@/lib/notation'
import type {
  Adventure,
  Alignment,
  AnyEditOp,
  AreaSpec,
  AreaTreasureSpec,
  Condition,
  EncounterTable,
  EncounterTableRow,
  FeatureSpec,
  KeyedEncounter,
  KeyedMonster,
  LevelSpec,
  Position,
  ReactionResult,
  SaveCategory,
  TimeUnit,
  TrapEffect,
  TrapSpec,
} from '@/types'

// The enum option lists the native selects render. Runtime lists of the
// generated string-literal unions — each `satisfies` pins membership at tsc
// time, and the type-level suite pins exhaustiveness, so an osrlib enum
// change breaks loudly instead of silently dropping an option.
export const CONDITIONS = [
  'paralysed',
  'asleep',
  'blind',
  'charmed',
  'petrified',
  'diseased',
  'exhausted',
  'lycanthropy_incubation',
  'averted_eyes',
  'poisoned',
  'dead',
  'silenced',
  'entangled',
  'afraid',
  'feebleminded',
  'invisible',
  'turned',
  'confused',
  'weakened',
] as const satisfies readonly Condition[]

export const SAVE_CATEGORIES = [
  'death',
  'wands',
  'paralysis',
  'breath',
  'spells',
] as const satisfies readonly SaveCategory[]

export const TIME_UNITS = ['round', 'turn', 'day'] as const satisfies readonly TimeUnit[]

export const REACTION_RESULTS = [
  'attacks',
  'hostile',
  'uncertain',
  'indifferent',
  'friendly',
] as const satisfies readonly ReactionResult[]

export interface AreaTarget {
  dungeonId: string
  levelNumber: number
  areaId: string
}

// A feature's container: an area, or (areaId null) the level itself.
export interface FeatureScope {
  dungeonId: string
  levelNumber: number
  areaId: string | null
}

export function findLevel(
  document: Adventure,
  dungeonId: string,
  levelNumber: number,
): LevelSpec | null {
  return (
    document.dungeons
      .find((dungeon) => dungeon.id === dungeonId)
      ?.levels.find((level) => level.number === levelNumber) ?? null
  )
}

export function findArea(document: Adventure, target: AreaTarget): AreaSpec | null {
  return (
    findLevel(document, target.dungeonId, target.levelNumber)?.areas.find(
      (area) => area.id === target.areaId,
    ) ?? null
  )
}

// The dice-or-fixed segmented input's reading: all digits is a fixed count,
// anything else is dice under the convenience mirror; null means not yet
// committable.
export function parseCount(
  text: string,
): { count_dice: string | null; count_fixed: number | null } | null {
  const trimmed = text.trim()
  if (trimmed === '') return null
  if (/^[0-9]+$/.test(trimmed)) {
    const fixed = Number(trimmed)
    if (fixed < 1) return null
    return { count_dice: null, count_fixed: fixed }
  }
  if (!parseDice(trimmed)) return null
  return { count_dice: trimmed, count_fixed: null }
}

// --- encounter ---

export function encounterOps(target: AreaTarget, encounter: KeyedEncounter | null): AnyEditOp[] {
  return [
    {
      op: 'set_encounter',
      dungeon_id: target.dungeonId,
      level_number: target.levelNumber,
      area_id: target.areaId,
      encounter,
    },
  ]
}

export function encounterPatchOps(
  document: Adventure,
  target: AreaTarget,
  patch: Partial<KeyedEncounter>,
): AnyEditOp[] {
  const current = findArea(document, target)?.encounter
  if (!current) return []
  return encounterOps(target, { ...current, ...patch })
}

export function encounterAddLineOps(
  document: Adventure,
  target: AreaTarget,
  line: KeyedMonster,
): AnyEditOp[] {
  const area = findArea(document, target)
  if (!area) return []
  const current = area.encounter
  if (!current) {
    return encounterOps(target, { monsters: [line], alignment: null, aware: false, stance: null })
  }
  return encounterOps(target, { ...current, monsters: [...current.monsters, line] })
}

export function encounterSetLineOps(
  document: Adventure,
  target: AreaTarget,
  index: number,
  line: KeyedMonster,
): AnyEditOp[] {
  const current = findArea(document, target)?.encounter
  if (!current || index < 0 || index >= current.monsters.length) return []
  const monsters = current.monsters.map((existing, at) => (at === index ? line : existing))
  return encounterOps(target, { ...current, monsters })
}

// The last line never removes this way — `monsters` has min_length=1; the
// card's remove-encounter action is the exit.
export function encounterRemoveLineOps(
  document: Adventure,
  target: AreaTarget,
  index: number,
): AnyEditOp[] {
  const current = findArea(document, target)?.encounter
  if (!current || current.monsters.length <= 1 || index < 0 || index >= current.monsters.length) {
    return []
  }
  const monsters = current.monsters.filter((_, at) => at !== index)
  return encounterOps(target, { ...current, monsters })
}

const ALL_ALIGNMENTS: Alignment[] = ['lawful', 'neutral', 'chaotic']

// The alignment select's options: the intersection of every line's template
// options. A dangling template constrains nothing (its options are unknown),
// so the intersection runs over the resolvable lines only.
export function alignmentIntersection(
  lines: readonly KeyedMonster[],
  optionsFor: (templateId: string) => readonly Alignment[] | null,
): Alignment[] {
  let options = ALL_ALIGNMENTS
  for (const line of lines) {
    const templateOptions = optionsFor(line.template_id)
    if (templateOptions === null) continue
    options = options.filter((candidate) => templateOptions.includes(candidate))
  }
  return options
}

// --- trap ---

export const EMPTY_TRAP_EFFECT: TrapEffect = {
  damage_dice: null,
  volley_dice: null,
  save: null,
  kills: false,
  condition: null,
  condition_duration_dice: null,
  condition_duration_amount: null,
  condition_duration_unit: null,
  fall_feet: null,
  transition: null,
  manual: null,
}

// A fresh trap: kind pinned by where it lives (room on areas, treasure on
// caches), trigger defaulting to the kind's springing action. An all-empty
// effect is a valid model, so the single-click add commits immediately.
export function emptyTrap(kind: TrapSpec['kind']): TrapSpec {
  return {
    kind,
    trigger: kind === 'room' ? 'enter' : 'open',
    effect: EMPTY_TRAP_EFFECT,
    affects: 'triggerer',
  }
}

// Patch an effect holding the validators' implications by construction: a
// volley needs damage dice, a duration needs a condition — clearing the
// premise clears its dependents in the same value.
export function patchTrapEffect(effect: TrapEffect, patch: Partial<TrapEffect>): TrapEffect {
  const next = { ...effect, ...patch }
  if (next.damage_dice == null) next.volley_dice = null
  if (next.condition == null) {
    next.condition_duration_dice = null
    next.condition_duration_amount = null
    next.condition_duration_unit = null
  }
  return next
}

export function areaTrapOps(target: AreaTarget, trap: TrapSpec | null): AnyEditOp[] {
  return [
    {
      op: 'set_trap',
      dungeon_id: target.dungeonId,
      level_number: target.levelNumber,
      area_id: target.areaId,
      trap,
    },
  ]
}

export function areaTrapPatchOps(
  document: Adventure,
  target: AreaTarget,
  patch: Partial<TrapSpec>,
): AnyEditOp[] {
  const current = findArea(document, target)?.trap
  if (!current) return []
  return areaTrapOps(target, { ...current, ...patch })
}

// --- treasure ---

export function treasureOps(target: AreaTarget, treasure: AreaTreasureSpec | null): AnyEditOp[] {
  return [
    {
      op: 'set_treasure',
      dungeon_id: target.dungeonId,
      level_number: target.levelNumber,
      area_id: target.areaId,
      treasure,
    },
  ]
}

// Toggle one letter, holding the model's XOR: the result always names letters
// (unguarded false). Removing the last letter is refused (null) — the card's
// remove action is the exit, never an invalid empty spec.
export function toggleTreasureLetter(
  current: AreaTreasureSpec | null,
  letter: string,
): AreaTreasureSpec | null {
  const letters = current && !current.unguarded ? current.letters : []
  const next = letters.includes(letter)
    ? letters.filter((existing) => existing !== letter)
    : [...letters, letter]
  if (next.length === 0) return null
  return { letters: next, unguarded: false }
}

// --- features ---

// Feature keys auto-assign as feature-<n> — the smallest positive n unused in
// any feature-<n> id on the level, the next-free convention area keys
// established. The uniqueness scope spans the level's own features and every
// area's, matching the AddFeature invariant.
export function nextFreeFeatureKey(level: LevelSpec): string {
  const taken = new Set([
    ...level.features.map((feature) => feature.id),
    ...level.areas.flatMap((area) => area.features.map((feature) => feature.id)),
  ])
  let candidate = 1
  while (taken.has(`feature-${candidate}`)) candidate += 1
  return `feature-${candidate}`
}

export function emptyFeature(id: string, cell: Position | null): FeatureSpec {
  return {
    id,
    kind: 'custom',
    description: '',
    cell,
    item_ids: [],
    coins: { pp: 0, gp: 0, ep: 0, sp: 0, cp: 0 },
    valuables: [],
    trap: null,
  }
}

function scopeFeatures(document: Adventure, scope: FeatureScope): readonly FeatureSpec[] | null {
  const level = findLevel(document, scope.dungeonId, scope.levelNumber)
  if (!level) return null
  if (scope.areaId === null) return level.features
  return level.areas.find((area) => area.id === scope.areaId)?.features ?? null
}

export function featureAddOps(scope: FeatureScope, feature: FeatureSpec): AnyEditOp[] {
  return [
    {
      op: 'add_feature',
      dungeon_id: scope.dungeonId,
      level_number: scope.levelNumber,
      area_id: scope.areaId,
      feature,
    },
  ]
}

// Whole-value replacement with the patch merged over the committed feature —
// the spec's SetFeatureField slot at the card's commit grain. The trap-kind
// pin rides the patch: cache trap builders always pass kind "treasure" traps.
export function featurePatchOps(
  document: Adventure,
  scope: FeatureScope,
  featureId: string,
  patch: Partial<FeatureSpec>,
): AnyEditOp[] {
  const current = scopeFeatures(document, scope)?.find((feature) => feature.id === featureId)
  if (!current) return []
  return [
    {
      op: 'set_feature',
      dungeon_id: scope.dungeonId,
      level_number: scope.levelNumber,
      area_id: scope.areaId,
      feature_id: featureId,
      feature: { ...current, ...patch },
    },
  ]
}

export function featureRemoveOps(scope: FeatureScope, featureId: string): AnyEditOp[] {
  return [
    {
      op: 'remove_feature',
      dungeon_id: scope.dungeonId,
      level_number: scope.levelNumber,
      area_id: scope.areaId,
      feature_id: featureId,
    },
  ]
}

// --- the wandering table ---

// Seed an inline table from the compiled band table for the level. Blind
// row-by-row authoring cannot produce a valid table (twenty rows, 1-20 in
// order, each complete), so the editor always starts from the band and edits
// from there. Authored tables pin `<dungeon-id>-level-<n>-wandering` and keep
// an existing table's id and label through re-seeds; min_level pins 1 and
// max_level null — self-description only, since the runtime consumes an
// inline table wholesale and never consults its band.
export function seededWanderingTable(
  band: EncounterTable,
  dungeonId: string,
  levelNumber: number,
  existing: EncounterTable | null,
): EncounterTable {
  return {
    id: existing?.id ?? `${dungeonId}-level-${levelNumber}-wandering`,
    label: existing?.label ?? `Level ${levelNumber} wandering`,
    min_level: 1,
    max_level: null,
    rows: band.rows.map((row) => ({ ...row, entry: { ...row.entry } })),
    overrides_applied: [],
  }
}

// Replace one d20 row; rolls are fixed row labels, so order and coverage hold
// by construction and the model's validator is satisfied by shape.
export function replaceEncounterTableRow(
  table: EncounterTable,
  index: number,
  row: EncounterTableRow,
): EncounterTable {
  return { ...table, rows: table.rows.map((existing, at) => (at === index ? row : existing)) }
}
