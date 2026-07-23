import { expect, test } from 'vitest'

import { monsterAddress, navTargetFor } from '@/lib/address'
import { seedMonsterTemplate } from '@/lib/monster-builders'
import { makeDocument } from '@/test/fixtures'
import type { Adventure } from '@/types'

function documentWithGeometry(): Adventure {
  const document = makeDocument()
  const level = document.dungeons[0].levels[0]
  level.edges = { '1,1:north': { kind: 'open', door: null } }
  level.areas = [
    {
      id: '7',
      name: '',
      description: '',
      cells: [[2, 2]],
      encounter: null,
      features: [],
      trap: null,
      treasure: null,
    },
  ]
  return document
}

test('town resolves as before; the monsters scope lands on the Monsters section', () => {
  const document = documentWithGeometry()
  expect(navTargetFor('town', document)).toEqual({ kind: 'town' })
  expect(navTargetFor('monsters', document)).toEqual({ kind: 'monsters' })
})

test('a monster address selects its bundled template', () => {
  const document = documentWithGeometry()
  document.monsters = [seedMonsterTemplate('bespoke-1', 'Bespoke horror')]
  expect(navTargetFor('monster:bespoke-1', document)).toEqual({
    kind: 'monsters',
    templateId: 'bespoke-1',
  })
})

test('a monster address the document no longer bundles stays unnavigable', () => {
  expect(navTargetFor('monster:gone', documentWithGeometry())).toBeNull()
})

test('a percent-encoded monster id decodes before resolution', () => {
  const document = documentWithGeometry()
  document.monsters = [seedMonsterTemplate('the miller', 'The miller')]
  expect(monsterAddress('the miller')).toBe('monster:the%20miller')
  expect(navTargetFor('monster:the%20miller', document)).toEqual({
    kind: 'monsters',
    templateId: 'the miller',
  })
})

test('a dungeon-scope address lands on the first level with properties open', () => {
  expect(navTargetFor('dungeon:dungeon-1', documentWithGeometry())).toEqual({
    kind: 'level',
    dungeonId: 'dungeon-1',
    levelNumber: 1,
    focus: { type: 'properties' },
  })
})

test('a level-scope address without a geometry segment opens the level properties', () => {
  expect(navTargetFor('dungeon:dungeon-1/level:1', documentWithGeometry())).toEqual({
    kind: 'level',
    dungeonId: 'dungeon-1',
    levelNumber: 1,
    focus: { type: 'properties' },
  })
})

test('area, cell, and edge segments resolve against the document', () => {
  const document = documentWithGeometry()
  expect(navTargetFor('dungeon:dungeon-1/level:1/area:7', document)).toEqual({
    kind: 'level',
    dungeonId: 'dungeon-1',
    levelNumber: 1,
    focus: { type: 'area', areaId: '7' },
  })
  expect(navTargetFor('dungeon:dungeon-1/level:1/cell:4,5', document)).toEqual({
    kind: 'level',
    dungeonId: 'dungeon-1',
    levelNumber: 1,
    focus: { type: 'cell', cell: [4, 5] },
  })
  expect(navTargetFor('dungeon:dungeon-1/level:1/edge:1,1:north', document)).toEqual({
    kind: 'level',
    dungeonId: 'dungeon-1',
    levelNumber: 1,
    focus: { type: 'edge', key: '1,1:north' },
  })
})

test('a segment that resolves to nothing stays unnavigable', () => {
  const document = documentWithGeometry()
  // An unknown area, an out-of-bounds cell, an absent edge key.
  expect(navTargetFor('dungeon:dungeon-1/level:1/area:99', document)).toBeNull()
  expect(navTargetFor('dungeon:dungeon-1/level:1/cell:99,0', document)).toBeNull()
  expect(navTargetFor('dungeon:dungeon-1/level:1/edge:5,5:north', document)).toBeNull()
  // Unknown dungeon or level.
  expect(navTargetFor('dungeon:nope/level:1/cell:0,0', document)).toBeNull()
  expect(navTargetFor('dungeon:dungeon-1/level:9', document)).toBeNull()
})

test('percent-encoded ids decode before resolution', () => {
  const document = documentWithGeometry()
  document.dungeons[0].id = 'deep caves'
  expect(navTargetFor('dungeon:deep%20caves/level:1', document)).toMatchObject({
    kind: 'level',
    dungeonId: 'deep caves',
  })
})
