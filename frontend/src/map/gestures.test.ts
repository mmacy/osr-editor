import { expect, test } from 'vitest'

import {
  areaPaintOps,
  beginGesture,
  corridorOps,
  cycleAssignment,
  edgePaintOps,
  extendPath,
  rectFrom,
  roomOps,
  transitionOps,
  updateGesture,
} from '@/map/gestures'
import { makeDocument } from '@/test/fixtures'
import type { Edge, LevelSpec, TransitionSpec } from '@/types'

const OPEN: Edge = { kind: 'open', door: null }

function makeLevel(overrides: Partial<LevelSpec> = {}): LevelSpec {
  return {
    number: 1,
    width: 10,
    height: 10,
    edges: {},
    areas: [],
    features: [],
    transitions: [],
    wandering: { chance_in_six: 1, interval_turns: 2, table: null },
    entrance: [0, 0],
    ...overrides,
  }
}

test('the wall tool cycles wall to open to door to wall', () => {
  expect(cycleAssignment(undefined)).toEqual(OPEN)
  expect(cycleAssignment({ kind: 'wall', door: null })).toEqual(OPEN)
  expect(cycleAssignment(OPEN)).toEqual({
    kind: 'door',
    door: { kind: 'normal', stuck: false, locked: false, starts_open: false },
  })
  expect(
    cycleAssignment({
      kind: 'door',
      door: { kind: 'secret', stuck: false, locked: false, starts_open: false },
    }),
  ).toBeNull()
})

test('a room rectangle creates the area and opens every interior edge in one batch', () => {
  const ops = roomOps(rectFrom([3, 2], [1, 1]), makeLevel(), 'd', 1)
  expect(ops).toHaveLength(2)
  expect(ops[0]).toEqual({
    op: 'create_area',
    dungeon_id: 'd',
    level_number: 1,
    area_id: '1',
    cells: [
      [1, 1],
      [2, 1],
      [3, 1],
      [1, 2],
      [2, 2],
      [3, 2],
    ],
    name: '',
    description: '',
  })
  expect(ops[1]).toMatchObject({ op: 'set_edges' })
  const edges = (ops[1] as { edges: Record<string, Edge | null> }).edges
  // Interior edges of a 3x2 rect: 2 vertical pairs per row x 2 rows + 3
  // horizontal pairs between rows = 7.
  expect(Object.keys(edges).sort()).toEqual([
    '1,2:north',
    '2,1:west',
    '2,2:north',
    '2,2:west',
    '3,1:west',
    '3,2:north',
    '3,2:west',
  ])
  expect(Object.values(edges).every((edge) => edge?.kind === 'open')).toBe(true)
})

test('a single-cell room opens no edges', () => {
  const ops = roomOps(rectFrom([4, 4], [4, 4]), makeLevel(), 'd', 1)
  expect(ops).toHaveLength(1)
  expect(ops[0]).toMatchObject({ op: 'create_area', cells: [[4, 4]] })
})

test('the room key is the next free integer over existing areas', () => {
  const level = makeLevel({
    areas: [
      {
        id: '1',
        name: '',
        description: '',
        cells: [[9, 9]],
        encounter: null,
        features: [],
        trap: null,
        treasure: null,
      },
      {
        id: '2',
        name: '',
        description: '',
        cells: [[8, 9]],
        encounter: null,
        features: [],
        trap: null,
        treasure: null,
      },
    ],
  })
  const ops = roomOps(rectFrom([0, 0], [0, 0]), level, 'd', 1)
  expect(ops[0]).toMatchObject({ area_id: '3' })
})

test('a corridor drag opens the edges between consecutive path cells', () => {
  const ops = corridorOps(
    [
      [1, 1],
      [2, 1],
      [2, 2],
    ],
    'd',
    1,
  )
  expect(ops).toEqual([
    {
      op: 'set_edges',
      dungeon_id: 'd',
      level_number: 1,
      edges: { '2,1:west': OPEN, '2,2:north': OPEN },
    },
  ])
  expect(corridorOps([[1, 1]], 'd', 1)).toEqual([])
})

test('extendPath bridges pointer jumps x-then-y and drops duplicates', () => {
  expect(extendPath([[1, 1]], [1, 1])).toEqual([[1, 1]])
  expect(extendPath([[1, 1]], [3, 2])).toEqual([
    [1, 1],
    [2, 1],
    [3, 1],
    [3, 2],
  ])
})

test('edge paint applies the first-clicked assignment along the line', () => {
  const level = makeLevel({ edges: { '2,1:west': OPEN } })
  const door = cycleAssignment(OPEN)
  const ops = edgePaintOps(['2,1:west', '3,1:west'], door, level, 'd', 1)
  expect(ops).toEqual([
    {
      op: 'set_edges',
      dungeon_id: 'd',
      level_number: 1,
      edges: { '2,1:west': door, '3,1:west': door },
    },
  ])
})

