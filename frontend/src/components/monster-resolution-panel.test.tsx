// @vitest-environment jsdom
// The monster-resolution panel's vetoed picks (chunk: forge-0.2). Every test is
// skipped until that chunk merges; the merge removes each `.skip`.
//
// The contract: osr-forge 0.2.0's stat-block veto discards a catalog pick
// whose printed Hit Dice contradict it, and the report lists each discarded
// pick in `monsters.vetoed`. A vetoed name is still unresolved or custom, so
// it already has a row. That row also shows the discarded pick as
// `vetoed: <template id>`, and the veto's detail when the report has one.
import { render, screen, within } from '@testing-library/react'
import { expect, test, vi } from 'vitest'

import { MonsterResolutionPanel } from '@/components/monster-resolution-panel'
import { makeForgeReport, makeForgeState, makeProjectState } from '@/test/fixtures'

vi.mock('@/components/monster-picker', () => ({ MonsterPicker: () => null }))

function renderPanel(
  vetoed: { name: string; vetoed_template_id: string; detail?: string | null }[],
) {
  const report = makeForgeReport()
  const forge = makeForgeState({
    report: { ...report, monsters: { ...report.monsters, vetoed } },
  })
  render(<MonsterResolutionPanel project={makeProjectState({ type: 'forge', forge })} />)
}

test.skip("a vetoed name's row shows the discarded pick and the veto's detail", () => {
  renderPanel([
    {
      name: 'rat king',
      vetoed_template_id: 'giant_rat',
      detail: 'rat king → giant_rat, printed HD 3 vs ½',
    },
  ])
  const row = within(screen.getByTestId('monster-rat king'))
  expect(row.getByText('vetoed: giant_rat')).toBeInTheDocument()
  expect(row.getByText('rat king → giant_rat, printed HD 3 vs ½')).toBeInTheDocument()
})

test.skip('a custom row shows its vetoed pick too, and a veto with no detail shows the pick alone', () => {
  renderPanel([{ name: 'mill wisp', vetoed_template_id: 'will_o_wisp', detail: null }])
  const row = within(screen.getByTestId('monster-mill wisp'))
  expect(row.getByText('vetoed: will_o_wisp')).toBeInTheDocument()
  expect(screen.getByTestId('monster-rat king')).not.toHaveTextContent('vetoed')
})
