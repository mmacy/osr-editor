// The bound session's watcher: mounted for the lifetime of a forge-backed
// project screen, so a rerun started from the pipeline panel keeps its progress
// (and the chrome keeps its pause) no matter which section the user is looking
// at. A page reload mid-rerun re-attaches through the recovery lookup instead
// of orphaning the run.
//
// The store is the single source of truth here — every surface reads
// `conversion` from it — so this owns the interval directly rather than holding
// a second copy in a hook.
import { useEffect } from 'react'
import { toast } from 'sonner'

import { POLL_INTERVAL_MS } from '@/hooks/use-conversion-poll'
import { api } from '@/lib/api'
import { isActive } from '@/lib/conversion'
import { projectStore, useProjectStore } from '@/store/project-store'

export function ConversionWatcher({ workdirPath }: { workdirPath: string }) {
  const conversion = useProjectStore((state) => state.conversion)
  const id = conversion?.id ?? null
  const active = conversion !== null && isActive(conversion.state)

  useEffect(() => {
    let cancelled = false
    api
      .findConversion(workdirPath)
      .then((found) => {
        // Any state, not just active: a terminal session is this workdir's
        // session too, and reusing its id is what keeps one workdir on one.
        if (!cancelled) projectStore.getState().setConversion(found)
      })
      .catch(() => {
        // No session for this workdir is the normal case, not an error.
      })
    return () => {
      cancelled = true
    }
  }, [workdirPath])

  useEffect(() => {
    if (!id || !active) return
    let cancelled = false
    const timer = setInterval(() => {
      api
        .getConversion(id)
        .then((next) => {
          if (cancelled) return
          projectStore.getState().setConversion(next)
          if (isActive(next.state)) return
          // The terminal poll carries the signal: the adopted document,
          // refreshed report, run, diagnostics, and cleared `checked` all
          // arrive together on the refetch.
          void projectStore.getState().refresh()
          if (next.state === 'failed' && next.error) {
            toast.error('The rerun stopped', { description: next.error })
          }
        })
        .catch(() => {
          // A vanished session means the server restarted; the project screen's
          // own `unknown_project` handling routes home.
        })
    }, POLL_INTERVAL_MS)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [id, active])

  return null
}
