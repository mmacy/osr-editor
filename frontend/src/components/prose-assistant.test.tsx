// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, expect, test, vi } from 'vitest'

import { ProseAssistant } from '@/components/prose-assistant'
import { api } from '@/lib/api'
import { resetProviderStatus } from '@/lib/provider-status'
import { makeProviderStatus } from '@/test/fixtures'
import type { AidsProseResponse } from '@/types'

beforeEach(() => {
  vi.restoreAllMocks()
  // The provider status is process-wide state; drop the cache so each test's
  // own mocked status is the one the assistant reads.
  resetProviderStatus()
})

const AREA_TARGET = {
  kind: 'area',
  dungeon_id: 'dungeon-1',
  level_number: 1,
  area_id: '1',
} as const

const AREA_DRAFT: AidsProseResponse = {
  kind: 'area',
  description: 'A low, close room.',
  usage: { input_tokens: 100, output_tokens: 40 },
  model_id: 'stub-1',
}

test('the assistant is absent when no provider is configured', async () => {
  vi.spyOn(api, 'getProvider').mockResolvedValue(makeProviderStatus({ configured: false }))
  render(<ProseAssistant projectId="p1" target={AREA_TARGET} onAcceptArea={vi.fn()} />)
  // It never renders its affordance — the surface stays empty.
  await waitFor(() => expect(api.getProvider).toHaveBeenCalled())
  expect(screen.queryByRole('button', { name: 'Draft with assistant' })).toBeNull()
})

test('draft then accept commits the description; discard commits nothing', async () => {
  vi.spyOn(api, 'getProvider').mockResolvedValue(makeProviderStatus({ configured: true }))
  const post = vi.spyOn(api, 'postAidsProse').mockResolvedValue(AREA_DRAFT)
  const onAcceptArea = vi.fn()
  render(<ProseAssistant projectId="p1" target={AREA_TARGET} onAcceptArea={onAcceptArea} />)

  fireEvent.click(await screen.findByRole('button', { name: 'Draft with assistant' }))
  await screen.findByTestId('prose-suggestion')
  expect(post).toHaveBeenCalledWith('p1', AREA_TARGET, expect.any(AbortSignal))
  expect(screen.getByText('A low, close room.')).toBeInTheDocument()
  expect(screen.getByText(/100 in · 40 out · stub-1/)).toBeInTheDocument()

  // Discard commits nothing and clears the suggestion.
  fireEvent.click(screen.getByRole('button', { name: 'Discard' }))
  expect(onAcceptArea).not.toHaveBeenCalled()
  expect(screen.queryByTestId('prose-suggestion')).toBeNull()

  // Draft again, then accept — the description commits.
  fireEvent.click(await screen.findByRole('button', { name: 'Draft with assistant' }))
  fireEvent.click(await screen.findByRole('button', { name: 'Accept' }))
  expect(onAcceptArea).toHaveBeenCalledWith('A low, close room.')
})

test('a hooks draft accepts the complete replacement list', async () => {
  vi.spyOn(api, 'getProvider').mockResolvedValue(makeProviderStatus({ configured: true }))
  const hooks = ['A rumor.', 'A debt.']
  vi.spyOn(api, 'postAidsProse').mockResolvedValue({
    kind: 'hooks',
    hooks,
    usage: { input_tokens: 50, output_tokens: 20 },
    model_id: 'stub-1',
  })
  const onAcceptHooks = vi.fn()
  render(<ProseAssistant projectId="p1" target={{ kind: 'hooks' }} onAcceptHooks={onAcceptHooks} />)
  fireEvent.click(await screen.findByRole('button', { name: 'Draft with assistant' }))
  fireEvent.click(await screen.findByRole('button', { name: 'Accept' }))
  expect(onAcceptHooks).toHaveBeenCalledWith(hooks)
})
