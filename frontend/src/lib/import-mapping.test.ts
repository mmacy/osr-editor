import { expect, test } from 'vitest'

import { importOps, transitionResolves, unresolvedTransitionIndices } from '@/lib/import-mapping'
import { makeDocument } from '@/test/fixtures'
import type { Adventure, ImportedLevel, TransitionSpec } from '@/types'

const OPEN = { kind: 'open' as const, door: null }

function importedLevel(overrides: Partial<ImportedLevel> = {}): ImportedLevel {
  return {
    label: 'src level 1',
    width: 4,
    height: 3,
    edges: { '1,0:west': OPEN },
    areas: [
      {
        id: '1',
        name: 'Hall',
        description: '',
        cells: [
          [0, 0],
          [1, 0],
        ],
      },
    ],
    entrance: [0, 0],
    transitions: [],
    notes: [],
    ...overrides,
  }
}

function stairsTo(dungeonId: string, levelNumber: number, cell: [number, number]): TransitionSpec {
  return {
    kind: 'stairs_down',
    position: [1, 1],
    to_dungeon_id: dungeonId,
    to_level_number: levelNumber,
    to_position: cell,
    to_facing: 'north',
  }
}

function documentWithForeignLevel(): Adventure {
  const document = makeDocument()
  const level = document.dungeons[0].levels[0]
  level.edges = { bogus: OPEN, '2,0:west': OPEN }
  level.entrance = [0, 0]
  level.transitions = [
    stairsTo('dungeon-1', 1, [5, 5]),
    { ...stairsTo('dungeon-1', 1, [6, 6]), position: [2, 2] },
  ]
  level.areas = [
    {
      id: '9',
      name: '',
      description: '',
      cells: [[3, 3]],
      encounter: null,
      features: [],
      trap: null,
      treasure: null,
    },
  ]
  return document
}

test('new-level mode lands AddLevel first, then geometry, in the pinned order', () => {
  const ops = importOps(importedLevel(), makeDocument(), {
    dungeonId: 'dungeon-1',
    levelNumber: 2,
    mode: 'new',
    keepUnresolved: [],
  })
  expect(ops.map((op) => op.op)).toEqual(['add_level', 'set_edges', 'create_area', 'set_entrance'])
  expect(ops[0]).toMatchObject({ number: 2, width: 4, height: 3 })
  expect(ops[1]).toMatchObject({ level_number: 2, edges: { '1,0:west': OPEN } })
  expect(ops[2]).toMatchObject({ area_id: '1', name: 'Hall' })
  expect(ops[3]).toMatchObject({ entrance: [0, 0] })
})

test('replace mode clears the existing level first, in the pinned order', () => {
  const ops = importOps(importedLevel(), documentWithForeignLevel(), {
    dungeonId: 'dungeon-1',
    levelNumber: 1,
    mode: 'replace',
    keepUnresolved: [],
  })
  expect(ops.map((op) => op.op)).toEqual([
    'set_entrance', // clear
    'remove_transition',
    'remove_transition',
    'remove_area',
    'set_edges', // delete every existing key, foreign junk included
    'resize_level',
    'set_edges', // then the imported geometry
    'create_area',
    'set_entrance',
  ])
  expect(ops[0]).toMatchObject({ entrance: null })
  expect(ops[4]).toMatchObject({ edges: { bogus: null, '2,0:west': null } })
  expect(ops[5]).toMatchObject({ width: 4, height: 3 })
})

test('a source with no entrance skips both entrance ops when the target has none', () => {
  const document = makeDocument()
  document.dungeons[0].levels[0].entrance = null
  const ops = importOps(importedLevel({ entrance: null }), document, {
    dungeonId: 'dungeon-1',
    levelNumber: 1,
    mode: 'replace',
    keepUnresolved: [],
  })
  expect(ops.map((op) => op.op)).not.toContain('set_entrance')
})

test('unresolved transitions drop by default and land when kept', () => {
  const source = importedLevel({
    transitions: [stairsTo('nowhere', 9, [0, 0]), stairsTo('dungeon-1', 1, [1, 1])],
  })
  const document = makeDocument()
  const choices = { dungeonId: 'dungeon-1', levelNumber: 2 }
  expect(unresolvedTransitionIndices(source, document, choices)).toEqual([0])

  const dropped = importOps(source, document, { ...choices, mode: 'new', keepUnresolved: [] })
  expect(dropped.filter((op) => op.op === 'add_transition')).toHaveLength(1)

  const kept = importOps(source, document, { ...choices, mode: 'new', keepUnresolved: [0] })
  const transitions = kept.filter((op) => op.op === 'add_transition')
  expect(transitions).toHaveLength(2)
  // Kept ones land as authored — the dangling target becomes a validation
  // finding, exactly the editing-legal rule.
  expect(transitions[0]).toMatchObject({ transition: { to_dungeon_id: 'nowhere' } })
})

test('a transition targeting the destination level itself resolves against the imported dimensions', () => {
  const source = importedLevel({ width: 4, height: 3 })
  const document = makeDocument()
  const choices = { dungeonId: 'dungeon-1', levelNumber: 2 }
  expect(transitionResolves(stairsTo('dungeon-1', 2, [3, 2]), document, source, choices)).toBe(true)
  expect(transitionResolves(stairsTo('dungeon-1', 2, [4, 0]), document, source, choices)).toBe(
    false,
  )
  // An in-bounds target on an existing level resolves; out of its bounds does not.
  expect(transitionResolves(stairsTo('dungeon-1', 1, [29, 29]), document, source, choices)).toBe(
    true,
  )
  expect(transitionResolves(stairsTo('dungeon-1', 1, [30, 0]), document, source, choices)).toBe(
    false,
  )
})

test('replace mode against a vanished level returns no ops', () => {
  expect(
    importOps(importedLevel(), makeDocument(), {
      dungeonId: 'dungeon-1',
      levelNumber: 9,
      mode: 'replace',
      keepUnresolved: [],
    }),
  ).toEqual([])
})
