import { useEffect, useState } from 'react'

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { fetchStatus, type StatusResponse } from '@/lib/api'

export function StatusCard() {
  const [status, setStatus] = useState<StatusResponse | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    fetchStatus()
      .then((value) => {
        if (!cancelled) setStatus(value)
      })
      .catch((reason: unknown) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason))
      })
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <CardTitle>osr-editor</CardTitle>
        <CardDescription>Author osrlib adventure modules in your browser</CardDescription>
      </CardHeader>
      <CardContent>
        {error !== null ? (
          <p role="alert">Could not reach the backend: {error}</p>
        ) : status === null ? (
          <p>Connecting to the backend…</p>
        ) : (
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
            <dt className="text-muted-foreground">Editor version</dt>
            <dd data-testid="editor-version">{status.editor_version}</dd>
            <dt className="text-muted-foreground">Engine version</dt>
            <dd data-testid="engine-version">{status.engine_version}</dd>
            <dt className="text-muted-foreground">Schema version</dt>
            <dd data-testid="schema-version">{status.schema_version}</dd>
          </dl>
        )}
      </CardContent>
    </Card>
  )
}
