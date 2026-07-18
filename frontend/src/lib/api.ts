// The thin typed client over the backend API. Placeholder response types live
// here only until the generated types land (work item 7 retrofits this module
// onto frontend/src/types/generated/).

export interface StatusResponse {
  editor_version: string
  engine_version: string
  schema_version: number
}

export async function fetchStatus(): Promise<StatusResponse> {
  const response = await fetch('/api/status')
  if (!response.ok) {
    throw new Error(`status request failed: ${response.status}`)
  }
  return (await response.json()) as StatusResponse
}
