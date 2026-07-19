// The one open project's client-side state: the document, its revision, and
// the single-flight commit queue. Batches post strictly sequentially, each
// carrying the revision from the previous result, so rapid blur-commits can
// never 409 against themselves. A real 409 (`stale_revision` — the other tab
// won) triggers a wholesale refetch and a quiet toast; a 404
// (`unknown_project` — the server restarted) sets `gone` and the screen
// routes home.
import { toast } from 'sonner'
import { useStore } from 'zustand'
import { createStore, type StoreApi } from 'zustand/vanilla'

import { api, ApiRequestError, type ApiClient } from '@/lib/api'
import { applyDelta } from '@/lib/apply-delta'
import type { Adventure, AnyEditOp, OpBatchResult, ProjectState } from '@/types'

// Ops whose payload depends on the document (a whole hooks tuple, a spread
// wandering spec) must be BUILT at dequeue time against the document the
// carried revision names — a payload built at gesture time could be stale by
// the time its turn in the queue comes, and the fresh revision would make the
// server accept it, silently reverting the commit in between. A builder
// returning no ops skips the batch (its target vanished underneath).
export type OpsInput = AnyEditOp[] | ((document: Adventure) => AnyEditOp[])

export interface CommitOptions {
  // A caller that can render a rejection richer than the generic toast (the
  // resize dialog's offender list) returns true to claim it; anything
  // unclaimed falls through to the default handling.
  onError?: (error: ApiRequestError) => boolean
}

export interface ProjectStoreState {
  project: ProjectState | null
  fidelityAcknowledged: boolean
  gone: boolean
  lastExportPath: string | null
  setProject: (state: ProjectState) => void
  clear: () => void
  acknowledgeFidelity: () => void
  setLastExportPath: (path: string) => void
  commit: (ops: OpsInput, options?: CommitOptions) => Promise<boolean>
  undo: () => Promise<void>
  redo: () => Promise<void>
  refresh: () => Promise<void>
}

export function createProjectStore(client: ApiClient): StoreApi<ProjectStoreState> {
  // The single-flight queue: every mutating request chains onto the previous
  // one, and a failed link never blocks the chain.
  let queue: Promise<unknown> = Promise.resolve()
  const enqueue = <T>(task: () => Promise<T>): Promise<T> => {
    const result = queue.then(task)
    queue = result.catch(() => undefined)
    return result
  }

  return createStore<ProjectStoreState>((set, get) => {
    const applyResult = (result: OpBatchResult): void => {
      const { project } = get()
      if (!project) return
      set({
        project: {
          ...project,
          document: applyDelta(project.document, result.delta),
          revision: result.revision,
          diagnostics: result.diagnostics,
          can_undo: result.can_undo,
          can_redo: result.can_redo,
        },
      })
    }

    const refresh = async (): Promise<void> => {
      const { project } = get()
      if (!project) return
      try {
        set({ project: await client.getProject(project.id) })
      } catch (error) {
        handleError(error)
      }
    }

    const handleError = (error: unknown): void => {
      if (!(error instanceof ApiRequestError)) throw error
      if (error.detail.code === 'stale_revision') {
        void refresh().then(() => toast('Updated from another tab'))
        return
      }
      if (error.detail.code === 'unknown_project') {
        set({ gone: true })
        return
      }
      if (error.detail.code === 'nothing_to_undo' || error.detail.code === 'nothing_to_redo') {
        // The buttons track can_undo/can_redo, so this is a race — resync quietly.
        void refresh()
        return
      }
      toast.error(error.detail.message, {
        description: error.detail.remedy ?? undefined,
      })
    }

    return {
      project: null,
      fidelityAcknowledged: false,
      gone: false,
      lastExportPath: null,

      setProject: (state) => set({ project: state, fidelityAcknowledged: false, gone: false }),
      clear: () => set({ project: null, fidelityAcknowledged: false, gone: false }),
      acknowledgeFidelity: () => set({ fidelityAcknowledged: true }),
      setLastExportPath: (path) => set({ lastExportPath: path }),

      commit: (ops, options) =>
        enqueue(async () => {
          const { project } = get()
          if (!project) return false
          const built = typeof ops === 'function' ? ops(project.document) : ops
          if (built.length === 0) return false
          try {
            applyResult(await client.postOps(project.id, project.revision, built))
            return true
          } catch (error) {
            if (error instanceof ApiRequestError && options?.onError?.(error)) return false
            handleError(error)
            return false
          }
        }),

      undo: () =>
        enqueue(async () => {
          const { project } = get()
          if (!project) return
          try {
            applyResult(await client.undo(project.id))
          } catch (error) {
            handleError(error)
          }
        }),

      redo: () =>
        enqueue(async () => {
          const { project } = get()
          if (!project) return
          try {
            applyResult(await client.redo(project.id))
          } catch (error) {
            handleError(error)
          }
        }),

      refresh,
    }
  })
}

export const projectStore = createProjectStore(api)

export function useProjectStore<T>(selector: (state: ProjectStoreState) => T): T {
  return useStore(projectStore, selector)
}
