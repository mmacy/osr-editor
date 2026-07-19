// Canvas point → cell or edge, pure geometry over the view transform. Edge
// targets win inside a pinned fraction of the cell size, and the resolved
// edge is always canonical with both incident cells in bounds — the boundary
// is implicitly wall and never a target.
import type { Position } from '@/types'
import { edgeKey, inBounds, stepCell, type Direction, type GridBounds } from '@/map/edge-key'
import { canvasToGrid, type PointPx, type ViewTransform } from '@/map/view'

// The pinned edge-hit threshold, as a fraction of the on-screen cell size —
// constant at every zoom, deterministic for tests.
export const EDGE_HIT_FRACTION = 0.2

export interface CellTarget {
  kind: 'cell'
  cell: Position
}

export interface EdgeTarget {
  kind: 'edge'
  key: string
  cells: [Position, Position]
}

export type HitTarget = CellTarget | EdgeTarget

// Resolve a canvas point. `prefer: 'cell'` skips edge resolution entirely —
// the cell tools (room, corridor, area, entrance, transition) always want the
// cell, however close to a border the click lands.
export function hitTest(
  point: PointPx,
  bounds: GridBounds,
  view: ViewTransform,
  prefer: 'edge' | 'cell' = 'edge',
): HitTarget | null {
  const { x, y } = canvasToGrid(view, point)
  if (x < 0 || y < 0 || x >= bounds.width || y >= bounds.height) return null
  const cell: Position = [Math.floor(x), Math.floor(y)]
  if (prefer === 'cell') return { kind: 'cell', cell }
  const fracX = x - cell[0]
  const fracY = y - cell[1]
  const candidates: Array<{ direction: Direction; distance: number }> = [
    { direction: 'west', distance: fracX },
    { direction: 'east', distance: 1 - fracX },
    { direction: 'north', distance: fracY },
    { direction: 'south', distance: 1 - fracY },
  ]
  candidates.sort((a, b) => a.distance - b.distance)
  for (const candidate of candidates) {
    if (candidate.distance > EDGE_HIT_FRACTION) break
    const neighbour = stepCell(cell, candidate.direction)
    // Boundary edges are implicitly wall and not authorable; fall through to
    // the next-nearest candidate rather than giving up.
    if (!inBounds(neighbour, bounds)) continue
    const key = edgeKey(cell, candidate.direction)
    const parsedCells: [Position, Position] = [cell, neighbour]
    return { kind: 'edge', key, cells: parsedCells }
  }
  return { kind: 'cell', cell }
}
