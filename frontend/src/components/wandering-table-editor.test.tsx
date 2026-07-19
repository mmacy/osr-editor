// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, expect, test, vi } from 'vitest'

import { WanderingTableEditor } from '@/components/wandering-table-editor'
import { projectStore } from '@/store/project-store'
import { makeDocument } from '@/test/fixtures'
import type { EncounterTable, EncounterTableRow, WanderingSpec } from '@/types'

vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }),
}))

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>()
  return {
    ...actual,
    api: {
      ...actual.api,
      getMonsterCatalog: vi.fn(() => new Promise(() => undefined)),
      getEncounterTableCatalog: vi.fn(() => new Promise(() => undefined)),
    },
  }
})

function row(roll: number, monsterIds: string[]): EncounterTableRow {
  return {
    roll,
    name: `Row ${roll}`,
    entry: { kind: 'monster', monster_ids: monsterIds, variant_dice: null },
    count_dice: '1d6',
    count_fixed: null,
  }
}

function wanderingWithTable(): WanderingSpec {
  const table: EncounterTable = {
    id: 'dungeon-1-level-1-wandering',
    label: 'Level 1 wandering',
    min_level: 1,
    max_level: null,
    rows: Array.from({ length: 20 }, (_, index) => row(index + 1, ['orc'])),
    overrides_applied: [],
  }
  return { chance_in_six: 1, interval_turns: 2, table }
}

beforeEach(() => {
  projectStore.getState().clear()
})

test('the variant_dice span mismatch flags inline while typing', () => {
  render(
    <WanderingTableEditor
      document={makeDocument()}
      dungeonId="dungeon-1"
      levelNumber={1}
      wandering={wanderingWithTable()}
    />,
  )
  fireEvent.click(screen.getByTestId('wandering-row-1').querySelector('button')!)
  const variant = screen.getByLabelText('Variant dice')
  // 1d6 spans six values for a one-monster pool — the mirror flags it live.
  fireEvent.change(variant, { target: { value: '1d6' } })
  expect(screen.getByText('These dice span 6 values for 1 pool entries.')).toBeInTheDocument()
  expect(variant).toHaveAttribute('aria-invalid', 'true')
  // A multiplier is refused by the span rule itself.
  fireEvent.change(variant, { target: { value: '1d6×10' } })
  expect(
    screen.getByText('Variant dice must be plain dice with no multiplier.'),
  ).toBeInTheDocument()
  // A spanning expression clears the flag.
  fireEvent.change(variant, { target: { value: '' } })
  expect(screen.queryByText(/These dice span/)).not.toBeInTheDocument()
})
