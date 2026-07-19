// Gesture state and op builders: pure logic the canvas component drives.
// Every completed gesture becomes one op batch through the store's builder
// form — payloads that depend on current state are computed inside the
// commit queue against the committed document, so a queued gesture can never
// resurrect state a previous commit replaced.
import type { AnyEditOp, Adventure, Edge, LevelSpec, Position, TransitionSpec } from '@/types'
import { edgeKey, nextFreeAreaKey } from '@/map/edge-key'
import type { HitTarget } from '@/map/hit-test'

export type Tool = 'select' | 'room' | 'corridor' | 'wall' | 'area' | 'entrance' | 'transition'

// null assignment = delete the entry (an absent edge is a wall).
export type EdgeAssignment = Edge | null

export type Gesture =
  | { tool: 'room'; start: Position; end: Position }
  | { tool: 'corridor'; path: Position[] }
  | { tool: 'wall'; assignment: EdgeAssignment; keys: string[] }
  | { tool: 'area'; cells: Position[] }

const NORMAL_DOOR: Edge = {
  kind: 'door',
  door: { kind: 'normal', stuck: false, locked: false, starts_open: false },
}

// The wall tool's click cycle: wall → open → door-normal → wall. A foreign
// explicit-wall entry cycles like the wall it renders as.
export function cycleAssignment(current: Edge | undefined): EdgeAssignment {
  if (current === undefined || current.kind === 'wall') return { kind: 'open', door: null }
  if (current.kind === 'open') return NORMAL_DOOR
  return null
}

export function beginGesture(tool: Tool, target: HitTarget, level: LevelSpec): Gesture | null {
  if (tool === 'room' && target.kind === 'cell') {
    return { tool: 'room', start: target.cell, end: target.cell }
  }
  if (tool === 'corridor' && target.kind === 'cell') {
    return { tool: 'corridor', path: [target.cell] }
  }
  if (tool === 'wall' && target.kind === 'edge') {
    return { tool: 'wall', assignment: cycleAssignment(level.edges[target.key]), keys: [target.key] }
  }
  if (tool === 'area' && target.kind === 'cell') {
    return { tool: 'area', cells: [target.cell] }
  }
  return null
}

export function updateGesture(gesture: Gesture, target: HitTarget): Gesture {
  if (gesture.tool === 'room' && target.kind === 'cell') {
    return { ...gesture, end: target.cell }
  }
  if (gesture.tool === 'corridor' && target.kind === 'cell') {
    return { ...gesture, path: extendPath(gesture.path, target.cell) }
  }
  if (gesture.tool === 'wall' && target.kind === 'edge' && !gesture.keys.includes(target.key)) {
    return { ...gesture, keys: [...gesture.keys, target.key] }
  }
  if (gesture.tool === 'area' && target.kind === 'cell' && !containsCell(gesture.cells, target.cell)) {
    return { ...gesture, cells: [...gesture.cells, target.cell] }
  }
  return gesture
}

function sameCell(a: Position, b: Position): boolean {
  return a[0] === b[0] && a[1] === b[1]
}

function containsCell(cells: readonly Position[], cell: Position): boolean {
  return cells.some((candidate) => sameCell(candidate, cell))
}

// Extend a drag path to a new cell. A fast pointer can skip cells, so a
// non-adjacent jump is bridged with an x-then-y walk — deterministic, and
// every consecutive pair stays orthogonally adjacent.
export function extendPath(path: Position[], cell: Position): Position[] {
  const last = path[path.length - 1]
  if (sameCell(last, cell)) return path
  const extended = [...path]
  let [x, y] = last
  while (x !== cell[0]) {
    x += Math.sign(cell[0] - x)
    extended.push([x, y])
  }
  while (y !== cell[1]) {
    y += Math.sign(cell[1] - y)
    extended.push([x, y])
  }
  return extended
}

export interface CellRect {
  x0: number
  y0: number
  x1: number
  y1: number
}

export function rectFrom(start: Position, end: Position): CellRect {
  return {
    x0: Math.min(start[0], end[0]),
    y0: Math.min(start[1], end[1]),
    x1: Math.max(start[0], end[0]),
    y1: Math.max(start[1], end[1]),
  }
}

export function rectCells(rect: CellRect): Position[] {
  const cells: Position[] = []
  for (let y = rect.y0; y <= rect.y1; y += 1) {
    for (let x = rect.x0; x <= rect.x1; x += 1) {
      cells.push([x, y])
    }
  }
  return cells
}

// Room rectangle → CreateArea (next free key) + SetEdges opening every
// interior edge, one batch.
export function roomOps(
  rect: CellRect,
  level: LevelSpec,
  dungeonId: string,
  levelNumber: number,
): AnyEditOp[] {
  const cells = rectCells(rect)
  const edges: Record<string, Edge | null> = {}
  for (const [x, y] of cells) {
    if (x > rect.x0) edges[`${x},${y}:west`] = { kind: 'open', door: null }
    if (y > rect.y0) edges[`${x},${y}:north`] = { kind: 'open', door: null }
  }
  const ops: AnyEditOp[] = [
    {
      op: 'create_area',
      dungeon_id: dungeonId,
      level_number: levelNumber,
      area_id: nextFreeAreaKey(level.areas),
      cells,
      name: '',
      description: '',
    },
  ]
  if (Object.keys(edges).length > 0) {
    ops.push({ op: 'set_edges', dungeon_id: dungeonId, level_number: levelNumber, edges })
  }
  return ops
}

