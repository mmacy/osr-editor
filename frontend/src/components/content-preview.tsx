// The read-only content preview: one labeled module-notation line per carried
// kind, in the cards' order. Shared by the library panel's entry previews and
// the map's area hover card — both preview surfaces, never editors; the
// editing forms stay the inspector's cards.
import { formatEncounter, formatFeature, formatTrap, formatTreasure } from '@/lib/notation'
import type { AreaTreasureSpec, FeatureSpec, KeyedEncounter, TrapSpec } from '@/types'

// The structural subset an `AreaSpec` and a `ContentPackEntry` both satisfy —
// the same shape `formatAreaContents` accepts.
export interface PreviewContents {
  encounter?: KeyedEncounter | null
  treasure?: AreaTreasureSpec | null
  trap?: TrapSpec | null
  features: readonly FeatureSpec[]
}

export function hasPreviewContents(contents: PreviewContents): boolean {
  return Boolean(
    contents.encounter || contents.treasure || contents.trap || contents.features.length > 0,
  )
}

export function ContentPreviewLines({
  contents,
  nameFor,
}: {
  contents: PreviewContents
  nameFor: (templateId: string) => string
}) {
  const lines: Array<{ key: string; label: string; value: string }> = []
  if (contents.encounter) {
    lines.push({
      key: 'encounter',
      label: 'Encounter',
      value: formatEncounter(contents.encounter, nameFor),
    })
  }
  if (contents.treasure) {
    lines.push({ key: 'treasure', label: 'Treasure', value: formatTreasure(contents.treasure) })
  }
  if (contents.trap) {
    lines.push({ key: 'trap', label: 'Trap', value: formatTrap(contents.trap) })
  }
  contents.features.forEach((feature, index) => {
    lines.push({ key: `feature-${index}`, label: 'Feature', value: formatFeature(feature) })
  })
  if (lines.length === 0) return null
  return (
    <div className="flex flex-col gap-0.5">
      {lines.map((line) => (
        <div key={line.key} className="flex items-baseline gap-2 text-xs">
          <span className="w-16 shrink-0 text-muted-foreground">{line.label}</span>
          <span className="min-w-0 font-mono break-words">{line.value}</span>
        </div>
      ))}
    </div>
  )
}
