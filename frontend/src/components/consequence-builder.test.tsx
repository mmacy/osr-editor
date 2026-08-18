// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, expect, test, vi } from 'vitest'

import { ConsequenceBuilder, SelectorControl } from '@/components/consequence-builder'
import { api } from '@/lib/api'
import { makeDocument } from '@/test/fixtures'
import type { Adventure, ConsequenceCommand } from '@/types'

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
  vi.mocked(api.getMagicItemCatalog).mockResolvedValue({ items: [] })
  vi.mocked(api.getMonsterCatalog).mockResolvedValue({
    monsters: [
      {
        id: 'orc',
        name: 'Orc',
        page: '',
        categories: [],
        hit_dice: { count: 1, die: 8, modifier: 0, asterisks: 0 },
        alignment_options: ['chaotic'],
        usual_alignment: 'chaotic',
      },
    ],
  })
})

// A small level with two door edges on one cell and one lone door elsewhere —
// the door picker's fixture. Cell size in the picker is proportional, so the
// click coordinates below map through a stubbed 300×300 content box.
function documentWithDoors(): Adventure {
  const document = makeDocument()
  document.dungeons[0].levels[0].width = 3
  document.dungeons[0].levels[0].height = 3
  document.dungeons[0].levels[0].edges = {
    '1,1:north': {
      kind: 'door',
      door: { kind: 'normal', stuck: false, locked: false, starts_open: false, requires: null },
    },
    '2,1:west': {
      kind: 'door',
      door: { kind: 'normal', stuck: false, locked: false, starts_open: false, requires: null },
    },
    '2,2:north': {
      kind: 'door',
      door: { kind: 'normal', stuck: false, locked: false, starts_open: false, requires: null },
    },
  }
  return document
}

function renderBuilder(
  command: ConsequenceCommand | null,
  onCommit = vi.fn(),
  document = makeDocument(),
) {
  render(
    <ConsequenceBuilder
      command={command}
      document={document}
      idPrefix="test"
      onCommit={onCommit}
    />,
  )
  return onCommit
}

test('the command select covers exactly the nine kinds — the closed union', () => {
  renderBuilder(null)
  const select = screen.getByLabelText('Command')
  const options = Array.from(select.querySelectorAll('option')).map((option) => option.value)
  expect(options).toEqual([
    'grant_item',
    'grant_coins',
    'award_xp',
    'set_flag',
    'spawn_monsters',
    'spawn_npc_party',
    'set_door_state',
    'place_party',
    'advance_time',
  ])
})

test('a default-complete kind commits the moment it is chosen — and never authors a source', () => {
  const onCommit = renderBuilder(null)
  fireEvent.change(screen.getByLabelText('Command'), { target: { value: 'grant_coins' } })
  expect(onCommit).toHaveBeenCalledWith({
    command_type: 'grant_coins',
    character_id: '@party',
    coins: { pp: 0, gp: 0, ep: 0, sp: 0, cp: 0 },
  })
  expect(onCommit.mock.calls[0][0]).not.toHaveProperty('source')
})

test('advance_time commits its defaults and edits per gesture', () => {
  const onCommit = vi.fn()
  renderBuilder({ command_type: 'advance_time', n: 1, unit: 'turn' }, onCommit)
  fireEvent.change(screen.getByLabelText('Unit'), { target: { value: 'day' } })
  expect(onCommit).toHaveBeenCalledWith({ command_type: 'advance_time', n: 1, unit: 'day' })
})

test('the selector offers exactly the two values — no free id path exists', () => {
  render(<SelectorControl id="selector" value="@party" onChange={vi.fn()} />)
  const select = screen.getByLabelText('Recipient')
  const options = Array.from(select.querySelectorAll('option')).map((option) => option.value)
  expect(options).toEqual(['@party', '@first'])
  expect(select.tagName).toBe('SELECT')
})

