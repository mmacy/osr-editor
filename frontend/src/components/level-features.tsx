// Level-scope features in level properties: the same feature cards as the
// area panel, with the cell required by the UI at creation — the add flow
// picks the cell first (the one-shot thumbnail gesture), then commits. This
// is the surface that makes level-feature findings navigable-to-fixable and
// stranded-feature resize offenders resolvable.
import { useState } from 'react'

import { FeatureEditor } from '@/components/area-content-cards'
import { MiniLevelPicker } from '@/components/mini-level-picker'
import { Button } from '@/components/ui/button'
import { emptyFeature, featureAddOps, findLevel, nextFreeFeatureKey } from '@/lib/content-builders'
import { projectStore } from '@/store/project-store'
import type { Adventure, Position } from '@/types'

export function LevelFeaturesSection({
  document,
  dungeonId,
  levelNumber,
}: {
  document: Adventure
  dungeonId: string
  levelNumber: number
}) {
  const [picking, setPicking] = useState(false)
  const level = findLevel(document, dungeonId, levelNumber)
  if (!level) return null
  const scope = { dungeonId, levelNumber, areaId: null }
  const addAt = (cell: Position) => {
    setPicking(false)
    void projectStore.getState().commit((current) => {
      const target = findLevel(current, dungeonId, levelNumber)
      if (!target) return []
      return featureAddOps(scope, { ...emptyFeature(nextFreeFeatureKey(target), cell) })
    })
  }
  return (
    <div className="flex flex-col gap-2" aria-label="Level features">
      <h3 className="text-sm font-medium">Level features</h3>
      {level.features.length === 0 && !picking && (
        <p className="text-muted-foreground text-xs">
          No level-scope features — cell-bound tricks and caches outside any keyed area.
        </p>
      )}
      {level.features.map((feature) => (
        <FeatureEditor
          key={feature.id}
          document={document}
          feature={feature}
          scope={scope}
          cellHint={null}
        />
      ))}
      {picking ? (
        <div className="flex flex-col gap-1.5">
          <p className="text-muted-foreground text-xs">Click the feature's cell.</p>
          <MiniLevelPicker level={level} selected={null} onPick={addAt} />
          <Button
            variant="outline"
            size="sm"
            className="self-start"
            onClick={() => setPicking(false)}
          >
            Cancel
          </Button>
        </div>
      ) : (
        <Button variant="outline" size="sm" className="self-start" onClick={() => setPicking(true)}>
          Add feature…
        </Button>
      )}
    </div>
  )
}
