// The source-pages pane: the selected area's printed pages rendered beside
// the inspector — correction happens against the printed page, and a printed
// page is read by moving around it. So the pane is a viewer, not a list: drag
// to pan, wheel or pinch to zoom about the pointer, the same gestures and the
// same feel as the map canvas beside it. Collapsible; a missing render (a
// licensed subset or a lean workdir) shows its absence quietly, never an error
// toast.
import { useEffect, useRef, useState } from 'react'
import {
  ChevronDownIcon,
  ChevronRightIcon,
  FullscreenIcon,
  MaximizeIcon,
  ZoomInIcon,
  ZoomOutIcon,
} from 'lucide-react'

import { Button } from '@/components/ui/button'
import { forgePageUrl } from '@/lib/api'
import { fitAcross, panBy, zoomAbout, type PanZoom, type PointPx } from '@/lib/pan-zoom'
import { NO_BURST, readWheel } from '@/map/wheel'

// A page render is a few thousand pixels wide and the pane a few hundred, so
// the floor sits well below the map's: fitting a whole page into a narrow pane
// is an ordinary thing to want here, not the far end of the range.
const SCALE_BOUNDS = { min: 0.05, max: 4 }

// The gap between stacked pages and the margin a fit leaves around them, in
// content pixels — the plane the pages themselves live in.
const PAGE_GAP = 24
const FIT_MARGIN = 16

// What one press of the zoom buttons buys: the map toolbar's own step.
const STEP = 1.25

const IDENTITY: PanZoom = { scale: 1, offsetX: 0, offsetY: FIT_MARGIN }

/** The natural size of a loaded page render, in image pixels. */
interface PageSize {
  width: number
  height: number
}