test('a foreign literal character id renders honestly and only selectors are choosable', () => {
  const onChange = vi.fn()
  render(<SelectorControl id="selector" value="c-1" onChange={onChange} />)
  expect(screen.getByText("character 'c-1' — pick a selector")).toBeInTheDocument()
  fireEvent.change(screen.getByLabelText('Recipient'), { target: { value: '@first' } })
  expect(onChange).toHaveBeenCalledWith('@first')
})

test('grant_item commits on the item pick with the party default and quantity 1', async () => {
  const onCommit = renderBuilder(null)
  fireEvent.change(screen.getByLabelText('Command'), { target: { value: 'grant_item' } })
  expect(onCommit).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: /Pick item/ }))
  fireEvent.click(await screen.findByText('Torch'))
  expect(onCommit).toHaveBeenCalledWith({
    command_type: 'grant_item',
    character_id: '@party',
    item_id: 'torch',
    quantity: 1,
  })
})

test('set_flag commits the key with a typed value defaulting to boolean true', () => {
  const onCommit = renderBuilder(null)
  fireEvent.change(screen.getByLabelText('Command'), { target: { value: 'set_flag' } })
  const key = screen.getByLabelText('Flag key')
  fireEvent.change(key, { target: { value: 'lever' } })
  fireEvent.blur(key)
  expect(onCommit).toHaveBeenCalledWith({ command_type: 'set_flag', key: 'lever', value: true })
})

test('the spawn count is exactly one of dice or fixed — the encounter-count gesture', () => {
  const onCommit = vi.fn()
  renderBuilder(
    {
      command_type: 'spawn_monsters',
      template_id: 'orc',
      count_dice: null,
      count_fixed: 1,
      distance_feet: 30,
    },
    onCommit,
  )
  const count = screen.getByLabelText('Count (dice or number)')
  fireEvent.change(count, { target: { value: '2d4' } })
  fireEvent.blur(count)
  expect(onCommit).toHaveBeenLastCalledWith({
    command_type: 'spawn_monsters',
    template_id: 'orc',
    count_dice: '2d4',
    count_fixed: null,
    distance_feet: 30,
  })
  fireEvent.change(count, { target: { value: '3' } })
  fireEvent.blur(count)
  expect(onCommit).toHaveBeenLastCalledWith({
    command_type: 'spawn_monsters',
    template_id: 'orc',
    count_dice: null,
    count_fixed: 3,
    distance_feet: 30,
  })
})

test('the door writes are three-way controls committing null, true, or false', () => {
  const onCommit = vi.fn()
  const committed: ConsequenceCommand = {
    command_type: 'set_door_state',
    dungeon_id: 'dungeon-1',
    level_number: 1,
    x: 1,
    y: 1,
    direction: 'north',
    open: true,
    wedged: null,
    discovered: null,
    unlocked: null,
  }
  renderBuilder(committed, onCommit, documentWithDoors())
  expect(screen.getByTestId('door-ref')).toHaveTextContent('(1, 1) north')
  fireEvent.change(screen.getByLabelText('wedged'), { target: { value: 'false' } })
  expect(onCommit).toHaveBeenLastCalledWith({ ...committed, wedged: false })
  fireEvent.change(screen.getByLabelText('open'), { target: { value: 'unchanged' } })
  expect(onCommit).toHaveBeenLastCalledWith({ ...committed, open: null })
})

function stubPickerBox(canvas: HTMLElement) {
  Object.defineProperty(canvas, 'clientWidth', { value: 300, configurable: true })
  Object.defineProperty(canvas, 'clientHeight', { value: 300, configurable: true })
  canvas.getBoundingClientRect = () =>
    ({
      left: 0,
      top: 0,
      right: 300,
      bottom: 300,
      width: 300,
      height: 300,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }) as DOMRect
}

