// The TriggerClause composite: PatternBuilder over `clause.pattern` plus the
// shared condition list with consumes suppressed (osrlib rejects a consuming
// clause condition at parse — "a quest observes, it does not take"). Three
// consumers: a quest's activation card, each objective's completion clause,
// and a hidden objective's reveal clause.
//
// Commits complete clauses only: while `clause` is null (the drafting state),
// only the pattern builder renders, and the first complete pattern commits
// the whole clause with empty conditions — a half-picked clause never reaches
// the document. Commits are *updates* over the committed clause, applied by
// the host inside its commit queue (the compute-in-the-queue discipline); an
// update answering null skips the batch — the clause vanished under a queued
// gesture — and is never how a clause is removed (the hosts remove with their
// own explicit controls).
import { ConditionList } from '@/components/condition-list'
import { PatternBuilder } from '@/components/pattern-builder'
import type { Adventure, TriggerClause } from '@/types'

export type ClauseUpdate = (committed: TriggerClause | null) => TriggerClause | null

export function ClauseBuilder({
  clause,
  document,
  idPrefix,
  onCommit,
}: {
  clause: TriggerClause | null
  document: Adventure
  idPrefix: string
  onCommit: (update: ClauseUpdate) => void
}) {
  return (
    <div className="flex flex-col gap-2" aria-label="Clause">
      <PatternBuilder
        pattern={clause?.pattern ?? null}
        document={document}
        idPrefix={idPrefix}
        onCommit={(pattern) =>
          onCommit((committed) => ({ pattern, conditions: committed?.conditions ?? [] }))
        }
      />
      {clause !== null && (
        <ConditionList
          conditions={clause.conditions}
          document={document}
          idPrefix={`${idPrefix}-condition`}
          consumeRule="A quest observes, it does not take"
          onUpdate={(build) =>
            onCommit((committed) => {
              if (committed === null) return null
              const conditions = build(committed.conditions)
              return conditions === null ? null : { ...committed, conditions }
            })
          }
        />
      )}
    </div>
  )
}
