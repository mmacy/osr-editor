import { expect, test } from 'vitest'

import { clearLevelContentOps, contentTally, hasClearable, hasContent } from '@/lib/level-content'
import { emptyFeature, emptyTrap } from '@/lib/content-builders'
import { makeDocument } from '@/test/fixtures'
import type { AreaSpec, LevelSpec } from '@/types'

function makeArea(overrides: Partial<AreaSpec> = {}): AreaSpec {
  return {
    id: 'a1',
    name: '',
    description: '',
    cells: [[0, 0]],
    encounter: null,
    features: [],
    trap: null,
    treasure: null,
    ...overrides,
  }
}

function makeLevel(overrides: Partial<LevelSpec> = {}): LevelSpec {
  return { ...makeDocument().dungeons[0].levels[0], ...overrides }
}

const STOCKED = makeLevel({
  areas: [
    makeArea({
      id: 'a1',
      name: 'Guard post',
      description: 'Two goblins bicker over dice.',
      encounter: { monsters: [], alignment: null, aware: false, stance: null, hoard: true },
      trap: emptyTrap('room'),
      treasure: { letters: ['C'], unguarded: false },
      features: [emptyFeature('feature-1', [0, 0])],
    }),
    makeArea({ id: 'a2', description: 'A dry well.' }),
    makeArea({ id: 'a3' }),
  ],
  features: [emptyFeature('feature-2', null)],
})

test('the tally counts what a clear would remove, across areas and the level', () => {
  expect(contentTally(STOCKED)).toEqual({
    names: 1,
    descriptions: 2,
    encounters: 1,
    traps: 1,
    treasures: 1,
    features: 2,
    areas: 3,
  })
  expect(hasContent(STOCKED)).toBe(true)
  // The area count is not content: a level of blank rooms has nothing to empty.
  expect(hasContent(makeLevel({ areas: [makeArea()] }))).toBe(false)
})

test('blank rooms are clearable even though they are not content', () => {
  const blank = makeLevel({ areas: [makeArea()] })
  expect(hasContent(blank)).toBe(false)
  expect(hasClearable(blank)).toBe(true)
  // A level with neither content nor areas has nothing to offer at all.
  expect(hasClearable(makeLevel())).toBe(false)
})

test('removing the areas replaces the per-field clears rather than following them', () => {
  const ops = clearLevelContentOps(STOCKED, 'dungeon-1', 1, true)
  // One remove per area — emptying an area and then removing it would be two ops
  // saying one thing — plus the level's own feature, which no area carries.
  expect(ops.map((op) => op.op)).toEqual([
    'remove_area',
    'remove_area',
    'remove_area',
    'remove_feature',
  ])
  expect(ops[0]).toEqual({
    op: 'remove_area',
    dungeon_id: 'dungeon-1',
    level_number: 1,
    area_id: 'a1',
  })
  // Still no geometry op: removing an area unkeys its cells, and the edges that
  // draw the room are untouched.
  const geometry = ['set_edges', 'set_area_cells', 'create_area', 'set_entrance']
  expect(ops.some((op) => geometry.includes(op.op) || op.op.endsWith('transition'))).toBe(false)
})

test('removing the areas empties a level of blank rooms, which the default cannot', () => {
  const blank = makeLevel({ areas: [makeArea({ id: 'a1' }), makeArea({ id: 'a2' })] })
  expect(clearLevelContentOps(blank, 'dungeon-1', 1)).toEqual([])
  expect(clearLevelContentOps(blank, 'dungeon-1', 1, true).map((op) => op.op)).toEqual([
    'remove_area',
    'remove_area',
  ])
})

test('the batch strips content and never touches geometry', () => {
  const ops = clearLevelContentOps(STOCKED, 'dungeon-1', 1)
  // Emitted per area in document order, then the level's own features.
  expect(ops.map((op) => op.op)).toEqual([
    'set_area_field',
    'set_area_field',
    'set_encounter',
    'set_trap',
    'set_treasure',
    'remove_feature',
    'set_area_field',
    'remove_feature',
  ])
  // Nothing that would move a cell, an edge, the entrance, or a transition.
  const geometry = ['set_edges', 'set_area_cells', 'create_area', 'remove_area', 'set_entrance']
  expect(ops.some((op) => geometry.includes(op.op) || op.op.endsWith('transition'))).toBe(false)
  expect(ops[0]).toEqual({
    op: 'set_area_field',
    dungeon_id: 'dungeon-1',
    level_number: 1,
    area_id: 'a1',
    field: 'name',
    value: '',
  })
  expect(ops[6]).toMatchObject({ area_id: 'a2', field: 'description', value: '' })
  // The level's own feature is the one removal scoped to the level, not an area.
  expect(ops[7]).toEqual({
    op: 'remove_feature',
    dungeon_id: 'dungeon-1',
    level_number: 1,
    area_id: null,
    feature_id: 'feature-2',
  })
})

test('only what differs is emitted, so a re-clear is a no-op', () => {
  const partly = makeLevel({ areas: [makeArea({ id: 'a1', name: 'Vault' })] })
  expect(clearLevelContentOps(partly, 'dungeon-1', 1)).toEqual([
    {
      op: 'set_area_field',
      dungeon_id: 'dungeon-1',
      level_number: 1,
      area_id: 'a1',
      field: 'name',
      value: '',
    },
  ])
})
