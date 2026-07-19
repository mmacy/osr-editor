// The printed-notation stat-block form: corrections land pre-mapping, so the
// form mirrors the raw printed block (AC string and notation, THAC0, hit dice,
// class/level, hp, attack lines, movement, saves, morale, alignment, XP, number
// appearing, special lines). A blank field is untouched (omitted from the
// patch); the server-side StatBlockOverride carries the absent-vs-null semantics.
import type { StatBlockPatch } from '@/types'

export type StatBlockFieldKind = 'text' | 'number' | 'lines' | 'notation'

export interface StatBlockFieldDef {
  key: keyof StatBlockPatch
  label: string
  kind: StatBlockFieldKind
  placeholder?: string
}

export const AC_NOTATIONS = ['descending', 'ascending', 'dual'] as const

export const STATBLOCK_FIELDS: StatBlockFieldDef[] = [
  { key: 'ac', label: 'Armour class', kind: 'text', placeholder: '5 [14]' },
  { key: 'ac_notation', label: 'AC notation', kind: 'notation' },
  { key: 'thac0', label: 'THAC0', kind: 'text', placeholder: '17' },
  { key: 'hit_dice', label: 'Hit dice', kind: 'text', placeholder: '3+1' },
  { key: 'class_level', label: 'Class and level', kind: 'text', placeholder: 'F 3' },
  { key: 'hp', label: 'Hit points', kind: 'number' },
  {
    key: 'attacks',
    label: 'Attacks (one per line)',
    kind: 'lines',
    placeholder: '2 claws (1d4 each)',
  },
  { key: 'movement', label: 'Movement', kind: 'text', placeholder: "120' (40')" },
  { key: 'saves', label: 'Saving throws', kind: 'text', placeholder: 'D12 W13 P14 B15 S16 (2)' },
  { key: 'morale', label: 'Morale', kind: 'number' },
  { key: 'alignment', label: 'Alignment', kind: 'text', placeholder: 'Chaotic' },
  { key: 'xp', label: 'XP', kind: 'number' },
  { key: 'number_appearing', label: 'Number appearing', kind: 'text', placeholder: '1d6 (2d6)' },
  { key: 'special', label: 'Special (one per line)', kind: 'lines' },
]

// Build a StatBlockPatch from raw form strings: blank fields are omitted
// (untouched), numbers are parsed, line fields split and trimmed.
export function buildStatBlockPatch(form: Readonly<Record<string, string>>): StatBlockPatch {
  const patch: Record<string, unknown> = {}
  for (const field of STATBLOCK_FIELDS) {
    const raw = (form[field.key] ?? '').trim()
    if (raw === '') continue
    if (field.kind === 'number') {
      const value = Number(raw)
      if (Number.isInteger(value)) patch[field.key] = value
    } else if (field.kind === 'lines') {
      const lines = raw
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line !== '')
      if (lines.length > 0) patch[field.key] = lines
    } else {
      patch[field.key] = raw
    }
  }
  return patch as StatBlockPatch
}
