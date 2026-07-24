// The thin typed client over the backend API, typed by the generated types.
// Errors arrive in the one structured envelope; ApiRequestError carries it so
// every caller can toast the message and remedy generically.
import type {
  AnyEditOp,
  AnyOverrideEdit,
  AnySidecarPatch,
  ApiError,
  ApiErrorDetail,
  ConversionState,
  EditorSidecar,
  EncounterTableCatalogResponse,
  EquipmentCatalogResponse,
  ExportResult,
  ImportedGeometry,
  ImporterListResponse,
  MonsterCatalogResponse,
  MonsterTemplate,
  OpBatchResult,
  PreviewResult,
  ProjectListResponse,
  ProjectState,
  ProviderSettingsRequest,
  ProviderStatus,
  PublishResult,
  SniffResult,
  Stage,
  StatusResponse,
  TreasureTypeCatalogResponse,
} from '@/types'

export interface PublishRequest {
  mode: 'symlink' | 'copy'
  name?: string
  overwrite?: boolean
  checkout_path?: string
}

export interface CreatePdfConversion {
  pdf_path: string
  workdir_path: string
  settings?: Record<string, unknown>
  allow_existing?: boolean
}

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
  publishProject: (id: string, body: PublishRequest) =>
    request<PublishResult>(`/api/projects/${id}/publish`, jsonPost(body)),
  getMonsterCatalog: () => request<MonsterCatalogResponse>('/api/catalogs/monsters'),
  getCatalogMonster: (id: string) =>
    request<MonsterTemplate>(`/api/catalogs/monsters/${encodeURIComponent(id)}`),
  getEquipmentCatalog: () => request<EquipmentCatalogResponse>('/api/catalogs/equipment'),
  getTreasureTypeCatalog: () =>
    request<TreasureTypeCatalogResponse>('/api/catalogs/treasure-types'),
  getEncounterTableCatalog: () =>
    request<EncounterTableCatalogResponse>('/api/catalogs/encounter-tables'),
  listImporters: () => request<ImporterListResponse>('/api/importers'),
  sniffImporters: (path: string) =>
    request<SniffResult>('/api/importers/sniff', jsonPost({ path })),
  loadGeometry: (formatId: string, path: string) =>
    request<ImportedGeometry>(
      `/api/importers/${encodeURIComponent(formatId)}/load`,
      jsonPost({ path }),
    ),
  postForgeOverrides: (id: string, revision: string, edits: AnyOverrideEdit[]) =>
    request<OpBatchResult>(`/api/projects/${id}/forge/overrides`, jsonPost({ revision, edits })),
  postForgeCheck: (id: string) =>
    request<OpBatchResult>(`/api/projects/${id}/forge/check`, jsonPost()),
  postForgeRerun: (id: string, settings: Record<string, unknown>) =>
    request<OpBatchResult>(`/api/projects/${id}/forge/rerun`, jsonPost({ settings })),
  postForgeDetach: (id: string, path: string) =>
    request<ProjectState>(`/api/projects/${id}/forge/detach`, jsonPost({ path })),
  postSidecar: (id: string, patches: AnySidecarPatch[]) =>
    request<EditorSidecar>(`/api/projects/${id}/sidecar`, jsonPost({ patches })),
  getProvider: () => request<ProviderStatus>('/api/provider'),
  setProvider: (body: ProviderSettingsRequest) =>
    request<ProviderStatus>('/api/provider', jsonPost(body)),
  createPdfConversion: (body: CreatePdfConversion) =>
    request<ConversionState>('/api/conversions', jsonPost({ kind: 'pdf', ...body })),
  createWorkdirConversion: (workdirPath: string) =>
    request<ConversionState>(
      '/api/conversions',
      jsonPost({ kind: 'workdir', workdir_path: workdirPath }),
    ),
  // The recovery lookup: every surface that hits a busy conflict comes here
  // rather than guessing which session it collided with.
  findConversion: (workdirPath: string) =>
    request<ConversionState>(`/api/conversions?workdir=${encodeURIComponent(workdirPath)}`),
  getConversion: (id: string) => request<ConversionState>(`/api/conversions/${id}`),
  runConversion: (id: string, stage: Stage | null, settings: Record<string, unknown>) =>
    request<ConversionState>(`/api/conversions/${id}/run`, jsonPost({ stage, settings })),
  cancelConversion: (id: string) =>
    request<ConversionState>(`/api/conversions/${id}/cancel`, jsonPost()),
  regenerateConversionPreviews: (id: string) =>
    request<PreviewResult>(`/api/conversions/${id}/previews`, jsonPost()),
}

// Image sources for the review surfaces — plain URLs, not fetches: the browser
// streams them straight into <img>.
export function forgePageUrl(projectId: string, pageNumber: number): string {
  return `/api/projects/${projectId}/forge/pages/${pageNumber}`
}

export function forgePreviewUrl(projectId: string, dungeonId: string, levelNumber: number): string {
  return `/api/projects/${projectId}/forge/previews/${encodeURIComponent(dungeonId)}/${levelNumber}`
}

export function conversionPreviewUrl(
  conversionId: string,
  dungeonId: string,
  levelNumber: number,
): string {
  return `/api/conversions/${conversionId}/previews/${encodeURIComponent(dungeonId)}/${levelNumber}`
}

export type ApiClient = typeof api
