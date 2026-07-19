import { expect, test } from 'vitest'

import {
  edgeKey,
  invalidEdgeKeyMessage,
  nextFreeAreaKey,
  parseEdgeKey,
  pyRepr,
} from '@/map/edge-key'

test('edgeKey folds south and east onto the neighbour exactly as osrlib does', () => {
  expect(edgeKey([2, 3], 'north')).toBe('2,3:north')
  expect(edgeKey([2, 3], 'west')).toBe('2,3:west')
  expect(edgeKey([2, 3], 'south')).toBe('2,4:north')
  expect(edgeKey([2, 3], 'east')).toBe('3,3:west')
})

test('parseEdgeKey answers the two incident cells', () => {
  expect(parseEdgeKey('2,3:north')).toEqual({
    x: 2,
    y: 3,
    side: 'north',
    cells: [
      [2, 3],
      [2, 2],
    ],
  })
  expect(parseEdgeKey('2,3:west')?.cells).toEqual([
    [2, 3],
    [1, 3],
  ])
})

test.each(['2,3:south', '2,3:east', '02,3:north', '-1,3:north', 'bogus', '2,3'])(
  'parseEdgeKey refuses the non-canonical form %s',
  (key) => {
    expect(parseEdgeKey(key)).toBeNull()
  },
)

const BOUNDS = { width: 4, height: 4 }

test('invalidEdgeKeyMessage mirrors the lint classification exactly', () => {
  // These strings must equal the backend lint's messages byte for byte — the
  // remove-entry action matches on the rendering.
  expect(invalidEdgeKeyMessage('bogus', BOUNDS)).toBe(
    "edge key 'bogus' is malformed — expected 'x,y:side'",
  )
  expect(invalidEdgeKeyMessage('0,1:south', BOUNDS)).toBe(
    "edge key '0,1:south' is never consulted — osrlib's canonical form is '0,2:north'",
  )
  expect(invalidEdgeKeyMessage('0,0:north', BOUNDS)).toBe(
    "edge key '0,0:north' references the out-of-bounds cell (0, -1)",
  )
  expect(invalidEdgeKeyMessage('1,1:north', BOUNDS)).toBeNull()
  expect(invalidEdgeKeyMessage('1,0:west', BOUNDS)).toBeNull()
})

test('pyRepr mirrors CPython quote choice and escapes', () => {
  expect(pyRepr('plain')).toBe("'plain'")
  expect(pyRepr("it's")).toBe('"it\'s"')
  expect(pyRepr('both "and" \'quotes\'')).toBe("'both \"and\" \\'quotes\\''")
  expect(pyRepr('tab\there')).toBe("'tab\\there'")
  expect(pyRepr('back\\slash')).toBe("'back\\\\slash'")
})

test('nextFreeAreaKey skips taken numeric ids and ignores foreign ones', () => {
  expect(nextFreeAreaKey([])).toBe('1')
  expect(nextFreeAreaKey([{ id: '1' }, { id: '2' }])).toBe('3')
  expect(nextFreeAreaKey([{ id: '1' }, { id: '3' }])).toBe('2')
  expect(nextFreeAreaKey([{ id: 'crypt' }, { id: '1' }])).toBe('2')
})