test('the door picker offers doors alone and emits the canonical form', () => {
  const onCommit = renderBuilder(null, vi.fn(), documentWithDoors())
  fireEvent.change(screen.getByLabelText('Command'), { target: { value: 'set_door_state' } })
  fireEvent.change(screen.getByLabelText('Dungeon'), { target: { value: 'dungeon-1' } })
  fireEvent.change(screen.getByLabelText('Level'), { target: { value: '1' } })
  const canvas = screen.getByTestId('mini-level-picker')
  stubPickerBox(canvas)
  // Cell (0, 0) carries no door: nothing offerable, nothing committed.
  fireEvent.click(canvas, { clientX: 50, clientY: 50 })
  expect(onCommit).not.toHaveBeenCalled()
  // Cell (2, 2) touches exactly one door (its own north edge): auto-picked,
  // canonical storage-form triple, the open write seeded.
  fireEvent.click(canvas, { clientX: 250, clientY: 250 })
  expect(onCommit).toHaveBeenCalledWith({
    command_type: 'set_door_state',
    dungeon_id: 'dungeon-1',
    level_number: 1,
    x: 2,
    y: 2,
    direction: 'north',
    open: true,
    wedged: null,
    discovered: null,
    unlocked: null,
  })
})

test('a cell touching several doors disambiguates instead of guessing', () => {
  const onCommit = renderBuilder(null, vi.fn(), documentWithDoors())
  fireEvent.change(screen.getByLabelText('Command'), { target: { value: 'set_door_state' } })
  fireEvent.change(screen.getByLabelText('Dungeon'), { target: { value: 'dungeon-1' } })
  fireEvent.change(screen.getByLabelText('Level'), { target: { value: '1' } })
  const canvas = screen.getByTestId('mini-level-picker')
  stubPickerBox(canvas)
  // Cell (1, 1) touches its own north door, its south door (2,2? no — its
  // east door at 2,1:west and its south door at 1,2:north is absent): the
  // north edge and the east edge — two doors, so the row offers both.
  fireEvent.click(canvas, { clientX: 150, clientY: 150 })
  expect(onCommit).not.toHaveBeenCalled()
  const choices = screen.getByLabelText('Door choices')
  fireEvent.click(
    Array.from(choices.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('west'),
    )!,
  )
  expect(onCommit).toHaveBeenCalledWith(
    expect.objectContaining({ command_type: 'set_door_state', x: 2, y: 1, direction: 'west' }),
  )
})

test('place_party town is complete at once; the dungeon branch commits on the cell pick', () => {
  const onCommit = renderBuilder(null, vi.fn(), documentWithDoors())
  fireEvent.change(screen.getByLabelText('Command'), { target: { value: 'place_party' } })
  expect(onCommit).toHaveBeenCalledWith({
    command_type: 'place_party',
    location: { kind: 'town' },
  })
  fireEvent.click(screen.getByRole('radio', { name: 'Dungeon cell' }))
  fireEvent.change(screen.getByLabelText('Dungeon'), { target: { value: 'dungeon-1' } })
  fireEvent.change(screen.getByLabelText('Level'), { target: { value: '1' } })
  fireEvent.change(screen.getByLabelText('Facing'), { target: { value: 'south' } })
  const canvas = screen.getByTestId('mini-level-picker')
  stubPickerBox(canvas)
  fireEvent.click(canvas, { clientX: 50, clientY: 150 })
  expect(onCommit).toHaveBeenLastCalledWith({
    command_type: 'place_party',
    location: {
      kind: 'dungeon',
      dungeon_id: 'dungeon-1',
      level_number: 1,
      position: [0, 1],
      facing: 'south',
    },
  })
})

test('spawn_npc_party commits its defaults on selection with the compiled dice', () => {
  const onCommit = renderBuilder(null)
  fireEvent.change(screen.getByLabelText('Command'), { target: { value: 'spawn_npc_party' } })
  expect(onCommit).toHaveBeenCalledWith({
    command_type: 'spawn_npc_party',
    party_kind: 'basic',
    count_dice: null,
    distance_feet: 30,
  })
})

test('award_xp commits its defaults and the amount edits per gesture', () => {
  const onCommit = renderBuilder(null)
  fireEvent.change(screen.getByLabelText('Command'), { target: { value: 'award_xp' } })
  expect(onCommit).toHaveBeenCalledWith({
    command_type: 'award_xp',
    character_id: '@party',
    amount: 0,
  })
})
