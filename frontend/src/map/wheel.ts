// Wheel interpretation: one wheel event to one view action. Pure, because the
// interesting part is a heuristic and a heuristic wants tests, not a DOM.
//
// The Google Maps model the map targets — wheel zooms, two-finger drag pans,
// pinch zooms — asks the platform a question it cannot answer: a mouse wheel
// and a trackpad two-finger drag arrive as the same `wheel` event, and only
// pinch is distinguishable (macOS synthesizes it as a wheel event with
// `ctrlKey` set, which is also why ctrl/cmd-scroll is the escape hatch when the
// heuristic guesses wrong). So the two are told apart by the shape of the
// delta, and feathering is what makes a wrong guess survivable: a
// misclassified trackpad frame zooms by a few percent rather than a notch.

/** The fields of a `WheelEvent` the interpretation reads. */
export interface WheelSample {
  deltaX: number
  deltaY: number
  deltaMode: number
  ctrlKey: boolean
  metaKey: boolean
}

export type WheelAction = { kind: 'zoom'; factor: number } | { kind: 'pan'; dx: number; dy: number }

const DOM_DELTA_PIXEL = 0
const DOM_DELTA_LINE = 1

// `deltaMode` is a unit, not a magnitude: Firefox reports a mouse wheel in
// lines and a page-mode delta is a viewport, so both normalize to pixels before
// anything else looks at the number.
const LINE_PX = 16
const PAGE_PX = 400

// The smallest pixel delta that still reads as a mouse-wheel notch. Chromium
// spends 100 px on one notch and Firefox 3 lines (48 px here), while a
// trackpad's frames are small, fractional, or carry a horizontal component.
// The gap is wide for an ordinary wheel and this sits in it, but it is not a
// gap for every device: a high-resolution wheel reports small fractional
// deltas of its own and will read as a pad, which is what ctrl/cmd-scroll is
// the answer to.
const NOTCH_PX = 40

/**
 * How much scale a pixel of input buys, and how much sustained travel earns the
 * full gain. Feel constants: tuned by hand at the trackpad, not derived.
 */
export interface ZoomTuning {
  rate: number
  burstFullPx: number
}

// A wheel is coarse by nature — one notch is already 100 px — so its rate stays
// where it was: exp(100 * 0.0014) === 1.15, the fixed step this replaced. Full
// gain wants eight notches of continuous spinning, which is a deliberate act
// rather than a stray flick.
export const WHEEL_TUNING: ZoomTuning = { rate: 0.0014, burstFullPx: 800 }

// A pinch is fine-grained: macOS synthesizes it as ctrl-wheel frames of a few
// pixels each, so a whole two-finger spread accumulates well under 100 px. At
// the wheel's rate that spread bought about 10% and felt broken; this makes the
// same gesture roughly 1.6× before gain, which is what a pinch should feel like.
export const PINCH_TUNING: ZoomTuning = { rate: 0.0075, burstFullPx: 250 }

// The most the gain multiplies the base rate. The ramp is what makes one control
// serve two jobs: the first frames of any gesture stay at 1× for precise
// framing, and pushing the gesture further accelerates it up to this ceiling.
const MAX_GAIN = 4

// How fast accumulated travel decays when frames stop arriving. Short enough
// that a fresh gesture always begins precise, long enough that the momentary
// gaps inside one continuous gesture do not reset it.
const BURST_HALF_LIFE_MS = 120

// The most scale one event may buy, as an exponent — exp(0.6) is about 1.8×.
// Page-mode deltas and a coalesced flick are both unbounded, and an unbounded
// exponent teleports the view across the whole scale range in a single frame.
// Clamping the exponent rather than the delta bounds the gained paths too. The
// pan arm needs no such clamp precisely because it is linear: a big delta is a
// proportionally big pan, reversible by the opposite gesture, and it cannot slam
// into a limit the way a scale can.
const MAX_ZOOM_EXPONENT = 0.6

/**
 * Accumulated zoom travel, which is what the gain ramp reads. Held by the
 * caller across frames; `NO_BURST` is a gesture that has not started.
 */
export interface ZoomBurst {
  travel: number
  at: number
}

export const NO_BURST: ZoomBurst = { travel: 0, at: 0 }

/** One wheel delta in CSS pixels, whatever unit the event reported it in. */
export function normalizeDelta(delta: number, deltaMode: number): number {
  if (deltaMode === DOM_DELTA_LINE) return delta * LINE_PX
  if (deltaMode === DOM_DELTA_PIXEL) return delta
  return delta * PAGE_PX
}

