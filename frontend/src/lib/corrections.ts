// The corrections panel's pure logic: every override entry flattened in file
// order, grouped by kind, each with a one-line summary — the reviewable
// record, surfaced.
import type { NavTarget } from '@/lib/address'
import type {
  Adventure,
  AreaOverride,
  EditorSidecar,
  GeometryOverride,
  ModuleOverride,
  Overrides,
  StatBlockOverride,
  TownOverride,
} from '@/types'
import { parseForgeAreaAddress } from '@/lib/review'

export type CorrectionKind =
  'monsters' | 'monster_templates' | 'areas' | 'geometry' | 'town' | 'module'

export interface CorrectionEntry {
  kind: CorrectionKind
  // The entry key: a name, an address, or '' for town/module.
  key: string
  label: string
  summary: string
  reason: string
  // Whether the reason is still a machine draft (the auto_reasons ledger).
  machineDraft: boolean
}

const AREA_FIELDS = ['name', 'description', 'encounter', 'trap', 'treasure', 'features'] as const

function presentFields(entry: Record<string, unknown>, names: readonly string[]): string[] {
  // The wire cannot distinguish an unset field from an explicit null (both
  // arrive null), so the summary lists non-null fields only; the YAML file
  // remains the exact record of clears.
  return names.filter((name) => entry[name] !== undefined && entry[name] !== null)
}

function areaSummary(entry: AreaOverride): string {
  if (entry.remove) return 'removed'
  const set = presentFields(entry as unknown as Record<string, unknown>, AREA_FIELDS)
  return set.length > 0 ? `${set.join(', ')} replaced` : 'fields cleared'
}

function geometrySummary(entry: GeometryOverride): string {
  const parts: string[] = []
  const areaKeys = Object.keys(entry.areas ?? {})
  if (areaKeys.length > 0) parts.push(`cells for ${areaKeys.join(', ')}`)
  const edgeCount = Object.keys(entry.edges ?? {}).length
  if (edgeCount > 0) parts.push(`${edgeCount} edge ${edgeCount === 1 ? 'entry' : 'entries'}`)
  if (entry.entrance !== undefined) {
    parts.push(entry.entrance === null ? 'entrance cleared' : 'entrance moved')
  }
  if (entry.transitions !== undefined && entry.transitions !== null) {
    parts.push(`${entry.transitions.length} transition(s)`)
  }
  return parts.join('; ') || 'no fields'
}

const STAT_FIELDS = [
  'ac',
  'ac_notation',
  'thac0',
  'hit_dice',
  'class_level',
  'hp',
  'attacks',
  'movement',
  'saves',
  'morale',
  'alignment',
  'xp',
  'number_appearing',
  'special',
] as const

function statBlockSummary(entry: StatBlockOverride): string {
  const record = entry as unknown as Record<string, unknown>
  const set = presentFields(record, STAT_FIELDS)
  return set.length > 0 ? `printed ${set.join(', ')}` : 'printed block'
}

function metadataSummary(entry: TownOverride | ModuleOverride, names: readonly string[]): string {
  const set = presentFields(entry as unknown as Record<string, unknown>, names)
  return set.length > 0 ? `${set.join(', ')} replaced` : 'fields cleared'
}

function ledgerKey(kind: CorrectionKind, key: string): string {
  return kind === 'town' || kind === 'module' ? kind : `${kind}:${key}`
}

// Every entry, kinds in Overrides field order, entries in file order.
export function listCorrections(overrides: Overrides, sidecar: EditorSidecar): CorrectionEntry[] {
  const drafts = new Set(sidecar.auto_reasons)
  const entries: CorrectionEntry[] = []
  const push = (
    kind: CorrectionKind,
    key: string,
    label: string,
    summary: string,
    reason: string,
  ) =>
    entries.push({
      kind,
      key,
      label,
      summary,
      reason,
      machineDraft: drafts.has(ledgerKey(kind, key)),
    })
  for (const [name, entry] of Object.entries(overrides.monsters ?? {})) {
    push('monsters', name, name, `remapped to ${entry.template_id}`, entry.reason)
  }
  for (const [name, entry] of Object.entries(overrides.monster_templates ?? {})) {
    push('monster_templates', name, name, statBlockSummary(entry), entry.reason)
  }
  for (const [address, entry] of Object.entries(overrides.areas ?? {})) {
    push('areas', address, address, areaSummary(entry), entry.reason)
  }
  for (const [address, entry] of Object.entries(overrides.geometry ?? {})) {
    push('geometry', address, address, geometrySummary(entry), entry.reason)
  }
  if (overrides.town) {
    push(
      'town',
      '',
      'Town',
      metadataSummary(overrides.town, ['name', 'description', 'services', 'travel_turns']),
      overrides.town.reason,
    )
  }
  if (overrides.module) {
    push(
      'module',
      '',
      'Module',
      metadataSummary(overrides.module, ['name', 'description', 'hooks']),
      overrides.module.reason,
    )
  }
  return entries
}

// Click-to-navigate where the entry is addressable: area entries land on
// their area, geometry entries on their level, town/module on their forms.
export function correctionTarget(entry: CorrectionEntry, document: Adventure): NavTarget | null {
  if (entry.kind === 'town') return { kind: 'town' }
  if (entry.kind === 'module') return { kind: 'adventure' }
  if (entry.kind === 'areas') {
    const parsed = parseForgeAreaAddress(entry.key)
    if (!parsed) return null
    const level = document.dungeons
      .find((dungeon) => dungeon.id === parsed.dungeonId)
      ?.levels.find((candidate) => candidate.number === parsed.levelNumber)
    if (!level) return null
    const focus = level.areas.some((area) => area.id === parsed.areaKey)
      ? ({ type: 'area', areaId: parsed.areaKey } as const)
      : undefined
    return { kind: 'level', dungeonId: parsed.dungeonId, levelNumber: parsed.levelNumber, focus }
  }
  if (entry.kind === 'geometry') {
    const parts = entry.key.split('/')
    if (parts.length !== 2) return null
    const levelNumber = Number(parts[1])
    const exists = document.dungeons
      .find((dungeon) => dungeon.id === parts[0])
      ?.levels.some((level) => level.number === levelNumber)
    if (!exists) return null
    return { kind: 'level', dungeonId: parts[0], levelNumber }
  }
  return null
}
