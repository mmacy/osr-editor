// The printed-notation form's pure builders: form text ↔ StatBlockPatch.
// Fields are the printed page verbatim — "5 [14]", "3+1", attack lines as
// written — because monster_templates: corrections land pre-mapping by forge's
// contract and reviewing against the printed page is the point.
import type { StatBlockOverride, StatBlockPatch } from '@/types'

// Every form field as text; empty string means "leave the extracted value".
// The wire cannot distinguish a prior explicit null from unset (both arrive
// null), so re-editing an entry re-expresses only what the form shows — the
// overrides file remains the exact record.
export interface StatBlockFormValues {
  ac: string
  ac_notation: '' | 'descending' | 'ascending' | 'dual'
  thac0: string
  hit_dice: string
  class_level: string
  hp: string
  attacks: string
  movement: string
  saves: string
  morale: string
  alignment: string
  xp: string
  number_appearing: string
  special: string
}

export const EMPTY_STAT_FORM: StatBlockFormValues = {
  ac: '',
  ac_notation: '',
  thac0: '',
  hit_dice: '',
  class_level: '',
  hp: '',
  attacks: '',
  movement: '',
  saves: '',
  morale: '',
  alignment: '',
  xp: '',
  number_appearing: '',
  special: '',
}

// Prefill from an existing entry: nulls render empty (see the wire note above).
export function formFromOverride(entry: StatBlockOverride | undefined): StatBlockFormValues {
  if (!entry) return EMPTY_STAT_FORM
  return {
    ac: entry.ac ?? '',
    ac_notation: entry.ac_notation ?? '',
    thac0: entry.thac0 ?? '',
    hit_dice: entry.hit_dice ?? '',
    class_level: entry.class_level ?? '',
    hp: entry.hp != null ? String(entry.hp) : '',
    attacks: (entry.attacks ?? []).join('\n'),
    movement: entry.movement ?? '',
    saves: entry.saves ?? '',
    morale: entry.morale != null ? String(entry.morale) : '',
    alignment: entry.alignment ?? '',
    xp: entry.xp != null ? String(entry.xp) : '',
    number_appearing: entry.number_appearing ?? '',
    special: (entry.special ?? []).join('\n'),
  }
}

function lines(text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
}

function integer(text: string): number | null {
  const value = Number(text.trim())
  return Number.isInteger(value) ? value : null
}

// The patch: only filled fields travel — absent means untouched, exactly
// forge's semantics. Returns null when nothing is filled (the entry would
// replace nothing, which forge rejects).
export function patchFromForm(values: StatBlockFormValues): StatBlockPatch | null {
  const patch: StatBlockPatch = {}
  if (values.ac.trim()) patch.ac = values.ac.trim()
  if (values.ac_notation) patch.ac_notation = values.ac_notation
  if (values.thac0.trim()) patch.thac0 = values.thac0.trim()
  if (values.hit_dice.trim()) patch.hit_dice = values.hit_dice.trim()
  if (values.class_level.trim()) patch.class_level = values.class_level.trim()
  const hp = integer(values.hp)
  if (values.hp.trim() && hp !== null && hp >= 1) patch.hp = hp
  const attackLines = lines(values.attacks)
  if (attackLines.length > 0) patch.attacks = attackLines
  if (values.movement.trim()) patch.movement = values.movement.trim()
  if (values.saves.trim()) patch.saves = values.saves.trim()
  const morale = integer(values.morale)
  if (values.morale.trim() && morale !== null && morale >= 2 && morale <= 12) patch.morale = morale
  if (values.alignment.trim()) patch.alignment = values.alignment.trim()
  const xp = integer(values.xp)
  if (values.xp.trim() && xp !== null && xp >= 0) patch.xp = xp
  if (values.number_appearing.trim()) patch.number_appearing = values.number_appearing.trim()
  const specialLines = lines(values.special)
  if (specialLines.length > 0) patch.special = specialLines
  return Object.keys(patch).length > 0 ? patch : null
}
