// The graph-paper renderer: a 2D canvas drawing of one level from
// (document level, view transform, selection, hover, findings, gesture).
// Cream field, fine grid, pencil-weight walls, classic glyphs — door ticks,
// "S" for secret doors, stair treads, arrows for one-way drops, the entrance
// marker, area tints with key numbers; graphite-on-slate in dark mode. All
// drawing happens in CSS px — the component scales the context for
// devicePixelRatio.
import type { AreaSpec, Finding, LevelSpec, Position } from '@/types'
import { edgeAt, parseEdgeKey, type Direction } from '@/map/edge-key'
import type { HitTarget } from '@/map/hit-test'
import type { Gesture } from '@/map/gestures'
import { areaGlyphs, isAreaStocked } from '@/map/stocking'
import { cellSizePx, gridToCanvas, type ViewTransform } from '@/map/view'

export interface MapTheme {
  paper: string
  grid: string
  wall: string
  door: string
  areaTint: string
  ink: string
  faded: string
  accent: string
  warning: string
  error: string
}

export const LIGHT_THEME: MapTheme = {
  paper: '#f8f4e7',
  grid: '#ddd6c2',
  wall: '#3d3a35',
  door: '#f8f4e7',
  areaTint: 'rgba(122, 112, 90, 0.14)',
  ink: '#4a463f',
  faded: '#8d8676',
  accent: '#2f6f8f',
  warning: '#8a7440',
  error: '#b3362b',
}

export const DARK_THEME: MapTheme = {
  paper: '#262b33',
  grid: '#39404c',
  wall: '#cdd2da',
  door: '#262b33',
  areaTint: 'rgba(205, 210, 218, 0.10)',
  ink: '#c4c9d1',
  faded: '#7d8593',
  accent: '#6db3d4',
  warning: '#c0a45e',
  error: '#d16054',
}

export type MapSelection =
  | { kind: 'cell'; cell: Position }
  | { kind: 'edge'; key: string }
  | { kind: 'area'; areaId: string }

export type MapMarker =
  | { kind: 'cell'; cell: Position; severity: 'error' | 'warning' }
  | { kind: 'area'; areaId: string; severity: 'error' | 'warning' }

export interface RenderInput {
  level: LevelSpec
  view: ViewTransform
  theme: MapTheme
  selection: MapSelection | null
  hover: HitTarget | null
  markers: readonly MapMarker[]
  gesture: Gesture | null
  // The unstocked filter: stocked areas dim — reduced-alpha tint and key
  // number; nothing hides, everything stays clickable.
  dimStocked?: boolean
}

const DIMMED_ALPHA = 0.3

// Findings addressed to the rendered level become markers; addresses that
// parse to no geometry segment render nothing here (the panel still lists
// them).
export function markersFor(
  findings: readonly Finding[],
  dungeonId: string,
  levelNumber: number,
): MapMarker[] {
  const prefix = `dungeon:${encodeURIComponent(dungeonId)}/level:${levelNumber}/`
  const markers: MapMarker[] = []
  for (const finding of findings) {
    if (!finding.address?.startsWith(prefix)) continue
    const segment = finding.address.slice(prefix.length)
    if (segment.startsWith('cell:')) {
      const [x, y] = segment.slice('cell:'.length).split(',').map(Number)
      if (Number.isInteger(x) && Number.isInteger(y)) {
        markers.push({ kind: 'cell', cell: [x, y], severity: finding.severity })
      }
    } else if (segment.startsWith('area:')) {
      try {
        markers.push({
          kind: 'area',
          areaId: decodeURIComponent(segment.slice('area:'.length)),
          severity: finding.severity,
        })
      } catch {
        // An undecodable id resolves to nothing — unnavigable, not a guess.
      }
    }
  }
  return markers
}

const DIRECTIONS: readonly Direction[] = ['north', 'east', 'south', 'west']

