// The pipeline view: one screen serving both entry flows — the estimate's warm
// workdir confirmed into a conversion, and an incomplete workdir opened from the
// home screen. Everything a stalled conversion needs is here: what ran, what is
// left, what it will cost to continue, and how to stop.
import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { HomeIcon } from 'lucide-react'
import { toast } from 'sonner'

import { ProviderDialog, ProviderStrip } from '@/components/provider-dialog'
import { StageTable } from '@/components/stage-table'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useConversionPoll } from '@/hooks/use-conversion-poll'
import { api, ApiRequestError, conversionPreviewUrl } from '@/lib/api'
import {
  canRegeneratePreviews,
  firstIncompleteStage,
  isActive,
  modelStagesFrom,
  parseKnobEntry,
  RUNNABLE_STAGES,
} from '@/lib/conversion'
import { projectStore } from '@/store/project-store'
import type { ConversionState, PreviewLevel, ProviderStatus, Stage } from '@/types'

function toastApiError(error: unknown): void {
  if (error instanceof ApiRequestError) {
    toast.error(error.detail.message, { description: error.detail.remedy ?? undefined })
  } else {
    toast.error(error instanceof Error ? error.message : String(error))
  }
}

export function ConversionScreen() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [initial, setInitial] = useState<ConversionState | null>(null)

  useEffect(() => {
    if (!id) return
    api
      .getConversion(id)
      .then(setInitial)
      .catch((error: unknown) => {
        toastApiError(error)
        navigate('/')
      })
  }, [id, navigate])

  if (!initial || initial.id !== id) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <p className="text-sm text-muted-foreground">Opening the pipeline…</p>
      </main>
    )
  }
  return <ConversionView key={initial.id} initial={initial} />
}

