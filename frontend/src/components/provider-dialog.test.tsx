// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, expect, test, vi } from 'vitest'

import { ProviderDialog, ProviderStrip } from '@/components/provider-dialog'
import { api } from '@/lib/api'
import { makeProviderStatus } from '@/test/fixtures'

vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }),
}))

beforeEach(() => {
  vi.restoreAllMocks()
})

function renderDialog(status = makeProviderStatus()) {
  const onStatus = vi.fn()
  render(<ProviderDialog open onOpenChange={vi.fn()} status={status} onStatus={onStatus} />)
  return onStatus
}

test('each field shows where its value came from', () => {
  renderDialog(
    makeProviderStatus({
      endpoint: { value: 'https://env.example.invalid/', source: 'env' },
      deployment: { value: 'session-deployment', source: 'session' },
    }),
  )
  expect(screen.getByText('from environment')).toBeInTheDocument()
  expect(screen.getByText('from this session')).toBeInTheDocument()
  // The detected value is the placeholder, never the field's value — an
  // untouched field must not overwrite the environment it inherited.
  expect(screen.getByLabelText('Endpoint')).toHaveValue('')
  expect(screen.getByLabelText('Endpoint')).toHaveAttribute(
    'placeholder',
    'https://env.example.invalid/',
  )
})

test('the key input is write-only and its value is never echoed', () => {
  renderDialog(makeProviderStatus({ api_key_present: true, api_key_source: 'session' }))
  const field = screen.getByLabelText('API key')
  expect(field).toHaveAttribute('type', 'password')
  expect(field).toHaveValue('')
  expect(field).toHaveAttribute('placeholder', '••••••••')
  expect(screen.getByText('set (this session)')).toBeInTheDocument()
})

test('with no key set, the Entra hint names the extra when it is missing', () => {
  renderDialog(
    makeProviderStatus({ api_key_present: false, api_key_source: null, entra_available: false }),
  )
  expect(screen.getByTestId('entra-hint')).toHaveTextContent('osr-forge[entra] extra')
})

test('with the extra installed, the hint says Entra will be used', () => {
  renderDialog(
    makeProviderStatus({ api_key_present: false, api_key_source: null, entra_available: true }),
  )
  expect(screen.getByTestId('entra-hint')).toHaveTextContent('DefaultAzureCredential')
  expect(screen.getByTestId('entra-hint')).not.toHaveTextContent('osr-forge[entra]')
})

test('only the fields the user typed are sent', async () => {
  const set = vi.spyOn(api, 'setProvider').mockResolvedValue(makeProviderStatus())
  renderDialog()
  fireEvent.change(screen.getByLabelText('Deployment'), { target: { value: 'gpt-new' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save for this session' }))
  await waitFor(() => expect(set).toHaveBeenCalledWith({ deployment: 'gpt-new' }))
})

test('clearing a session key sends an explicit null', async () => {
  const set = vi.spyOn(api, 'setProvider').mockResolvedValue(makeProviderStatus())
  renderDialog(makeProviderStatus({ api_key_present: true, api_key_source: 'session' }))
  fireEvent.click(screen.getByRole('button', { name: 'Clear' }))
  await waitFor(() => expect(set).toHaveBeenCalledWith({ api_key: null }))
})

test('an environment key offers no clear — it is not the session to clear', () => {
  renderDialog(makeProviderStatus({ api_key_present: true, api_key_source: 'env' }))
  expect(screen.queryByRole('button', { name: 'Clear' })).not.toBeInTheDocument()
})

test('the strip reports readiness and opens the dialog', () => {
  const onOpen = vi.fn()
  const { rerender } = render(
    <ProviderStrip status={makeProviderStatus({ configured: false })} onOpen={onOpen} />,
  )
  expect(screen.getByTestId('provider-state')).toHaveTextContent('not configured')
  fireEvent.click(screen.getByRole('button', { name: 'Provider settings…' }))
  expect(onOpen).toHaveBeenCalled()

  rerender(<ProviderStrip status={makeProviderStatus({ configured: true })} onOpen={onOpen} />)
  expect(screen.getByTestId('provider-state')).toHaveTextContent('ready')
})
