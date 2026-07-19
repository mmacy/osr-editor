// The forge review surfaces: the review queue, the corrections panel, the
// pipeline panel, and the monster-resolution panel. Each reads the project's
// forge projection and sidecar and commits through the store's forge methods.
import { useMemo, useState } from 'react'

import { StatBlockForm } from '@/components/statblock-form'
import { MonsterPicker } from '@/components/monster-picker'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { navTargetFor, type NavTarget } from '@/lib/address'
import { collectCorrections, type CorrectionEntry } from '@/lib/corrections'
import {
  buildReviewRows,
  flagLabel,
  undismissedCount,
  visibleRows,
  type ReviewRow,
} from '@/lib/flags'
import { cn } from '@/lib/utils'
import { projectStore } from '@/store/project-store'
import type { ForgeState, ProjectState } from '@/types'

// --- The review queue ---------------------------------------------------------

export function ReviewQueue({
  project,
  onNavigate,
}: {
  project: ProjectState
  onNavigate: (target: NavTarget, row: ReviewRow) => void
}) {
  const forge = project.forge
  const [showDismissed, setShowDismissed] = useState(false)
  const rows = useMemo(
    () => (forge ? buildReviewRows(forge.report, project.sidecar.review) : []),
    [forge, project.sidecar.review],
  )
  const shown = visibleRows(rows, showDismissed)
  const remaining = undismissedCount(rows)

  const dismiss = (row: ReviewRow, flag: string, dismissed: boolean) => {
    void projectStore
      .getState()
      .patchSidecar([
        dismissed
          ? { patch: 'dismiss_flag', address: row.address, flag }
          : { patch: 'undismiss_flag', address: row.address, flag },
      ])
  }

  return (
    <section aria-label="Review" className="flex flex-col gap-2 p-2">
      <div className="flex items-center justify-between px-1">
        <span className="text-sm font-medium">Review</span>
        <Badge variant={remaining > 0 ? 'default' : 'secondary'} data-testid="review-count">
          {remaining}
        </Badge>
      </div>
      <label className="flex items-center gap-2 px-1 text-xs text-muted-foreground">
        <Checkbox
          checked={showDismissed}
          onCheckedChange={(value) => setShowDismissed(value === true)}
          aria-label="Show dismissed"
        />
        Show dismissed
      </label>
      {shown.length === 0 ? (
        <p className="px-1 py-2 text-sm text-muted-foreground">No flags to review.</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {shown.map((row) => (
            <li key={row.address || 'module'} className="rounded-md border bg-card p-2">
              <button
                type="button"
                className="mb-1 w-full text-left text-sm font-medium hover:underline"
                onClick={() => {
                  const target = navTargetFor(row.address || undefined, project.document)
                  if (target) onNavigate(target, row)
                }}
              >
                {row.areaKey ? `Area ${row.areaKey}` : 'Module'}
                {row.confidence !== null && (
                  <span className="ml-2 font-mono text-xs text-muted-foreground">
                    {Math.round(row.confidence * 100)}%
                  </span>
                )}
              </button>
              {row.overridden.length > 0 && (
                <div className="mb-1 flex flex-wrap gap-1">
                  {row.overridden.map((field) => (
                    <Badge key={field} variant="outline" className="text-[10px]">
                      {field}
                    </Badge>
                  ))}
                </div>
              )}
              <ul className="flex flex-col gap-0.5">
                {row.flags.map((flag) => (
                  <li key={flag.raw} className="flex items-start gap-2 text-xs">
                    <Checkbox
                      checked={flag.dismissed}
                      onCheckedChange={(value) => dismiss(row, flag.raw, value === true)}
                      aria-label={`Dismiss ${flag.raw}`}
                      className="mt-0.5"
                    />
                    <span
                      className={cn(
                        'flex-1',
                        flag.dismissed && 'text-muted-foreground line-through',
                      )}
                    >
                      <span className="font-medium">{flagLabel(flag.flag)}</span>
                      {flag.detail && (
                        <span className="text-muted-foreground"> — {flag.detail}</span>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

// --- The corrections panel ----------------------------------------------------

export function CorrectionsPanel({
  project,
  onNavigate,
}: {
  project: ProjectState
  onNavigate: (target: NavTarget) => void
}) {
  const forge = project.forge
  const entries = useMemo(
    () => (forge ? collectCorrections(forge.overrides, project.sidecar.auto_reasons) : []),
    [forge, project.sidecar.auto_reasons],
  )
  if (!forge) return null

  const setReason = (entry: CorrectionEntry, reason: string) => {
    void projectStore
      .getState()
      .forgeEdit([{ edit: 'set_reason', kind: entry.kind, key: entry.key, reason }])
  }
  const remove = (entry: CorrectionEntry) => {
    void projectStore
      .getState()
      .forgeEdit([{ edit: 'remove_entry', kind: entry.kind, key: entry.key }])
  }

  return (
    <section aria-label="Corrections" className="flex flex-col gap-2 p-2">
      <span className="px-1 text-sm font-medium">Corrections</span>
      {entries.length === 0 ? (
        <p className="px-1 py-2 text-sm text-muted-foreground">No corrections yet.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {entries.map((entry) => (
            <li
              key={`${entry.kind}:${entry.key}`}
              className="rounded-md border bg-card p-2 text-sm"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="min-w-0 flex-1 truncate">
                  <span className="font-mono text-xs text-muted-foreground">{entry.kind}</span>{' '}
                  {entry.key && (
                    <button
                      type="button"
                      className={cn('font-medium', entry.address && 'hover:underline')}
                      disabled={!entry.address}
                      onClick={() => {
                        const target = navTargetFor(entry.address ?? undefined, project.document)
                        if (target) onNavigate(target)
                      }}
                    >
                      {entry.key}
                    </button>
                  )}
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 shrink-0 px-2 text-xs"
                  onClick={() => remove(entry)}
                >
                  Remove
                </Button>
              </div>
              <div className="text-xs text-muted-foreground">{entry.summary}</div>
              <div className="mt-1 flex items-center gap-2">
                <ReasonField
                  reason={entry.reason}
                  onCommit={(reason) => setReason(entry, reason)}
                />
                {entry.autoReason && (
                  <Badge variant="outline" className="shrink-0 text-[10px]">
                    draft
                  </Badge>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function ReasonField({ reason, onCommit }: { reason: string; onCommit: (reason: string) => void }) {
  const [value, setValue] = useState(reason)
  return (
    <Input
      value={value}
      onChange={(event) => setValue(event.target.value)}
      onBlur={() => {
        if (value.trim() && value !== reason) onCommit(value.trim())
      }}
      aria-label="Reason"
      className="h-7 text-xs"
    />
  )
}

// --- The pipeline panel -------------------------------------------------------

const STAGE_ORDER = ['preprocess', 'survey', 'content', 'monsters', 'geometry', 'assemble']

export function PipelinePanel({ project }: { project: ProjectState }) {
  const forge = project.forge
  const [fallback, setFallback] = useState('best-effort')
  if (!forge) return null
  const run = forge.run
  const checked = forge.report.findings.length > 0

  return (
    <section aria-label="Pipeline" className="flex flex-col gap-2 p-2 text-sm">
      <span className="px-1 font-medium">Pipeline</span>
      <div className="px-1 text-xs text-muted-foreground">
        {run.provider ?? 'no provider'} · {run.model_id ?? 'no model'} · {run.page_count} pages
      </div>
      <ul className="flex flex-col gap-0.5">
        {STAGE_ORDER.map((stage) => {
          const status = run.stages[stage as keyof typeof run.stages]
          return (
            <li key={stage} className="flex items-center justify-between rounded px-1 py-0.5">
              <span className="font-mono text-xs">{stage}</span>
              <StageBadge status={status?.status ?? 'pending'} />
            </li>
          )
        })}
      </ul>
      <div className="flex items-center gap-2 px-1">
        <Button size="sm" variant="outline" onClick={() => void projectStore.getState().check()}>
          {checked ? 'Re-check' : 'Check'}
        </Button>
        <span className="text-xs text-muted-foreground">
          {checked ? 'checked' : 'stale since last change'}
        </span>
      </div>
      <div className="flex flex-col gap-1 px-1">
        <Label className="text-xs">Unresolved fallback</Label>
        <div className="flex items-center gap-2">
          <select
            value={fallback}
            onChange={(event) => setFallback(event.target.value)}
            className="h-7 rounded-md border bg-background px-2 text-xs"
            aria-label="Unresolved fallback"
          >
            <option value="best-effort">best-effort</option>
            <option value="omit">omit</option>
          </select>
          <Button
            size="sm"
            variant="outline"
            onClick={() => void projectStore.getState().rerun({ unresolved_fallback: fallback })}
          >
            Rerun assemble
          </Button>
        </div>
      </div>
    </section>
  )
}

function StageBadge({ status }: { status: string }) {
  const variant =
    status === 'completed' ? 'secondary' : status === 'failed' ? 'destructive' : 'outline'
  return (
    <Badge variant={variant} className="text-[10px]">
      {status}
    </Badge>
  )
}

// --- The monster-resolution panel ---------------------------------------------

export function MonsterResolutionPanel({ project }: { project: ProjectState }) {
  const forge = project.forge
  if (!forge) return null
  const { unresolved, custom } = forge.report.monsters
  const bundled = project.document.monsters

  return (
    <section aria-label="Monsters" className="flex flex-col gap-2 p-2 text-sm">
      <span className="px-1 font-medium">Monsters</span>
      {unresolved.length === 0 && custom.length === 0 && (
        <p className="px-1 py-2 text-muted-foreground">Every monster resolved.</p>
      )}
      {unresolved.map((name) => (
        <MonsterRow key={name} name={name} forge={forge} bundled={bundled} unresolvedName />
      ))}
      {custom.map((record) => (
        <MonsterRow
          key={record.id}
          name={record.name}
          forge={forge}
          bundled={bundled}
          derived={record.derived}
        />
      ))}
    </section>
  )
}

function MonsterRow({
  name,
  forge,
  bundled,
  unresolvedName = false,
  derived = [],
}: {
  name: string
  forge: ForgeState
  bundled: ProjectState['document']['monsters']
  unresolvedName?: boolean
  derived?: string[]
}) {
  const [patching, setPatching] = useState(false)
  return (
    <div className="rounded-md border bg-card p-2">
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium">{name}</span>
        <Badge variant={unresolvedName ? 'destructive' : 'secondary'} className="text-[10px]">
          {unresolvedName ? 'unresolved' : 'custom'}
        </Badge>
      </div>
      {derived.length > 0 && (
        <div className="mt-1 flex flex-wrap gap-1">
          {derived.map((field) => (
            <Badge key={field} variant="outline" className="text-[10px]">
              derived: {field}
            </Badge>
          ))}
        </div>
      )}
      <div className="mt-2 flex items-center gap-2">
        <MonsterPicker
          bundled={bundled}
          triggerLabel="Remap"
          onPick={(line) =>
            void projectStore
              .getState()
              .forgeEdit([{ edit: 'set_monster_remap', name, template_id: line.template_id }])
          }
        />
        <Button size="sm" variant="outline" onClick={() => setPatching((value) => !value)}>
          Printed block
        </Button>
      </div>
      {patching && (
        <StatBlockForm
          onSubmit={(patch) => {
            void projectStore.getState().forgeEdit([{ edit: 'set_template_patch', name, patch }])
            setPatching(false)
          }}
          onCancel={() => setPatching(false)}
        />
      )}
      <p className="mt-1 text-[11px] text-muted-foreground">
        {forge.report.monsters.resolved} resolved · either remap or supply the printed block.
      </p>
    </div>
  )
}
