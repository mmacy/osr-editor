import { expect, test } from 'vitest'

import { clampScale, fitAcross, panBy, zoomAbout, type PanZoom } from '@/lib/pan-zoom'

const BOUNDS = { min: 0.5, max: 2 }
const START: PanZoom = { scale: 1, offsetX: 40, offsetY: -20 }

// The content coordinate a viewport point is over, under some view.
function contentAt(view: PanZoom, x: number, y: number) {
  return { x: (x - view.offsetX) / view.scale, y: (y - view.offsetY) / view.scale }
}

test('zooming about a point leaves the content under it', () => {
  const point = { x: 120, y: 90 }
  const before = contentAt(START, point.x, point.y)
  for (const factor of [1.25, 1 / 1.25, 1.9, 0.55]) {
    const after = contentAt(zoomAbout(START, point, factor, BOUNDS), point.x, point.y)
    expect(after.x).toBeCloseTo(before.x, 10)
    expect(after.y).toBeCloseTo(before.y, 10)
  }
})

test('the scale stays inside its bounds', () => {
  expect(zoomAbout(START, { x: 0, y: 0 }, 10, BOUNDS).scale).toBe(BOUNDS.max)
  expect(zoomAbout(START, { x: 0, y: 0 }, 0.01, BOUNDS).scale).toBe(BOUNDS.min)
  expect(clampScale(3, BOUNDS)).toBe(2)
  expect(clampScale(0.1, BOUNDS)).toBe(0.5)
})

test('a zoom that cannot move the scale cannot move the content either', () => {
  // Sitting on a bound, a further gesture in that direction is inert — without
  // this the offset would drift while the scale stood still.
  const atMax = { ...START, scale: BOUNDS.max }
  expect(zoomAbout(atMax, { x: 200, y: 200 }, 1.5, BOUNDS)).toBe(atMax)
})

test('panning moves the origin by the delta and nothing else', () => {
  expect(panBy(START, 15, -5)).toEqual({ scale: 1, offsetX: 55, offsetY: -25 })
})

test('a fit puts the content inside the margins, centred and hung from the top', () => {
  const fitted = fitAcross(1000, 300, 10, { min: 0.05, max: 4 })
  expect(fitted.scale).toBeCloseTo(0.28, 10)
  expect(fitted.offsetX).toBeCloseTo(10, 10)
  expect(fitted.offsetY).toBe(10)
  // Content narrower than the viewport centres rather than stretching past the
  // scale ceiling.
  const small = fitAcross(50, 300, 10, { min: 0.05, max: 2 })
  expect(small.scale).toBe(2)
  expect(small.offsetX).toBe(100)
})

test('a fit with nothing measured yet is the identity, not a division by zero', () => {
  expect(fitAcross(0, 300, 10, { min: 0.5, max: 2 })).toEqual({ scale: 1, offsetX: 0, offsetY: 10 })
  expect(fitAcross(800, 0, 10, { min: 0.5, max: 2 })).toEqual({ scale: 1, offsetX: 0, offsetY: 10 })
})
