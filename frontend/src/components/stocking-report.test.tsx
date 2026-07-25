// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { expect, test } from 'vitest'

import { StockingReportDialog } from '@/components/stocking-report'
import type { StockRoll } from '@/types'

function roll(overrides: Partial<StockRoll>): StockRoll {
  return {
    area_id: '1',
    address: 'dungeon:d/level:1/area:1',
    contents: 'empty',
    treasure_present: false,
    summary: [],
    follow_ups: [],
    ...overrides,
  }
}

test('renders a row per roll with its summary and follow-up badges', () => {
  const rolls: StockRoll[] = [
    roll({ area_id: '1', address: 'a1', contents: 'monster', summary: ['5 × acolyte'] }),
    roll({
      area_id: '2',
      address: 'a2',
      contents: 'special',
      follow_ups: [{ kind: 'special', npc_kind: null, npc_count: null }],
    }),
    roll({
      area_id: '3',
      address: 'a3',
      contents: 'trap',
      treasure_present: true,
      summary: ['unguarded'],
      follow_ups: [{ kind: 'trap_design', npc_kind: null, npc_count: null }],
    }),
  ]
  render(<StockingReportDialog rolls={rolls} onClose={() => undefined} />)
  const report = screen.getByTestId('stocking-report')
  expect(report).toHaveTextContent('5 × acolyte')
  expect(report).toHaveTextContent('Special — describe by hand')
  expect(report).toHaveTextContent('Trap — design it in the trap card')
  // A trap room that also rolled treasure names the SRD's steer.
  expect(report).toHaveTextContent(/guard the treasure/i)
  // The undo-does-not-rewind-the-dice note rides the header.
  expect(screen.getByText(/the dice stay advanced/i)).toBeInTheDocument()
})

test('an empty sweep reads as nothing to roll', () => {
  render(<StockingReportDialog rolls={[]} onClose={() => undefined} />)
  expect(screen.getByText(/nothing to roll/i)).toBeInTheDocument()
})
