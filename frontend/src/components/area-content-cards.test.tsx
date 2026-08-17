// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { useState } from 'react'
import { beforeEach, expect, test, vi } from 'vitest'

import { AreaContentCards, type CardIntent } from '@/components/area-content-cards'
import { api } from '@/lib/api'
import { emptyFeature, emptyTrap } from '@/lib/content-builders'
import { projectStore } from '@/store/project-store'
import { makeDocument, makeProjectState } from '@/test/fixtures'
import type { AreaSpec, FeatureSpec, OpBatchResult } from '@/types'

vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }),
}))

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>()
  return {
    ...actual,
    api: {
      ...actual.api,
      postOps: vi.fn(),
      getMonsterCatalog: vi.fn(() => new Promise(() => undefined)),
    },
  }
})

const postOps = vi.mocked(api.postOps)

function area(id: string): AreaSpec {
  return {
    id,
    name: '',
    description: '',
    cells: [[0, 0]],
    encounter: null,
    features: [],
    trap: null,
    treasure: null,
  }
}

// A stocked cache: one of everything only a cache can hold.
function stockedCache(overrides: Partial<FeatureSpec> = {}): FeatureSpec {
  return {
    ...emptyFeature('feature-1', null),
    kind: 'treasure_cache',
    item_ids: ['longsword'],
    magic_item_ids: ['sword_plus_1'],
    coins: { pp: 0, gp: 500, ep: 0, sp: 0, cp: 0 },
    valuables: [{ kind: 'gem', name: 'Star sapphire', value_gp: 1000, weight_coins: 1 }],
    ...overrides,
  }
}

// The feature editor's own disclosure — the features card holds many.
function expandFeature(featureId: string): HTMLElement {
  const card = screen.getByTestId(`feature-${featureId}`)
  fireEvent.click(within(card).getAllByRole('button')[0])
  return card
}

function renderCards(areaId: string, intent: CardIntent | null, overrides: Partial<AreaSpec> = {}) {
  const target = { dungeonId: 'dungeon-1', levelNumber: 1, areaId }
  const spec = { ...area(areaId), ...overrides }
  const document = makeDocument()
  document.dungeons[0].levels[0].areas = [spec]
  projectStore.getState().setProject(makeProjectState({ document }))
  return render(
    <AreaContentCards document={document} area={spec} target={target} intent={intent} />,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  projectStore.getState().clear()
  postOps.mockResolvedValue({
    revision: 'r2',
    diagnostics: { validation: [], lint: [], forge: [] },
    delta: [],
    can_undo: true,
    can_redo: false,
  } satisfies OpBatchResult)
})

test('an add intent raised on this area expands its card and commits its flow', async () => {
  renderCards('1', { areaId: '1', card: 'trap', action: 'add', token: 1 })
  await waitFor(() => expect(postOps).toHaveBeenCalledTimes(1))
  const [, , ops] = postOps.mock.calls[0]
  expect(ops).toEqual([
    expect.objectContaining({
      op: 'set_trap',
      area_id: '1',
      trap: expect.objectContaining({ kind: 'room' }),
    }),
  ])
  expect(screen.getByRole('button', { name: 'Trap' })).toHaveAttribute('aria-expanded', 'true')
})

test('a stale intent from another area never replays — the inspector remounts per area, the pin holds', async () => {
  // The intent was raised on area 1; the panel now shows area 2. Without the
  // areaId pin the freshly mounted consumer would replay the add here.
  renderCards('2', { areaId: '1', card: 'trap', action: 'add', token: 1 })
  await new Promise((resolve) => setTimeout(resolve, 20))
  expect(postOps).not.toHaveBeenCalled()
  // The trap card stays the collapsed empty add row, unexpanded.
  expect(screen.queryByRole('button', { name: 'Trap', expanded: true })).not.toBeInTheDocument()
})

