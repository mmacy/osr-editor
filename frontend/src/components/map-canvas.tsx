// The map canvas: pointer plumbing around the pure map core. Hit testing,
// gestures, and drawing all live in src/map/ — this component owns the DOM
// canvas, devicePixelRatio, the resize observer, and pointer/wheel events.
import { useCallback, useEffect, useRef, useState } from 'react'

import { beginGesture, updateGesture, type Gesture, type Tool } from '@/map/gestures'
import { hitTest, type HitTarget } from '@/map/hit-test'
import { drawLevel, type MapMarker, type MapSelection, type MapTheme } from '@/map/render'
import { panView, zoomAt, type PointPx, type ViewTransform } from '@/map/view'
import { NO_BURST, readWheel } from '@/map/wheel'
import type { LevelSpec, Position } from '@/types'

export interface MapCanvasProps {
  level: LevelSpec
  view: ViewTransform | null
  // The next view arrives as an updater, never a value. Wheel and pointer
  // frames both outrun React's commit — a trackpad gesture is dozens of frames
  // and React batches them — so a frame that recomputed from the last rendered
  // view would overwrite the frames before it instead of composing with them,
  // and most of the gesture would be silently discarded.
  onViewChange: (update: (current: ViewTransform) => ViewTransform) => void
  onViewportSize: (size: { width: number; height: number }) => void
  tool: Tool
  gesture: Gesture | null
  onGestureChange: (gesture: Gesture | null) => void
  onGestureComplete: (gesture: Gesture) => void
  selection: MapSelection | null
  hover: HitTarget | null
  onHover: (target: HitTarget | null) => void
  onSelect: (target: HitTarget) => void
  onPlaceEntrance: (cell: Position) => void
  onTransitionAt: (cell: Position) => void
  markers: readonly MapMarker[]
  theme: MapTheme
  dimStocked?: boolean
}

// The cell tools always want the cell, however close to a border the pointer
// lands; only select and the wall tool care about edges.
function preferFor(tool: Tool): 'edge' | 'cell' {
  return tool === 'wall' || tool === 'select' ? 'edge' : 'cell'
}

// How far a select-tool press may travel before it stops being a click and
// becomes a pan. Small enough that a deliberate click on a one-cell area never
// slips into panning, large enough to absorb the tremor in a real click.
const DRAG_THRESHOLD_PX = 4

