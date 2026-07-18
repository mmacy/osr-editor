// The thin typed client over the backend API, typed by the generated types.
import type { StatusResponse } from '@/types'

export async function fetchStatus(): Promise<StatusResponse> {
  const response = await fetch('/api/status')
  if (!response.ok) {
    throw new Error(`status request failed: ${response.status}`)
  }
  return (await response.json()) as StatusResponse
}
