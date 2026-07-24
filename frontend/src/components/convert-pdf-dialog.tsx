// New from PDF: pick a source, confirm the destination, then the estimate gate.
// The gate is structural, not advisory — there is no path from this dialog to a
// running conversion that does not pass through the cost card. `estimate()`
// really preprocesses into the destination, so "Not now" leaves a warm workdir
// the home screen lists and the pipeline view resumes.
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { FileTextIcon } from 'lucide-react'
import { toast } from 'sonner'

import { ProviderDialog, ProviderStrip } from '@/components/provider-dialog'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { api, ApiRequestError } from '@/lib/api'
import {
  defaultWorkdirPath,
  estimateRows,
  formatTokens,
  formatUsd,
  parseKnobEntry,
} from '@/lib/conversion'
import { useConversionPoll } from '@/hooks/use-conversion-poll'
import type { CostEstimate, ProviderStatus } from '@/types'

export function EstimateCard({ estimate }: { estimate: CostEstimate }) {
  return (
    <div className="flex flex-col gap-2 rounded-md border p-3" data-testid="estimate-card">
      <div className="flex items-baseline gap-2">
        <span className="text-sm">
          Converting this {estimate.page_count}-page module will cost roughly
        </span>
        <span className="font-mono text-lg font-semibold" data-testid="estimate-usd">
          {formatUsd(estimate.usd)}
        </span>
      </div>
      <table className="w-full text-xs">
        <thead>
          <tr className="text-left text-muted-foreground">
            <th className="py-0.5 font-medium">Stage</th>
            <th className="py-0.5 font-medium">Input</th>
            <th className="py-0.5 font-medium">Output</th>
          </tr>
        </thead>
        <tbody>
          {estimateRows(estimate).map((row) => (
            <tr key={row.label}>
              <td className="py-0.5 font-mono">{row.label}</td>
              <td className="py-0.5 font-mono">{formatTokens(row.input)}</td>
              <td className="py-0.5 font-mono">{formatTokens(row.output)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-xs text-muted-foreground">
        A rough estimate, not a quote: forge prices from measured heuristics, and schema retries and
        follow-up requests are real tokens no pre-call estimate can see.
      </p>
    </div>
  )
}

export function ConvertPdfDialog({ onConverted }: { onConverted?: () => void }) {
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [pdfPath, setPdfPath] = useState('')
  const [workdirPath, setWorkdirPath] = useState('')
  const [knobText, setKnobText] = useState('')
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const [confirmExisting, setConfirmExisting] = useState<{ completed: boolean } | null>(null)
  const [status, setStatus] = useState<ProviderStatus | null>(null)
  const [providerOpen, setProviderOpen] = useState(false)
  const { conversion, setConversion } = useConversionPoll(null)

  const openDialog = (next: boolean) => {
    setOpen(next)
    if (next) {
      setFailure(null)
      setConfirmExisting(null)
      void api.getProvider().then(setStatus).catch(noteApiError)
    }
  }

  const setPdf = (value: string) => {
    setPdfPath(value)
    // The CLI's default, prefilled on entry and freely editable after.
    setWorkdirPath(defaultWorkdirPath(value))
  }

  const settings = () => parseKnobEntry(knobText) ?? {}

  const estimate = async (allowExisting: boolean) => {
    setBusy(true)
    setFailure(null)
    try {
      const created = await api.createPdfConversion({
        pdf_path: pdfPath.trim(),
        workdir_path: workdirPath.trim(),
        settings: settings(),
        allow_existing: allowExisting,
      })
      setConfirmExisting(null)
      setConversion(created)
    } catch (error) {
      if (error instanceof ApiRequestError) {
        if (error.detail.code === 'conversion_destination_exists') {
          const details = (error.detail.details ?? {}) as { completed?: boolean }
          setConfirmExisting({ completed: Boolean(details.completed) })
        } else if (error.detail.code === 'conversion_in_progress') {
          // Somebody is already converting into this workdir — a reload during
          // the estimate lands here. Recovery is a lookup, not a guess.
          await attachExisting(workdirPath.trim())
        } else {
          setFailure(error.detail.message)
        }
      } else {
        throw error
      }
    } finally {
      setBusy(false)
    }
  }

  const attachExisting = async (path: string) => {
    try {
      const found = await api.findConversion(path)
      setOpen(false)
      navigate(`/conversions/${found.id}`)
    } catch (error) {
      noteApiError(error)
    }
  }

  const convert = async () => {
    if (!conversion) return
    setBusy(true)
    try {
      const started = await api.runConversion(conversion.id, null, {})
      setOpen(false)
      onConverted?.()
      navigate(`/conversions/${started.id}`)
    } catch (error) {
      if (error instanceof ApiRequestError) setFailure(error.detail.message)
      else throw error
    } finally {
      setBusy(false)
    }
  }

  const notNow = () => {
    setOpen(false)
    onConverted?.()
    toast('The rendered workdir is kept', {
      description: `Resume it any time from ${conversion?.workdir_path ?? 'the home screen'}.`,
    })
  }

  return (
    <Dialog open={open} onOpenChange={openDialog}>
      <DialogTrigger asChild>
        <Button variant="outline">
          <FileTextIcon /> Convert a PDF
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Convert a PDF</DialogTitle>
          <DialogDescription>
            The editor prices the conversion before spending anything: pick a module, see the page
            count and rough cost, then decide.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="convert-pdf-path">Module PDF</Label>
            <Input
              id="convert-pdf-path"
              className="font-mono"
              value={pdfPath}
              placeholder="/absolute/path/to/module.pdf"
              onChange={(event) => setPdf(event.target.value)}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="convert-workdir-path">Destination workdir</Label>
            <Input
              id="convert-workdir-path"
              className="font-mono"
              value={workdirPath}
              placeholder="/absolute/path/to/module.forge"
              onChange={(event) => setWorkdirPath(event.target.value)}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="convert-knob">Optional knob (knob=value)</Label>
            <Input
              id="convert-knob"
              className="h-8 font-mono text-xs"
              value={knobText}
              placeholder="render_dpi=200"
              onChange={(event) => setKnobText(event.target.value)}
            />
          </div>

          {status && <ProviderStrip status={status} onOpen={() => setProviderOpen(true)} />}

          {confirmExisting && (
            <div
              className="flex flex-col gap-2 rounded-md border border-destructive/50 p-3"
              data-testid="existing-workdir-confirm"
            >
              <p className="text-sm font-medium">That destination is already a forge workdir.</p>
              <p className="text-xs text-muted-foreground">
                Estimating re-renders its <span className="font-mono">pages/</span> and resets{' '}
                <span className="font-mono">run.json</span> to preprocess only — declining
                afterwards cannot undo that.
                {confirmExisting.completed && (
                  <>
                    {' '}
                    This workdir holds a <strong>finished conversion</strong>: its model stages
                    would have to be paid for again before it reviews.
                  </>
                )}
              </p>
              <div className="flex gap-2">
                <Button size="sm" variant="destructive" onClick={() => void estimate(true)}>
                  Supersede it
                </Button>
                <Button size="sm" variant="outline" onClick={() => setConfirmExisting(null)}>
                  Cancel
                </Button>
              </div>
            </div>
          )}

          {failure && (
            <p className="text-sm text-destructive" data-testid="convert-failure">
              {failure}
            </p>
          )}

          {conversion?.state === 'estimating' && (
            <p className="text-sm text-muted-foreground" data-testid="estimating">
              Rendering pages and pricing the conversion…
            </p>
          )}
          {conversion?.state === 'failed' && conversion.error && (
            <p className="text-sm text-destructive" data-testid="convert-failure">
              {conversion.error}
            </p>
          )}
          {conversion?.estimate && <EstimateCard estimate={conversion.estimate} />}
        </div>

        <DialogFooter>
          {conversion?.estimate ? (
            <>
              <Button variant="outline" onClick={notNow}>
                Not now
              </Button>
              <Button onClick={() => void convert()} disabled={busy}>
                Convert
              </Button>
            </>
          ) : (
            <Button
              onClick={() => void estimate(false)}
              disabled={busy || !pdfPath.trim() || !workdirPath.trim()}
            >
              Estimate
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
      {status && (
        <ProviderDialog
          open={providerOpen}
          onOpenChange={setProviderOpen}
          status={status}
          onStatus={setStatus}
        />
      )}
    </Dialog>
  )
}

function noteApiError(error: unknown): void {
  if (error instanceof ApiRequestError) {
    toast.error(error.detail.message, { description: error.detail.remedy ?? undefined })
  }
}