export function drawLevel(ctx: CanvasRenderingContext2D, input: RenderInput): void {
  const { level, view, theme } = input
  const size = cellSizePx(view)
  const origin = gridToCanvas(view, 0, 0)
  const corner = gridToCanvas(view, level.width, level.height)

  ctx.fillStyle = theme.paper
  ctx.fillRect(origin.x, origin.y, corner.x - origin.x, corner.y - origin.y)

  ctx.strokeStyle = theme.grid
  ctx.lineWidth = 1
  ctx.beginPath()
  for (let x = 0; x <= level.width; x += 1) {
    const point = gridToCanvas(view, x, 0)
    ctx.moveTo(point.x, origin.y)
    ctx.lineTo(point.x, corner.y)
  }
  for (let y = 0; y <= level.height; y += 1) {
    const point = gridToCanvas(view, 0, y)
    ctx.moveTo(origin.x, point.y)
    ctx.lineTo(corner.x, point.y)
  }
  ctx.stroke()

  for (const area of level.areas) {
    ctx.save()
    if (input.dimStocked && isAreaStocked(area)) ctx.globalAlpha = DIMMED_ALPHA
    ctx.fillStyle = theme.areaTint
    for (const cell of area.cells) {
      fillCell(ctx, view, cell)
    }
    ctx.restore()
  }

  drawGesturePreview(ctx, input)

  drawWallsAndDoors(ctx, input)

  for (const transition of level.transitions) {
    drawTransitionGlyph(ctx, view, theme, transition.kind, transition.position)
  }
  if (level.entrance) drawEntrance(ctx, view, theme, level.entrance)

  // Key numbers over the tint and walls, centered on each area's first cell:
  // filled for stocked areas, hollow for unstocked — the at-a-glance stocking
  // state — with the content glyphs beside them.
  ctx.font = `${Math.max(9, size * 0.42)}px ui-monospace, Menlo, monospace`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  for (const area of level.areas) {
    const stocked = isAreaStocked(area)
    const center = cellCenter(view, area.cells[0])
    ctx.save()
    if (input.dimStocked && stocked) ctx.globalAlpha = DIMMED_ALPHA
    if (stocked) {
      ctx.fillStyle = theme.ink
      ctx.fillText(area.id, center.x, center.y)
    } else {
      ctx.strokeStyle = theme.ink
      ctx.lineWidth = 1
      ctx.strokeText(area.id, center.x, center.y)
    }
    drawContentGlyphs(ctx, view, theme, area, center)
    ctx.restore()
  }

  for (const marker of input.markers) {
    drawMarker(ctx, input, marker)
  }
  if (input.hover) drawTargetOutline(ctx, view, input.hover, theme.faded, 2)
  if (input.selection) drawSelection(ctx, input)
}

// The content glyphs beside the key number, pencil-weight: crossed lines for
// an encounter, an open triangle for a trap (an area trap or any trapped
// cache), an open circle for treasure (an area treasure or any cache). Skipped
// below readable size.
function drawContentGlyphs(
  ctx: CanvasRenderingContext2D,
  view: ViewTransform,
  theme: MapTheme,
  area: AreaSpec,
  center: { x: number; y: number },
): void {
  const size = cellSizePx(view)
  if (size < 16) return
  const glyphs = areaGlyphs(area)
  const active: Array<(x: number, y: number, r: number) => void> = []
  if (glyphs.encounter) {
    active.push((x, y, r) => {
      ctx.beginPath()
      ctx.moveTo(x - r, y - r)
      ctx.lineTo(x + r, y + r)
      ctx.moveTo(x + r, y - r)
      ctx.lineTo(x - r, y + r)
      ctx.stroke()
    })
  }
  if (glyphs.trap) {
    active.push((x, y, r) => {
      ctx.beginPath()
      ctx.moveTo(x, y - r)
      ctx.lineTo(x + r, y + r)
      ctx.lineTo(x - r, y + r)
      ctx.closePath()
      ctx.stroke()
    })
  }
  if (glyphs.treasure) {
    active.push((x, y, r) => {
      ctx.beginPath()
      ctx.arc(x, y, r, 0, Math.PI * 2)
      ctx.stroke()
    })
  }
  if (active.length === 0) return
  ctx.save()
  ctx.strokeStyle = theme.ink
  ctx.lineWidth = 1
  const radius = size * 0.08
  const step = size * 0.22
  const baseX = center.x + size * 0.28
  const baseY = center.y - size * 0.26
  active.forEach((draw, index) => draw(baseX + index * step, baseY, radius))
  ctx.restore()
}

function fillCell(ctx: CanvasRenderingContext2D, view: ViewTransform, cell: Position): void {
  const size = cellSizePx(view)
  const point = gridToCanvas(view, cell[0], cell[1])
  ctx.fillRect(point.x, point.y, size, size)
}

