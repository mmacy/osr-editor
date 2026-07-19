// The map canvas: pointer plumbing around the pure map core. Hit testing,
// gestures, and drawing all live in src/map/ — this component owns the DOM
// canvas, devicePixelRatio, the resize observer, and pointer/wheel events.
import { useCallback, useEffect, useRef, useState } from 'react'

import { beginGesture, updateGesture, type Gesture, type Tool } from '@/map/gestures'
import { hitTest, type HitTarget } from '@/map/hit-test'
import { drawLevel, type MapMarker, type MapSelection, type MapTheme } from '@/map/render'
import { panView, zoomAt, type PointPx, type ViewTransform } from '@/map/view'
import type { LevelSpec, Position } from '@/types'

export interface MapCanvasProps {
  level: LevelSpec
  view: ViewTransform | null
  onViewChange: (view: ViewTransform) => void
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

export function MapCanvas(props: MapCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const [spaceHeld, setSpaceHeld] = useState(false)
  const panning = useRef<{ x: number; y: number } | null>(null)

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

  const pointFor = useCallback((event: React.PointerEvent | React.WheelEvent): PointPx => {
    const rect = canvasRef.current?.getBoundingClientRect()
    return { x: event.clientX - (rect?.left ?? 0), y: event.clientY - (rect?.top ?? 0) }
  }, [])

  const onPointerDown = (event: React.PointerEvent) => {
    if (!props.view) return
    canvasRef.current?.setPointerCapture(event.pointerId)
    if (event.button === 1 || (event.button === 0 && spaceHeld)) {
      panning.current = { x: event.clientX, y: event.clientY }
      return
    }
    if (event.button !== 0) return
    const target = hitTest(pointFor(event), props.level, props.view, preferFor(props.tool))
    if (!target) return
    if (props.tool === 'select') {
      props.onSelect(target)
      return
    }
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
    if (panning.current) {
      props.onViewChange(
        panView(props.view, event.clientX - panning.current.x, event.clientY - panning.current.y),
      )
      panning.current = { x: event.clientX, y: event.clientY }
      return
    }
    const target = hitTest(pointFor(event), props.level, props.view, preferFor(props.tool))
    props.onHover(target)
    if (props.gesture && target) {
      props.onGestureChange(updateGesture(props.gesture, target))
    }
  }

  const onPointerUp = (event: React.PointerEvent) => {
    canvasRef.current?.releasePointerCapture(event.pointerId)
    if (panning.current) {
      panning.current = null
      return
    }
    if (props.gesture) {
      props.onGestureComplete(props.gesture)
      props.onGestureChange(null)
    }
  }

  const onWheel = (event: React.WheelEvent) => {
    if (!props.view) return
    props.onViewChange(zoomAt(props.view, pointFor(event), event.deltaY < 0 ? 1.15 : 1 / 1.15))
  }

  return (
    <canvas
      ref={canvasRef}
      data-testid="map-canvas"
      role="img"
      aria-label={`Level ${props.level.number} map`}
      className="h-full w-full touch-none"
      style={{ cursor: spaceHeld ? 'grab' : 'crosshair' }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerLeave={() => props.onHover(null)}
      onWheel={onWheel}
      // contextmenu deliberately not handled here: the editor wraps this
      // canvas in the stocking context-menu trigger, which owns the event —
      // opening on area cells, preventing the native menu everywhere else.
    />
  )
}
