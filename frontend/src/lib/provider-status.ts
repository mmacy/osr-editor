// The model provider's status, shared by every surface that reads or changes it.
//
// One source of truth on purpose: the status is process-wide state (session
// overrides merged over the environment), and it is read from surfaces that can
// be mounted at the same time — the project header's settings entry, the prose
// assistant's gate, and the conversion surfaces' strips. A per-component fetch
// would let one surface change the provider while another kept rendering the
// state it read at mount, which is exactly how the prose assistant would stay
// absent after you had just configured a provider.
import { useEffect, useSyncExternalStore } from 'react'

import { api } from '@/lib/api'
import type { ProviderStatus } from '@/types'

let status: ProviderStatus | null = null
let inFlight: Promise<void> | null = null
const listeners = new Set<() => void>()

function emit(): void {
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

// Install a status every caller sees — what the provider dialog hands back on
// save, so a change lands everywhere at once.
export function setProviderStatus(next: ProviderStatus): void {
  status = next
  emit()
}

// Drop the cached status so the next reader re-fetches.
export function resetProviderStatus(): void {
  status = null
  inFlight = null
  emit()
}

// Fetch the status, coalescing concurrent callers onto one request. A failed
// fetch leaves the cache alone — the surfaces render their unconfigured state,
// which is the honest answer when the backend cannot be reached.
export function refreshProviderStatus(): Promise<void> {
  inFlight ??= api
    .getProvider()
    .then((value) => {
      status = value
      emit()
    })
    .catch(() => undefined)
    .finally(() => {
      inFlight = null
    })
  return inFlight
}

// The status as a component sees it: `null` until the first fetch lands.
export function useProviderStatus(): ProviderStatus | null {
  const value = useSyncExternalStore(
    subscribe,
    () => status,
    () => status,
  )
  useEffect(() => {
    if (status === null) void refreshProviderStatus()
  }, [])
  return value
}
