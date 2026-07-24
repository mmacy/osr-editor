// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import { POLL_INTERVAL_MS, useConversionPoll } from '@/hooks/use-conversion-poll'
import { api, ApiRequestError } from '@/lib/api'
import { makeConversionState } from '@/test/fixtures'

beforeEach(() => {
  vi.restoreAllMocks()
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

// Fake timers and RTL's waitFor do not mix — waitFor polls on the timers this
// test controls — so every wait here is an explicit tick inside act().
async function tick(times = 1): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * times)
  })
}

test('an idle session is never polled', async () => {
  const get = vi.spyOn(api, 'getConversion')
  renderHook(() => useConversionPoll(makeConversionState({ state: 'ready' })))
  await tick(5)
  expect(get).not.toHaveBeenCalled()
})

test('an active session polls until it lands, then stops', async () => {
  const running = makeConversionState({ state: 'running' })
  const get = vi
    .spyOn(api, 'getConversion')
    .mockResolvedValueOnce(running)
    .mockResolvedValue({ ...running, state: 'completed' })
  const settled = vi.fn()
  const { result } = renderHook(() => useConversionPoll(running, settled))

  await tick()
  expect(get).toHaveBeenCalledTimes(1)
  expect(settled).not.toHaveBeenCalled()

  await tick()
  expect(result.current.conversion?.state).toBe('completed')
  expect(settled).toHaveBeenCalledTimes(1)

  // Landed: no further requests, and the settle fires exactly once.
  const calls = get.mock.calls.length
  await tick(3)
  expect(get).toHaveBeenCalledTimes(calls)
  expect(settled).toHaveBeenCalledTimes(1)
})

test('a vanished session marks the poll gone rather than looping', async () => {
  vi.spyOn(api, 'getConversion').mockRejectedValue(
    new ApiRequestError(404, {
      code: 'unknown_conversion',
      message: 'no conversion with id',
      remedy: null,
      details: null,
    }),
  )
  const { result } = renderHook(() => useConversionPoll(makeConversionState({ state: 'running' })))
  await tick()
  expect(result.current.gone).toBe(true)
})
