// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, expect, test, vi } from 'vitest'

import { ClauseBuilder, type ClauseUpdate } from '@/components/clause-builder'
import { api } from '@/lib/api'
import { makeDocument } from '@/test/fixtures'
import type { TriggerClause } from '@/types'

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>()
  return {
    ...actual,
    api: {
      ...actual.api,
      getEquipmentCatalog: vi.fn(),
      getMagicItemCatalog: vi.fn(),
      getMonsterCatalog: vi.fn(),
    },
  }
})

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(api.getEquipmentCatalog).mockResolvedValue({ items: [] })
  vi.mocked(api.getMagicItemCatalog).mockResolvedValue({ items: [] })
  vi.mocked(api.getMonsterCatalog).mockResolvedValue({ monsters: [] })
})

const TOWN_CLAUSE: TriggerClause = { pattern: { pattern_type: 'town_entered' }, conditions: [] }

function renderBuilder(clause: TriggerClause | null) {
  const updates: ClauseUpdate[] = []
  render(
    <ClauseBuilder
      clause={clause}
      document={makeDocument()}
      idPrefix="test-clause"
      onCommit={(update) => updates.push(update)}
    />,
  )
  return updates
}

test('drafting renders the pattern builder alone — a clause commits complete or not at all', () => {
  const updates = renderBuilder(null)
  expect(screen.getByLabelText('Fires')).toBeInTheDocument()
  expect(screen.queryByLabelText('Conditions')).not.toBeInTheDocument()
  // The first complete pattern commits the whole clause with empty
  // conditions, computed over the committed value in the queue.
  fireEvent.change(screen.getByLabelText('Fires'), { target: { value: 'town_entered' } })
  expect(updates).toHaveLength(1)
  expect(updates[0](null)).toEqual(TOWN_CLAUSE)
})

test('a pattern change keeps the committed conditions', () => {
  const conditions: TriggerClause['conditions'] = [
    { condition_type: 'flag_equals', key: 'k', value: true },
  ]
  const updates = renderBuilder({ ...TOWN_CLAUSE, conditions })
  fireEvent.change(screen.getByLabelText('Fires'), { target: { value: 'town_entered' } })
  expect(updates[0]({ ...TOWN_CLAUSE, conditions })).toEqual({ ...TOWN_CLAUSE, conditions })
})

test('the condition list renders with consumes suppressed and updates ride the committed clause', () => {
  const updates = renderBuilder(TOWN_CLAUSE)
  fireEvent.click(screen.getByRole('button', { name: 'Add condition' }))
  expect(screen.getByLabelText('Condition kind')).toBeInTheDocument()
  expect(
    screen.getByText('A quest observes, it does not take', { exact: false }),
  ).toBeInTheDocument()
  // The consumes control never renders — osrlib rejects a consuming clause
  // condition at parse.
  expect(screen.queryByText('Consumes the item — a toll')).not.toBeInTheDocument()
  fireEvent.change(screen.getByLabelText('Condition kind'), { target: { value: 'flag_equals' } })
  const key = screen.getByLabelText('Flag key')
  fireEvent.change(key, { target: { value: 'lever' } })
  fireEvent.blur(key)
  const update = updates.at(-1)
  expect(update).toBeDefined()
  const next = update!(TOWN_CLAUSE)
  expect(next?.conditions).toHaveLength(1)
  expect(next?.conditions[0]).toMatchObject({ condition_type: 'flag_equals', key: 'lever' })
  // A clause that vanished under a queued gesture skips the batch.
  expect(update!(null)).toBeNull()
})
