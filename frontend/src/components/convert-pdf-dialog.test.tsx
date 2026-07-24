// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, expect, test, vi } from 'vitest'

import { ConvertPdfDialog, EstimateCard } from '@/components/convert-pdf-dialog'
import { api, ApiRequestError } from '@/lib/api'
import { makeConversionState, makeCostEstimate, makeProviderStatus } from '@/test/fixtures'

const navigate = vi.fn()

vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }),
}))

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
  return { ...actual, useNavigate: () => navigate }
})

beforeEach(() => {
  vi.restoreAllMocks()
  navigate.mockClear()
  vi.spyOn(api, 'getProvider').mockResolvedValue(makeProviderStatus())
})

function renderDialog() {
  render(
    <MemoryRouter>
      <ConvertPdfDialog />
    </MemoryRouter>,
  )
  fireEvent.click(screen.getByRole('button', { name: 'Convert a PDF' }))
}

function fillPdf(path = '/modules/minimod.pdf') {
  fireEvent.change(screen.getByLabelText('Module PDF'), { target: { value: path } })
}

test('the estimate card frames the cost as rough, never as a quote', () => {
  render(<EstimateCard estimate={makeCostEstimate({ page_count: 48, usd: 1.234 })} />)
  expect(screen.getByTestId('estimate-card')).toHaveTextContent(
    'Converting this 48-page module will cost roughly',
  )
  expect(screen.getByTestId('estimate-usd')).toHaveTextContent('$1.23')
  expect(screen.getByTestId('estimate-card')).toHaveTextContent('A rough estimate, not a quote')
})

test('the destination prefills from the PDF path and stays editable', () => {
  renderDialog()
  fillPdf()
  expect(screen.getByLabelText('Destination workdir')).toHaveValue('/modules/minimod.forge')
  fireEvent.change(screen.getByLabelText('Destination workdir'), {
    target: { value: '/elsewhere/mine.forge' },
  })
  expect(screen.getByLabelText('Destination workdir')).toHaveValue('/elsewhere/mine.forge')
})

test('estimate is required before convert — the gate is structural', async () => {
  const create = vi
    .spyOn(api, 'createPdfConversion')
    .mockResolvedValue(
      makeConversionState({ kind: 'pdf', state: 'estimated', estimate: makeCostEstimate() }),
    )
  renderDialog()
  expect(screen.getByRole('button', { name: 'Estimate' })).toBeDisabled()
  expect(screen.queryByRole('button', { name: 'Convert' })).not.toBeInTheDocument()

  fillPdf()
  fireEvent.click(screen.getByRole('button', { name: 'Estimate' }))
  await waitFor(() => expect(screen.getByTestId('estimate-card')).toBeInTheDocument())
  expect(create).toHaveBeenCalledWith({
    pdf_path: '/modules/minimod.pdf',
    workdir_path: '/modules/minimod.forge',
    settings: {},
    allow_existing: false,
  })
  expect(screen.getByRole('button', { name: 'Convert' })).toBeInTheDocument()
})

test('convert runs the session and lands on the conversion screen', async () => {
  const session = makeConversionState({
    kind: 'pdf',
    state: 'estimated',
    estimate: makeCostEstimate(),
  })
  vi.spyOn(api, 'createPdfConversion').mockResolvedValue(session)
  const run = vi.spyOn(api, 'runConversion').mockResolvedValue({ ...session, state: 'running' })
  renderDialog()
  fillPdf()
  fireEvent.click(screen.getByRole('button', { name: 'Estimate' }))
  await waitFor(() => expect(screen.getByRole('button', { name: 'Convert' })).toBeInTheDocument())
  fireEvent.click(screen.getByRole('button', { name: 'Convert' }))
  await waitFor(() => expect(navigate).toHaveBeenCalledWith(`/conversions/${session.id}`))
  // No stage: the server resumes from the first incomplete one, which for a
  // freshly estimated workdir is survey.
  expect(run).toHaveBeenCalledWith(session.id, null, {})
})

test('an existing workdir confirms with copy naming what the estimate itself does', async () => {
  const failure = new ApiRequestError(409, {
    code: 'conversion_destination_exists',
    message: 'already a forge workdir',
    remedy: null,
    details: { completed: false },
  })
  const create = vi.spyOn(api, 'createPdfConversion').mockRejectedValueOnce(failure)
  renderDialog()
  fillPdf()
  fireEvent.click(screen.getByRole('button', { name: 'Estimate' }))

  const confirm = await screen.findByTestId('existing-workdir-confirm')
  expect(confirm).toHaveTextContent('Estimating re-renders')
  expect(confirm).toHaveTextContent('declining afterwards cannot undo that')
  expect(confirm).not.toHaveTextContent('finished conversion')

  create.mockResolvedValueOnce(
    makeConversionState({ kind: 'pdf', state: 'estimated', estimate: makeCostEstimate() }),
  )
  fireEvent.click(screen.getByRole('button', { name: 'Supersede it' }))
  await waitFor(() => expect(screen.getByTestId('estimate-card')).toBeInTheDocument())
  expect(create).toHaveBeenLastCalledWith(expect.objectContaining({ allow_existing: true }))
})

test('a completed workdir says the model stages would be paid for again', async () => {
  vi.spyOn(api, 'createPdfConversion').mockRejectedValue(
    new ApiRequestError(409, {
      code: 'conversion_destination_exists',
      message: 'already a forge workdir',
      remedy: null,
      details: { completed: true },
    }),
  )
  renderDialog()
  fillPdf()
  fireEvent.click(screen.getByRole('button', { name: 'Estimate' }))
  const confirm = await screen.findByTestId('existing-workdir-confirm')
  expect(confirm).toHaveTextContent('finished conversion')
  expect(confirm).toHaveTextContent('paid for again')
})

test('a source rejection surfaces forges message in place', async () => {
  vi.spyOn(api, 'createPdfConversion').mockResolvedValue(
    makeConversionState({
      kind: 'pdf',
      state: 'failed',
      error: 'source is corrupt or password-protected: /modules/minimod.pdf',
    }),
  )
  renderDialog()
  fillPdf()
  fireEvent.click(screen.getByRole('button', { name: 'Estimate' }))
  const failure = await screen.findByTestId('convert-failure')
  expect(failure).toHaveTextContent('corrupt or password-protected')
  expect(screen.queryByRole('button', { name: 'Convert' })).not.toBeInTheDocument()
})

test('a busy destination routes to the live session through the lookup', async () => {
  vi.spyOn(api, 'createPdfConversion').mockRejectedValue(
    new ApiRequestError(409, {
      code: 'conversion_in_progress',
      message: 'a conversion is already running',
      remedy: null,
      details: null,
    }),
  )
  vi.spyOn(api, 'findConversion').mockResolvedValue(
    makeConversionState({ id: 'live1', state: 'estimating' }),
  )
  renderDialog()
  fillPdf()
  fireEvent.click(screen.getByRole('button', { name: 'Estimate' }))
  await waitFor(() => expect(navigate).toHaveBeenCalledWith('/conversions/live1'))
})
