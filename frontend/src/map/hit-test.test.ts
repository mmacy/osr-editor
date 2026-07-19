import { expect, test } from 'vitest'

import { EDGE_HIT_FRACTION, hitTest } from '@/map/hit-test'
import { CELL_SIZE, fitView, resetView, zoomAt } from '@/map/view'

const BOUNDS = { width: 10, height: 8 }
const VIEW = resetView() // scale 1, origin at the pinned margin

function px(x: number, y: number): { x: number; y: number } {
  return { x: VIEW.offsetX + x * CELL_SIZE, y: VIEW.offsetY + y * CELL_SIZE }
}

test('a point in a cell interior resolves to the cell', () => {
  expect(hitTest(px(2.5, 3.5), BOUNDS, VIEW)).toEqual({ kind: 'cell', cell: [2, 3] })
})

test('a point near an interior border resolves to the canonical edge', () => {
  // Near the west border of (2,3): within the fraction.
  expect(hitTest(px(2 + EDGE_HIT_FRACTION / 2, 3.5), BOUNDS, VIEW)).toEqual({
    kind: 'edge',
    key: '2,3:west',
    cells: [
      [2, 3],
      [1, 3],
    ],
  })
  // Near the east border of (2,3): folds onto the neighbour's west.
  expect(hitTest(px(3 - EDGE_HIT_FRACTION / 2, 3.5), BOUNDS, VIEW)).toEqual({
    kind: 'edge',
    key: '3,3:west',
    cells: [
      [2, 3],
      [3, 3],
    ],
  })
  // Near the south border of (2,3): folds onto the neighbour's north.
  expect(hitTest(px(2.5, 4 - EDGE_HIT_FRACTION / 2), BOUNDS, VIEW)).toEqual({
    kind: 'edge',
    key: '2,4:north',
    cells: [
      [2, 3],
      [2, 4],
    ],
  })
})

test('just outside the threshold resolves to the cell', () => {
  expect(hitTest(px(2 + EDGE_HIT_FRACTION * 1.5, 3.5), BOUNDS, VIEW)).toEqual({
    kind: 'cell',
    cell: [2, 3],
  })
})

test('the level boundary is never an edge target', () => {
  // Near the north border of (2,0) — the boundary is implicitly wall; the
  // cell wins.
  expect(hitTest(px(2.5, 0.05), BOUNDS, VIEW)).toEqual({ kind: 'cell', cell: [2, 0] })
})

test('prefer cell skips edge resolution entirely', () => {
  expect(hitTest(px(2.02, 3.5), BOUNDS, VIEW, 'cell')).toEqual({ kind: 'cell', cell: [2, 3] })
})

test('outside the grid resolves to nothing', () => {
  expect(hitTest({ x: 0, y: 0 }, BOUNDS, VIEW)).toBeNull()
  expect(hitTest(px(10.5, 3), BOUNDS, VIEW)).toBeNull()
})

test('hit testing follows the view transform under zoom', () => {
  const zoomed = zoomAt(VIEW, px(0, 0), 2)
  const size = CELL_SIZE * zoomed.scale
  const point = { x: zoomed.offsetX + 2.5 * size, y: zoomed.offsetY + 3.5 * size }
  expect(hitTest(point, BOUNDS, zoomed)).toEqual({ kind: 'cell', cell: [2, 3] })
})

test('zoomAt keeps the anchor point fixed', () => {
  const anchor = px(4, 4)
  const zoomed = zoomAt(VIEW, anchor, 1.5)
  // The grid coordinate under the anchor is unchanged.
  const size = CELL_SIZE * zoomed.scale
  expect((anchor.x - zoomed.offsetX) / size).toBeCloseTo(4)
  expect((anchor.y - zoomed.offsetY) / size).toBeCloseTo(4)
})

test('fitView centers the level and never exceeds 100%', () => {
  const view = fitView(10, 8, 1000, 800)
  expect(view.scale).toBe(1)
  expect(view.offsetX).toBeCloseTo((1000 - 10 * CELL_SIZE) / 2)
  const cramped = fitView(100, 100, 500, 500)
  expect(cramped.scale).toBeLessThan(1)
})
