// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, expect, test, vi } from 'vitest'

import { ConversionView } from '@/components/conversion-screen'
import { api } from '@/lib/api'
import {
  makeConversionState,
  makeProjectState,
  makeProviderStatus,
  makeStageRows,
} from '@/test/fixtures'

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

function renderView(overrides = {}) {
  const conversion = makeConversionState(overrides)
  render(
    <MemoryRouter>
      <ConversionView initial={conversion} />
    </MemoryRouter>,
  )
  return conversion
}

test('the stage rows render every stage in run.json order', () => {
  renderView()
  for (const stage of ['preprocess', 'survey', 'content', 'monsters', 'geometry', 'assemble']) {
    expect(screen.getByTestId(`stage-row-${stage}`)).toBeInTheDocument()
  }
  expect(screen.getByTestId('stage-row-preprocess')).toHaveTextContent('completed')
  expect(screen.getByTestId('stage-row-survey')).toHaveTextContent('pending')
})

test('the stage picker defaults to the first incomplete stage', () => {
  renderView({ stages: makeStageRows({ survey: 'completed' }) })
  expect(screen.getByLabelText('Resume from')).toHaveValue('content')
})

test('the run confirm names the model stages and says cost is not re-estimated', () => {
  renderView({ stages: makeStageRows({ survey: 'completed' }) })
  const copy = screen.getByTestId('run-confirm-copy')
  expect(copy).toHaveTextContent('runs the model stages content, monsters')
  expect(copy).toHaveTextContent('cost is not re-estimated on resume')
})

test('an assemble-only resume says it costs nothing', () => {
  renderView({
    stages: makeStageRows({ survey: 'completed', content: 'completed', monsters: 'completed' }),
  })
  expect(screen.getByLabelText('Resume from')).toHaveValue('assemble')
  expect(screen.getByTestId('run-confirm-copy')).toHaveTextContent('costs nothing')
})

test('running posts the chosen stage and the knob', async () => {
  const conversion = renderView()
  const run = vi.spyOn(api, 'runConversion').mockResolvedValue({ ...conversion, state: 'running' })
  fireEvent.change(screen.getByLabelText('Optional knob (knob=value)'), {
    target: { value: 'custom_monsters=off' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Run' }))
  await waitFor(() =>
    expect(run).toHaveBeenCalledWith(conversion.id, 'survey', { custom_monsters: 'off' }),
  )
})

test('a running session shows cancel with its boundary semantics and hides the run row', () => {
  renderView({ state: 'running' })
  expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument()
  expect(screen.getByText(/takes effect at the next stage boundary/)).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Run' })).not.toBeInTheDocument()
})

test('a failure renders forges message verbatim with the resume still offered', () => {
  renderView({
    state: 'failed',
    error: "no fixture for tag 'survey' with fingerprint abc in /fixtures",
    stages: makeStageRows({ survey: 'failed' }),
  })
  expect(screen.getByTestId('failure-card')).toHaveTextContent("no fixture for tag 'survey'")
  expect(screen.getByRole('button', { name: 'Run' })).toBeInTheDocument()
  expect(screen.getByLabelText('Resume from')).toHaveValue('survey')
})

test('a cancelled session says completed stages are kept', () => {
  renderView({ state: 'cancelled', stages: makeStageRows({ survey: 'completed' }) })
  expect(screen.getByTestId('cancelled-note')).toHaveTextContent('Every completed stage is on disk')
})

test('the previews control appears only once its caches exist, and never mid-run', () => {
  const { unmount } = render(
    <MemoryRouter>
      <ConversionView initial={makeConversionState()} />
    </MemoryRouter>,
  )
  expect(screen.queryByRole('button', { name: 'Regenerate previews' })).not.toBeInTheDocument()
  unmount()

  const withCaches = makeStageRows({ survey: 'completed', content: 'completed' })
  renderView({ stages: withCaches })
  expect(screen.getByRole('button', { name: 'Regenerate previews' })).toBeInTheDocument()
  screen.getByRole('button', { name: 'Regenerate previews' })
})

test('regenerating previews opens the first level in the preview dialog', async () => {
  const conversion = renderView({
    stages: makeStageRows({ survey: 'completed', content: 'completed' }),
  })
  vi.spyOn(api, 'regenerateConversionPreviews').mockResolvedValue({
    levels: [{ dungeon_id: 'cellar', level_number: 1 }],
  })
  fireEvent.click(screen.getByRole('button', { name: 'Regenerate previews' }))
  const image = await screen.findByAltText('Forge preview of cellar level 1')
  expect(image).toHaveAttribute('src', `/api/conversions/${conversion.id}/previews/cellar/1`)
})

test('a completed conversion offers the review queue and opens it', async () => {
  const project = makeProjectState({ id: 'p1', type: 'forge' })
  const open = vi.spyOn(api, 'openProject').mockResolvedValue(project)
  renderView({
    state: 'completed',
    workdir_path: '/projects/demo.forge',
    stages: makeStageRows({
      survey: 'completed',
      content: 'completed',
      monsters: 'completed',
      geometry: 'completed',
      assemble: 'completed',
    }),
  })
  fireEvent.click(screen.getByRole('button', { name: 'Open the review queue' }))
  await waitFor(() => expect(open).toHaveBeenCalledWith('/projects/demo.forge'))
  expect(navigate).toHaveBeenCalledWith('/projects/p1')
})
