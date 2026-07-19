// The thin typed client over the backend API, typed by the generated types.
// Errors arrive in the one structured envelope; ApiRequestError carries it so
// every caller can toast the message and remedy generically.
import type {
  AnyEditOp,
  ApiError,
  ApiErrorDetail,
  ExportResult,
  ImportedGeometry,
  ImporterListResponse,
  OpBatchResult,
  ProjectListResponse,
  ProjectState,
  SniffResult,
  StatusResponse,
} from '@/types'

export class ApiRequestError extends Error {
  readonly status: number
  readonly detail: ApiErrorDetail

  constructor(status: number, detail: ApiErrorDetail) {
    super(detail.message)
    this.name = 'ApiRequestError'
    this.status = status
    this.detail = detail
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init)
  if (!response.ok) {
    let detail: ApiErrorDetail = {
      code: 'unknown_error',
      message: `request failed with status ${response.status}`,
      remedy: null,
      details: null,
    }
    try {
      const body = (await response.json()) as Partial<ApiError>
      if (body.error) detail = body.error
    } catch {
      // A non-envelope failure (proxy error, crash) keeps the fallback detail.
    }
    throw new ApiRequestError(response.status, detail)
  }
  return (await response.json()) as T
}

function jsonPost(body?: unknown): RequestInit {
  return {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  }
}

export const api = {
  status: () => request<StatusResponse>('/api/status'),
  listProjects: () => request<ProjectListResponse>('/api/projects'),
  createProject: (path: string, name: string) =>
    request<ProjectState>('/api/projects', jsonPost({ path, name })),
  openProject: (path: string) => request<ProjectState>('/api/projects/open', jsonPost({ path })),
  getProject: (id: string) => request<ProjectState>(`/api/projects/${id}`),
  postOps: (id: string, revision: string, ops: AnyEditOp[]) =>
    request<OpBatchResult>(`/api/projects/${id}/ops`, jsonPost({ revision, ops })),
  undo: (id: string) => request<OpBatchResult>(`/api/projects/${id}/undo`, jsonPost()),
  redo: (id: string) => request<OpBatchResult>(`/api/projects/${id}/redo`, jsonPost()),
  exportProject: (id: string, path: string) =>
    request<ExportResult>(`/api/projects/${id}/export`, jsonPost({ path })),
  listImporters: () => request<ImporterListResponse>('/api/importers'),
  sniffImporters: (path: string) =>
    request<SniffResult>('/api/importers/sniff', jsonPost({ path })),
  loadGeometry: (formatId: string, path: string) =>
    request<ImportedGeometry>(
      `/api/importers/${encodeURIComponent(formatId)}/load`,
      jsonPost({ path }),
    ),
}

export type ApiClient = typeof api
