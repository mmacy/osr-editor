import { expect, test } from 'vitest'

import {
  addTravel,
  burstGain,
  decayBurst,
  normalizeDelta,
  readWheel,
  tuningFor,
  zoomFactorFor,
  NO_BURST,
  PINCH_TUNING,
  WHEEL_TUNING,
  type WheelSample,
  type ZoomBurst,
} from '@/map/wheel'

function sample(overrides: Partial<WheelSample> = {}): WheelSample {
  return { deltaX: 0, deltaY: 0, deltaMode: 0, ctrlKey: false, metaKey: false, ...overrides }
}

/** One frame at a time, threading the burst — how the canvas drives it. */
function replay(frames: Array<Partial<WheelSample> & { at: number }>): {
  factors: number[]
  burst: ZoomBurst
} {
  let burst = NO_BURST
  const factors: number[] = []
  for (const { at, ...overrides } of frames) {
    const reading = readWheel(sample(overrides), burst, at)
    burst = reading.burst
    if (reading.action.kind === 'zoom') factors.push(reading.action.factor)
  }
  return { factors, burst }
}

function action(overrides: Partial<WheelSample> = {}) {
  return readWheel(sample(overrides), NO_BURST, 0).action
}

test('line and page deltas normalize to pixels', () => {
  expect(normalizeDelta(3, 1)).toBe(48)
  expect(normalizeDelta(-1, 2)).toBe(-400)
  expect(normalizeDelta(100, 0)).toBe(100)
})

test('one Chromium notch reproduces the fixed step it replaced', () => {
  expect(zoomFactorFor(-100, WHEEL_TUNING)).toBeCloseTo(1.15, 2)
  expect(zoomFactorFor(100, WHEEL_TUNING)).toBeCloseTo(1 / 1.15, 2)
})

test('the zoom factor is continuous in the delta — the whole point of feathering', () => {
  // A trackpad frame is a fraction of a gesture and must zoom by a fraction of
  // one; the fixed factor this replaced spent a whole notch on each.
  expect(zoomFactorFor(-4, WHEEL_TUNING)).toBeLessThan(1.01)
  expect(zoomFactorFor(-2, WHEEL_TUNING)).toBeLessThan(zoomFactorFor(-4, WHEEL_TUNING))
  expect(zoomFactorFor(0, WHEEL_TUNING)).toBe(1)
})

test('a single event never zooms past the exponent clamp, however it is gained', () => {
  const ceiling = zoomFactorFor(-100_000, WHEEL_TUNING)
  expect(ceiling).toBeCloseTo(Math.exp(0.6), 6)
  // The clamp bounds the gained paths too, which is why it clamps the exponent
  // rather than the delta.
  expect(zoomFactorFor(-100_000, PINCH_TUNING, 4)).toBe(ceiling)
  expect(zoomFactorFor(100_000, PINCH_TUNING, 4)).toBeCloseTo(1 / ceiling, 6)
})

test('a pinch is read on its own rate, and the escape hatch keeps the wheel feel', () => {
  // macOS delivers a pinch as ctrl-wheel frames of a few pixels. On the wheel's
  // rate a whole spread bought about 10%, which is what felt broken.
  expect(tuningFor(sample({ deltaY: -3, ctrlKey: true }))).toBe(PINCH_TUNING)
  expect(PINCH_TUNING.rate).toBeGreaterThan(WHEEL_TUNING.rate * 4)
  // A notch under the modifier is a mouse asking for the escape hatch, not a
  // pinch — it must not become hypersensitive.
  expect(tuningFor(sample({ deltaY: -100, ctrlKey: true }))).toBe(WHEEL_TUNING)
  expect(tuningFor(sample({ deltaY: -3, deltaMode: 1 }))).toBe(WHEEL_TUNING)
})

test('the gain ramps from base to the ceiling and never past it', () => {
  expect(burstGain(0, 250)).toBe(1)
  expect(burstGain(125, 250)).toBe(2.5)
  expect(burstGain(250, 250)).toBe(4)
  expect(burstGain(10_000, 250)).toBe(4)
})

