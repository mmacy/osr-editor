// The view transform: level grid coordinates (cell units) to canvas CSS
// pixels. In-memory only, per the phase 2 scope decision — an always-saved
// editor must not turn every pan into a disk write.
//
// The camera arithmetic itself is content-unit-agnostic and shared with the
// source-pages viewer (lib/pan-zoom); what lives here is the grid: the cell
// size, the level's own fit, and this surface's scale bounds.
import { zoomAbout, clampScale as clampToBounds, type PanZoom, type PointPx } from '@/lib/pan-zoom'

// The pinned cell size in CSS pixels at 100% zoom, exported so e2e coordinate
// math is deterministic after the reset-to-100% control.
export const CELL_SIZE = 24

// Where reset-to-100% puts the level's northwest corner, in canvas CSS px.
export const RESET_MARGIN = 24

export const MIN_SCALE = 0.25
export const MAX_SCALE = 4
const SCALE_BOUNDS = { min: MIN_SCALE, max: MAX_SCALE }

/** The map's camera. The shared shape, named for the surface that holds it. */
export type ViewTransform = PanZoom

export type { PointPx }

export function cellSizePx(view: ViewTransform): number {
  return CELL_SIZE * view.scale
}

// Grid coordinates (cell units, fractional allowed) to canvas CSS px.
export function gridToCanvas(view: ViewTransform, x: number, y: number): PointPx {
  return { x: view.offsetX + x * cellSizePx(view), y: view.offsetY + y * cellSizePx(view) }
}

// Canvas CSS px to fractional grid coordinates.
export function canvasToGrid(view: ViewTransform, point: PointPx): { x: number; y: number } {
  const size = cellSizePx(view)
  return { x: (point.x - view.offsetX) / size, y: (point.y - view.offsetY) / size }
}

// The reset-to-100% view: scale 1, northwest corner at the pinned margin —
// the deterministic anchor e2e coordinate math relies on.
export function resetView(): ViewTransform {
  return { scale: 1, offsetX: RESET_MARGIN, offsetY: RESET_MARGIN }
}

// Fit the level in the viewport with a margin, centered; scale is clamped so
// a tiny level never blows past 100%.
export function fitView(
  levelWidth: number,
  levelHeight: number,
  viewportWidth: number,
  viewportHeight: number,
  margin = RESET_MARGIN,
): ViewTransform {
  const usableWidth = Math.max(viewportWidth - 2 * margin, CELL_SIZE)
  const usableHeight = Math.max(viewportHeight - 2 * margin, CELL_SIZE)
  const scale = clampScale(
    Math.min(usableWidth / (levelWidth * CELL_SIZE), usableHeight / (levelHeight * CELL_SIZE), 1),
  )
  return {
    scale,
    offsetX: (viewportWidth - levelWidth * CELL_SIZE * scale) / 2,
    offsetY: (viewportHeight - levelHeight * CELL_SIZE * scale) / 2,
  }
}

export function clampScale(scale: number): number {
  return clampToBounds(scale, SCALE_BOUNDS)
}

// Zoom about a canvas point: the grid coordinate under the cursor stays under
// the cursor.
export function zoomAt(view: ViewTransform, point: PointPx, factor: number): ViewTransform {
  return zoomAbout(view, point, factor, SCALE_BOUNDS)
}