export function ConversionView({ initial }: { initial: ConversionState }) {
  const navigate = useNavigate()
  const [stage, setStage] = useState<Stage | null>(null)
  const [knobText, setKnobText] = useState('')
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<ProviderStatus | null>(null)
  const [providerOpen, setProviderOpen] = useState(false)
  const [previews, setPreviews] = useState<PreviewLevel[]>([])
  const [previewing, setPreviewing] = useState<PreviewLevel | null>(null)

  const openReview = async (workdirPath: string) => {
    try {
      const project = await api.openProject(workdirPath)
      projectStore.getState().setProject(project)
      navigate(`/projects/${project.id}`)
    } catch (error) {
      toastApiError(error)
    }
  }

  const { conversion, gone, setConversion } = useConversionPoll(initial, (settled) => {
    // On success the workdir opens directly into the review queue — the spec's
    // landing. A failure or a cancel stays here, where the resume lives.
    if (settled.state === 'completed') void openReview(settled.workdir_path)
  })

  useEffect(() => {
    api.getProvider().then(setStatus).catch(toastApiError)
  }, [])

  useEffect(() => {
    if (gone) {
      toast.error('The editor restarted', {
        description: 'Reopen the workdir; its run.json is the durable record.',
      })
      navigate('/')
    }
  }, [gone, navigate])

  if (!conversion) return null
  const active = isActive(conversion.state)
  const resumeFrom = stage ?? firstIncompleteStage(conversion.stages)
  const modelStages = modelStagesFrom(resumeFrom)

  const run = async () => {
    setBusy(true)
    try {
      setConversion(
        await api.runConversion(conversion.id, resumeFrom, parseKnobEntry(knobText) ?? {}),
      )
    } catch (error) {
      toastApiError(error)
    } finally {
      setBusy(false)
    }
  }

  const cancel = async () => {
    setBusy(true)
    try {
      setConversion(await api.cancelConversion(conversion.id))
    } catch (error) {
      toastApiError(error)
    } finally {
      setBusy(false)
    }
  }

  const regenerate = async () => {
    setBusy(true)
    try {
      const result = await api.regenerateConversionPreviews(conversion.id)
      setPreviews(result.levels)
      if (result.levels.length > 0) setPreviewing(result.levels[0])
    } catch (error) {
      toastApiError(error)
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-3xl flex-col gap-6 p-8">
      <header className="flex items-center gap-3">
        <Button variant="ghost" size="icon-sm" aria-label="Home" onClick={() => navigate('/')}>
          <HomeIcon />
        </Button>
        <div className="min-w-0 flex-1">
          <h1 className="font-serif text-2xl font-semibold">Conversion</h1>
          <p className="truncate font-mono text-xs text-muted-foreground">
            {conversion.workdir_path}
          </p>
        </div>
        <Badge
          variant={conversion.state === 'failed' ? 'destructive' : 'secondary'}
          data-testid="conversion-state"
        >
          {conversion.state}
        </Badge>
      </header>

      <StageTable rows={conversion.stages} />

      {conversion.state === 'failed' && conversion.error && (
        <div
          className="flex flex-col gap-2 rounded-md border border-destructive/50 p-3"
          data-testid="failure-card"
        >
          <h2 className="text-sm font-medium">The conversion stopped</h2>
          {/* Forge's message verbatim — it names the entry and its remedy. */}
          <p className="font-mono text-xs text-destructive">{conversion.error}</p>
          <p className="text-xs text-muted-foreground">
            Completed stages are kept. Fix what the message names, then run again from the stage
            that failed.
          </p>
        </div>
      )}

      {conversion.state === 'cancelled' && (
        <p className="text-sm text-muted-foreground" data-testid="cancelled-note">
          Cancelled at a stage boundary. Every completed stage is on disk, and running again picks
          up exactly where it stopped.
        </p>
      )}

      {conversion.state === 'completed' && (
        <div className="flex items-center gap-2 rounded-md border p-3">
          <p className="text-sm">The conversion is complete.</p>
          <Button
            size="sm"
            className="ml-auto"
            onClick={() => void openReview(conversion.workdir_path)}
          >
            Open the review queue
          </Button>
        </div>
      )}

      {status && <ProviderStrip status={status} onOpen={() => setProviderOpen(true)} />}

      <section className="flex flex-col gap-2 rounded-md border p-3" aria-label="Run">
        <h2 className="text-sm font-medium">{active ? 'Running' : 'Run the pipeline'}</h2>
        {active ? (
          <>
            <div className="flex items-center gap-2">
              <p className="text-xs text-muted-foreground">
                Cancelling takes effect at the next stage boundary: the stage in flight always
                finishes, so nothing is left half-written.
              </p>
              <Button size="sm" variant="outline" disabled={busy} onClick={() => void cancel()}>
                Cancel
              </Button>
            </div>
          </>
        ) : (
          <>
            <div className="flex items-end gap-2">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="conversion-stage">Resume from</Label>
                <select
                  id="conversion-stage"
                  className="h-8 rounded-md border bg-transparent px-2 text-sm"
                  value={resumeFrom}
                  onChange={(event) => setStage(event.target.value as Stage)}
                >
                  {RUNNABLE_STAGES.map((member) => (
                    <option key={member} value={member}>
                      {member}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                <Label htmlFor="conversion-knob">Optional knob (knob=value)</Label>
                <Input
                  id="conversion-knob"
                  className="h-8 font-mono text-xs"
                  placeholder="custom_monsters=off"
                  value={knobText}
                  onChange={(event) => setKnobText(event.target.value)}
                />
              </div>
              <Button size="sm" disabled={busy} onClick={() => void run()}>
                Run
              </Button>
            </div>
            <p className="text-xs text-muted-foreground" data-testid="run-confirm-copy">
              {modelStages.length > 0
                ? `Resuming from ${resumeFrom} runs the model stages ${modelStages.join(', ')} — cost is not re-estimated on resume; the estimate belongs to the first conversion.`
                : `Resuming from ${resumeFrom} runs no model stage, so it costs nothing.`}
            </p>
          </>
        )}
      </section>

      {canRegeneratePreviews(conversion.stages) && !active && (
        <section className="flex flex-col gap-2 rounded-md border p-3" aria-label="Previews">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-medium">Level previews</h2>
            <Button
              size="sm"
              variant="outline"
              className="ml-auto"
              disabled={busy}
              onClick={() => void regenerate()}
            >
              Regenerate previews
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Rendered from the survey and content caches plus overrides.yaml alone — eyeball the
            geometry before paying for the remaining model stages.
          </p>
          {previews.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {previews.map((level) => (
                <Button
                  key={`${level.dungeon_id}.${level.level_number}`}
                  size="sm"
                  variant="ghost"
                  onClick={() => setPreviewing(level)}
                >
                  {level.dungeon_id} level {level.level_number}
                </Button>
              ))}
            </div>
          )}
        </section>
      )}

      {status && (
        <ProviderDialog
          open={providerOpen}
          onOpenChange={setProviderOpen}
          status={status}
          onStatus={setStatus}
        />
      )}

      <Dialog open={previewing !== null} onOpenChange={(next) => !next && setPreviewing(null)}>
        {previewing && (
          <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-3xl">
            <DialogHeader>
              <DialogTitle>
                Forge preview — {previewing.dungeon_id} level {previewing.level_number}
              </DialogTitle>
              <DialogDescription>
                Forge&apos;s own rendering of the synthesized plan, regenerated from the caches.
              </DialogDescription>
            </DialogHeader>
            <img
              src={conversionPreviewUrl(
                conversion.id,
                previewing.dungeon_id,
                previewing.level_number,
              )}
              alt={`Forge preview of ${previewing.dungeon_id} level ${previewing.level_number}`}
              className="w-full rounded-sm border bg-white"
            />
          </DialogContent>
        )}
      </Dialog>
    </main>
  )
}