test('a burst decays back to idle when the frames stop', () => {
  const hot = addTravel(decayBurst(NO_BURST, 0), 240)
  expect(hot.travel).toBe(240)
  // One half-life halves it; a long gap leaves effectively nothing.
  expect(decayBurst(hot, 120).travel).toBeCloseTo(120, 6)
  expect(decayBurst(hot, 1200).travel).toBeLessThan(1)
})

test('the gain reads the decayed travel, not the stale total', () => {
  // The bug this pins: reading the gain before applying the decay let the first
  // frame after a pause inherit the previous gesture's acceleration, so
  // precision never came back until a frame had been spent restoring it.
  const hot = addTravel(decayBurst(NO_BURST, 0), 240)
  const cold = readWheel(sample({ deltaY: -6, ctrlKey: true }), hot, 2000)
  const fresh = readWheel(sample({ deltaY: -6, ctrlKey: true }), NO_BURST, 0)
  // Exponential decay leaves a residue rather than reaching zero, so these are
  // equal to within it. The tolerance is still three orders of magnitude tighter
  // than the defect, which showed up as a factor 0.04 too high.
  expect(cold.action.kind === 'zoom' && cold.action.factor).toBeCloseTo(
    fresh.action.kind === 'zoom' ? fresh.action.factor : 0,
    3,
  )
})

test('the first frame of a gesture is never gained, so an isolated notch is unchanged', () => {
  const { factors } = replay([{ deltaY: -100, at: 0 }])
  expect(factors[0]).toBeCloseTo(zoomFactorFor(-100, WHEEL_TUNING), 6)
})

/** A steady gesture: `count` identical frames, one every 10ms. */
function steadyPinch(deltaY: number, count = 20) {
  return Array.from({ length: count }, (_, index) => ({
    deltaY,
    ctrlKey: true,
    at: index * 10,
  }))
}

test('a sustained pinch accelerates, then holds — and a fresh one starts precise', () => {
  // The same input per frame buys more scale as the gesture is pushed onward,
  // which is the acceleration asked for.
  const { factors, burst } = replay(steadyPinch(-6))
  expect(factors[0]).toBeLessThan(factors[5])
  expect(factors[5]).toBeLessThan(factors[19])
  for (let index = 1; index < factors.length; index += 1) {
    expect(factors[index]).toBeGreaterThanOrEqual(factors[index - 1])
  }
  // It decelerates towards a bound rather than climbing forever: every frame
  // adds less than the one before it, and this speed settles well short of the
  // ceiling. Monotone deceleration is the exact property, so it is what is
  // asserted — no tolerance to tune.
  for (let index = 2; index < factors.length; index += 1) {
    const gained = factors[index] - factors[index - 1]
    const gainedBefore = factors[index - 1] - factors[index - 2]
    expect(gained).toBeLessThanOrEqual(gainedBefore + Number.EPSILON)
  }
  expect(factors[19]).toBeLessThan(zoomFactorFor(-6, PINCH_TUNING, 4))

  // After a pause the ramp has decayed, so the next gesture is precise again —
  // this is what keeps fine framing available at any time.
  const resumed = readWheel(sample({ deltaY: -6, ctrlKey: true }), burst, 190 + 1200)
  expect(resumed.action.kind === 'zoom' && resumed.action.factor).toBeCloseTo(factors[0], 3)
})

test('a faster gesture earns more gain than a slower one', () => {
  // The velocity scaling, which is the whole point: the decay bounds travel at a
  // level proportional to how hard the gesture is being pushed, so a decisive
  // pinch crosses scales while a slow one stays fine-grained. Compared as gain
  // rather than as factors, which differ by their own delta.
  const gainOf = (deltaY: number, count = 20) => {
    const { burst } = replay(steadyPinch(deltaY, count))
    return burstGain(burst.travel, PINCH_TUNING.burstFullPx)
  }
  const slow = gainOf(-3)
  const brisk = gainOf(-6)
  const fast = gainOf(-18)
  expect(slow).toBeLessThan(brisk)
  expect(brisk).toBeLessThan(fast)
  // A slow, deliberate pinch stays near the base rate — precise framing is
  // still available without letting go.
  expect(slow).toBeLessThan(1.7)
  expect(fast).toBeGreaterThan(3.5)
  // Held long enough, a fast gesture reaches the ceiling and stops there.
  expect(gainOf(-18, 80)).toBe(4)
})

