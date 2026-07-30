import { expect, test } from 'vitest'

import {
  HOVER_CARD_MAX_HEIGHT,
  HOVER_CARD_WIDTH,
  hoverCardAreaId,
  hoverCardPlacement,
} from '@/map/hover-card'
import { resetView } from '@/map/view'
import type { AreaSpec } from '@/types'

function makeArea(overrides: Partial<AreaSpec> = {}): AreaSpec {
  return {
    id: 'a1',
    name: '',
    description: '',
    cells: [[0, 0]],
    encounter: null,
    features: [],
    trap: null,
    treasure: null,
    ...overrides,
  }
}

const AT_REST = { tool: 'select' as const, gesturing: false, placing: false, dragging: false }

test('the card raises over a named or stocked area under the idle select tool', () => {
  expect(hoverCardAreaId(makeArea({ description: 'A dry well.' }), AT_REST)).toBe('a1')
  expect(hoverCardAreaId(makeArea({ name: 'The well' }), AT_REST)).toBe('a1')
})

test('a bare area has nothing to say, and no area says nothing', () => {
  expect(hoverCardAreaId(makeArea(), AT_REST)).toBeNull()
  expect(hoverCardAreaId(null, AT_REST)).toBeNull()
})

test('every other owner of the hover suppresses the card', () => {
  const area = makeArea({ description: 'A dry well.' })
  expect(hoverCardAreaId(area, { ...AT_REST, tool: 'room' })).toBeNull()
  expect(hoverCardAreaId(area, { ...AT_REST, gesturing: true })).toBeNull()
  expect(hoverCardAreaId(area, { ...AT_REST, placing: true })).toBeNull()
  expect(hoverCardAreaId(area, { ...AT_REST, dragging: true })).toBeNull()
})

// Placement at the deterministic reset transform: cell size 24, margin 24.
const VIEWPORT = { width: 800, height: 600 }

test('the card sits just right of the area box, top-aligned with it', () => {
  const placement = hoverCardPlacement(
    [
      [0, 0],
      [1, 0],
      [1, 1],
    ],
    resetView(),
    VIEWPORT,
  )
  // The box spans cells 0–1, so its right edge is grid x 2 → 72px, plus the gap.
  expect(placement).toEqual({ left: 80, top: 24 })
})

test('the card flips to the left of the box when the right edge would clip it', () => {
  const placement = hoverCardPlacement([[30, 0]], resetView(), VIEWPORT)
  // Right anchor 24 + 31·24 = 768 leaves no room for the card, so it hangs
  // off the box's left edge (744) instead, gap and width to the west.
  expect(placement.left).toBe(744 - 8 - HOVER_CARD_WIDTH)
  expect(placement.top).toBe(24)
})

test('the card clamps into the viewport on both axes', () => {
  const low = hoverCardPlacement([[0, 40]], resetView(), VIEWPORT)
  expect(low.top).toBe(VIEWPORT.height - 8 - HOVER_CARD_MAX_HEIGHT)
  // A viewport narrower than either side leaves the margin as the floor.
  const narrow = hoverCardPlacement([[0, 0]], resetView(), {
    width: HOVER_CARD_WIDTH + 40,
    height: 600,
  })
  expect(narrow.left).toBe(8)
})
