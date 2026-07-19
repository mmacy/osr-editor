// The edge-key mirror: osrlib's canonical folding, the parse, and the
// edge_invalid message renderer. The mirror is convenience, not authority —
// the backend op validation is the gate, so a mirror bug is a rejected batch,
// never a corrupt document.
import type { Edge, Position } from '@/types'

export type Direction = 'north' | 'east' | 'south' | 'west'
export type CanonicalSide = 'north' | 'west'

// Folds south/east onto the neighbour's north/west exactly as osrlib's
// edge_key does: each physical edge has exactly one entry.
export function edgeKey(cell: Position, direction: Direction): string {
  const [x, y] = cell
  if (direction === 'south') return `${x},${y + 1}:north`
  if (direction === 'east') return `${x + 1},${y}:west`
  return `${x},${y}:${direction}`
}

export interface ParsedEdgeKey {
  x: number
  y: number
  side: CanonicalSide
  // The two incident cells: the key's own cell and its north/west neighbour —
  // the inline decode in osrlib's exploration.py is the reference.
  cells: [Position, Position]
}

const CANONICAL_EDGE_KEY = /^(0|[1-9][0-9]*),(0|[1-9][0-9]*):(north|west)$/

// Parses a canonical edge key; any other string — the aliases osrlib silently
// ignores — answers null.
export function parseEdgeKey(key: string): ParsedEdgeKey | null {
  const match = CANONICAL_EDGE_KEY.exec(key)
  if (!match) return null
  const x = Number(match[1])
  const y = Number(match[2])
  const side = match[3] as CanonicalSide
  const neighbour: Position = side === 'north' ? [x, y - 1] : [x - 1, y]
  return { x, y, side, cells: [[x, y], neighbour] }
}

// Forge's edge-key shape: any compass side, signed integers — the first rung
// of the edge_invalid classification.
const EDGE_KEY_SHAPE = /^(-?[0-9]+),(-?[0-9]+):(north|south|east|west)$/

// Python's repr for strings, mirrored: quote choice, backslash and control
// escapes. Exotic unicode may diverge from CPython — as may keys whose
// coordinates exceed Number.MAX_SAFE_INTEGER, where the classification below
// differs from the backend's — acceptable, because the one consumer (the
// remove-entry action) treats a render mismatch as "no match, no ops", a safe
// decline.
export function pyRepr(value: string): string {
  const quote = value.includes("'") && !value.includes('"') ? '"' : "'"
  let out = quote
  for (const ch of value) {
    if (ch === '\\' || ch === quote) out += `\\${ch}`
    else if (ch === '\n') out += '\\n'
    else if (ch === '\r') out += '\\r'
    else if (ch === '\t') out += '\\t'
    else {
      const code = ch.codePointAt(0) ?? 0
      if (code < 0x20 || code === 0x7f) out += `\\x${code.toString(16).padStart(2, '0')}`
      else out += ch
    }
  }
  return out + quote
}

// Python's tuple rendering for a cell: "(x, y)".
export function pyCell(cell: Position): string {
  return `(${cell[0]}, ${cell[1]})`
}

export interface GridBounds {
  width: number
  height: number
}

export function inBounds(cell: Position, bounds: GridBounds): boolean {
  return cell[0] >= 0 && cell[0] < bounds.width && cell[1] >= 0 && cell[1] < bounds.height
}

// Classifies one edge-map key exactly as the backend's edge_invalid lint does,
// rendering the identical message (or null for a valid key). The diagnostics
// panel's remove-entry action resolves its key by enumeration, never
// extraction: it renders every key's message with this function and acts on
// the key whose rendering equals the finding's message.
export function invalidEdgeKeyMessage(key: string, bounds: GridBounds): string | null {
  const match = EDGE_KEY_SHAPE.exec(key)
  if (!match) return `edge key ${pyRepr(key)} is malformed — expected 'x,y:side'`
  const x = Number(match[1])
  const y = Number(match[2])
  const side = match[3] as Direction
  const canonical = edgeKey([x, y], side)
  if (key !== canonical) {
    return `edge key ${pyRepr(key)} is never consulted — osrlib's canonical form is ${pyRepr(canonical)}`
  }
  const neighbour: Position = side === 'north' ? [x, y - 1] : [x - 1, y]
  for (const cell of [[x, y] as Position, neighbour]) {
    if (!inBounds(cell, bounds)) {
      return `edge key ${pyRepr(key)} references the out-of-bounds cell ${pyCell(cell)}`
    }
  }
  return null
}

// The authored edge on one side of a cell, applying osrlib's conventions: an
// absent entry is a wall, and the level boundary is implicitly wall.
export function edgeAt(
  edges: Record<string, Edge>,
  bounds: GridBounds,
  cell: Position,
  direction: Direction,
): Edge {
  const neighbour = stepCell(cell, direction)
  if (!inBounds(cell, bounds) || !inBounds(neighbour, bounds)) return { kind: 'wall', door: null }
  return edges[edgeKey(cell, direction)] ?? { kind: 'wall', door: null }
}

export function stepCell(cell: Position, direction: Direction): Position {
  const [x, y] = cell
  if (direction === 'north') return [x, y - 1]
  if (direction === 'south') return [x, y + 1]
  if (direction === 'east') return [x + 1, y]
  return [x - 1, y]
}

// The shared next-free-key rule: the smallest positive integer, as a string,
// unused as an area id — non-numeric foreign ids simply don't participate.
export function nextFreeAreaKey(areas: readonly { id: string }[]): string {
  const taken = new Set(areas.map((area) => area.id))
  let candidate = 1
  while (taken.has(String(candidate))) candidate += 1
  return String(candidate)
}
