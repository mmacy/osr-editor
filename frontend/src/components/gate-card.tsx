// The shared gate card — composing the condition builder and the narrative
// editor with add/remove affordances. No gate shows "Add gate" (in forge mode
// the action routes to the blocked-op dialog client-side, the server's 422
// behind it); a gate shows the builder, the block editor with the gate's read
// beats (refusal and success), and "Remove gate". The host commits per
// gesture: the door inspector through patchDoor({requires}), the transition
// dialog into the spec its submit carries.
//
// "Add gate" is a drafting state, not a commit: a gate needs a complete
// condition, so the card renders the builder over nothing-committed and the
// first complete condition commits the whole gate — a half-built gate never
// reaches the document.
import { useState } from 'react'

import { ConditionBuilder } from '@/components/condition-builder'
import { NarrativeBlockEditor } from '@/components/narrative-block-editor'
import { Button } from '@/components/ui/button'
import { GATE_BLOCKED_MESSAGE } from '@/lib/item-builders'
import { projectStore } from '@/store/project-store'
import type { Adventure, ConditionSpec, GateSpec } from '@/types'

// A gate reads exactly two beats; speaker and guidance render for every
// carrier.
const GATE_BEATS = ['refusal', 'success'] as const

// Commits are updates over the committed gate, applied by the host inside
// its commit queue — the compute-in-the-queue discipline, so a narrative
// beat committed behind an in-flight one merges instead of reverting it.
export type GateUpdate = (committed: GateSpec | null) => GateSpec | null

export function GateCard({
  gate,
  document,
  idPrefix,
  forge,
  blockedAddress,
  blockedOpCode,
  onCommit,
}: {
  gate: GateSpec | null
  document: Adventure
  idPrefix: string
  // The forge flow-entry mirror: the add action opens the blocked-op dialog
  // with the would-be op named, so nobody authors a gate just to be refused.
  forge: boolean
  blockedAddress: string
  blockedOpCode: string
  onCommit: (update: GateUpdate) => void
}) {
  const [drafting, setDrafting] = useState(false)
  const commitCondition = (condition: ConditionSpec) => {
    setDrafting(false)
    onCommit((committed) => ({ condition, narrative: committed?.narrative ?? null }))
  }
  if (!gate && !drafting) {
    return (
      <div className="flex flex-col items-start gap-1.5" aria-label="Gate">
        <h4 className="text-sm font-medium">Gate</h4>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            if (forge) {
              projectStore.getState().setBlockedOp({
                op: blockedOpCode,
                address: blockedAddress,
                message: GATE_BLOCKED_MESSAGE,
              })
              return
            }
            setDrafting(true)
          }}
        >
          Add gate
        </Button>
      </div>
    )
  }
  return (
    <div className="flex flex-col gap-3 rounded-md border p-2" aria-label="Gate">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-medium">Gate</h4>
        <button
          type="button"
          className="text-muted-foreground text-xs underline underline-offset-2"
          onClick={() => {
            setDrafting(false)
            if (gate) onCommit(() => null)
          }}
        >
          Remove gate
        </button>
      </div>
      <ConditionBuilder
        condition={gate?.condition ?? null}
        document={document}
        offerConsumes
        idPrefix={idPrefix}
        onCommit={commitCondition}
      />
      {gate && (
        <NarrativeBlockEditor
          block={gate.narrative ?? null}
          beats={GATE_BEATS}
          idPrefix={idPrefix}
          onCommit={(blockUpdate) =>
            onCommit((committed) =>
              committed
                ? {
                    condition: committed.condition,
                    narrative: blockUpdate(committed.narrative ?? null),
                  }
                : committed,
            )
          }
        />
      )}
    </div>
  )
}
