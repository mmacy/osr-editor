// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, test, vi } from 'vitest'

import { PipelinePanel } from '@/components/pipeline-panel'
import { api, ApiRequestError } from '@/lib/api'
import { projectStore } from '@/store/project-store'
import {
  makeConversionState,
  makeForgeState,
  makeProjectState,
  makeProviderStatus,
} from '@/test/fixtures'

vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }),
}))

const noSession = new ApiRequestError(404, {
  code: 'unknown_conversion',
  message: 'no conversion for workdir',
  remedy: null,
  details: null,
})

beforeEach(() => {
  vi.restoreAllMocks()
  vi.spyOn(api, 'getProvider').mockResolvedValue(makeProviderStatus())
  vi.spyOn(api, 'findConversion').mockRejectedValue(noSession)
  projectStore.getState().setConversion(null)
})

const forgeProject = () => makeProjectState({ type: 'forge', forge: makeForgeState() })

describe('PipelinePanel', () => {
  test('renders per-stage status, usage, and provider identity from run.json', () => {
    render(<PipelinePanel project={forgeProject()} />)
    expect(screen.getByTestId('stage-row-survey')).toBeInTheDocument()
    expect(screen.getByText('1,200 in / 300 out')).toBeInTheDocument()
    expect(screen.getByText('FixtureProvider')).toBeInTheDocument()
    expect(screen.getByText('fixture-model-1')).toBeInTheDocument()
  })

  test('the check control shows the stale hint until a check runs', () => {
    const { rerender } = render(
      <PipelinePanel
        project={makeProjectState({
          type: 'forge',
          forge: makeForgeState({ checked: false }),
        })}
      />,
    )
    expect(screen.getByTestId('check-state')).toHaveTextContent('not run since the last change')
    rerender(
      <PipelinePanel
        project={makeProjectState({ type: 'forge', forge: makeForgeState({ checked: true }) })}
      />,
    )
    expect(screen.getByTestId('check-state')).toHaveTextContent('findings current')
  })

  test('renders nothing for a native project', () => {
    const { container } = render(<PipelinePanel project={makeProjectState()} />)
    expect(container).toBeEmptyDOMElement()
  })

  test('assemble keeps the synchronous route; no session is ever created for it', async () => {
    const create = vi.spyOn(api, 'createWorkdirConversion')
    const rerun = vi.spyOn(api, 'postForgeRerun').mockResolvedValue({
      revision: 'r2',
      delta: [],
      diagnostics: { validation: [], lint: [], forge: [] },
      can_undo: true,
      can_redo: false,
      forge: makeForgeState(),
      sidecar: makeProjectState().sidecar,
    })
    const project = forgeProject()
    projectStore.getState().setProject(project)
    render(<PipelinePanel project={project} />)
    fireEvent.click(screen.getByRole('button', { name: 'Rerun assemble' }))
    await waitFor(() => expect(rerun).toHaveBeenCalled())
    expect(create).not.toHaveBeenCalled()
  })

  test('a model stage creates a bound session, runs it, and shows the busy state', async () => {
    const session = makeConversionState({ kind: 'workdir', state: 'ready', project_id: 'abc123' })
    vi.spyOn(api, 'createWorkdirConversion').mockResolvedValue(session)
    const run = vi.spyOn(api, 'runConversion').mockResolvedValue({ ...session, state: 'running' })
    render(<PipelinePanel project={forgeProject()} />)

    fireEvent.change(screen.getByLabelText('Stage'), { target: { value: 'monsters' } })
    expect(screen.getByTestId('rerun-consequences')).toHaveTextContent('model stages monsters')
    expect(screen.getByTestId('rerun-consequences')).toHaveTextContent('undo history survives')

    fireEvent.click(screen.getByRole('button', { name: 'Rerun monsters' }))
    await waitFor(() => expect(screen.getByTestId('pipeline-busy')).toBeInTheDocument())
    expect(run).toHaveBeenCalledWith(session.id, 'monsters', {})
    // Commits are paused while it runs.
    expect(screen.getByRole('button', { name: 'Run check' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Detach to a native project…' })).toBeDisabled()
  })

  test('an active session on the store shows the busy state and pauses commits', () => {
    projectStore
      .getState()
      .setConversion(makeConversionState({ state: 'running', project_id: 'abc123' }))
    render(<PipelinePanel project={forgeProject()} />)
    expect(screen.getByTestId('pipeline-busy')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Run check' })).toBeDisabled()
  })

  test('a terminal session is not treated as busy, but its id is reused', async () => {
    const terminal = makeConversionState({ state: 'completed' })
    projectStore.getState().setConversion(terminal)
    const create = vi.spyOn(api, 'createWorkdirConversion')
    const run = vi.spyOn(api, 'runConversion').mockResolvedValue({ ...terminal, state: 'running' })
    render(<PipelinePanel project={forgeProject()} />)
    expect(screen.queryByTestId('pipeline-busy')).not.toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Stage'), { target: { value: 'content' } })
    fireEvent.click(screen.getByRole('button', { name: 'Rerun content' }))
    await waitFor(() => expect(run).toHaveBeenCalledWith(terminal.id, 'content', {}))
    // One workdir, one session: nothing new is minted.
    expect(create).not.toHaveBeenCalled()
  })
})