function cellCenter(view: ViewTransform, cell: Position): { x: number; y: number } {
  return gridToCanvas(view, cell[0] + 0.5, cell[1] + 0.5)
}

interface Segment {
  from: { x: number; y: number }
  to: { x: number; y: number }
}

function edgeSegment(view: ViewTransform, cell: Position, direction: Direction): Segment {
  const [x, y] = cell
  switch (direction) {
    case 'north':
      return { from: gridToCanvas(view, x, y), to: gridToCanvas(view, x + 1, y) }
    case 'south':
      return { from: gridToCanvas(view, x, y + 1), to: gridToCanvas(view, x + 1, y + 1) }
    case 'west':
      return { from: gridToCanvas(view, x, y), to: gridToCanvas(view, x, y + 1) }
    case 'east':
      return { from: gridToCanvas(view, x + 1, y), to: gridToCanvas(view, x + 1, y + 1) }
  }
}

function segmentId(segment: Segment): string {
  return `${segment.from.x},${segment.from.y}-${segment.to.x},${segment.to.y}`
}

// Floor is what the map carves: area cells plus cells incident to any valid
// non-wall edge entry (osrlib's corridor definition). Walls draw only around
// floor, so the untouched grid stays blank graph paper.
function floorCells(level: LevelSpec): Set<string> {
  const floor = new Set<string>()
  for (const area of level.areas) {
    for (const cell of area.cells) floor.add(`${cell[0]},${cell[1]}`)
  }
  for (const [key, edge] of Object.entries(level.edges)) {
    if (edge.kind === 'wall') continue
    const parsed = parseEdgeKey(key)
    if (!parsed) continue
    for (const cell of parsed.cells) floor.add(`${cell[0]},${cell[1]}`)
  }
  return floor
}

function drawWallsAndDoors(ctx: CanvasRenderingContext2D, input: RenderInput): void {
  const { level, view, theme } = input
  const size = cellSizePx(view)
  const wallWidth = Math.max(2, size * 0.1)
  const floor = floorCells(level)
  const drawn = new Set<string>()
  for (const key of floor) {
    const [x, y] = key.split(',').map(Number)
    const cell: Position = [x, y]
    for (const direction of DIRECTIONS) {
      const segment = edgeSegment(view, cell, direction)
      const id = segmentId(segment)
      if (drawn.has(id)) continue
      drawn.add(id)
      const edge = edgeAt(level.edges, level, cell, direction)
      if (edge.kind === 'open') continue
      if (edge.kind === 'wall') {
        strokeSegment(ctx, segment, theme.wall, wallWidth)
        continue
      }
      // A door: wall stubs at both ends, the leaf across the gap; secret
      // doors draw as solid wall with the classic "S" in the gap.
      if (edge.door?.kind === 'secret') {
        strokeSegment(ctx, segment, theme.wall, wallWidth)
        drawSecretGlyph(ctx, segment, theme, size)
        continue
      }
      drawDoor(ctx, segment, theme, size, wallWidth)
    }
  }
}

function strokeSegment(
  ctx: CanvasRenderingContext2D,
  segment: Segment,
  color: string,
  width: number,
): void {
  ctx.strokeStyle = color
  ctx.lineWidth = width
  ctx.lineCap = 'square'
  ctx.beginPath()
  ctx.moveTo(segment.from.x, segment.from.y)
  ctx.lineTo(segment.to.x, segment.to.y)
  ctx.stroke()
}

function lerp(
  a: { x: number; y: number },
  b: { x: number; y: number },
  t: number,
): { x: number; y: number } {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }
}

