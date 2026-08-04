// Pan and zoom over a plane of content, in content pixels. The map's camera
// and the source-pages viewer are the same transform over different content —
// graph paper in one, a scanned page in the other — so the arithmetic lives
// here once and each surface brings its own scale bounds and its own units.

/** A camera: how much the content is scaled, and where its origin sits. */
export interface PanZoom {
  scale: number
  offsetX: number
  offsetY: number
}

/** A point in the viewport's own pixels, measured from its top-left corner. */
export interface PointPx {
  x: number
  y: number
}

/** How far a surface lets its content be scaled. */
export interface ScaleBounds {
  min: number
  max: number
}

export function clampScale(scale: number, bounds: ScaleBounds): number {
  return Math.min(bounds.max, Math.max(bounds.min, scale))
}

/**
 * Zoom about a viewport point: the content under the cursor stays under it.
 *
 * Returns the view unchanged when the factor would take the scale past a bound
 * it is already sitting on, so a gesture at the limit cannot drift the content
 * sideways.
 */
export function zoomAbout(
  view: PanZoom,
  point: PointPx,
  factor: number,
  bounds: ScaleBounds,
): PanZoom {
  const scale = clampScale(view.scale * factor, bounds)
  if (scale === view.scale) return view
  const ratio = scale / view.scale
  return {
    scale,
    offsetX: point.x - (point.x - view.offsetX) * ratio,
    offsetY: point.y - (point.y - view.offsetY) * ratio,
  }
}

/** Move the content by a viewport-pixel delta. */
export function panBy(view: PanZoom, dx: number, dy: number): PanZoom {
  return { ...view, offsetX: view.offsetX + dx, offsetY: view.offsetY + dy }
}

/**
 * Fit content of a known width across the viewport: centred, and hung from the
 * top under `margin` — the framing a page wants, where the interesting axis is
 * the width and reading goes downward.
 *
 * Answers the identity transform when there is nothing to measure yet.
 */
export function fitAcross(
  contentWidth: number,
  viewportWidth: number,
  margin: number,
  bounds: ScaleBounds,
): PanZoom {
  if (contentWidth <= 0 || viewportWidth <= 0) {
    return { scale: 1, offsetX: 0, offsetY: margin }
  }
  const scale = clampScale((viewportWidth - 2 * margin) / contentWidth, bounds)
  return { scale, offsetX: (viewportWidth - contentWidth * scale) / 2, offsetY: margin }
}