test('consumption nulls the parent copy, so a same-area deselect/reselect never replays', async () => {
  // The parent contract: the editor holds the intent across inspector
  // remounts and nulls it on onIntentConsumed. Deselect (unmount) then
  // reselect the same area — the remounted consumer, guards freshly reset,
  // must receive null and commit nothing further.
  const target = { dungeonId: 'dungeon-1', levelNumber: 1, areaId: '1' }
  const spec = area('1')
  const document = makeDocument()
  document.dungeons[0].levels[0].areas = [spec]
  projectStore.getState().setProject(makeProjectState({ document }))

  function Harness() {
    // The parent survives the child's unmount, exactly like the editor
    // surviving the per-area inspector remount.
    const [intent, setIntent] = useState<CardIntent | null>({
      areaId: '1',
      card: 'features',
      action: 'add',
      token: 1,
    })
    const [show, setShow] = useState(true)
    return (
      <>
        <button type="button" onClick={() => setShow((current) => !current)}>
          toggle selection
        </button>
        {show && (
          <AreaContentCards
            document={document}
            area={spec}
            target={target}
            intent={intent}
            onIntentConsumed={() => setIntent(null)}
          />
        )}
      </>
    )
  }
  render(<Harness />)
  await waitFor(() => expect(postOps).toHaveBeenCalledTimes(1))
  fireEvent.click(screen.getByRole('button', { name: 'toggle selection' }))
  fireEvent.click(screen.getByRole('button', { name: 'toggle selection' }))
  await new Promise((resolve) => setTimeout(resolve, 20))
  expect(postOps).toHaveBeenCalledTimes(1)
})

const FEATURES_INTENT: CardIntent = { areaId: '1', card: 'features', action: 'edit', token: 1 }

test('a cache offers the contents editors — the kinds osrlib cannot open offer none', () => {
  renderCards('1', FEATURES_INTENT, { features: [stockedCache()] })
  const cache = expandFeature('feature-1')
  for (const label of ['Items', 'Magic items', 'Coins', 'Valuables', 'Treasure trap']) {
    expect(within(cache).getByText(label)).toBeInTheDocument()
  }
})

test('removing a placed magic item posts the filtered cache', async () => {
  renderCards('1', FEATURES_INTENT, { features: [stockedCache()] })
  const cache = expandFeature('feature-1')
  fireEvent.click(within(cache).getByRole('button', { name: 'Remove sword_plus_1' }))
  await waitFor(() => expect(postOps).toHaveBeenCalledTimes(1))
  const [, , ops] = postOps.mock.calls[0]
  expect(ops).toEqual([
    expect.objectContaining({
      op: 'set_feature',
      feature_id: 'feature-1',
      feature: expect.objectContaining({ magic_item_ids: [] }),
    }),
  ])
})

test('a trick hides them: contents it carries would be unreachable in play', () => {
  renderCards('1', FEATURES_INTENT, {
    features: [stockedCache({ kind: 'construction_trick' })],
  })
  const trick = expandFeature('feature-1')
  for (const label of ['Items', 'Magic items', 'Coins', 'Valuables', 'Treasure trap']) {
    expect(within(trick).queryByText(label)).not.toBeInTheDocument()
  }
})

test('the kind options read as sentence case over the unchanged enum values', () => {
  renderCards('1', FEATURES_INTENT, { features: [stockedCache()] })
  const cache = expandFeature('feature-1')
  const options = within(within(cache).getByLabelText('Kind')).getAllByRole<HTMLOptionElement>(
    'option',
  )
  expect(options.map((option) => option.textContent)).toEqual([
    'Treasure cache',
    'Construction trick',
    'Custom',
  ])
  expect(options.map((option) => option.value)).toEqual([
    'treasure_cache',
    'construction_trick',
    'custom',
  ])
})

