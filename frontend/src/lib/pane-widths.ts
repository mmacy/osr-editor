// The resizable side panes: their pixel limits, the width a pane opens at, and
// the sidecar write a finished drag earns.
//
// Widths are pixels rather than percentages because that is what a pane is for
// — a room name either fits in the panel or it does not, and how wide the
// window happens to be has nothing to say about it. The panel library takes
// pixel constraints directly, so nothing here converts.
import { projectStore } from '@/store/project-store'
import type { PaneWidths, ViewState } from '@/types'

/** The panes an author can drag. The keys are the sidecar's own field names. */
export type PaneId = 'nav' | 'inspector' | 'library' | 'source_pages'

export interface PaneLimits {
  /** The width a never-dragged pane opens at. */
  default: number
  /** How narrow a drag may leave the pane before it stops being a pane. */
  min: number
  /** How wide it may grow; the canvas floor below is the harder of the two. */
  max: number
}

// The defaults are the fixed widths these panes shipped with (nav w-56,
// inspector w-64, library and source pages w-80), so an author who never
// touches a splitter sees the layout unchanged. The floors are the narrowest
// width at which each pane still does its job: enough for the nav's level rows,
// for the inspector's two-control content rows, for a library entry's glyphs
// and Place button beside a truncated label. The ceilings are generous — a page
// scan is worth a lot of screen — and are the only limit the source-pages pane
// tests in practice.
export const PANE_LIMITS: Record<PaneId, PaneLimits> = {
  nav: { default: 224, min: 160, max: 480 },
  inspector: { default: 256, min: 224, max: 640 },
  library: { default: 320, min: 240, max: 560 },
  source_pages: { default: 320, min: 240, max: 800 },
}

/**
 * The inspector's unsized width when an area is selected.
 *
 * The deep content forms expand in place and need the room, which is why the
 * pane used to widen on its own. It still does — but only while the author has
 * never dragged it. One drag pins one width, and a pane that keeps jumping
 * after it was deliberately sized reads as broken.
 */
export const INSPECTOR_AREA_DEFAULT = 384

/**
 * The narrowest the map canvas may be squeezed to.
 *
 * The canvas is the surface the panes flank, so it carries the floor that stops
 * a pane being dragged into the whole window.
 */
export const CANVAS_MIN = 320

function clamp(width: number, pane: PaneId): number {
  const limits = PANE_LIMITS[pane]
  return Math.round(Math.min(limits.max, Math.max(limits.min, width)))
}

/**
 * A project with nothing dragged yet — a stable reference, so a store selector
 * falling back to it does not hand React a new object every render.
 */
export const EMPTY_PANE_WIDTHS: PaneWidths = {}

/**
 * The width a pane opens at: the author's if they have set one, else `unsized`.
 *
 * Clamped on the way out as well as in, so a width recorded under limits that
 * have since moved (or edited by hand in the sidecar) still opens sanely.
 */
export function paneWidth(widths: PaneWidths, pane: PaneId, unsized?: number): number {
  const saved = widths[pane]
  if (saved == null) return unsized ?? PANE_LIMITS[pane].default
  return clamp(saved, pane)
}

/**
 * The view state a finished drag should persist, or `null` when nothing moved.
 *
 * Returning `null` for a no-op is what keeps the sidecar quiet: panes report
 * their size on mount and on every window resize too, and only a drag is worth
 * a write.
 */
export function paneWidthUpdate(
  view: ViewState,
  changes: Partial<Record<PaneId, number>>,
): ViewState | null {
  const next: PaneWidths = { ...view.pane_widths }
  let changed = false
  for (const [pane, width] of Object.entries(changes) as [PaneId, number][]) {
    const rounded = clamp(width, pane)
    if (next[pane] === rounded) continue
    next[pane] = rounded
    changed = true
  }
  return changed ? { ...view, pane_widths: next } : null
}

/**
 * Record dragged pane widths in the sidecar — the camera's terms exactly.
 *
 * Called when a drag ends, never per pointer frame, and a no-op write is
 * dropped rather than queued.
 */
export function persistPaneWidths(changes: Partial<Record<PaneId, number>>): void {
  const project = projectStore.getState().project
  if (!project) return
  const view = paneWidthUpdate(project.sidecar.view_state, changes)
  if (!view) return
  void projectStore.getState().patchSidecar([{ action: 'set_view_state', view_state: view }])
}
