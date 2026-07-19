// The mini target-level picker: the target grid at thumbnail scale, click to
// choose the landing cell — the shared one-shot cell-pick gesture. The
// transition dialog's target, the trap builder's slide destination, and the
// feature cards' cell binding all reuse it.
import { useEffect, useRef } from 'react'

import type { LevelSpec, Position } from '@/types'

export function MiniLevelPicker({
  level,
  selected,
  onPick,
}: {
  level: LevelSpec
  selected: Position | null
  onPick: (cell: Position) => void
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const cellPx = Math.max(
    4,
    Math.min(Math.floor(280 / level.width), Math.floor(200 / level.height)),
  )
  const width = level.width * cellPx
  const height = level.height * cellPx

  useEffect(() => {
    const ctx = canvasRef.current?.getContext('2d')
    if (!ctx) return
    ctx.clearRect(0, 0, width, height)
    ctx.fillStyle = 'rgba(125, 115, 95, 0.08)'
    ctx.fillRect(0, 0, width, height)
    ctx.strokeStyle = 'rgba(125, 115, 95, 0.35)'
    ctx.lineWidth = 1
    ctx.beginPath()
    for (let x = 0; x <= level.width; x += 1) {
      ctx.moveTo(x * cellPx + 0.5, 0)
      ctx.lineTo(x * cellPx + 0.5, height)
    }
    for (let y = 0; y <= level.height; y += 1) {
      ctx.moveTo(0, y * cellPx + 0.5)
      ctx.lineTo(width, y * cellPx + 0.5)
    }
    ctx.stroke()
    ctx.fillStyle = 'rgba(125, 115, 95, 0.3)'
    for (const area of level.areas) {
      for (const cell of area.cells) {
        ctx.fillRect(cell[0] * cellPx, cell[1] * cellPx, cellPx, cellPx)
      }
    }
    for (const transition of level.transitions) {
      ctx.fillStyle = 'rgba(47, 111, 143, 0.6)'
      ctx.fillRect(transition.position[0] * cellPx, transition.position[1] * cellPx, cellPx, cellPx)
    }
    if (selected) {
      ctx.strokeStyle = '#2f6f8f'
      ctx.lineWidth = 2
      ctx.strokeRect(selected[0] * cellPx + 1, selected[1] * cellPx + 1, cellPx - 2, cellPx - 2)
    }
  })

  return (
    <canvas
      ref={canvasRef}
      data-testid="mini-level-picker"
      width={width}
      height={height}
      className="max-w-full cursor-crosshair rounded-sm border"
      onClick={(event) => {
        const rect = event.currentTarget.getBoundingClientRect()
        const x = Math.floor((event.clientX - rect.left) / cellPx)
        const y = Math.floor((event.clientY - rect.top) / cellPx)
        if (x >= 0 && x < level.width && y >= 0 && y < level.height) onPick([x, y])
      }}
    />
  )
}
