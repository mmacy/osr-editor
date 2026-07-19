// The corrections panel's logic: the overrides value flattened into a list of
// entries grouped by kind in file order, each with a one-line summary, its
// reason, whether that reason is still a machine draft, and the editor address
// it navigates to (when addressable). This is the reviewable record, surfaced.
import type { AreaOverride, Overrides } from '@/types'
import { forgeAddressToEditor } from '@/lib/flags'

export type OverrideKind =
  'monsters' | 'monster_templates' | 'areas' | 'geometry' | 'town' | 'module'

export interface CorrectionEntry {
  kind: OverrideKind
  // The entry key (a name or address); "" for the town/module singletons.
  key: string
  summary: string
  reason: string
  // True while the reason is still a machine draft (auto_reasons tracks it).
  autoReason: boolean
  // The editor-grammar address to navigate to, or null when not addressable.
  address: string | null
}

// The sidecar's auto_reasons key: kind for singletons, `kind:key` otherwise.
export function autoReasonKey(kind: OverrideKind, key: string): string {
  return kind === 'town' || kind === 'module' ? kind : `${kind}:${key}`
}

function areaSummary(entry: AreaOverride): string {
  if (entry.remove) return 'removed'
  const fields = (
    ['name', 'description', 'encounter', 'trap', 'treasure', 'features'] as const
  ).filter((field) => entry[field] !== undefined && entry[field] !== null)
  return fields.length > 0 ? `corrected: ${fields.join(', ')}` : 'replaced'
}

export function collectCorrections(
  overrides: Overrides,
  autoReasons: readonly string[],
): CorrectionEntry[] {
  const auto = new Set(autoReasons)
  const entries: CorrectionEntry[] = []
  const push = (
    kind: OverrideKind,
    key: string,
    summary: string,
    reason: string,
    address: string | null,
  ): void => {
    entries.push({
      kind,
      key,
      summary,
      reason,
      autoReason: auto.has(autoReasonKey(kind, key)),
      address,
    })
  }

  for (const [name, entry] of Object.entries(overrides.monsters ?? {})) {
    push('monsters', name, `→ ${entry.template_id}`, entry.reason, null)
  }
  for (const [name, entry] of Object.entries(overrides.monster_templates ?? {})) {
    push('monster_templates', name, 'printed stat block corrected', entry.reason, null)
  }
  for (const [address, entry] of Object.entries(overrides.areas ?? {})) {
    push('areas', address, areaSummary(entry), entry.reason, forgeAddressToEditor(address))
  }
  for (const [address, entry] of Object.entries(overrides.geometry ?? {})) {
    const [dungeon, level] = address.split('/')
    push(
      'geometry',
      address,
      'geometry corrected',
      entry.reason,
      `dungeon:${encodeURIComponent(dungeon)}/level:${level}`,
    )
  }
  if (overrides.town) push('town', '', 'town metadata corrected', overrides.town.reason, 'town')
  if (overrides.module)
    push('module', '', 'module metadata corrected', overrides.module.reason, null)
  return entries
}
