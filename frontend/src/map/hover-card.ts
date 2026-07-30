// The area hover card's pure logic: when the card may raise, and where it
// sits. Placement is computed from the hovered area's cells, the view
// transform, and the viewport — declared box, no DOM measurement — so it is
// deterministic for tests and stable while the pointer sweeps one area.
import { isAreaStocked } from '@/map/stocking'
import { gridToCanvas, type ViewTransform } from '@/map/view'
import type { Tool } from '@/map/gestures'
import type { AreaSpec, Position } from '@/types'

// The pinned card box (Tailwind w-72 / max-h-56), declared rather than
// observed so placement never waits on layout.
export const HOVER_CARD_WIDTH = 288
export const HOVER_CARD_MAX_HEIGHT = 224
// How long the pointer rests on an area before the card raises — long enough
// that sweeping across the map stays quiet, short enough to feel immediate.
export const HOVER_CARD_DELAY_MS = 300
const GAP = 8
const MARGIN = 8

// The card belongs to the inspect posture alone: the select tool, with no
// gesture in flight and no other surface owning the hover — the armed
// click-to-place highlight and an entry drag's drop target both outrank it.
// It raises only over an area with something to say beyond its bare id.
export function hoverCardAreaId(
  area: AreaSpec | null,
  state: { tool: Tool; gesturing: boolean; placing: boolean; dragging: boolean },
): string | null {
  if (!area || state.tool !== 'select' || state.gesturing || state.placing || state.dragging) {
    return null
  }
  return area.name !== '' || isAreaStocked(area) ? area.id : null
}

export interface HoverCardPlacement {
  left: number
  top: number
}

// Beside the area, out from under the pointer: at the right of the area's
// bounding box, flipped to its left when the viewport edge would clip it,
// clamped into frame either way. Anchoring to the box rather than the pointer
// keeps the card still while the pointer moves within the same area.
export function hoverCardPlacement(
  cells: readonly Position[],
  view: ViewTransform,
  viewport: { width: number; height: number },
): HoverCardPlacement {
  if (cells.length === 0) return { left: MARGIN, top: MARGIN }
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  for (const [x, y] of cells) {
    if (x < minX) minX = x
    if (y < minY) minY = y
    if (x > maxX) maxX = x
  }
  const right = gridToCanvas(view, maxX + 1, minY)
  const fitsRight = right.x + GAP + HOVER_CARD_WIDTH <= viewport.width - MARGIN
  const x = fitsRight ? right.x + GAP : gridToCanvas(view, minX, minY).x - GAP - HOVER_CARD_WIDTH
  return {
    left: Math.max(MARGIN, Math.min(x, viewport.width - MARGIN - HOVER_CARD_WIDTH)),
    top: Math.max(MARGIN, Math.min(right.y, viewport.height - MARGIN - HOVER_CARD_MAX_HEIGHT)),
  }
}
