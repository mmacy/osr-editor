// The source-pages pane: the selected area's printed pages rendered beside
// the inspector — correction happens against the printed page. Collapsible
// and zoomable; a missing render (a licensed subset or lean workdir) shows
// its absence quietly, never an error toast.
import { useState } from 'react'
import { ChevronDownIcon, ChevronRightIcon, ZoomInIcon, ZoomOutIcon } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { forgePageUrl } from '@/lib/api'

const ZOOMS = [0.5, 0.75, 1, 1.5, 2]

export function SourcePagesPane({
  projectId,
  pages,
}: {
  projectId: string
  pages: readonly number[]
}) {
  const [open, setOpen] = useState(true)
  const [zoomIndex, setZoomIndex] = useState(2)
  const [failed, setFailed] = useState<Record<number, boolean>>({})
  if (pages.length === 0) return null
  const zoom = ZOOMS[zoomIndex]
  return (
    <aside
      aria-label="Source pages"
      data-testid="source-pages"
      className="flex min-h-0 shrink-0 flex-col border-l bg-card"
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
        <span className="text-xs font-medium">
          Source {pages.length === 1 ? 'page' : 'pages'} {pages.join(', ')}
        </span>
        {open && (
          <span className="ml-auto flex items-center gap-0.5">
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Zoom out"
              disabled={zoomIndex === 0}
              onClick={() => setZoomIndex((index) => Math.max(0, index - 1))}
            >
              <ZoomOutIcon />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Zoom in"
              disabled={zoomIndex === ZOOMS.length - 1}
              onClick={() => setZoomIndex((index) => Math.min(ZOOMS.length - 1, index + 1))}
            >
              <ZoomInIcon />
            </Button>
          </span>
        )}
      </div>
      {open && (
        <ScrollArea className="min-h-0 w-80 flex-1">
          <div className="flex flex-col gap-3 p-2">
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
                    style={{ width: `${zoom * 100}%`, maxWidth: 'none' }}
                    onError={() => setFailed((state) => ({ ...state, [page]: true }))}
                  />
                )}
              </figure>
            ))}
          </div>
        </ScrollArea>
      )}
    </aside>
  )
}