test('an erase sweep deletes only keys present in the committed document', () => {
  const level = makeLevel({ edges: { '2,1:west': OPEN } })
  const ops = edgePaintOps(['2,1:west', '3,1:west'], null, level, 'd', 1)
  expect(ops).toEqual([
    { op: 'set_edges', dungeon_id: 'd', level_number: 1, edges: { '2,1:west': null } },
  ])
  // Nothing to erase — no batch at all, never a delete the op would reject.
  expect(edgePaintOps(['3,1:west'], null, level, 'd', 1)).toEqual([])
})

test('area paint unions into an existing area and creates a new one otherwise', () => {
  const level = makeLevel({
    areas: [
      {
        id: '1',
        name: '',
        description: '',
        cells: [[1, 1]],
        encounter: null,
        features: [],
        trap: null,
        treasure: null,
      },
    ],
  })
  expect(
    areaPaintOps(
      [
        [1, 1],
        [2, 1],
      ],
      '1',
      level,
      'd',
      1,
    ),
  ).toEqual([
    {
      op: 'set_area_cells',
      dungeon_id: 'd',
      level_number: 1,
      area_id: '1',
      cells: [
        [1, 1],
        [2, 1],
      ],
    },
  ])
  expect(areaPaintOps([[3, 3]], null, level, 'd', 1)).toEqual([
    {
      op: 'create_area',
      dungeon_id: 'd',
      level_number: 1,
      area_id: '2',
      cells: [[3, 3]],
      name: '',
      description: '',
    },
  ])
  // A vanished target skips the batch — the builder-returns-no-ops rule.
  expect(areaPaintOps([[3, 3]], 'gone', level, 'd', 1)).toEqual([])
})

const STAIRS: TransitionSpec = {
  kind: 'stairs_down',
  position: [7, 0],
  to_dungeon_id: 'dungeon-1',
  to_level_number: 2,
  to_position: [0, 0],
  to_facing: 'south',
}

function documentWithLevelTwo() {
  const document = makeDocument()
  document.dungeons[0].levels.push({
    number: 2,
    width: 10,
    height: 10,
    edges: {},
    areas: [],
    features: [],
    transitions: [],
    wandering: { chance_in_six: 1, interval_turns: 2, table: null },
    entrance: null,
  })
  return document
}

test('stairs with auto-reciprocal land both transitions in one batch', () => {
  const ops = transitionOps(STAIRS, 'dungeon-1', 1, true, documentWithLevelTwo())
  expect(ops).toHaveLength(2)
  expect(ops[1]).toEqual({
    op: 'add_transition',
    dungeon_id: 'dungeon-1',
    level_number: 2,
    transition: {
      kind: 'stairs_up',
      position: [0, 0],
      to_dungeon_id: 'dungeon-1',
      to_level_number: 1,
      to_position: [7, 0],
      to_facing: 'north',
    },
  })
})

test('the reciprocal is skipped when infeasible and never offered for one-way drops', () => {
  // Target level missing.
  expect(transitionOps(STAIRS, 'dungeon-1', 1, true, makeDocument())).toHaveLength(1)
  // Target cell occupied.
  const document = documentWithLevelTwo()
  document.dungeons[0].levels[1].transitions.push({ ...STAIRS, position: [0, 0] })
  expect(transitionOps(STAIRS, 'dungeon-1', 1, true, document)).toHaveLength(1)
  // Chutes are one-way by osrlib's design.
  expect(
    transitionOps({ ...STAIRS, kind: 'chute' }, 'dungeon-1', 1, true, documentWithLevelTwo()),
  ).toHaveLength(1)
})

test('gesture begin and update track each tool shape', () => {
  const level = makeLevel()
  const room = beginGesture('room', { kind: 'cell', cell: [1, 1] }, level)
  expect(room).toEqual({ tool: 'room', start: [1, 1], end: [1, 1] })
  expect(updateGesture(room!, { kind: 'cell', cell: [3, 2] })).toEqual({
    tool: 'room',
    start: [1, 1],
    end: [3, 2],
  })

  const wall = beginGesture(
    'wall',
    {
      kind: 'edge',
      key: '2,1:west',
      cells: [
        [2, 1],
        [1, 1],
      ],
    },
    level,
  )
  expect(wall).toEqual({ tool: 'wall', assignment: OPEN, keys: ['2,1:west'] })
  const painted = updateGesture(wall!, {
    kind: 'edge',
    key: '3,1:west',
    cells: [
      [3, 1],
      [2, 1],
    ],
  })
  expect(painted).toMatchObject({ keys: ['2,1:west', '3,1:west'] })

  // The select tool starts no drag gesture.
  expect(beginGesture('select', { kind: 'cell', cell: [1, 1] }, level)).toBeNull()
})
