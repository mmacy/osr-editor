// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, expect, test, vi } from 'vitest'

import { GateCard } from '@/components/gate-card'
import { api } from '@/lib/api'
import { GATE_BLOCKED_MESSAGE } from '@/lib/item-builders'
import { projectStore } from '@/store/project-store'
import { makeDocument } from '@/test/fixtures'
import type { GateSpec } from '@/types'

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>()
  return {
    ...actual,
    api: {
      ...actual.api,
      getEquipmentCatalog: vi.fn(),
      getMagicItemCatalog: vi.fn(),
    },
  }
})

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver ??= ResizeObserverStub as unknown as typeof ResizeObserver

beforeEach(() => {
  vi.clearAllMocks()
  projectStore.getState().clearBlockedOp()
  vi.mocked(api.getEquipmentCatalog).mockResolvedValue({
    items: [{ id: 'torch', name: 'Torch', item_type: 'gear', cost_gp: 1 }],
  })
  vi.mocked(api.getMagicItemCatalog).mockResolvedValue({ items: [] })
})

function emptyBlock() {
  return {
    refusal: '',
    success: '',
    fired: '',
    offer: '',
    progress: '',
    completion: '',
    journal: '',
    guidance: '',
    speaker: '',
  }
}

const KEY_GATE: GateSpec = {
  condition: { condition_type: 'has_item', item_id: 'brass-key', consumes: false },
  narrative: { ...emptyBlock(), refusal: 'The lock refuses.' },
}

function renderCard(gate: GateSpec | null, forge = false, onCommit = vi.fn()) {
  render(
    <GateCard
      gate={gate}
      document={makeDocument()}
      idPrefix="test"
      forge={forge}
      blockedAddress="dungeon:d/level:1/edge:1,1:north"
      blockedOpCode="set_edges"
      onCommit={onCommit}
    />,
  )
  return onCommit
}

test('no gate shows Add gate; adding drafts without committing', () => {
  const onCommit = renderCard(null)
  fireEvent.click(screen.getByRole('button', { name: 'Add gate' }))
  // The drafting state renders the condition builder with nothing committed —
  // a half-built gate never reaches the document.
  expect(screen.getByLabelText('Condition kind')).toBeInTheDocument()
  expect(onCommit).not.toHaveBeenCalled()
})

test('the first complete condition commits the whole gate', async () => {
  const onCommit = renderCard(null)
  fireEvent.click(screen.getByRole('button', { name: 'Add gate' }))
  fireEvent.click(screen.getByRole('button', { name: 'Pick item' }))
  fireEvent.click(await screen.findByText('Torch'))
  expect(onCommit).toHaveBeenCalledWith({
    condition: { condition_type: 'has_item', item_id: 'torch', consumes: false },
    narrative: null,
  })
})

test('a gate shows the builder, the block editor with the gate beats, and Remove gate', () => {
  renderCard(KEY_GATE)
  expect(screen.getByTestId('condition-item')).toHaveTextContent('brass-key')
  expect(screen.getByLabelText('Refusal')).toHaveValue('The lock refuses.')
  expect(screen.getByLabelText('Success')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Remove gate' })).toBeInTheDocument()
})

test('removing commits null', () => {
  const onCommit = renderCard(KEY_GATE)
  fireEvent.click(screen.getByRole('button', { name: 'Remove gate' }))
  expect(onCommit).toHaveBeenCalledWith(null)
})

test('a narrative commit preserves the condition', () => {
  const onCommit = renderCard(KEY_GATE)
  const success = screen.getByLabelText('Success')
  fireEvent.change(success, { target: { value: 'The key turns.' } })
  fireEvent.blur(success)
  expect(onCommit).toHaveBeenCalledWith({
    condition: KEY_GATE.condition,
    narrative: { ...emptyBlock(), refusal: 'The lock refuses.', success: 'The key turns.' },
  })
})

test('in forge mode Add gate routes to the blocked-op dialog client-side', () => {
  const onCommit = renderCard(null, true)
  fireEvent.click(screen.getByRole('button', { name: 'Add gate' }))
  expect(projectStore.getState().blockedOp).toEqual({
    op: 'set_edges',
    address: 'dungeon:d/level:1/edge:1,1:north',
    message: GATE_BLOCKED_MESSAGE,
  })
  expect(onCommit).not.toHaveBeenCalled()
  expect(screen.queryByLabelText('Condition kind')).not.toBeInTheDocument()
})
