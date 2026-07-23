// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, expect, test, vi } from 'vitest'

import { BlockedOpDialog } from '@/components/blocked-op-dialog'
import { projectStore } from '@/store/project-store'
import { makeForgeState, makeProjectState } from '@/test/fixtures'

vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }),
}))

beforeEach(() => {
  projectStore.setState({
    project: makeProjectState({ type: 'forge', forge: makeForgeState() }),
    blockedOp: null,
  })
})

function raiseBlockedOp() {
  act(() =>
    projectStore.setState({
      blockedOp: {
        op: 'resize_level',
        address: 'dungeon:dungeon-1/level:1',
        message: 'level dimensions are derived state — the bounding box forge recomputes',
      },
    }),
  )
}

test('a blocked op renders in place with the gesture named and the why', () => {
  render(
    <MemoryRouter>
      <BlockedOpDialog />
    </MemoryRouter>,
  )
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  raiseBlockedOp()
  expect(screen.getByRole('dialog')).toBeInTheDocument()
  expect(screen.getByText('resize_level')).toBeInTheDocument()
  expect(screen.getByText(/derived state/)).toBeInTheDocument()
})

test('cancel dismisses without detaching', () => {
  render(
    <MemoryRouter>
      <BlockedOpDialog />
    </MemoryRouter>,
  )
  raiseBlockedOp()
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
  expect(projectStore.getState().blockedOp).toBeNull()
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
})

test('the detach choice flows into the detach dialog with the severance warning', async () => {
  render(
    <MemoryRouter>
      <BlockedOpDialog />
    </MemoryRouter>,
  )
  raiseBlockedOp()
  fireEvent.click(screen.getByRole('button', { name: 'Detach…' }))
  expect(projectStore.getState().blockedOp).toBeNull()
  await waitFor(() => {
    expect(screen.getByRole('dialog')).toHaveTextContent('Detach to a native project')
  })
  expect(screen.getByRole('dialog')).toHaveTextContent('The forge re-run loop is severed')
  // The confirm stays disabled until a destination is typed.
  expect(screen.getByRole('button', { name: 'Detach' })).toBeDisabled()
})
