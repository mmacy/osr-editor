// The pipeline panel: run.json rendered honestly — per-stage status,
// timestamps, token usage, provider and model identity — plus the check
// control with its ran/stale state and the assemble-stage rerun knob.
import { useState } from 'react'

import { DetachDialog } from '@/components/detach-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { projectStore } from '@/store/project-store'
import type { ProjectState, StageStatus } from '@/types'

const STAGE_ORDER = ['preprocess', 'survey', 'content', 'monsters', 'geometry', 'assemble'] as const

function formatTimestamp(value: string | null | undefined): string {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString()
}

function formatUsage(status: StageStatus): string {
  if (!status.usage) return '—'
  const { input_tokens, output_tokens } = status.usage
  if (!input_tokens && !output_tokens) return '—'
  return `${input_tokens.toLocaleString()} in / ${output_tokens.toLocaleString()} out`
}

// "knob=value" → a one-entry settings object; malformed input answers null.
export function parseKnobEntry(text: string): Record<string, unknown> | null {
  const trimmed = text.trim()
  if (!trimmed) return null
  const separator = trimmed.indexOf('=')
  if (separator <= 0 || separator === trimmed.length - 1) return null
  const key = trimmed.slice(0, separator).trim()
  const raw = trimmed.slice(separator + 1).trim()
  if (!key || !raw) return null
  const asNumber = Number(raw)
  return { [key]: Number.isNaN(asNumber) ? raw : asNumber }
}

export function PipelinePanel({ project }: { project: ProjectState }) {
  const [fallback, setFallback] = useState<'best-effort' | 'omit' | ''>('')
  const [knobText, setKnobText] = useState('')
  const [busy, setBusy] = useState(false)
  const [detachOpen, setDetachOpen] = useState(false)
  if (!project.forge) return null
  const { run, report, checked } = project.forge
  const rerun = () => {
    const settings: Record<string, unknown> = {}
    if (fallback) settings.unresolved_fallback = fallback
    const extra = parseKnobEntry(knobText)
    if (extra) Object.assign(settings, extra)
    setBusy(true)
    void projectStore
      .getState()
      .runForgeRerun(settings)
      .then(() => setBusy(false))
  }
  const check = () => {
    setBusy(true)
    void projectStore
      .getState()
      .runForgeCheck()
      .then(() => setBusy(false))
  }
  return (
    <section aria-label="Pipeline" className="mx-auto flex w-full max-w-2xl flex-col gap-4">
      <h2 className="text-lg font-semibold">Pipeline</h2>
      <div className="overflow-x-auto rounded-md border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
              <th className="px-2 py-1 font-medium">Stage</th>
              <th className="px-2 py-1 font-medium">Status</th>
              <th className="px-2 py-1 font-medium">Finished</th>
              <th className="px-2 py-1 font-medium">Tokens</th>
            </tr>
          </thead>
          <tbody>
            {STAGE_ORDER.map((stage) => {
              const status = run.stages[stage]
              if (!status) return null
              return (
                <tr key={stage} className="border-b last:border-b-0">
                  <td className="px-2 py-1 font-mono text-xs">{stage}</td>
                  <td className="px-2 py-1">
                    <Badge
                      variant={
                        status.status === 'completed'
                          ? 'secondary'
                          : status.status === 'failed'
                            ? 'destructive'
                            : 'outline'
                      }
                      className="text-[10px]"
                    >
                      {status.status}
                    </Badge>
                    {status.error && (
                      <span className="ml-2 text-xs text-muted-foreground">{status.error}</span>
                    )}
                  </td>
                  <td className="px-2 py-1 text-xs text-muted-foreground">
                    {formatTimestamp(status.finished_at)}
                  </td>
                  <td className="px-2 py-1 font-mono text-xs">{formatUsage(status)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted-foreground">
        {run.provider ? (
          <>
            Converted by <span className="font-mono">{run.provider}</span>
            {run.model_id && (
              <>
                {' '}
                (<span className="font-mono">{run.model_id}</span>)
              </>
            )}
            {' — '}
          </>
        ) : null}
        {report.usage.input_tokens.toLocaleString()} tokens in /{' '}
        {report.usage.output_tokens.toLocaleString()} out across the model stages.
      </p>

      <div className="flex flex-col gap-2 rounded-md border p-3">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-medium">Playability check</h3>
          <Badge
            variant={checked ? 'secondary' : 'outline'}
            className="text-[10px]"
            data-testid="check-state"
          >
            {checked ? 'findings current' : 'not run since the last change'}
          </Badge>
          <Button size="sm" className="ml-auto" disabled={busy} onClick={check}>
            Run check
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Forge&apos;s static graph checks plus the smoke delve, merged into the diagnostics
          panel&apos;s forge tier. Re-assembly clears the findings — stale lint about a changed
          draft is worse than none.
        </p>
      </div>

      <div className="flex flex-col gap-2 rounded-md border p-3">
        <h3 className="text-sm font-medium">Re-run assembly</h3>
        <div className="flex items-end gap-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="unresolved-fallback">Unresolved fallback</Label>
            <select
              id="unresolved-fallback"
              className="h-8 rounded-md border bg-transparent px-2 text-sm"
              value={fallback}
              onChange={(event) => setFallback(event.target.value as typeof fallback)}
            >
              <option value="">keep current ({run.settings.unresolved_fallback})</option>
              <option value="best-effort">best-effort</option>
              <option value="omit">omit</option>
            </select>
          </div>
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <Label htmlFor="rerun-knob">Other knob (knob=value)</Label>
            <Input
              id="rerun-knob"
              className="h-8 font-mono text-xs"
              placeholder="unresolved_fallback=omit"
              value={knobText}
              onChange={(event) => setKnobText(event.target.value)}
            />
          </div>
          <Button size="sm" disabled={busy} onClick={rerun}>
            Rerun assemble
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Assemble-stage knobs only in this release; a knob owned by an upstream stage is refused
          with forge&apos;s own remedy. Model-stage reruns arrive with conversion.
        </p>
      </div>

      <div className="flex flex-col gap-2 rounded-md border p-3">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-medium">Detach</h3>
          <Button
            variant="outline"
            size="sm"
            className="ml-auto"
            onClick={() => setDetachOpen(true)}
          >
            Detach to a native project…
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          For edits overrides cannot express — new dungeons or levels, wandering tables, resizing.
          The crossing is recorded and one-way: corrections stop landing in overrides.yaml.
        </p>
      </div>
      <DetachDialog open={detachOpen} onOpenChange={setDetachOpen} />
    </section>
  )
}