test('leaving the cache kind clears the contents with the trap — one batch, one undo step', async () => {
  renderCards('1', FEATURES_INTENT, {
    features: [stockedCache({ trap: emptyTrap('treasure') })],
  })
  const cache = expandFeature('feature-1')
  fireEvent.change(within(cache).getByLabelText('Kind'), { target: { value: 'custom' } })
  await waitFor(() => expect(postOps).toHaveBeenCalledTimes(1))
  const [, , ops] = postOps.mock.calls[0]
  expect(ops).toEqual([
    expect.objectContaining({
      op: 'set_feature',
      feature_id: 'feature-1',
      feature: expect.objectContaining({
        kind: 'custom',
        trap: null,
        item_ids: [],
        magic_item_ids: [],
        coins: { pp: 0, gp: 0, ep: 0, sp: 0, cp: 0 },
        valuables: [],
      }),
    }),
  ])
})

test('a room trap offers both live triggers and commits a change', async () => {
  renderCards(
    '1',
    { areaId: '1', card: 'trap', action: 'edit', token: 1 },
    { trap: emptyTrap('room') },
  )
  const builder = screen.getByLabelText('Trap')
  const select = within(builder).getByLabelText('Trigger')
  // Both values are live under osrlib 1.6: enter springs on a cell of the
  // area, open on a door of the area swinging — either side.
  expect(within(select).getByRole('option', { name: 'enter' })).toBeInTheDocument()
  expect(within(select).getByRole('option', { name: 'open' })).toBeInTheDocument()
  expect(builder).toHaveTextContent('Springs when the party steps onto a cell of the area.')
  fireEvent.change(select, { target: { value: 'open' } })
  await waitFor(() => expect(postOps).toHaveBeenCalledTimes(1))
  const [, , ops] = postOps.mock.calls[0]
  expect(ops).toEqual([
    expect.objectContaining({
      op: 'set_trap',
      area_id: '1',
      trap: expect.objectContaining({ kind: 'room', trigger: 'open' }),
    }),
  ])
})

test("a cache trap shows no trigger at all — the cache's own open springs it", () => {
  renderCards('1', FEATURES_INTENT, {
    features: [stockedCache({ trap: emptyTrap('treasure') })],
  })
  const cache = expandFeature('feature-1')
  expect(within(cache).getByLabelText('Trap')).toBeInTheDocument()
  expect(within(cache).queryByText('Trigger')).not.toBeInTheDocument()
})

const TRAP_INTENT: CardIntent = { areaId: '1', card: 'trap', action: 'edit', token: 1 }

test("a door-sprung room trap's help names its springing action, with no warning", () => {
  renderCards('1', TRAP_INTENT, { trap: { ...emptyTrap('room'), trigger: 'open' } })
  const builder = screen.getByLabelText('Trap')
  expect(builder).toHaveTextContent('Springs when a door of the area is opened, from either side.')
  // The pre-1.5 dead-trigger warning is gone: no representable room-trap
  // trigger is dead, so there is nothing to warn about.
  expect(screen.queryByLabelText('Dead trigger')).not.toBeInTheDocument()
})

test('a non-cache carrying contents names them and points at the way back', () => {
  renderCards('1', FEATURES_INTENT, {
    features: [stockedCache({ kind: 'construction_trick', trap: emptyTrap('treasure') })],
  })
  const trick = expandFeature('feature-1')
  expect(within(trick).getByTestId('stranded-contents')).toHaveTextContent(
    'Carries 500 gp, 1 gem, 1 item, 1 magic item, a trap, which the party can never reach — ' +
      'only a treasure cache can be opened. Set the kind back to Treasure cache to edit or ' +
      'remove them.',
  )
})

test('an empty non-cache warns about nothing — the ordinary case', () => {
  renderCards('1', FEATURES_INTENT, {
    features: [{ ...emptyFeature('feature-1', null), kind: 'construction_trick' }],
  })
  const trick = expandFeature('feature-1')
  expect(within(trick).queryByTestId('stranded-contents')).not.toBeInTheDocument()
})

test('a stocked cache warns about nothing — its contents are exactly where they work', () => {
  renderCards('1', FEATURES_INTENT, { features: [stockedCache()] })
  const cache = expandFeature('feature-1')
  expect(within(cache).queryByTestId('stranded-contents')).not.toBeInTheDocument()
})
