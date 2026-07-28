// The mini target-level picker: the target level at thumbnail scale, click to
// choose the landing cell — the shared one-shot cell-pick gesture. The
// transition dialog's target, the trap builder's slide destination, and the
// feature cards' cell binding all reuse it. It draws with the map's own
// renderer, so walls, doors, corridors, the entrance, and existing transitions
// all read the same here as on the canvas.
import { useEffect, useRef, useState } from 'react'

import { usePrefersDark } from '@/hooks/use-prefers-dark'
import { inBounds } from '@/map/edge-key'
import { DARK_THEME, LIGHT_THEME, drawLevel } from '@/map/render'
import { CELL_SIZE } from '@/map/view'
import type { LevelSpec, Position } from '@/types'

// The sizing budget: fill the container's width up to a height cap, between a
// floor that keeps cells clickable and a ceiling that keeps small levels from
// ballooning. A level too large for the budget keeps the floor size and the
// wrapper scrolls — precision is the picker's one job, so the cell size never
// shrinks below it.
const MAX_HEIGHT_PX = 380
const MIN_CELL_PX = 6
const MAX_CELL_PX = 22

// jsdom has no ResizeObserver and no layout; the fallback keeps component
// tests initializing at the old fixed budget.
const FALLBACK_WIDTH_PX = 280

function cellSizeFor(availableWidth: number, level: LevelSpec): number {
  const fit = Math.floor(Math.min(availableWidth / level.width, MAX_HEIGHT_PX / level.height))
  return Math.min(MAX_CELL_PX, Math.max(MIN_CELL_PX, fit))
}

export function MiniLevelPicker({
  level,
  selected,
  onPick,
  sourceCell = null,
  onHover,
}: {
  level: LevelSpec
  selected: Position | null
  onPick: (cell: Position) => void
  // The cell the transition departs from, ghosted onto the target grid — the
  // stacked-stairs case wants the landing directly below the source.
  sourceCell?: Position | null
  onHover?: (cell: Position | null) => void
}) {
  const wrapperRef = useRef<HTMLDivElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const [availWidth, setAvailWidth] = useState<number | null>(null)
  const [hovered, setHovered] = useState<Position | null>(null)
  const prefersDark = usePrefersDark()
  const theme = prefersDark ? DARK_THEME : LIGHT_THEME

  const cellPx = cellSizeFor(availWidth ?? FALLBACK_WIDTH_PX, level)
  const cssWidth = level.width * cellPx
  const cssHeight = level.height * cellPx

  useEffect(() => {
    const wrapper = wrapperRef.current
    if (!wrapper || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width
      if (width) setAvailWidth(width)
    })
    observer.observe(wrapper)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    const ratio = window.devicePixelRatio || 1
    canvas.width = Math.max(1, Math.round(cssWidth * ratio))
    canvas.height = Math.max(1, Math.round(cssHeight * ratio))
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0)
    ctx.clearRect(0, 0, cssWidth, cssHeight)
    drawLevel(ctx, {
      level,
      view: { scale: cellPx / CELL_SIZE, offsetX: 0, offsetY: 0 },
      theme,
      selection: selected ? { kind: 'cell', cell: selected } : null,
      hover: hovered ? { kind: 'cell', cell: hovered } : null,
      markers: [],
      gesture: null,
    })
    if (sourceCell && inBounds(sourceCell, level)) {
      ctx.save()
      ctx.strokeStyle = theme.accent
      ctx.setLineDash([3, 2])
      ctx.lineWidth = 1.5
      ctx.strokeRect(sourceCell[0] * cellPx + 1, sourceCell[1] * cellPx + 1, cellPx - 2, cellPx - 2)
      ctx.restore()
    }
  })

  // The click maps through the rendered content box, never the backing store —
  // correct at any display size the surrounding layout imposes. clientWidth and
  // clientLeft exclude the 1px border, which getBoundingClientRect includes.
  const cellAt = (event: React.MouseEvent<HTMLCanvasElement>): Position | null => {
    const canvas = event.currentTarget
    const rect = canvas.getBoundingClientRect()
    if (canvas.clientWidth === 0 || canvas.clientHeight === 0) return null
    const x = Math.floor(
      ((event.clientX - rect.left - canvas.clientLeft) / canvas.clientWidth) * level.width,
    )
    const y = Math.floor(
      ((event.clientY - rect.top - canvas.clientTop) / canvas.clientHeight) * level.height,
    )
    if (x < 0 || x >= level.width || y < 0 || y >= level.height) return null
    return [x, y]
  }

  const hover = (cell: Position | null) => {
    setHovered(cell)
    onHover?.(cell)
  }

  return (
    <div ref={wrapperRef} className="max-h-96 w-full overflow-auto">
      <canvas
        ref={canvasRef}
        data-testid="mini-level-picker"
        role="img"
        aria-label={`Level ${level.number} cell picker`}
        style={{ width: cssWidth, height: cssHeight }}
        className="cursor-crosshair rounded-sm border"
        onClick={(event) => {
          const cell = cellAt(event)
          if (cell) onPick(cell)
        }}
        onMouseMove={(event) => hover(cellAt(event))}
        onMouseLeave={() => hover(null)}
      />
    </div>
  )
}
