// Preview affordances inside the expanded encounter and treasure cards: sampled
// example hoards, and an encounter's sampled counts, stat table, and XP totals.
// Pure display — nothing commits. The backend rolls; this only renders.
import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { treasurePreviewFor } from '@/lib/aids'
import { api, ApiRequestError } from '@/lib/api'
import { formatCoins, formatMagicItem } from '@/lib/notation'
import { projectStore } from '@/store/project-store'
import type {
  AreaTreasureSpec,
  EncounterPreviewResponse,
  KeyedEncounter,
  TreasurePreviewResponse,
} from '@/types'

export function TreasurePreviewPanel({
  treasure,
  levelNumber,
}: {
  treasure: AreaTreasureSpec
  levelNumber: number
}) {
  const [tier, setTier] = useState<'basic' | 'expert'>('basic')
  const [samples, setSamples] = useState<TreasurePreviewResponse | null>(null)
  const [error, setError] = useState<string | null>(null)

  const preview = async () => {
    const projectId = projectStore.getState().project?.id
    if (!projectId) return
    setError(null)
    try {
      const response = await api.postAidsPreview(
        projectId,
        treasurePreviewFor(treasure, tier, levelNumber),
      )
      if (response.kind === 'treasure') setSamples(response)
    } catch (caught) {
      setError(caught instanceof ApiRequestError ? caught.detail.message : 'The preview failed.')
    }
  }

  return (
    <div className="flex flex-col gap-2" data-testid="treasure-preview">
      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" onClick={() => void preview()}>
          Preview sample hoards
        </Button>
        <label className="flex items-center gap-1 text-xs">
          <input
            type="checkbox"
            checked={tier === 'expert'}
            onChange={(event) => setTier(event.target.checked ? 'expert' : 'basic')}
          />
          Expert tier
        </label>
      </div>
      {error && <p className="text-destructive text-xs">{error}</p>}
      {samples && (
        <ul className="flex flex-col gap-1 text-xs">
          {samples.samples.map((sample, index) => (
            <li key={index} className="font-mono">
              {formatCoins(sample.coins)} · {sample.valuables.length} valuable(s) ·{' '}
              {sample.magic_items.length} magic · {sample.total_gp} gp
              {/* The count is the summary; the items are the detail that decides
                  whether the hoard suits the room. Subordinate, not a second
                  summary — and absent entirely when the roll produced none. */}
              {sample.magic_items.length > 0 && (
                <ul className="text-muted-foreground pl-4">
                  {sample.magic_items.map((item, itemIndex) => (
                    <li key={itemIndex}>{formatMagicItem(item)}</li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export function EncounterPreviewPanel({
  encounter,
  nameFor,
}: {
  encounter: KeyedEncounter
  nameFor: (templateId: string) => string
}) {
  const [preview, setPreview] = useState<EncounterPreviewResponse | null>(null)
  const [error, setError] = useState<string | null>(null)

  const run = async () => {
    const projectId = projectStore.getState().project?.id
    if (!projectId) return
    setError(null)
    try {
      const response = await api.postAidsPreview(projectId, {
        kind: 'encounter',
        encounter,
        samples: 3,
      })
      if (response.kind === 'encounter') setPreview(response)
    } catch (caught) {
      setError(caught instanceof ApiRequestError ? caught.detail.message : 'The preview failed.')
    }
  }

  return (
    <div className="flex flex-col gap-2" data-testid="encounter-preview">
      <Button variant="outline" size="sm" className="self-start" onClick={() => void run()}>
        Preview counts and XP
      </Button>
      {error && <p className="text-destructive text-xs">{error}</p>}
      {preview && (
        <div className="flex flex-col gap-1 text-xs">
          {preview.lines.map((line, index) => (
            <div key={index} className="font-mono">
              {nameFor(line.template_id)} · {line.resolution} · AC {line.ac ?? '—'} · THAC0{' '}
              {line.thac0 ?? '—'} · counts {line.sampled_counts.join('/')}
            </div>
          ))}
          <div className="text-muted-foreground">
            XP per sample: {preview.sample_xp_totals.join(' / ')}
          </div>
        </div>
      )}
    </div>
  )
}