export function SourcePagesPane({
  projectId,
  pages,
}: {
  projectId: string
  pages: readonly number[]
}) {
  const [open, setOpen] = useState(true)
  const [view, setView] = useState<PanZoom>(IDENTITY)
  const [widest, setWidest] = useState<PageSize | null>(null)
  const [failed, setFailed] = useState<Record<number, boolean>>({})
  const [grabbing, setGrabbing] = useState(false)
  const viewportRef = useRef<HTMLDivElement | null>(null)
  const panning = useRef<{ x: number; y: number } | null>(null)

  // A new selection's pages open fitted rather than inheriting the camera the
  // last area was left under — the render-time adjustment the map editor uses
  // for the same job on a level switch.
  const identity = pages.join(',')
  const [seen, setSeen] = useState(identity)
  const [fitted, setFitted] = useState(false)
  if (seen !== identity) {
    setSeen(identity)
    setView(IDENTITY)
    setWidest(null)
    setFailed({})
    setFitted(false)
  }

  const fit = (page: PageSize | null = widest) => {
    if (!page) return
    setView(fitAcross(page.width, viewportRef.current?.clientWidth ?? 0, FIT_MARGIN, SCALE_BOUNDS))
  }

  // Native and non-passive, exactly as the map canvas registers its own:
  // React's root `wheel` listener is passive, where preventDefault is a no-op,
  // and without it a horizontal two-finger drag over the pane triggers the
  // browser's back-navigation swipe instead of moving the page.
  const burst = useRef(NO_BURST)
  useEffect(() => {
    const element = viewportRef.current
    if (!element) return
    const onWheel = (event: WheelEvent) => {
      event.preventDefault()
      const reading = readWheel(event, burst.current, event.timeStamp)
      burst.current = reading.burst
      const action = reading.action
      if (action.kind === 'pan' && action.dx === 0 && action.dy === 0) return
      const rect = element.getBoundingClientRect()
      const point: PointPx = { x: event.clientX - rect.left, y: event.clientY - rect.top }
      setView((current) =>
        action.kind === 'zoom'
          ? zoomAbout(current, point, action.factor, SCALE_BOUNDS)
          : panBy(current, action.dx, action.dy),
      )
    }
    element.addEventListener('wheel', onWheel, { passive: false })
    return () => element.removeEventListener('wheel', onWheel)
  }, [open])

  const zoomStep = (factor: number) => {
    const element = viewportRef.current
    if (!element) return
    const middle = { x: element.clientWidth / 2, y: element.clientHeight / 2 }
    setView((current) => zoomAbout(current, middle, factor, SCALE_BOUNDS))
  }

  return (
    <aside
      aria-label="Source pages"
      data-testid="source-pages"
      className="flex h-full min-h-0 flex-col bg-card"
    >
      <div className="flex items-center gap-1 border-b px-2 py-1">
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={open ? 'Collapse source pages' : 'Expand source pages'}
          onClick={() => setOpen((value) => !value)}
        >
          {open ? <ChevronDownIcon /> : <ChevronRightIcon />}
        </Button>
        <span className="truncate text-xs font-medium">
          Source {pages.length === 1 ? 'page' : 'pages'} {pages.join(', ')}
        </span>
        {open && (
          <span className="ml-auto flex items-center gap-0.5">
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Zoom page out"
              onClick={() => zoomStep(1 / STEP)}
            >
              <ZoomOutIcon />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Zoom page in"
              onClick={() => zoomStep(STEP)}
            >
              <ZoomInIcon />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Reset page zoom"
              onClick={() => setView(IDENTITY)}
            >
              <MaximizeIcon />
            </Button>
            <Button variant="ghost" size="icon-sm" aria-label="Fit page" onClick={() => fit()}>
              <FullscreenIcon />
            </Button>
          </span>
        )}
      </div>
      {open && (
        <div
          ref={viewportRef}
          data-testid="source-pages-viewport"
          className="relative min-h-0 w-full flex-1 touch-none overflow-hidden"
          style={{ cursor: grabbing ? 'grabbing' : 'grab' }}
          onPointerDown={(event) => {
            if (event.button !== 0) return
            event.currentTarget.setPointerCapture(event.pointerId)
            panning.current = { x: event.clientX, y: event.clientY }
            setGrabbing(true)
          }}
          onPointerMove={(event) => {
            const from = panning.current
            if (!from) return
            panning.current = { x: event.clientX, y: event.clientY }
            setView((current) => panBy(current, event.clientX - from.x, event.clientY - from.y))
          }}
          onPointerUp={(event) => {
            if (event.currentTarget.hasPointerCapture(event.pointerId)) {
              event.currentTarget.releasePointerCapture(event.pointerId)
            }
            panning.current = null
            setGrabbing(false)
          }}
          onPointerCancel={() => {
            panning.current = null
            setGrabbing(false)
          }}
        >
          <div
            className="absolute top-0 left-0 flex flex-col items-start"
            style={{
              gap: PAGE_GAP,
              transform: `translate(${view.offsetX}px, ${view.offsetY}px) scale(${view.scale})`,
              transformOrigin: '0 0',
            }}
          >
            {pages.map((page) => (
              <figure key={page} className="flex flex-col gap-1">
                <figcaption className="font-mono text-xs text-muted-foreground">
                  p. {page}
                </figcaption>
                {failed[page] ? (
                  <p className="text-xs text-muted-foreground">
                    No render for this page in the workdir.
                  </p>
                ) : (
                  <img
                    src={forgePageUrl(projectId, page)}
                    alt={`Source page ${page}`}
                    // The pane's own drag is the pan; the browser's image drag
                    // would fight it for the same gesture.
                    draggable={false}
                    className="max-w-none select-none"
                    onLoad={(event) => {
                      const size = {
                        width: event.currentTarget.naturalWidth,
                        height: event.currentTarget.naturalHeight,
                      }
                      setWidest((current) =>
                        current && current.width >= size.width ? current : size,
                      )
                      // The first page to arrive frames the pane; every page
                      // after it is the author's to find, because by then the
                      // camera is theirs.
                      if (!fitted) {
                        setFitted(true)
                        fit(size)
                      }
                    }}
                    onError={() => setFailed((state) => ({ ...state, [page]: true }))}
                  />
                )}
              </figure>
            ))}
          </div>
        </div>
      )}
    </aside>
  )
}
