// Provider settings: the Foundry fields, with env-detected placeholders, source
// badges, and a write-only key. The posture is stated in the copy because it is
// the whole point — session values live in memory until the editor closes, the
// OSRFORGE_FOUNDRY_* environment variables are the durable configuration, and
// nothing here is ever written to disk.
import { useState } from 'react'
import { toast } from 'sonner'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { api, ApiRequestError } from '@/lib/api'
import type { ProviderFieldStatus, ProviderStatus } from '@/types'

export const ENDPOINT_ENV = 'OSRFORGE_FOUNDRY_ENDPOINT'
export const DEPLOYMENT_ENV = 'OSRFORGE_FOUNDRY_DEPLOYMENT'
export const API_KEY_ENV = 'OSRFORGE_FOUNDRY_API_KEY'

function SourceBadge({ source }: { source: ProviderFieldStatus['source'] }) {
  if (!source) return <Badge variant="outline">not set</Badge>
  return <Badge variant="secondary">from {source === 'env' ? 'environment' : 'this session'}</Badge>
}

export function ProviderStrip({ status, onOpen }: { status: ProviderStatus; onOpen: () => void }) {
  return (
    <div
      className="flex items-center gap-2 rounded-md border p-3 text-sm"
      data-testid="provider-strip"
    >
      <span className="font-medium">Provider</span>
      <Badge variant={status.configured ? 'secondary' : 'destructive'} data-testid="provider-state">
        {status.configured ? 'ready' : 'not configured'}
      </Badge>
      <span className="min-w-0 truncate font-mono text-xs text-muted-foreground">
        {status.deployment.value ?? 'no deployment'}
      </span>
      <Button variant="outline" size="sm" className="ml-auto" onClick={onOpen}>
        Provider settings…
      </Button>
    </div>
  )
}

export function ProviderDialog({
  open,
  onOpenChange,
  status,
  onStatus,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  status: ProviderStatus
  onStatus: (status: ProviderStatus) => void
}) {
  // The form mounts only while the dialog is open, so its fields start empty
  // every time — no reset effect, and an untouched field can never overwrite
  // the environment value it inherited.
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open && (
        <ProviderForm status={status} onStatus={onStatus} onDone={() => onOpenChange(false)} />
      )}
    </Dialog>
  )
}

function ProviderForm({
  status,
  onStatus,
  onDone,
}: {
  status: ProviderStatus
  onStatus: (status: ProviderStatus) => void
  onDone: () => void
}) {
  const [endpoint, setEndpoint] = useState('')
  const [deployment, setDeployment] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [busy, setBusy] = useState(false)

  const save = async () => {
    setBusy(true)
    try {
      const body: Record<string, string> = {}
      if (endpoint.trim()) body.endpoint = endpoint.trim()
      if (deployment.trim()) body.deployment = deployment.trim()
      if (apiKey.trim()) body.api_key = apiKey.trim()
      onStatus(await api.setProvider(body))
      onDone()
    } catch (error) {
      if (error instanceof ApiRequestError) {
        toast.error(error.detail.message, { description: error.detail.remedy ?? undefined })
      }
    } finally {
      setBusy(false)
    }
  }

  const clearKey = async () => {
    setBusy(true)
    try {
      onStatus(await api.setProvider({ api_key: null }))
      setApiKey('')
    } finally {
      setBusy(false)
    }
  }

  return (
    <DialogContent className="sm:max-w-lg">
      <DialogHeader>
        <DialogTitle>Provider settings</DialogTitle>
        <DialogDescription>
          Session values live in memory until the editor closes. The{' '}
          <span className="font-mono">OSRFORGE_FOUNDRY_*</span> environment variables are the
          durable configuration, and no credential is ever written to editor config.
        </DialogDescription>
      </DialogHeader>

      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-2">
            <Label htmlFor="provider-endpoint">Endpoint</Label>
            <SourceBadge source={status.endpoint.source} />
          </div>
          <Input
            id="provider-endpoint"
            className="font-mono text-xs"
            value={endpoint}
            placeholder={status.endpoint.value ?? ENDPOINT_ENV}
            onChange={(event) => setEndpoint(event.target.value)}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-2">
            <Label htmlFor="provider-deployment">Deployment</Label>
            <SourceBadge source={status.deployment.source} />
          </div>
          <Input
            id="provider-deployment"
            className="font-mono text-xs"
            value={deployment}
            placeholder={status.deployment.value ?? DEPLOYMENT_ENV}
            onChange={(event) => setDeployment(event.target.value)}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-2">
            <Label htmlFor="provider-api-key">API key</Label>
            <Badge variant={status.api_key_present ? 'secondary' : 'outline'}>
              {status.api_key_present
                ? `set (${status.api_key_source === 'env' ? 'environment' : 'this session'})`
                : 'not set'}
            </Badge>
            {status.api_key_source === 'session' && (
              <Button variant="ghost" size="sm" disabled={busy} onClick={() => void clearKey()}>
                Clear
              </Button>
            )}
          </div>
          <Input
            id="provider-api-key"
            type="password"
            className="font-mono text-xs"
            value={apiKey}
            placeholder={status.api_key_present ? '••••••••' : API_KEY_ENV}
            onChange={(event) => setApiKey(event.target.value)}
          />
          {!status.api_key_present && (
            <p className="text-xs text-muted-foreground" data-testid="entra-hint">
              {status.entra_available
                ? 'With no key set, forge signs in with Entra ID through DefaultAzureCredential.'
                : 'With no key set, forge signs in with Entra ID — install the osr-forge[entra] extra, or set a key here.'}
            </p>
          )}
        </div>
      </div>

      <DialogFooter>
        <Button onClick={() => void save()} disabled={busy}>
          Save for this session
        </Button>
      </DialogFooter>
    </DialogContent>
  )
}
