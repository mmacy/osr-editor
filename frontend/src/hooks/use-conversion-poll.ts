// The progress view's poll: one second while a worker holds the session, and
// nothing at all once it lands. Stages run minutes, not milliseconds, so a
// second is the interval the granularity deserves — and stopping on a terminal
// state is what keeps an idle conversion screen silent.
import { useEffect, useRef, useState } from 'react'

import { api, ApiRequestError } from '@/lib/api'
import { isActive } from '@/lib/conversion'
import type { ConversionState } from '@/types'

export const POLL_INTERVAL_MS = 1000

export interface ConversionPoll {
  conversion: ConversionState | null
  // Set when the session vanished under us — a server restart. The screen
  // routes home rather than polling a ghost.
  gone: boolean
  setConversion: (state: ConversionState) => void
}

export function useConversionPoll(
  initial: ConversionState | null,
  onSettled?: (state: ConversionState) => void,
): ConversionPoll {
  const [conversion, setConversion] = useState<ConversionState | null>(initial)
  const [gone, setGone] = useState(false)
  // Fires exactly once per active → terminal transition, so the caller can
  // refetch a bound project or navigate without racing the next tick.
  const settled = useRef<string | null>(null)
  // The callback rides a ref, synced in its own effect, so a caller's inline
  // arrow never restarts the interval.
  const settledCallback = useRef(onSettled)
  useEffect(() => {
    settledCallback.current = onSettled
  }, [onSettled])

  const id = conversion?.id ?? null
  const active = conversion !== null && isActive(conversion.state)

  useEffect(() => {
    if (!id || !active) return
    let cancelled = false
    const tick = () => {
      api
        .getConversion(id)
        .then((next) => {
          if (cancelled) return
          setConversion(next)
          if (!isActive(next.state) && settled.current !== next.id + next.state) {
            settled.current = next.id + next.state
            settledCallback.current?.(next)
          }
        })
        .catch((error: unknown) => {
          if (cancelled) return
          if (error instanceof ApiRequestError && error.detail.code === 'unknown_conversion') {
            setGone(true)
          }
        })
    }
    const timer = setInterval(tick, POLL_INTERVAL_MS)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [id, active])

  return { conversion, gone, setConversion }
}
