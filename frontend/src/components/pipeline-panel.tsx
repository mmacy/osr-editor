// The pipeline panel: run.json rendered honestly — per-stage status, timestamps,
// token usage, provider and model identity — the check control with its
// ran/stale state, and reruns. Assembly keeps its synchronous route (the fast
// path of the correction loop); every other stage runs through a conversion
// session bound to this project, with live progress, cancellation, and adoption
// of the re-assembled document.
import { useEffect, useState } from 'react'
import { toast } from 'sonner'

import { DetachDialog } from '@/components/detach-dialog'
import { ProviderDialog, ProviderStrip } from '@/components/provider-dialog'
import { StageTable } from '@/components/stage-table'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { api, ApiRequestError } from '@/lib/api'
import { isActive, modelStagesFrom, parseKnobEntry, RUNNABLE_STAGES } from '@/lib/conversion'
import { projectStore, useProjectStore } from '@/store/project-store'
import type { ConversionStageRow, ProjectState, ProviderStatus, Stage } from '@/types'

const STAGE_ORDER: Stage[] = ['preprocess', 'survey', 'content', 'monsters', 'geometry', 'assemble']

function toastApiError(error: unknown): void {
  if (error instanceof ApiRequestError) {
    toast.error(error.detail.message, { description: error.detail.remedy ?? undefined })
  }
}

// run.json's stage table as the shared row shape — one rendering wherever a
// stage row appears.
export function runRows(project: ProjectState): ConversionStageRow[] {
  const stages = project.forge?.run.stages ?? {}
  return STAGE_ORDER.flatMap((stage) => {
    const status = stages[stage]
    return status ? [{ stage, status }] : []
  })
}

export function PipelinePanel({ project }: { project: ProjectState }) {
  const [fallback, setFallback] = useState<'best-effort' | 'omit' | ''>('')
  const [knobText, setKnobText] = useState('')
  const [stage, setStage] = useState<Stage>('assemble')
  const [busy, setBusy] = useState(false)
  const [detachOpen, setDetachOpen] = useState(false)
  const [status, setStatus] = useState<ProviderStatus | null>(null)
  const [providerOpen, setProviderOpen] = useState(false)

  const projectPath = project.path
  // The session lives on the store, watched for the whole screen's lifetime —
  // so the progress and the commit pause survive a section change, and a
  // reload mid-rerun re-attaches instead of orphaning the run.
  const conversion = useProjectStore((state) => state.conversion)
  const setConversion = projectStore.getState().setConversion

  useEffect(() => {
    let cancelled = false
    api
      .getProvider()
      .then((value) => {
        if (!cancelled) setStatus(value)
      })
      .catch(toastApiError)
    return () => {
      cancelled = true
    }
  }, [projectPath])

  if (!project.forge) return null
  const { run, report, checked } = project.forge
  const active = conversion !== null && isActive(conversion.state)
  const modelStages = modelStagesFrom(stage)

  const settings = (): Record<string, unknown> => {
    const values: Record<string, unknown> = {}
    if (fallback) values.unresolved_fallback = fallback
    const extra = parseKnobEntry(knobText)
    if (extra) Object.assign(values, extra)
    return values
  }

  const rerun = async () => {
    setBusy(true)
    try {
      if (stage === 'assemble') {
        // The correction loop's fast path: synchronous, no session, no
        // provider — one act, one path.
        await projectStore.getState().runForgeRerun(settings())
        return
      }
      // Idempotent by registry rule: creating over a path that already holds a
      // session returns that session, bound to this project.
      const bound = conversion ?? (await api.createWorkdirConversion(projectPath))
      setConversion(await api.runConversion(bound.id, stage, settings()))
    } catch (error) {
      toastApiError(error)
    } finally {
      setBusy(false)
    }
  }

  const cancel = async () => {
    if (!conversion) return
    setBusy(true)
    try {
      setConversion(await api.cancelConversion(conversion.id))
    } catch (error) {
      toastApiError(error)
    } finally {
      setBusy(false)
    }
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
      <StageTable rows={active && conversion ? conversion.stages : runRows(project)} />
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

      {active && (
        <div
          className="flex items-center gap-2 rounded-md border border-primary/40 p-3"
          data-testid="pipeline-busy"
        >
          <Badge variant="outline">{conversion.state}</Badge>
          <p className="text-xs text-muted-foreground">
            A rerun is running over this workdir. Commits are paused until it lands; cancelling
            takes effect at the next stage boundary.
          </p>
          <Button
            size="sm"
            variant="outline"
            className="ml-auto"
            disabled={busy}
            onClick={() => void cancel()}
          >
            Cancel
          </Button>
        </div>
      )}

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
          <Button size="sm" className="ml-auto" disabled={busy || active} onClick={check}>
            Run check
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Forge&apos;s static graph checks plus the smoke delve, merged into the diagnostics
          panel&apos;s forge tier. Re-assembly clears the findings — stale lint about a changed
          draft is worse than none.
        </p>
      </div>

      {status && <ProviderStrip status={status} onOpen={() => setProviderOpen(true)} />}

      <div className="flex flex-col gap-2 rounded-md border p-3">
        <h3 className="text-sm font-medium">Re-run a stage</h3>
        <div className="flex items-end gap-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="rerun-stage">Stage</Label>
            <select
              id="rerun-stage"
              className="h-8 rounded-md border bg-transparent px-2 text-sm"
              value={stage}
              onChange={(event) => setStage(event.target.value as Stage)}
            >
              {RUNNABLE_STAGES.map((member) => (
                <option key={member} value={member}>
                  {member}
                </option>
              ))}
            </select>
          </div>
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
              placeholder="custom_monsters=off"
              value={knobText}
              onChange={(event) => setKnobText(event.target.value)}
            />
          </div>
          <Button size="sm" disabled={busy || active} onClick={() => void rerun()}>
            {stage === 'assemble' ? 'Rerun assemble' : `Rerun ${stage}`}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground" data-testid="rerun-consequences">
          {modelStages.length > 0 ? (
            <>
              Re-running {stage} runs the model stages {modelStages.join(', ')} and re-assembles.
              Report flags may change wholesale, so dismissal marks keyed to vanished flags go
              dormant; the undo history survives and replays your corrections against the new caches
              rather than restoring the old document. With{' '}
              <span className="font-mono">custom_monsters=off</span>, existing printed-notation
              patches will fail assembly until they are removed or the pass is run again.
            </>
          ) : (
            <>
              Assembly is pure — no model calls, no cost. A knob owned by an upstream stage is
              refused with forge&apos;s own remedy.
            </>
          )}
        </p>
      </div>

      <div className="flex flex-col gap-2 rounded-md border p-3">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-medium">Detach</h3>
          <Button
            variant="outline"
            size="sm"
            className="ml-auto"
            disabled={active}
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
      {status && (
        <ProviderDialog
          open={providerOpen}
          onOpenChange={setProviderOpen}
          status={status}
          onStatus={setStatus}
        />
      )}
    </section>
  )
}
