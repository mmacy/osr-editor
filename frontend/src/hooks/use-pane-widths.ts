// Wire one resizable group's panes to the sidecar: panes report their pixel
// size as they move, and the group records them when the drag ends.
//
// The sizes ride a ref because a resize frame must not re-render — the panel
// library is already driving the layout, and nothing in React needs to know the
// width until it is worth persisting.
import { useCallback, useRef } from 'react'
import type { LayoutChangedMeta, PanelSize } from 'react-resizable-panels'

import { persistPaneWidths, type PaneId } from '@/lib/pane-widths'

export interface PaneGroupHandlers {
  /** `onResize` for one pane's `ResizablePanel`. */
  onPaneResize: (
    pane: PaneId,
  ) => (size: PanelSize, id: string | number | undefined, previous: PanelSize | undefined) => void
  /** `onLayoutChanged` for the enclosing `ResizablePanelGroup`. */
  onLayoutChanged: (layout: unknown, meta: LayoutChangedMeta) => void
}

export function usePaneWidths(): PaneGroupHandlers {
  const moved = useRef<Partial<Record<PaneId, number>>>({})
  // A pane reports its size on mount too, with no previous size — and a pane
  // that merely *opened* at its default has not been sized by anyone. Recording
  // it anyway would pin every other pane's width the first time any one of them
  // was dragged, which is exactly how the inspector would lose its widen-for-an-
  // area default without the author ever touching it.
  const onPaneResize = useCallback(
    (pane: PaneId) =>
      (size: PanelSize, _id: string | number | undefined, previous: PanelSize | undefined) => {
        if (previous) moved.current[pane] = size.inPixels
      },
    [],
  )
  // `isUserInteraction` is the whole reason this hangs off the group rather
  // than off each pane: opening a pane, closing another, and resizing the
  // window all move panes too, and none of them is an author choosing a layout.
  // Either way the batch is spent — a width that moved on its own must not ride
  // along with the next real drag.
  const onLayoutChanged = useCallback((_layout: unknown, meta: LayoutChangedMeta) => {
    if (meta.isUserInteraction) persistPaneWidths(moved.current)
    moved.current = {}
  }, [])
  return { onPaneResize, onLayoutChanged }
}