function drawDoor(
  ctx: CanvasRenderingContext2D,
  segment: Segment,
  theme: MapTheme,
  size: number,
  wallWidth: number,
): void {
  const gapStart = lerp(segment.from, segment.to, 0.25)
  const gapEnd = lerp(segment.from, segment.to, 0.75)
  strokeSegment(ctx, { from: segment.from, to: gapStart }, theme.wall, wallWidth)
  strokeSegment(ctx, { from: gapEnd, to: segment.to }, theme.wall, wallWidth)
  // The door leaf: a small rectangle straddling the gap — the classic tick.
  const dx = segment.to.x - segment.from.x
  const dy = segment.to.y - segment.from.y
  const length = Math.hypot(dx, dy) || 1
  const px = (-dy / length) * size * 0.14
  const py = (dx / length) * size * 0.14
  ctx.save()
  ctx.fillStyle = theme.door
  ctx.strokeStyle = theme.wall
  ctx.lineWidth = Math.max(1, wallWidth * 0.5)
  ctx.beginPath()
  ctx.moveTo(gapStart.x + px, gapStart.y + py)
  ctx.lineTo(gapEnd.x + px, gapEnd.y + py)
  ctx.lineTo(gapEnd.x - px, gapEnd.y - py)
  ctx.lineTo(gapStart.x - px, gapStart.y - py)
  ctx.closePath()
  ctx.fill()
  ctx.stroke()
  ctx.restore()
}

