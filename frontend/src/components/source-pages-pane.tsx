// The source-pages pane: the selected area's printed pages, rendered from the
// pages route beside the inspector — correction happens against the printed page.
import { useState } from 'react'
import { ZoomInIcon, ZoomOutIcon } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { forgePageUrl } from '@/lib/api'

export function SourcePagesPane({ projectId, pages }: { projectId: string; pages: number[] }) {
  const [zoom, setZoom] = useState(1)
  if (pages.length === 0) return null
  return (
    <aside aria-label="Source pages" className="flex w-64 shrink-0 flex-col border-l bg-card">
      <div className="flex items-center justify-between border-b px-2 py-1">
        <span className="text-xs font-medium">Source pages</span>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Zoom out"
            onClick={() => setZoom((z) => Math.max(0.5, z - 0.25))}
          >
            <ZoomOutIcon />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Zoom in"
            onClick={() => setZoom((z) => z + 0.25)}
          >
            <ZoomInIcon />
          </Button>
        </div>
      </div>
      <ScrollArea className="flex-1">
        <div className="flex flex-col gap-3 p-2">
          {pages.map((page) => (
            <figure key={page} className="flex flex-col items-center gap-1">
              <img
                src={forgePageUrl(projectId, page)}
                alt={`Source page ${page}`}
                style={{ width: `${zoom * 100}%` }}
                className="border"
              />
              <figcaption className="text-xs text-muted-foreground">p. {page}</figcaption>
            </figure>
          ))}
        </div>
      </ScrollArea>
    </aside>
  )
}
