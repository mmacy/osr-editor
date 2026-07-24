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

import type { NavTarget } from '@/lib/address'
import { api, ApiRequestError, type ApiClient } from '@/lib/api'
import { applyDelta } from '@/lib/apply-delta'
import { isActive } from '@/lib/conversion'
import type {
  Adventure,
  AnyEditOp,
  AnyOverrideEdit,
  AnySidecarPatch,
  ConversionState,
  OpBatchResult,
  ProjectState,
} from '@/types'

// A blocked forge-mode gesture, rendered in place by the blocked-op dialog:
// the gesture named, the one-line why, and the detach-or-cancel choice.
export interface BlockedOp {
  op: string
  address: string
  message: string
}

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
  // The session's remembered checkout path, prefilling the publish dialog —
  // the backend's config is the durable copy; this is only the echo of the
  // last path this session typed or used.
  lastCheckoutPath: string | null
  // The blocked forge-mode gesture awaiting the detach-or-cancel choice.
  blockedOp: BlockedOp | null
  // A cross-surface navigation request (the monster picker's create shortcut
  // lives layers below the section state); the project screen consumes it.
  navigationIntent: NavTarget | null
  // The conversion session bound to this project's workdir, when one exists.
  // While it is active every workdir-touching act is refused server-side, so
  // the chrome pauses commits rather than letting them 409 one by one.
  conversion: ConversionState | null
  setProject: (state: ProjectState) => void
  clear: () => void
  acknowledgeFidelity: () => void
  setLastExportPath: (path: string) => void
  setLastCheckoutPath: (path: string) => void
  // Client-side flow-entry blocking: a forge-mode gesture whose whole flow is
  // blocked (create/clone/remove a bundled template, the picker's create
  // shortcut, import's new-level mode) opens the dialog before any dialog is
  // filled or batch posted — the server's op_unsupported_forge stays the
  // authority for any batch that does arrive.
  setBlockedOp: (blocked: BlockedOp) => void
  clearBlockedOp: () => void
  requestNavigation: (target: NavTarget) => void
  clearNavigationIntent: () => void
  setConversion: (state: ConversionState | null) => void
  commit: (ops: OpsInput, options?: CommitOptions) => Promise<boolean>
  undo: () => Promise<void>
  redo: () => Promise<void>
  refresh: () => Promise<void>
  commitForgeEdits: (edits: AnyOverrideEdit[]) => Promise<boolean>
  runForgeCheck: () => Promise<void>
  runForgeRerun: (settings: Record<string, unknown>) => Promise<boolean>
  detach: (path: string) => Promise<ProjectState | null>
  patchSidecar: (patches: AnySidecarPatch[]) => Promise<void>
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
          // The forge state refreshes on every forge commit, undo, and redo;
          // a native result carries null and leaves the field null.
          forge: result.forge ?? project.forge,
          // The sidecar rides every result: a forge commit moves the
          // auto_reasons ledger, a native re-keying commit cascades the notes.
          sidecar: result.sidecar ?? project.sidecar,
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

    // The bound-session guard, client side: the server refuses every
    // workdir-touching act with `conversion_in_progress` anyway, and saying so
    // once per gesture beats a 409 per keystroke.
    const busy = (): boolean => {
      const state = get().conversion
      if (!state || !isActive(state.state)) return false
      toast('A rerun is running', {
        description: 'Edits resume when it lands. The pipeline panel shows its progress.',
      })
      return true
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
      if (error.detail.code === 'op_unsupported_forge') {
        // The spec's rule: the edit blocks in place with the detach offer —
        // a dialog, never a toast.
        const details = (error.detail.details ?? {}) as { op?: string; address?: string }
        set({
          blockedOp: {
            op: details.op ?? 'unknown',
            address: details.address ?? '',
            message: error.detail.message,
          },
        })
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
      lastCheckoutPath: null,
      blockedOp: null,
      navigationIntent: null,
      conversion: null,

      setProject: (state) => set({ project: state, fidelityAcknowledged: false, gone: false }),
      clear: () =>
        set({ project: null, fidelityAcknowledged: false, gone: false, conversion: null }),
      acknowledgeFidelity: () => set({ fidelityAcknowledged: true }),
      setLastExportPath: (path) => set({ lastExportPath: path }),
      setLastCheckoutPath: (path) => set({ lastCheckoutPath: path }),
      setBlockedOp: (blocked) => set({ blockedOp: blocked }),
      clearBlockedOp: () => set({ blockedOp: null }),
      requestNavigation: (target) => set({ navigationIntent: target }),
      clearNavigationIntent: () => set({ navigationIntent: null }),
      setConversion: (state) => set({ conversion: state }),

      commit: (ops, options) =>
        enqueue(async () => {
          const { project } = get()
          if (!project || busy()) return false
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
          if (!project || busy()) return
          try {
            applyResult(await client.undo(project.id))
          } catch (error) {
            handleError(error)
          }
        }),

      redo: () =>
        enqueue(async () => {
          const { project } = get()
          if (!project || busy()) return
          try {
            applyResult(await client.redo(project.id))
          } catch (error) {
            handleError(error)
          }
        }),

      refresh,

      commitForgeEdits: (edits) =>
        enqueue(async () => {
          const { project } = get()
          if (!project || edits.length === 0 || busy()) return false
          try {
            applyResult(await client.postForgeOverrides(project.id, project.revision, edits))
            return true
          } catch (error) {
            handleError(error)
            return false
          }
        }),

      runForgeCheck: () =>
        enqueue(async () => {
          const { project } = get()
          if (!project || busy()) return
          try {
            applyResult(await client.postForgeCheck(project.id))
          } catch (error) {
            handleError(error)
          }
        }),

      runForgeRerun: (settings) =>
        enqueue(async () => {
          const { project } = get()
          if (!project || busy()) return false
          try {
            applyResult(await client.postForgeRerun(project.id, settings))
            return true
          } catch (error) {
            handleError(error)
            return false
          }
        }),

      detach: (path) =>
        enqueue(async () => {
          const { project } = get()
          if (!project || busy()) return null
          try {
            const detached = await client.postForgeDetach(project.id, path)
            set({ project: detached, fidelityAcknowledged: false, gone: false, blockedOp: null })
            return detached
          } catch (error) {
            handleError(error)
            return null
          }
        }),

      patchSidecar: (patches) =>
        enqueue(async () => {
          const { project } = get()
          if (!project || patches.length === 0) return
          try {
            const sidecar = await client.postSidecar(project.id, patches)
            const current = get().project
            if (current && current.id === project.id) {
              set({ project: { ...current, sidecar } })
            }
          } catch (error) {
            handleError(error)
          }
        }),
    }
  })
}

export const projectStore = createProjectStore(api)

export function useProjectStore<T>(selector: (state: ProjectStoreState) => T): T {
  return useStore(projectStore, selector)
}
