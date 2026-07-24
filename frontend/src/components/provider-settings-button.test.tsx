// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, expect, test, vi } from 'vitest'

import { ProviderSettingsButton } from '@/components/provider-dialog'
import { api } from '@/lib/api'
import { resetProviderStatus } from '@/lib/provider-status'
import { makeProviderStatus } from '@/test/fixtures'

vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }),
}))

beforeEach(() => {
  vi.restoreAllMocks()
  resetProviderStatus()
})

// The gap this closes: the provider dialog used to be reachable only from the
// conversion surfaces, so a native project — the stocking-and-prose case — had
// no way to configure a provider and the assistant could never appear.
test('the project chrome offers provider settings whatever the project type', async () => {
  vi.spyOn(api, 'getProvider').mockResolvedValue(makeProviderStatus({ configured: false }))
  render(<ProviderSettingsButton />)
  const button = await screen.findByTestId('provider-settings-button')
  expect(button).toBeInTheDocument()
  expect(screen.getByTestId('provider-settings-state')).toHaveTextContent('off')
})

test('it reports a configured provider as ready', async () => {
  vi.spyOn(api, 'getProvider').mockResolvedValue(makeProviderStatus({ configured: true }))
  render(<ProviderSettingsButton />)
  await waitFor(() =>
    expect(screen.getByTestId('provider-settings-state')).toHaveTextContent('ready'),
  )
})

test('opening it reaches the provider fields', async () => {
  vi.spyOn(api, 'getProvider').mockResolvedValue(makeProviderStatus({ configured: false }))
  render(<ProviderSettingsButton />)
  fireEvent.click(await screen.findByTestId('provider-settings-button'))
  // The three Foundry fields the assistant needs.
  expect(await screen.findByLabelText(/endpoint/i)).toBeInTheDocument()
  expect(screen.getByLabelText(/deployment/i)).toBeInTheDocument()
  expect(screen.getByLabelText(/api key/i)).toBeInTheDocument()
})
