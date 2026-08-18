// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, expect, test, vi } from 'vitest'

import { ConditionBuilder } from '@/components/condition-builder'
import { api } from '@/lib/api'
import { makeDocument } from '@/test/fixtures'
import type { ConditionSpec } from '@/types'

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
  vi.mocked(api.getEquipmentCatalog).mockResolvedValue({
    items: [{ id: 'torch', name: 'Torch', item_type: 'gear', cost_gp: 1 }],
  })
  vi.mocked(api.getMagicItemCatalog).mockResolvedValue({
    items: [{ id: 'ring_of_x', name: 'Ring of X', category: 'ring', cursed: true }],
  })
})

function renderBuilder(
  condition: ConditionSpec | null,
  offerConsumes: boolean,
  onCommit = vi.fn(),
) {
  render(
    <ConditionBuilder
      condition={condition}
      document={makeDocument()}
      offerConsumes={offerConsumes}
      idPrefix="test"
      onCommit={onCommit}
    />,
  )
  return onCommit
}

const HAS_KEY: ConditionSpec = { condition_type: 'has_item', item_id: 'brass-key', consumes: false }

test('the kind select covers the three-member union and switches controls', () => {
  renderBuilder(HAS_KEY, true)
  const select = screen.getByLabelText('Condition kind')
  expect(screen.getByTestId('condition-item')).toHaveTextContent('brass-key')
  fireEvent.change(select, { target: { value: 'flag_equals' } })
  expect(screen.getByLabelText('Flag key')).toBeInTheDocument()
  fireEvent.change(select, { target: { value: 'effect_active' } })
  expect(screen.getByLabelText('Effect kind')).toBeInTheDocument()
})

test('a kind switch commits nothing until the new kind holds a complete value', () => {
  const onCommit = renderBuilder(HAS_KEY, true)
  fireEvent.change(screen.getByLabelText('Condition kind'), { target: { value: 'flag_equals' } })
  expect(onCommit).not.toHaveBeenCalled()
  const key = screen.getByLabelText('Flag key')
  fireEvent.change(key, { target: { value: 'lever' } })
  fireEvent.blur(key)
  expect(onCommit).toHaveBeenCalledWith({ condition_type: 'flag_equals', key: 'lever', value: '' })
})

test('the typed flag value preserves its type end to end — a true never becomes a 1', () => {
  const onCommit = renderBuilder(
    { condition_type: 'flag_equals', key: 'lever', value: 'pulled' },
    true,
  )
  fireEvent.change(screen.getByLabelText('Type'), { target: { value: 'boolean' } })
  expect(onCommit).toHaveBeenLastCalledWith({
    condition_type: 'flag_equals',
    key: 'lever',
    value: true,
  })
  fireEvent.change(screen.getByLabelText('Type'), { target: { value: 'number' } })
  expect(onCommit).toHaveBeenLastCalledWith({
    condition_type: 'flag_equals',
    key: 'lever',
    value: 0,
  })
})

test('a numeric draft commits a number, not its string', () => {
  const onCommit = renderBuilder({ condition_type: 'flag_equals', key: 'count', value: 2 }, true)
  const value = screen.getByLabelText('Value')
  fireEvent.change(value, { target: { value: '5' } })
  fireEvent.blur(value)
  expect(onCommit).toHaveBeenLastCalledWith({
    condition_type: 'flag_equals',
    key: 'count',
    value: 5,
  })
})

test('the consumes toggle renders only when the host offers it — the unrepresentable rule as a prop', () => {
  renderBuilder(HAS_KEY, true)
  expect(screen.getByText('Consumes the item — a toll')).toBeInTheDocument()
})

test('a clause host passing offerConsumes false never shows the control', () => {
  renderBuilder(HAS_KEY, false)
  expect(screen.queryByText('Consumes the item — a toll')).not.toBeInTheDocument()
})

test('the consumes toggle commits with the same item', () => {
  const onCommit = renderBuilder(HAS_KEY, true)
  fireEvent.click(screen.getByRole('checkbox'))
  expect(onCommit).toHaveBeenCalledWith({
    condition_type: 'has_item',
    item_id: 'brass-key',
    consumes: true,
  })
})

test('the effect kind is a free string — the open domain', () => {
  const onCommit = renderBuilder({ condition_type: 'effect_active', kind: 'fatigue' }, true)
  const kind = screen.getByLabelText('Effect kind')
  expect(kind).toHaveValue('fatigue')
  fireEvent.change(kind, { target: { value: 'blessing_of_the_millstream' } })
  fireEvent.blur(kind)
  expect(onCommit).toHaveBeenCalledWith({
    condition_type: 'effect_active',
    kind: 'blessing_of_the_millstream',
  })
})
