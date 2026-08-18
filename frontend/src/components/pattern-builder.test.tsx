// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, expect, test, vi } from 'vitest'

import { PatternBuilder } from '@/components/pattern-builder'
import { api } from '@/lib/api'
import { makeDocument } from '@/test/fixtures'
import type { Adventure, TriggerPattern } from '@/types'

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
  vi.mocked(api.getMonsterCatalog).mockResolvedValue({ monsters: [] })
})

function documentWithAreas(): Adventure {
  const document = makeDocument()
  document.dungeons[0].levels[0].areas = [
    {
      id: '1',
      name: 'Guard post',
      description: '',
      cells: [[0, 0]],
      features: [],
      encounter: null,
      trap: null,
      treasure: null,
    },
    {
      id: '2',
      name: '',
      description: '',
      cells: [[1, 0]],
      features: [],
      encounter: null,
      trap: null,
      treasure: null,
    },
  ]
  return document
}

function renderBuilder(pattern: TriggerPattern | null, onCommit = vi.fn()) {
  render(
    <PatternBuilder
      pattern={pattern}
      document={documentWithAreas()}
      idPrefix="test"
      onCommit={onCommit}
    />,
  )
  return onCommit
}

test('the kind select covers all seven kinds', () => {
  renderBuilder(null)
  const select = screen.getByLabelText('Fires')
  const options = Array.from(select.querySelectorAll('option')).map((option) => option.value)
  expect(options).toEqual([
    'area_entered',
    'level_entered',
    'dungeon_entered',
    'town_entered',
    'item_acquired',
    'monster_defeated',
    'flag_set',
  ])
})

test('an area pattern commits only when the whole triple is chosen', () => {
  const onCommit = renderBuilder(null)
  fireEvent.change(screen.getByLabelText('Dungeon'), { target: { value: 'dungeon-1' } })
  expect(onCommit).not.toHaveBeenCalled()
  fireEvent.change(screen.getByLabelText('Level'), { target: { value: '1' } })
  expect(onCommit).not.toHaveBeenCalled()
  fireEvent.change(screen.getByLabelText('Area'), { target: { value: '2' } })
  expect(onCommit).toHaveBeenCalledWith({
    pattern_type: 'area_entered',
    dungeon_id: 'dungeon-1',
    level_number: 1,
    area_id: '2',
  })
})

test('town_entered is complete with zero fields and commits on selection', () => {
  const onCommit = renderBuilder(null)
  fireEvent.change(screen.getByLabelText('Fires'), { target: { value: 'town_entered' } })
  expect(onCommit).toHaveBeenCalledWith({ pattern_type: 'town_entered' })
})

test('a kind switch commits nothing until the new kind holds a complete value', () => {
  const onCommit = renderBuilder({ pattern_type: 'town_entered' })
  fireEvent.change(screen.getByLabelText('Fires'), { target: { value: 'level_entered' } })
  expect(onCommit).not.toHaveBeenCalled()
  fireEvent.change(screen.getByLabelText('Dungeon'), { target: { value: 'dungeon-1' } })
  expect(onCommit).not.toHaveBeenCalled()
  fireEvent.change(screen.getByLabelText('Level'), { target: { value: '1' } })
  expect(onCommit).toHaveBeenCalledWith({
    pattern_type: 'level_entered',
    dungeon_id: 'dungeon-1',
    level_number: 1,
  })
})

test('the flag pattern’s any-value toggle is on by default — value null matches any write', () => {
  const onCommit = renderBuilder(null)
  fireEvent.change(screen.getByLabelText('Fires'), { target: { value: 'flag_set' } })
  const key = screen.getByLabelText('Flag key')
  fireEvent.change(key, { target: { value: 'lever' } })
  fireEvent.blur(key)
  expect(onCommit).toHaveBeenCalledWith({ pattern_type: 'flag_set', key: 'lever', value: null })
})

test('toggling any-value off commits a typed value, preserved end to end', () => {
  const onCommit = renderBuilder({ pattern_type: 'flag_set', key: 'lever', value: null })
  fireEvent.click(screen.getByRole('checkbox', { name: 'Any written value' }))
  expect(onCommit).toHaveBeenLastCalledWith({ pattern_type: 'flag_set', key: 'lever', value: '' })
})

test('a committed boolean flag value renders and re-commits as a boolean', () => {
  const onCommit = renderBuilder({ pattern_type: 'flag_set', key: 'lever', value: true })
  fireEvent.change(screen.getByLabelText('Value'), { target: { value: 'false' } })
  expect(onCommit).toHaveBeenLastCalledWith({
    pattern_type: 'flag_set',
    key: 'lever',
    value: false,
  })
})

test('toggling any-value back on recommits value null', () => {
  const onCommit = renderBuilder({ pattern_type: 'flag_set', key: 'lever', value: 'pulled' })
  fireEvent.click(screen.getByRole('checkbox', { name: 'Any written value' }))
  expect(onCommit).toHaveBeenLastCalledWith({ pattern_type: 'flag_set', key: 'lever', value: null })
})

test('a committed area pattern renders its triple back', () => {
  renderBuilder({
    pattern_type: 'area_entered',
    dungeon_id: 'dungeon-1',
    level_number: 1,
    area_id: '1',
  })
  expect(screen.getByLabelText('Dungeon')).toHaveValue('dungeon-1')
  expect(screen.getByLabelText('Level')).toHaveValue('1')
  expect(screen.getByLabelText('Area')).toHaveValue('1')
})
