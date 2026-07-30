// The drop collision prompt: one dialog naming the colliding kinds with
// per-kind replace-or-keep choices, replace preselected. It fires only for
// colliding kinds with no remembered choice, and what it collects joins the
// pack's panel-lifetime memory — so stocking an OPD level whose every area
// arrives carrying Watabou's note text prompts once, not thirty times.
import { useState } from 'react'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import type { CollisionChoices, CollisionKind } from '@/lib/library-drop'

const KIND_LABELS: Record<CollisionKind, string> = {
  name: 'Name',
  description: 'Description',
  encounter: 'Encounter',
  trap: 'Trap',
  treasure: 'Treasure',
}

export function LibraryCollisionDialog({
  kinds,
  onSubmit,
  onCancel,
}: {
  kinds: readonly CollisionKind[]
  onSubmit: (choices: CollisionChoices) => void
  onCancel: () => void
}) {
  const [choices, setChoices] = useState<CollisionChoices>({})
  return (
    <Dialog open onOpenChange={(next) => !next && onCancel()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>The room already has some of this</DialogTitle>
          <DialogDescription>
            Choose per kind; everything else merges in beside what the room keeps. Your choices are
            remembered while this pack stays open.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-2">
          {kinds.map((kind) => {
            const choice = choices[kind] ?? 'replace'
            return (
              <div key={kind} className="flex items-center gap-3 text-sm">
                <span className="w-24">{KIND_LABELS[kind]}</span>
                <label className="flex items-center gap-1.5">
                  <input
                    type="radio"
                    name={`collision-${kind}`}
                    checked={choice === 'replace'}
                    onChange={() => setChoices((current) => ({ ...current, [kind]: 'replace' }))}
                  />
                  Replace
                </label>
                <label className="flex items-center gap-1.5">
                  <input
                    type="radio"
                    name={`collision-${kind}`}
                    checked={choice === 'keep'}
                    onChange={() => setChoices((current) => ({ ...current, [kind]: 'keep' }))}
                  />
                  Keep the room&apos;s
                </label>
              </div>
            )
          })}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            onClick={() => {
              const complete: CollisionChoices = {}
              for (const kind of kinds) complete[kind] = choices[kind] ?? 'replace'
              onSubmit(complete)
            }}
          >
            Place
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
