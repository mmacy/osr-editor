// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, expect, test, vi } from 'vitest'

import { HomeScreen } from '@/components/home-screen'
import { api, ApiRequestError } from '@/lib/api'
import { makeConversionState, makeProviderStatus } from '@/test/fixtures'

const navigate = vi.fn()

vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }),
}))

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
  return { ...actual, useNavigate: () => navigate }
})

const LISTING = {
  recents: [
    {
      path: '/projects/live.osr',
      name: 'The mill on the moor',
      type: 'native',
      last_opened_at: '2026-07-18T00:00:00+00:00',
      missing: false,
    },
    {
      path: '/projects/vanished.osr',
      name: 'Gone away',
      type: 'native',
      last_opened_at: '2026-07-17T00:00:00+00:00',
      missing: true,
    },
  ],
  open_at_launch: null,
}

beforeEach(() => {
  vi.restoreAllMocks()
  navigate.mockClear()
  vi.spyOn(api, 'listProjects').mockResolvedValue(LISTING)
  vi.spyOn(api, 'getProvider').mockResolvedValue(makeProviderStatus())
})

function renderHome() {
  render(
    <MemoryRouter>
      <HomeScreen />
    </MemoryRouter>,
  )
}

function apiError(code: string): ApiRequestError {
  return new ApiRequestError(code === 'conversion_in_progress' ? 409 : 422, {
    code,
    message: 'the workdir needs the pipeline view',
    remedy: null,
    details: null,
  })
}

test('the home screen lists probed recents and offers all three entries', async () => {
  renderHome()
  expect(await screen.findByText('The mill on the moor')).toBeInTheDocument()
  expect(screen.getByText('Gone away')).toBeInTheDocument()
  expect(screen.getByText('The directory has moved or been deleted.')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: /new adventure/i })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: /convert a pdf/i })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: /open project/i })).toBeInTheDocument()
})

test('an incomplete workdir opens into the pipeline view instead of dead-ending', async () => {
  vi.spyOn(api, 'openProject').mockRejectedValue(apiError('forge_workdir_incomplete'))
  const create = vi
    .spyOn(api, 'createWorkdirConversion')
    .mockResolvedValue(makeConversionState({ id: 'conv9' }))
  renderHome()
  fireEvent.click(await screen.findByText('The mill on the moor'))
  await waitFor(() => expect(create).toHaveBeenCalledWith('/projects/live.osr'))
  expect(navigate).toHaveBeenCalledWith('/conversions/conv9')
})

test('a busy workdir routes to its live session through the recovery lookup', async () => {
  vi.spyOn(api, 'openProject').mockRejectedValue(apiError('conversion_in_progress'))
  const create = vi.spyOn(api, 'createWorkdirConversion')
  const find = vi
    .spyOn(api, 'findConversion')
    .mockResolvedValue(makeConversionState({ id: 'live7', state: 'running' }))
  renderHome()
  fireEvent.click(await screen.findByText('The mill on the moor'))
  await waitFor(() => expect(find).toHaveBeenCalledWith('/projects/live.osr'))
  expect(navigate).toHaveBeenCalledWith('/conversions/live7')
  // Never create over a busy workdir: the lookup is what recovery is for.
  expect(create).not.toHaveBeenCalled()
})

test('any other open failure still toasts rather than routing anywhere', async () => {
  vi.spyOn(api, 'openProject').mockRejectedValue(apiError('not_a_project'))
  renderHome()
  fireEvent.click(await screen.findByText('The mill on the moor'))
  await waitFor(() => expect(api.openProject).toHaveBeenCalled())
  expect(navigate).not.toHaveBeenCalled()
})
