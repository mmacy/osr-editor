// The review queue: report.json's flags as a work list. Rows are the areas
// (and the module) carrying at least one flag; dismissal is per flag,
// matching the {address, flag} mark grain; the header counts undismissed
// flags — the honest work-remaining number.
import { useState } from 'react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { ScrollArea } from '@/components/ui/scroll-area'
import type { NavTarget } from '@/lib/address'
import {
  buildReviewRows,
  reviewRowTarget,
  rowFullyDismissed,
  undismissedFlagCount,
  type ReviewRow,
} from '@/lib/review'
import { cn } from '@/lib/utils'
import { projectStore } from '@/store/project-store'
import type { AnySidecarPatch, ProjectState } from '@/types'

export function ReviewQueue({
  project,
  onNavigate,
}: {
  project: ProjectState
  onNavigate: (target: NavTarget) => void
}) {
  const [showDismissed, setShowDismissed] = useState(false)
  if (!project.forge) return null
  const rows = buildReviewRows(project.forge.report, project.sidecar)
  const remaining = undismissedFlagCount(rows)
  const visible = showDismissed ? rows : rows.filter((row) => !rowFullyDismissed(row))
  const selectRow = (row: ReviewRow) => {
    const viewState = project.sidecar.view_state
    void projectStore
      .getState()
      .patchSidecar([
        { action: 'set_view_state', view_state: { ...viewState, review_selection: row.address } },
      ])
    const target = reviewRowTarget(row.address, project.document)
    if (target) onNavigate(target)
  }
  return (
    <section aria-label="Review queue" className="mx-auto flex w-full max-w-2xl flex-col gap-3">
      <header className="flex items-center gap-3">
        <h2 className="text-lg font-semibold">Review</h2>
        <Badge variant={remaining > 0 ? 'default' : 'secondary'} data-testid="review-count">
          {remaining} {remaining === 1 ? 'flag' : 'flags'} to review
        </Badge>
        <label className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
          <Checkbox
            checked={showDismissed}
            onCheckedChange={(checked) => setShowDismissed(checked === true)}
          />
          Show dismissed
        </label>
      </header>
      {visible.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {rows.length === 0
            ? 'The report carries no flags — nothing needs review.'
            : 'Every flag is dismissed. Toggle "Show dismissed" to revisit them.'}
        </p>
      ) : (
        <ScrollArea className="min-h-0">
          <ul className="flex flex-col gap-2">
            {visible.map((row) => (
              <ReviewRowCard
                key={row.address || '(module)'}
                row={row}
                selected={project.sidecar.view_state.review_selection === row.address}
                onSelect={() => selectRow(row)}
              />
            ))}
          </ul>
        </ScrollArea>
      )}
    </section>
  )
}

function mark(action: 'dismiss_flag' | 'undismiss_flag', address: string, flag: string) {
  const patch: AnySidecarPatch = { action, address, flag }
  void projectStore.getState().patchSidecar([patch])
}

function ReviewRowCard({
  row,
  selected,
  onSelect,
}: {
  row: ReviewRow
  selected: boolean
  onSelect: () => void
}) {
  const undismissed = row.flags.filter((flag) => !flag.dismissed)
  return (
    <li
      className={cn(
        'rounded-md border bg-card p-2',
        selected && 'ring-1 ring-ring',
        rowFullyDismissed(row) && 'opacity-60',
      )}
      data-testid={`review-row-${row.address || 'module'}`}
    >
      <div className="flex items-center gap-2">
        <button
          type="button"
          className="min-w-0 flex-1 rounded-sm px-1 py-0.5 text-left text-sm font-medium hover:bg-accent"
          onClick={onSelect}
        >
          {row.label}
        </button>
        {row.confidence !== null && (
          <span className="font-mono text-xs text-muted-foreground">
            {Math.round(row.confidence * 100)}%
          </span>
        )}
        {row.overridden.map((field) => (
          <Badge key={field} variant="outline" className="text-[10px]">
            {field}
          </Badge>
        ))}
        {undismissed.length > 1 && (
          <Button
            variant="ghost"
            size="sm"
            className="text-xs"
            onClick={() => {
              void projectStore.getState().patchSidecar(
                undismissed.map((flag) => ({
                  action: 'dismiss_flag' as const,
                  address: row.address,
                  flag: flag.value,
                })),
              )
            }}
          >
            Dismiss all
          </Button>
        )}
      </div>
      <ul className="mt-1 flex flex-col gap-1">
        {row.flags.map((flag) => (
          <li key={flag.value} className="flex items-start gap-2 text-sm">
            <Checkbox
              aria-label={`Dismiss ${flag.value}`}
              checked={flag.dismissed}
              onCheckedChange={(checked) =>
                mark(checked === true ? 'dismiss_flag' : 'undismiss_flag', row.address, flag.value)
              }
            />
            <span className={cn('min-w-0', flag.dismissed && 'line-through opacity-60')}>
              {flag.parsed ? (
                <>
                  <Badge variant="secondary" className="mr-1 font-mono text-[10px]">
                    {flag.parsed.flag}
                  </Badge>
                  {flag.parsed.detail}
                </>
              ) : (
                <span className="font-mono text-xs">{flag.value}</span>
              )}
            </span>
          </li>
        ))}
      </ul>
    </li>
  )
}