/**
 * Decay a burst to `now`. Separate from folding a frame in, and applied first,
 * because the gain must read the travel a gesture *still* has: reading it before
 * the decay lets the frame after a long pause inherit the previous gesture's
 * acceleration, and the pause is exactly when precision is wanted back.
 */
export function decayBurst(burst: ZoomBurst, now: number): ZoomBurst {
  const elapsed = Math.max(0, now - burst.at)
  return { travel: burst.travel * 0.5 ** (elapsed / BURST_HALF_LIFE_MS), at: now }
}

/** Fold one frame's travel into an already-decayed burst. */
export function addTravel(burst: ZoomBurst, deltaPx: number): ZoomBurst {
  return { travel: burst.travel + Math.abs(deltaPx), at: burst.at }
}

/** The rate multiplier a burst of this much travel has earned, in `1..MAX_GAIN`. */
export function burstGain(travel: number, burstFullPx: number): number {
  return 1 + (MAX_GAIN - 1) * Math.min(1, travel / burstFullPx)
}

/**
 * The zoom factor for a pixel delta — continuous in the delta, which is the
 * whole of "feathering": a small trackpad frame is a small scale change.
 */
export function zoomFactorFor(deltaPx: number, tuning: ZoomTuning, gain = 1): number {
  const exponent = -deltaPx * tuning.rate * gain
  return Math.exp(Math.max(-MAX_ZOOM_EXPONENT, Math.min(MAX_ZOOM_EXPONENT, exponent)))
}

// Which input this frame came from. A notch-shaped delta is a wheel even under
// the modifier — that is the escape hatch, and it must keep the wheel's feel
// rather than becoming hypersensitive for mouse users.
export function tuningFor(sample: WheelSample): ZoomTuning {
  return sample.deltaMode !== DOM_DELTA_PIXEL || isWheelNotch(sample) ? WHEEL_TUNING : PINCH_TUNING
}

// A pixel-mode delta that is vertical-only, whole, and notch-sized is a mouse
// wheel; anything else is a two-finger drag. Fractional and small deltas are a
// trackpad's signature, and a drag that is even slightly off-axis carries
// `deltaX` a wheel never has.
function isWheelNotch(sample: WheelSample): boolean {
  return (
    sample.deltaX === 0 && Number.isInteger(sample.deltaY) && Math.abs(sample.deltaY) >= NOTCH_PX
  )
}

/** One frame read in the context of the gesture so far. */
export interface WheelReading {
  action: WheelAction
  burst: ZoomBurst
}

/**
 * Read one wheel event as a view action, accelerating a sustained gesture.
 *
 * The gain comes from the travel accumulated *before* this frame, so the first
 * frame of any gesture is always at the base rate — an isolated notch behaves
 * exactly as it did, and only pushing a gesture onward accelerates it.
 *
 * Args:
 *     sample: The event's delta, unit, and modifier state.
 *     burst: The travel accumulated so far, from the previous reading.
 *     now: A monotonic timestamp in milliseconds, for the decay.
 *
 * Returns:
 *     The action — a zoom factor to apply about the cursor, or a pan in canvas
 *     pixels — and the burst to carry into the next frame.
 */
export function readWheel(sample: WheelSample, burst: ZoomBurst, now: number): WheelReading {
  const deltaY = normalizeDelta(sample.deltaY, sample.deltaMode)
  const decayed = decayBurst(burst, now)
  // Three things zoom: pinch and the explicit modifier, which say so outright,
  // and a delta shaped like a mouse-wheel notch. All three still need a
  // vertical delta to be zooming *about* anything — a horizontal-only scroll
  // under the modifier, or in line mode, is a zoom by intent and a pan by axis,
  // and answering it with a factor of exactly 1 is a dead gesture. So the axis
  // is tested last, and every sample that cannot zoom pans instead.
  const zooming =
    sample.ctrlKey || sample.metaKey || sample.deltaMode !== DOM_DELTA_PIXEL || isWheelNotch(sample)
  if (zooming && deltaY !== 0) {
    const tuning = tuningFor(sample)
    const factor = zoomFactorFor(deltaY, tuning, burstGain(decayed.travel, tuning.burstFullPx))
    return { action: { kind: 'zoom', factor }, burst: addTravel(decayed, deltaY) }
  }
  // A pan frame decays the burst without feeding it: panning and pinching arrive
  // on the same stream, and a pan should not leave the next pinch accelerated.
  return {
    action: { kind: 'pan', dx: -normalizeDelta(sample.deltaX, sample.deltaMode), dy: -deltaY },
    burst: decayed,
  }
}
