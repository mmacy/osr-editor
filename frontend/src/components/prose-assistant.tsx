// The prose assistant: a "Draft with assistant" affordance, absent unless a
// provider is configured. It drafts read-aloud area prose or adventure hooks
// through the backend, shows the draft beside the current text with the token
// usage, and commits only on explicit accept. An in-flight draft can be abandoned.
import { useEffect, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import { api, ApiRequestError } from '@/lib/api'
import { refreshProviderStatus, useProviderStatus } from '@/lib/provider-status'
import type { AidsProseRequest, AidsProseResponse } from '@/types'

type Phase =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'ready'; draft: AidsProseResponse }
  | { kind: 'error'; message: string }

export function ProseAssistant({
  projectId,
  target,
  onAcceptArea,
  onAcceptHooks,
}: {
  projectId: string
  target: AidsProseRequest
  onAcceptArea?: (description: string) => void
  onAcceptHooks?: (hooks: string[]) => void
}) {
  // The shared provider status decides whether the affordance renders at all,
  // so configuring a provider from the header makes it appear here at once —
  // absent (not broken) until then.
  const status = useProviderStatus()
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' })
  const controller = useRef<AbortController | null>(null)
  const configured = status?.configured ?? false

  // Re-check on mount while no provider is known, so a provider configured out
  // of band (another tab, the typed route) is picked up when this surface
  // appears rather than staying absent until a reload. Once one is known the
  // dialog keeps the shared status current, so this costs nothing per area.
  useEffect(() => {
    if (!configured) void refreshProviderStatus()
  }, [configured])

  // Abandon an in-flight draft when the surface goes away.
  useEffect(() => () => controller.current?.abort(), [])

  if (!configured) return null

  const draft = async () => {
    controller.current?.abort()
    const abort = new AbortController()
    controller.current = abort
    setPhase({ kind: 'loading' })
    try {
      const response = await api.postAidsProse(projectId, target, abort.signal)
      setPhase({ kind: 'ready', draft: response })
    } catch (error) {
      if (abort.signal.aborted) return // the user abandoned it
      const message = error instanceof ApiRequestError ? error.detail.message : 'The draft failed.'
      setPhase({ kind: 'error', message })
    }
  }

  const accept = (draftResponse: AidsProseResponse) => {
    if (draftResponse.kind === 'area') onAcceptArea?.(draftResponse.description)
    else onAcceptHooks?.([...draftResponse.hooks])
    setPhase({ kind: 'idle' })
  }

  return (
    <div className="flex flex-col gap-2" data-testid="prose-assistant">
      {phase.kind === 'idle' && (
        <Button variant="outline" size="sm" className="self-start" onClick={() => void draft()}>
          Draft with assistant
        </Button>
      )}
      {phase.kind === 'loading' && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <span>Drafting…</span>
          <Button variant="ghost" size="sm" onClick={() => controller.current?.abort()}>
            Cancel
          </Button>
        </div>
      )}
      {phase.kind === 'error' && (
        <div className="flex items-center gap-2 text-sm text-destructive">
          <span>{phase.message}</span>
          <Button variant="ghost" size="sm" onClick={() => void draft()}>
            Retry
          </Button>
        </div>
      )}
      {phase.kind === 'ready' && (
        <div className="flex flex-col gap-2 rounded-md border p-3" data-testid="prose-suggestion">
          {phase.draft.kind === 'area' ? (
            <p className="font-serif text-sm whitespace-pre-wrap">{phase.draft.description}</p>
          ) : (
            <ul className="flex list-disc flex-col gap-1 pl-5 text-sm">
              {phase.draft.hooks.map((hook, index) => (
                <li key={index}>{hook}</li>
              ))}
            </ul>
          )}
          <p className="text-xs text-muted-foreground">
            {phase.draft.usage.input_tokens} in · {phase.draft.usage.output_tokens} out ·{' '}
            {phase.draft.model_id}
          </p>
          <div className="flex gap-2">
            <Button size="sm" onClick={() => accept(phase.draft)}>
              Accept
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setPhase({ kind: 'idle' })}>
              Discard
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