test('a pan frame decays the ramp without feeding it', () => {
  // Panning and pinching arrive on the same stream; a two-finger drag must not
  // leave the next pinch accelerated.
  let burst = NO_BURST
  for (let index = 0; index < 20; index += 1) {
    burst = readWheel(sample({ deltaY: 6 }), burst, index * 10).burst
  }
  expect(burst.travel).toBe(0)
})

test('pinch and the modifier escape hatch always zoom', () => {
  expect(action({ deltaY: -2.5, ctrlKey: true }).kind).toBe('zoom')
  expect(action({ deltaY: 3, metaKey: true }).kind).toBe('zoom')
})

test('a mouse-wheel notch zooms', () => {
  expect(action({ deltaY: -100 }).kind).toBe('zoom')
  expect(action({ deltaY: 120 }).kind).toBe('zoom')
  // Firefox reports a wheel in lines, and a line-mode delta is never a pad.
  expect(action({ deltaY: 3, deltaMode: 1 }).kind).toBe('zoom')
})

test('a two-finger drag pans, and the view moves against the delta', () => {
  expect(action({ deltaX: 12, deltaY: 8 })).toEqual({ kind: 'pan', dx: -12, dy: -8 })
  // Small whole deltas are a pad's slow frames, not a notch.
  expect(action({ deltaY: 6 })).toEqual({ kind: 'pan', dx: -0, dy: -6 })
  // A fractional delta is a pad however large it gets.
  expect(action({ deltaY: -144.5 }).kind).toBe('pan')
  // So is a whole one carrying any horizontal component.
  expect(action({ deltaX: 1, deltaY: -100 }).kind).toBe('pan')
})

test('a horizontal-only drag pans rather than zooming by nothing', () => {
  expect(action({ deltaX: -40 })).toEqual({ kind: 'pan', dx: 40, dy: -0 })
})

test('a line-mode horizontal scroll pans — a wheel by unit, a pan by axis', () => {
  // Firefox's shift-wheel. Classifying on the unit alone and only then looking
  // at the axis answered this with a zoom factor of exactly 1: a dead gesture.
  expect(action({ deltaX: -3, deltaY: 0, deltaMode: 1 })).toEqual({
    kind: 'pan',
    dx: 48,
    dy: -0,
  })
})

test('no sample answers a zoom that would not move the view', () => {
  // Every way a wheel event can claim to be zooming while carrying nothing to
  // zoom by, the modifier included — Firefox's ctrl+shift+wheel is the last of
  // them, and it used to come back as a zoom by a factor of exactly 1.
  const samples = [
    { deltaY: 0 },
    { deltaY: 0, deltaMode: 1 },
    { deltaX: 5, deltaY: 0, deltaMode: 2 },
    { deltaX: 5, deltaY: 0, ctrlKey: true },
    { deltaX: 5, deltaY: 0, metaKey: true },
    { deltaX: -3, deltaY: 0, deltaMode: 1, ctrlKey: true },
  ]
  for (const candidate of samples) {
    expect(action(candidate).kind).toBe('pan')
  }
})

test('the modifier still zooms whenever there is a vertical delta to zoom by', () => {
  // The escape hatch is about resolving the wheel-versus-pad ambiguity on a
  // vertical scroll, and dropping the dead horizontal case must not weaken it.
  for (const candidate of [
    { deltaY: -6, ctrlKey: true },
    { deltaX: 5, deltaY: -6, ctrlKey: true },
    { deltaX: 5, deltaY: 6, metaKey: true },
  ]) {
    expect(action(candidate).kind).toBe('zoom')
  }
})
