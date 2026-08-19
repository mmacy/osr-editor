// The shared clause-condition list: add/remove/edit rows of ConditionBuilder
// with consumes suppressed — the control never renders, because osrlib
// rejects a consuming clause condition at parse, for triggers and quests
// alike. Typed over the committed condition tuple, not any carrier spec: the
// host adapts its whole-value commit around the tuple update, keeping the
// compute-in-the-queue discipline on its own side of the prop. `consumeRule`
// is the one line of copy the hosts speak differently ("A trigger fires, it
// does not take" / "A quest observes, it does not take" — osrlib's own
// words).
import { useState } from 'react'
import { PlusIcon, XIcon } from 'lucide-react'

import { ConditionBuilder } from '@/components/condition-builder'
import { Button } from '@/components/ui/button'
import type { Adventure, ConditionSpec } from '@/types'

export type ConditionTupleUpdate = (committed: readonly ConditionSpec[]) => ConditionSpec[] | null

export function ConditionList({
  conditions,
  document,
  idPrefix,
  consumeRule,
  onUpdate,
}: {
  conditions: readonly ConditionSpec[]
  document: Adventure
  idPrefix: string
  consumeRule: string
  onUpdate: (build: ConditionTupleUpdate) => void
}) {
  const [drafting, setDrafting] = useState(false)
  const replaceAt = (index: number, condition: ConditionSpec) =>
    onUpdate((committed) => {
      if (index >= committed.length) return null
      const next = [...committed]
      next[index] = condition
      return next
    })
  const removeAt = (index: number) =>
    onUpdate((committed) => {
      if (index >= committed.length) return null
      return committed.filter((_, position) => position !== index)
    })
  return (
    <div className="flex flex-col gap-2" aria-label="Conditions">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium">Conditions</h3>
        {!drafting && (
          <Button variant="outline" size="sm" onClick={() => setDrafting(true)}>
            <PlusIcon /> Add condition
          </Button>
        )}
      </div>
      <p className="text-muted-foreground text-xs">
        All conditions must hold at the moment of the match. {consumeRule} — conditions here never
        consume.
      </p>
      {conditions.map((condition, index) => (
        <div key={index} className="flex flex-col gap-2 rounded-md border p-2">
          <div className="flex justify-end">
            <button
              type="button"
              aria-label={`Remove condition ${index + 1}`}
              onClick={() => removeAt(index)}
            >
              <XIcon className="size-3" />
            </button>
          </div>
          <ConditionBuilder
            condition={condition}
            document={document}
            offerConsumes={false}
            idPrefix={`${idPrefix}-${index}`}
            onCommit={(next) => replaceAt(index, next)}
          />
        </div>
      ))}
      {drafting && (
        <div className="flex flex-col gap-2 rounded-md border border-dashed p-2">
          <div className="flex justify-end">
            <button
              type="button"
              aria-label="Discard new condition"
              onClick={() => setDrafting(false)}
            >
              <XIcon className="size-3" />
            </button>
          </div>
          <ConditionBuilder
            condition={null}
            document={document}
            offerConsumes={false}
            idPrefix={`${idPrefix}-new`}
            onCommit={(condition) => {
              setDrafting(false)
              onUpdate((committed) => [...committed, condition])
            }}
          />
        </div>
      )}
    </div>
  )
}