// Corridor drag → SetEdges opening the edges between consecutive path cells.
export function corridorOps(path: Position[], dungeonId: string, levelNumber: number): AnyEditOp[] {
  const edges: Record<string, Edge | null> = {}
  for (let index = 1; index < path.length; index += 1) {
    const [ax, ay] = path[index - 1]
    const [bx, by] = path[index]
    const direction = bx > ax ? 'east' : bx < ax ? 'west' : by > ay ? 'south' : 'north'
    edges[edgeKey(path[index - 1], direction)] = { kind: 'open', door: null }
  }
  if (Object.keys(edges).length === 0) return []
  return [{ op: 'set_edges', dungeon_id: dungeonId, level_number: levelNumber, edges }]
}

// Edge paint → the first-clicked assignment applied along the dragged line.
// Deletes are emitted only for keys present in the committed document —
// painting wall over an already-absent edge is a no-op, never a delete the op
// would reject — which is what keeps an erase sweep across mixed edges a
// clean single batch.
export function edgePaintOps(
  keys: readonly string[],
  assignment: EdgeAssignment,
  level: LevelSpec,
  dungeonId: string,
  levelNumber: number,
): AnyEditOp[] {
  const edges: Record<string, Edge | null> = {}
  for (const key of keys) {
    if (assignment === null) {
      if (key in level.edges) edges[key] = null
    } else {
      edges[key] = assignment
    }
  }
  if (Object.keys(edges).length === 0) return []
  return [{ op: 'set_edges', dungeon_id: dungeonId, level_number: levelNumber, edges }]
}

// Area paint → SetAreaCells (union with the committed cluster) into an
// existing area, or CreateArea for a new one. A vanished target skips the
// batch (the builder-returns-no-ops rule).
export function areaPaintOps(
  cells: readonly Position[],
  areaId: string | null,
  level: LevelSpec,
  dungeonId: string,
  levelNumber: number,
): AnyEditOp[] {
  if (cells.length === 0) return []
  if (areaId === null) {
    return [
      {
        op: 'create_area',
        dungeon_id: dungeonId,
        level_number: levelNumber,
        area_id: nextFreeAreaKey(level.areas),
        cells: [...cells],
        name: '',
        description: '',
      },
    ]
  }
  const area = level.areas.find((candidate) => candidate.id === areaId)
  if (!area) return []
  const union = [...area.cells]
  for (const cell of cells) {
    if (!containsCell(union, cell)) union.push(cell)
  }
  return [
    { op: 'set_area_cells', dungeon_id: dungeonId, level_number: levelNumber, area_id: areaId, cells: union },
  ]
}

const OPPOSITE: Record<TransitionSpec['to_facing'], TransitionSpec['to_facing']> = {
  north: 'south',
  south: 'north',
  east: 'west',
  west: 'east',
}

const RECIPROCAL_KIND: Partial<Record<TransitionSpec['kind'], TransitionSpec['kind']>> = {
  stairs_down: 'stairs_up',
  stairs_up: 'stairs_down',
}

// Transition placement, with the stairs auto-reciprocal: both AddTransitions
// land in one batch when the reciprocal is wanted and feasible — the target
// level exists, the landing cell is in its bounds and unoccupied. Trapdoors
// and chutes never reciprocate (one-way by osrlib's design).
export function transitionOps(
  spec: TransitionSpec,
  dungeonId: string,
  levelNumber: number,
  reciprocal: boolean,
  document: Adventure,
): AnyEditOp[] {
  const ops: AnyEditOp[] = [
    { op: 'add_transition', dungeon_id: dungeonId, level_number: levelNumber, transition: spec },
  ]
  const inverseKind = RECIPROCAL_KIND[spec.kind]
  if (!reciprocal || !inverseKind) return ops
  const targetLevel = document.dungeons
    .find((dungeon) => dungeon.id === spec.to_dungeon_id)
    ?.levels.find((level) => level.number === spec.to_level_number)
  if (!targetLevel) return ops
  const [tx, ty] = spec.to_position
  const landingInBounds = tx >= 0 && tx < targetLevel.width && ty >= 0 && ty < targetLevel.height
  const occupied = targetLevel.transitions.some(
    (existing) => existing.position[0] === tx && existing.position[1] === ty,
  )
  if (!landingInBounds || occupied) return ops
  ops.push({
    op: 'add_transition',
    dungeon_id: spec.to_dungeon_id,
    level_number: spec.to_level_number,
    transition: {
      kind: inverseKind,
      position: spec.to_position,
      to_dungeon_id: dungeonId,
      to_level_number: levelNumber,
      to_position: spec.position,
      to_facing: OPPOSITE[spec.to_facing],
    },
  })
  return ops
}