function drawSecretGlyph(
  ctx: CanvasRenderingContext2D,
  segment: Segment,
  theme: MapTheme,
  size: number,
): void {
  const mid = lerp(segment.from, segment.to, 0.5)
  ctx.save()
  ctx.fillStyle = theme.paper
  const radius = size * 0.22
  ctx.beginPath()
  ctx.arc(mid.x, mid.y, radius, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = theme.ink
  ctx.font = `bold ${Math.max(8, size * 0.34)}px ui-monospace, Menlo, monospace`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText('S', mid.x, mid.y)
  ctx.restore()
}

function drawTransitionGlyph(
  ctx: CanvasRenderingContext2D,
  view: ViewTransform,
  theme: MapTheme,
  kind: 'stairs_up' | 'stairs_down' | 'trapdoor' | 'chute',
  cell: Position,
): void {
  const size = cellSizePx(view)
  const point = gridToCanvas(view, cell[0], cell[1])
  ctx.save()
  ctx.strokeStyle = theme.ink
  ctx.fillStyle = theme.ink
  ctx.lineWidth = Math.max(1, size * 0.05)
  if (kind === 'stairs_up' || kind === 'stairs_down') {
    // Stair treads: four lines, widths stepping the direction of travel.
    for (let index = 0; index < 4; index += 1) {
      const y = point.y + size * (0.25 + index * 0.17)
      const inset = kind === 'stairs_down' ? index * size * 0.08 : (3 - index) * size * 0.08
      ctx.beginPath()
      ctx.moveTo(point.x + size * 0.2 + inset, y)
      ctx.lineTo(point.x + size * 0.8 - inset, y)
      ctx.stroke()
    }
  } else if (kind === 'trapdoor') {
    ctx.strokeRect(point.x + size * 0.25, point.y + size * 0.25, size * 0.5, size * 0.5)
    drawArrow(
      ctx,
      point.x + size * 0.5,
      point.y + size * 0.35,
      point.x + size * 0.5,
      point.y + size * 0.68,
      size,
    )
  } else {
    drawArrow(
      ctx,
      point.x + size * 0.3,
      point.y + size * 0.3,
      point.x + size * 0.72,
      point.y + size * 0.72,
      size,
    )
  }
  ctx.restore()
}

function drawArrow(
  ctx: CanvasRenderingContext2D,
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  size: number,
): void {
  ctx.beginPath()
  ctx.moveTo(fromX, fromY)
  ctx.lineTo(toX, toY)
  ctx.stroke()
  const angle = Math.atan2(toY - fromY, toX - fromX)
  const head = size * 0.16
  ctx.beginPath()
  ctx.moveTo(toX, toY)
  ctx.lineTo(toX - head * Math.cos(angle - 0.5), toY - head * Math.sin(angle - 0.5))
  ctx.lineTo(toX - head * Math.cos(angle + 0.5), toY - head * Math.sin(angle + 0.5))
  ctx.closePath()
  ctx.fill()
}

function drawEntrance(
  ctx: CanvasRenderingContext2D,
  view: ViewTransform,
  theme: MapTheme,
  cell: Position,
): void {
  const size = cellSizePx(view)
  const center = cellCenter(view, cell)
  ctx.save()
  ctx.fillStyle = theme.accent
  ctx.beginPath()
  ctx.moveTo(center.x, center.y - size * 0.28)
  ctx.lineTo(center.x + size * 0.24, center.y + size * 0.2)
  ctx.lineTo(center.x - size * 0.24, center.y + size * 0.2)
  ctx.closePath()
  ctx.fill()
  ctx.restore()
}

function drawMarker(ctx: CanvasRenderingContext2D, input: RenderInput, marker: MapMarker): void {
  const { view, theme, level } = input
  const color = marker.severity === 'error' ? theme.error : theme.warning
  ctx.save()
  ctx.strokeStyle = color
  ctx.setLineDash([4, 3])
  ctx.lineWidth = 2
  if (marker.kind === 'cell') {
    strokeCell(ctx, view, marker.cell, 3)
  } else {
    const area = level.areas.find((candidate) => candidate.id === marker.areaId)
    for (const cell of area?.cells ?? []) {
      strokeCell(ctx, view, cell, 3)
    }
  }
  ctx.restore()
}

function strokeCell(
  ctx: CanvasRenderingContext2D,
  view: ViewTransform,
  cell: Position,
  inset: number,
): void {
  const size = cellSizePx(view)
  const point = gridToCanvas(view, cell[0], cell[1])
  ctx.strokeRect(point.x + inset, point.y + inset, size - 2 * inset, size - 2 * inset)
}

function drawTargetOutline(
  ctx: CanvasRenderingContext2D,
  view: ViewTransform,
  target: HitTarget,
  color: string,
  width: number,
): void {
  ctx.save()
  ctx.strokeStyle = color
  ctx.lineWidth = width
  if (target.kind === 'cell') {
    strokeCell(ctx, view, target.cell, 1)
  } else {
    const parsed = parseEdgeKey(target.key)
    if (parsed) {
      const cell: Position = [parsed.x, parsed.y]
      strokeSegment(ctx, edgeSegment(view, cell, parsed.side), color, width + 2)
    }
  }
  ctx.restore()
}

function drawSelection(ctx: CanvasRenderingContext2D, input: RenderInput): void {
  const { selection, view, theme, level } = input
  if (!selection) return
  ctx.save()
  ctx.strokeStyle = theme.accent
  ctx.lineWidth = 2
  if (selection.kind === 'cell') {
    strokeCell(ctx, view, selection.cell, 1.5)
  } else if (selection.kind === 'edge') {
    const parsed = parseEdgeKey(selection.key)
    if (parsed) {
      strokeSegment(ctx, edgeSegment(view, [parsed.x, parsed.y], parsed.side), theme.accent, 4)
    }
  } else {
    const area = level.areas.find((candidate) => candidate.id === selection.areaId)
    for (const cell of area?.cells ?? []) {
      strokeCell(ctx, view, cell, 1.5)
    }
  }
  ctx.restore()
}

function drawGesturePreview(ctx: CanvasRenderingContext2D, input: RenderInput): void {
  const { gesture, view, theme } = input
  if (!gesture) return
  ctx.save()
  ctx.fillStyle = theme.areaTint
  ctx.strokeStyle = theme.accent
  ctx.lineWidth = 1.5
  if (gesture.tool === 'room') {
    const x0 = Math.min(gesture.start[0], gesture.end[0])
    const y0 = Math.min(gesture.start[1], gesture.end[1])
    const x1 = Math.max(gesture.start[0], gesture.end[0])
    const y1 = Math.max(gesture.start[1], gesture.end[1])
    const from = gridToCanvas(view, x0, y0)
    const to = gridToCanvas(view, x1 + 1, y1 + 1)
    ctx.fillRect(from.x, from.y, to.x - from.x, to.y - from.y)
    ctx.strokeRect(from.x, from.y, to.x - from.x, to.y - from.y)
  } else if (gesture.tool === 'corridor') {
    for (const cell of gesture.path) fillCell(ctx, view, cell)
  } else if (gesture.tool === 'area') {
    for (const cell of gesture.cells) fillCell(ctx, view, cell)
  } else {
    for (const key of gesture.keys) {
      const parsed = parseEdgeKey(key)
      if (parsed) {
        strokeSegment(ctx, edgeSegment(view, [parsed.x, parsed.y], parsed.side), theme.accent, 3)
      }
    }
  }
  ctx.restore()
}

// Convenience for hover copy: the monospace cell/edge ref shown in the map
// chrome ("(3, 4)" or "3,4:north").
export function targetRef(target: HitTarget | null): string {
  if (!target) return ''
  if (target.kind === 'cell') return `(${target.cell[0]}, ${target.cell[1]})`
  return target.key
}