export function MapCanvas(props: MapCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const [spaceHeld, setSpaceHeld] = useState(false)
  const panning = useRef<{ x: number; y: number } | null>(null)
  // A select-tool press that has not yet moved far enough to be a pan: it
  // selects on release and pans instead the moment it crosses the threshold.
  const pendingSelect = useRef<{ x: number; y: number; target: HitTarget | null } | null>(null)
  // Only the cursor reads this, which is why the pan itself rides a ref — a
  // pan frame must not re-render, and grab/grabbing changes twice per gesture.
  const [grabbing, setGrabbing] = useState(false)

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.code !== 'Space') return
      const target = event.target as HTMLElement | null
      if (target && ['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON'].includes(target.tagName)) return
      setSpaceHeld(event.type === 'keydown')
      if (event.type === 'keydown') event.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('keyup', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('keyup', onKey)
    }
  }, [])

  // Track the element size: backing store scales for devicePixelRatio, and
  // the editor learns the viewport for fit-on-open. jsdom has no
  // ResizeObserver and no layout — fall back to a fixed size so component
  // tests still initialize a view.
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const apply = (width: number, height: number) => {
      const ratio = window.devicePixelRatio || 1
      canvas.width = Math.max(1, Math.round(width * ratio))
      canvas.height = Math.max(1, Math.round(height * ratio))
      props.onViewportSize({ width, height })
    }
    if (typeof ResizeObserver === 'undefined') {
      apply(800, 600)
      return
    }
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (entry) apply(entry.contentRect.width, entry.contentRect.height)
    })
    observer.observe(canvas)
    return () => observer.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- onViewportSize is stable by construction
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx || !props.view) return
    const ratio = window.devicePixelRatio || 1
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0)
    ctx.clearRect(0, 0, canvas.width / ratio, canvas.height / ratio)
    drawLevel(ctx, {
      level: props.level,
      view: props.view,
      theme: props.theme,
      selection: props.selection,
      hover: props.hover,
      markers: props.markers,
      gesture: props.gesture,
      dimStocked: props.dimStocked,
    })
  })

  const pointFor = useCallback((event: { clientX: number; clientY: number }): PointPx => {
    const rect = canvasRef.current?.getBoundingClientRect()
    return { x: event.clientX - (rect?.left ?? 0), y: event.clientY - (rect?.top ?? 0) }
  }, [])

  // The wheel handler is native and non-passive, unlike every other listener
  // here. React registers `wheel` at the root as passive, where preventDefault
  // is a no-op — and without it a horizontal two-finger drag over the canvas
  // triggers the browser's back-navigation swipe instead of panning the map.
  // Only the callback rides a ref, so the listener registers once; the view
  // itself comes from the updater, which is what keeps batched frames honest.
  const onViewChangeRef = useRef(props.onViewChange)
  useEffect(() => {
    onViewChangeRef.current = props.onViewChange
  })
  // The zoom gain ramp's accumulator: a ref, because it must survive frames
  // without provoking a render — nothing displays it.
  const burst = useRef(NO_BURST)
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const onWheel = (event: WheelEvent) => {
      event.preventDefault()
      const reading = readWheel(event, burst.current, event.timeStamp)
      burst.current = reading.burst
      const action = reading.action
      if (action.kind === 'pan' && action.dx === 0 && action.dy === 0) return
      const point = pointFor(event)
      onViewChangeRef.current((current) =>
        action.kind === 'zoom'
          ? zoomAt(current, point, action.factor)
          : panView(current, action.dx, action.dy),
      )
    }
    canvas.addEventListener('wheel', onWheel, { passive: false })
    return () => canvas.removeEventListener('wheel', onWheel)
  }, [pointFor])

  const startPanning = (x: number, y: number) => {
    panning.current = { x, y }
    setGrabbing(true)
  }

  const onPointerDown = (event: React.PointerEvent) => {
    if (!props.view) return
    canvasRef.current?.setPointerCapture(event.pointerId)
    // Middle-click-and-hold and space-drag pan under every tool; the pan tool
    // is the same gesture bound to a plain left-drag, for when holding a chord
    // is the wrong hand.
    if (event.button === 1 || (event.button === 0 && (spaceHeld || props.tool === 'pan'))) {
      startPanning(event.clientX, event.clientY)
      return
    }
    if (event.button !== 0) return
    const target = hitTest(pointFor(event), props.level, props.view, preferFor(props.tool))
    if (props.tool === 'select') {
      // Deferred to release: a select-tool drag is a pan, so the press cannot
      // commit to a selection until it is known to have stayed put. Armed even
      // off the grid, where `hitTest` answers null — empty paper is the most
      // natural place to grab a map, and it is most of the canvas zoomed out.
      pendingSelect.current = { x: event.clientX, y: event.clientY, target }
      return
    }
    if (!target) return
    if (props.tool === 'entrance' && target.kind === 'cell') {
      props.onPlaceEntrance(target.cell)
      return
    }
    if (props.tool === 'transition' && target.kind === 'cell') {
      props.onTransitionAt(target.cell)
      return
    }
    props.onGestureChange(beginGesture(props.tool, target, props.level))
  }

  const onPointerMove = (event: React.PointerEvent) => {
    if (!props.view) return
    const pending = pendingSelect.current
    if (
      pending &&
      Math.hypot(event.clientX - pending.x, event.clientY - pending.y) > DRAG_THRESHOLD_PX
    ) {
      // Panning resumes from the press point, not from here, so the map does
      // not jump by the threshold as the gesture converts.
      pendingSelect.current = null
      startPanning(pending.x, pending.y)
    }
    if (panning.current) {
      const { x, y } = panning.current
      panning.current = { x: event.clientX, y: event.clientY }
      props.onViewChange((current) => panView(current, event.clientX - x, event.clientY - y))
      return
    }
    const target = hitTest(pointFor(event), props.level, props.view, preferFor(props.tool))
    props.onHover(target)
    if (props.gesture && target) {
      props.onGestureChange(updateGesture(props.gesture, target))
    }
  }

  // The UA releases capture implicitly when a pointer goes away, and
  // `releasePointerCapture` throws `NotFoundError` on a pointer that is no
  // longer active — so both ends of a gesture ask first.
  const releaseCapture = (pointerId: number) => {
    const canvas = canvasRef.current
    if (canvas?.hasPointerCapture(pointerId)) canvas.releasePointerCapture(pointerId)
  }

  const onPointerUp = (event: React.PointerEvent) => {
    releaseCapture(event.pointerId)
    if (panning.current) {
      panning.current = null
      setGrabbing(false)
      return
    }
    const pending = pendingSelect.current
    if (pending) {
      pendingSelect.current = null
      // A press that never moved and landed on nothing selects nothing; it was
      // still a pan that happened not to travel.
      if (pending.target) props.onSelect(pending.target)
      return
    }
    if (props.gesture) {
      props.onGestureComplete(props.gesture)
      props.onGestureChange(null)
    }
  }

  // A cancelled pointer abandons whatever was in flight — the browser took the
  // gesture, so nothing about it was a completed act to commit.
  const onPointerCancel = (event: React.PointerEvent) => {
    releaseCapture(event.pointerId)
    panning.current = null
    pendingSelect.current = null
    setGrabbing(false)
    if (props.gesture) props.onGestureChange(null)
  }

  // Select drags the map, so it grabs; the drawing tools keep the crosshair.
  const grabs = spaceHeld || props.tool === 'pan' || props.tool === 'select'
  return (
    <canvas
      ref={canvasRef}
      data-testid="map-canvas"
      role="img"
      aria-label={`Level ${props.level.number} map`}
      className="h-full w-full touch-none"
      style={{ cursor: grabbing ? 'grabbing' : grabs ? 'grab' : 'crosshair' }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onPointerLeave={() => props.onHover(null)}
      // contextmenu deliberately not handled here: the editor wraps this
      // canvas in the stocking context-menu trigger, which owns the event —
      // opening on area cells, preventing the native menu everywhere else.
    />
  )
}
