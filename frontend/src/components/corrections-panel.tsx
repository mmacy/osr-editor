// The corrections panel: every override entry grouped by kind in file order —
// the reviewable record, surfaced. Reasons are inline-editable; a
// machine-draft badge marks reasons the translator wrote until a human
// composes one; per-entry removal is a two-step confirm.
import { useState } from 'react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { NavTarget } from '@/lib/address'
import {
  correctionTarget,
  listCorrections,
  type CorrectionEntry,
  type CorrectionKind,
} from '@/lib/corrections'
import { projectStore } from '@/store/project-store'
import type { ProjectState } from '@/types'

const KIND_LABELS: Record<CorrectionKind, string> = {
  monsters: 'Monster remaps',
  monster_templates: 'Printed stat blocks',
  areas: 'Areas',
  geometry: 'Geometry',
  town: 'Town',
  module: 'Module',
}

const KIND_ORDER: CorrectionKind[] = [
  'monsters',
  'monster_templates',
  'areas',
  'geometry',
  'town',
  'module',
]

export function CorrectionsPanel({
  project,
  onNavigate,
}: {
  project: ProjectState
  onNavigate: (target: NavTarget) => void
}) {
  if (!project.forge) return null
  const entries = listCorrections(project.forge.overrides, project.sidecar)
  if (entries.length === 0) {
    return (
      <section aria-label="Corrections" className="mx-auto w-full max-w-2xl">
        <h2 className="text-lg font-semibold">Corrections</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          No corrections yet. Every edit you commit lands here as an overrides.yaml entry with its
          reason — the reviewable record of what changed and why.
        </p>
      </section>
    )
  }
  return (
    <section aria-label="Corrections" className="mx-auto flex w-full max-w-2xl flex-col gap-4">
      <h2 className="text-lg font-semibold">Corrections</h2>
      {KIND_ORDER.map((kind) => {
        const group = entries.filter((entry) => entry.kind === kind)
        if (group.length === 0) return null
        return (
          <div key={kind} className="flex flex-col gap-2">
            <h3 className="text-sm font-medium text-muted-foreground">{KIND_LABELS[kind]}</h3>
            <ul className="flex flex-col gap-2">
              {group.map((entry) => (
                <CorrectionRow
                  key={`${entry.kind}:${entry.key}`}
                  entry={entry}
                  project={project}
                  onNavigate={onNavigate}
                />
              ))}
            </ul>
          </div>
        )
      })}
    </section>
  )
}

function CorrectionRow({
  entry,
  project,
  onNavigate,
}: {
  entry: CorrectionEntry
  project: ProjectState
  onNavigate: (target: NavTarget) => void
}) {
  const [reason, setReason] = useState(entry.reason)
  const [confirming, setConfirming] = useState(false)
  const target = correctionTarget(entry, project.document)
  const commitReason = () => {
    const trimmed = reason.trim()
    if (!trimmed || trimmed === entry.reason) {
      setReason(entry.reason)
      return
    }
    void projectStore
      .getState()
      .commitForgeEdits([{ edit: 'set_reason', kind: entry.kind, key: entry.key, reason: trimmed }])
  }
  const remove = () => {
    void projectStore
      .getState()
      .commitForgeEdits([{ edit: 'remove_entry', kind: entry.kind, key: entry.key }])
  }
  return (
    <li
      className="flex flex-col gap-1.5 rounded-md border bg-card p-2"
      data-testid={`correction-${entry.kind}-${entry.key || 'entry'}`}
    >
      <div className="flex items-center gap-2">
        {target ? (
          <button
            type="button"
            className="min-w-0 truncate rounded-sm px-1 text-left font-mono text-sm hover:bg-accent"
            onClick={() => onNavigate(target)}
          >
            {entry.label}
          </button>
        ) : (
          <span className="min-w-0 truncate px-1 font-mono text-sm">{entry.label}</span>
        )}
        <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
          {entry.summary}
        </span>
        {confirming ? (
          <>
            <Button variant="destructive" size="sm" className="text-xs" onClick={remove}>
              Confirm remove
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="text-xs"
              onClick={() => setConfirming(false)}
            >
              Keep
            </Button>
          </>
        ) : (
          <Button variant="ghost" size="sm" className="text-xs" onClick={() => setConfirming(true)}>
            Remove
          </Button>
        )}
      </div>
      <div className="flex items-center gap-2">
        <Input
          aria-label={`Reason for ${entry.label}`}
          className="h-7 flex-1 text-xs"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          onBlur={commitReason}
          onKeyDown={(event) => {
            if (event.key === 'Enter') event.currentTarget.blur()
          }}
        />
        {entry.machineDraft && (
          <Badge variant="outline" className="shrink-0 text-[10px]">
            machine draft
          </Badge>
        )}
      </div>
    </li>
  )
}
