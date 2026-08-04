// The content library: a map-adjacent collapsible aside listing open packs —
// derived from any project or forge workdir, or banked in the sidecar's stash
// — whose entries drag (or click-to-place) onto the map. Read-only over pack
// content by spec: the panel opens, lists, previews, badges, and closes; every
// write is a drop the map editor commits as an ordinary op batch.
import { Fragment, useState } from 'react'
import {
  ChevronDownIcon,
  ChevronRightIcon,
  ChevronsDownUpIcon,
  ChevronsUpDownIcon,
} from 'lucide-react'

import { ContentPreviewLines, hasPreviewContents } from '@/components/content-preview'
import { PathField } from '@/components/path-field'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { ScrollArea } from '@/components/ui/scroll-area'
import { loadMonsterCatalog, useCatalog } from '@/lib/catalogs'
import { stashedPackIds, stashPackFullyUsed, usedIndex } from '@/lib/library-badges'
import type { ArmedEntry } from '@/hooks/use-library'
import { cn } from '@/lib/utils'
import { projectStore, useProjectStore } from '@/store/project-store'
import type {
  ContentPackEntry,
  EditorSidecar,
  PackSection,
  SourceState,
  StashedPack,
} from '@/types'

export interface LibraryPanelProps {
  projectPath: string
  sources: readonly SourceState[]
  onOpenSource: (path: string) => void
  onOpenStash: (packId: string) => void
  onClosePack: (identity: string) => void
  onRefreshPack: (source: SourceState) => void
  armed: ArmedEntry | null
  onArm: (entry: ArmedEntry) => void
  onDisarm: () => void
  onCopyWandering: (source: SourceState, section: PackSection) => void
}

function entryGlyphs(entry: ContentPackEntry): string {
  let glyphs = ''
  if (entry.name || entry.description) glyphs += 'p'
  if (entry.encounter) glyphs += 'E'
  if (entry.trap) glyphs += 'T'
  if (entry.treasure) glyphs += '$'
  if (entry.features.length > 0) glyphs += 'F'
  return glyphs
}

function entryLabel(entry: ContentPackEntry): string {
  if (entry.name) return entry.name
  const tail = entry.id.split('/').at(-1) ?? entry.id
  const [, value = tail] = tail.split(':', 2)
  try {
    return `Area ${decodeURIComponent(value)}`
  } catch {
    return `Area ${value}`
  }
}

function UsedBadge({ used }: { used: boolean }) {
  if (!used) return null
  return (
    <span
      className="rounded bg-accent px-1 font-mono text-[10px] text-accent-foreground"
      title="Placed at least once"
    >
      used
    </span>
  )
}

export function LibraryPanel({
  projectPath,
  sources,
  onOpenSource,
  onOpenStash,
  onClosePack,
  onRefreshPack,
  armed,
  onArm,
  onDisarm,
  onCopyWandering,
}: LibraryPanelProps) {
  const [path, setPath] = useState('')
  const [confirmDelete, setConfirmDelete] = useState<StashedPack | null>(null)
  // The open entry previews across every pack, keyed like the used badges
  // (`identity entryId`) — panel state; the packs themselves never change.
  const [previews, setPreviews] = useState<ReadonlySet<string>>(new Set())
  const togglePreview = (key: string) =>
    setPreviews((current) => {
      const next = new Set(current)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  const allPreviewKeys = sources.flatMap((source) =>
    source.pack.sections.flatMap((section) =>
      section.entries.map((entry) => `${source.identity} ${entry.id}`),
    ),
  )
  const allOpen = allPreviewKeys.length > 0 && allPreviewKeys.every((key) => previews.has(key))
  const sidecar = useProjectStore((state) => state.project?.sidecar ?? null)
  const used = usedIndex(sidecar ?? ({ copies: {} } as unknown as EditorSidecar))
  const stash = sidecar?.stash ?? []

  const deleteStashPack = (pack: StashedPack) => {
    onClosePack(pack.pack_id)
    void projectStore
      .getState()
      .patchSidecar([{ action: 'remove_stash_pack', pack_id: pack.pack_id }])
    setConfirmDelete(null)
  }

  return (
    <aside
      aria-label="Content library"
      data-testid="library-panel"
      className="flex h-full min-h-0 flex-col bg-card"
    >
      <div className="flex items-center gap-1 border-b px-2 py-1.5">
        <span className="text-xs font-medium">Library</span>
        {allPreviewKeys.length > 0 && (
          <Button
            variant="ghost"
            size="icon-sm"
            className="ml-auto"
            aria-pressed={allOpen}
            aria-label={allOpen ? 'Collapse all previews' : 'Expand all previews'}
            title={allOpen ? 'Collapse all previews' : 'Expand all previews'}
            onClick={() => setPreviews(allOpen ? new Set() : new Set(allPreviewKeys))}
          >
            {allOpen ? <ChevronsDownUpIcon /> : <ChevronsUpDownIcon />}
          </Button>
        )}
      </div>
      <ScrollArea className="min-h-0 w-full flex-1">
        {/* Pinned to the viewport's own width, which the author now sets by
            dragging the splitter: labels must truncate at whatever that width
            is, keeping the kind glyphs, used badges, and buttons in frame. The
            scroll area's own viewport is what holds the content to it — see
            the note in ui/scroll-area.tsx. */}
        <div className="flex w-full flex-col gap-3 p-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="library-source">Open a source</Label>
            <div className="flex gap-2">
              <PathField
                id="library-source"
                className="flex-1"
                kind="directory"
                title="Choose a project or workdir"
                value={path}
                placeholder="~/adventures/mill.osr"
                onChange={setPath}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && path) onOpenSource(path)
                }}
              />
              <Button
                variant="outline"
                size="sm"
                onClick={() => onOpenSource(path)}
                disabled={!path}
              >
                Open
              </Button>
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="self-start"
              onClick={() => onOpenSource(projectPath)}
            >
              This project
            </Button>
          </div>

          {stash.length > 0 && (
            <div className="flex flex-col gap-1" aria-label="Stash">
              <p className="text-xs font-medium text-muted-foreground">Stash</p>
              {stash.map((pack) => (
                <div
                  key={pack.pack_id}
                  className="flex items-center gap-2 text-sm"
                  data-testid={`stash-${pack.pack_id}`}
                >
                  <span className="min-w-0 flex-1 truncate">{pack.label}</span>
                  <UsedBadge used={stashPackFullyUsed(pack, used)} />
                  <Button
                    variant="outline"
                    size="sm"
                    aria-label={`Open ${pack.label}`}
                    onClick={() => onOpenStash(pack.pack_id)}
                  >
                    Open
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-destructive"
                    aria-label={`Delete ${pack.label}`}
                    onClick={() => setConfirmDelete(pack)}
                  >
                    Delete
                  </Button>
                </div>
              ))}
            </div>
          )}

          {sources.map((source) => (
            <PackView
              key={source.identity}
              source={source}
              used={used}
              armed={armed}
              previews={previews}
              onTogglePreview={(entryId) => togglePreview(`${source.identity} ${entryId}`)}
              onArm={onArm}
              onDisarm={onDisarm}
              onClose={() => onClosePack(source.identity)}
              onRefresh={() => onRefreshPack(source)}
              onCopyWandering={(section) => onCopyWandering(source, section)}
            />
          ))}
          {sources.length === 0 && stash.length === 0 && (
            <p className="text-xs text-muted-foreground">
              Open a finished project or workdir to drag its rooms onto this map. Replacing or
              clearing a level offers to bank its content here first.
            </p>
          )}
        </div>
      </ScrollArea>
      {confirmDelete && (
        <Dialog open onOpenChange={(next) => !next && setConfirmDelete(null)}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Delete stash pack</DialogTitle>
              <DialogDescription>
                {`Deleting "${confirmDelete.label}" discards ${describeStashContents(confirmDelete)} it banked. Copy records stay; the pack itself is gone for good.`}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setConfirmDelete(null)}>
                Cancel
              </Button>
              <Button variant="destructive" onClick={() => deleteStashPack(confirmDelete)}>
                Delete pack
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </aside>
  )
}

function describeStashContents(pack: StashedPack): string {
  const ids = stashedPackIds(pack)
  if (!ids) return 'the content'
  const rooms = `${ids.entries.length} ${ids.entries.length === 1 ? 'room' : 'rooms'}`
  return ids.wandering.length > 0 ? `the ${rooms} and wandering table` : `the ${rooms}`
}

function PackView({
  source,
  used,
  armed,
  previews,
  onTogglePreview,
  onArm,
  onDisarm,
  onClose,
  onRefresh,
  onCopyWandering,
}: {
  source: SourceState
  used: Set<string>
  armed: ArmedEntry | null
  previews: ReadonlySet<string>
  onTogglePreview: (entryId: string) => void
  onArm: (entry: ArmedEntry) => void
  onDisarm: () => void
  onClose: () => void
  onRefresh: () => void
  onCopyWandering: (section: PackSection) => void
}) {
  // Monster names resolve the way play would: the shipped catalog first —
  // osrlib's first-occurrence-wins order — then the pack's own bundled
  // templates (the closure carries every non-SRD reference), then the raw id.
  const shipped = useCatalog(loadMonsterCatalog)
  const nameFor = (templateId: string): string =>
    shipped?.find((monster) => monster.id === templateId)?.name ??
    source.pack.monsters.find((monster) => monster.id === templateId)?.name ??
    templateId
  return (
    <div
      className="flex flex-col gap-1 rounded-md border p-2"
      data-testid={`pack-${source.identity}`}
    >
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-sm font-medium" title={source.identity}>
          {source.label}
        </span>
        <span className="font-mono text-[10px] text-muted-foreground">
          {source.habitat === 'stash' ? 'stash' : 'project'}
        </span>
        <Button variant="ghost" size="sm" onClick={onRefresh}>
          Refresh
        </Button>
        <Button variant="ghost" size="sm" aria-label={`Close ${source.label}`} onClick={onClose}>
          Close
        </Button>
      </div>
      {source.findings.length > 0 && (
        <ul
          className="flex flex-col gap-0.5 text-xs text-muted-foreground"
          aria-label="Pack findings"
        >
          {source.findings.map((finding, index) => (
            <li key={index} className="break-words">
              <span className="font-mono">{finding.code}</span> {finding.message}
            </li>
          ))}
        </ul>
      )}
      {source.pack.sections.map((section) => (
        <div key={section.id} className="flex flex-col gap-0.5">
          <div className="flex items-center gap-2">
            <span className="min-w-0 flex-1 truncate text-xs font-medium" title={section.label}>
              {section.label}
            </span>
            {section.wandering && (
              <>
                <UsedBadge used={used.has(`${source.identity} ${section.id}`)} />
                <Button variant="outline" size="sm" onClick={() => onCopyWandering(section)}>
                  Copy wandering
                </Button>
              </>
            )}
          </div>
          {section.entries.map((entry) => {
            const isArmed = armed?.identity === source.identity && armed.entryId === entry.id
            const isOpen = previews.has(`${source.identity} ${entry.id}`)
            return (
              <Fragment key={entry.id}>
                <div
                  draggable
                  onDragStart={(event) => {
                    event.dataTransfer.effectAllowed = 'copy'
                    event.dataTransfer.setData(
                      'application/x-osr-pack-entry',
                      JSON.stringify({ identity: source.identity, entryId: entry.id }),
                    )
                  }}
                  className={cn(
                    'flex cursor-grab items-center gap-2 rounded px-1 py-0.5 text-sm hover:bg-accent/50',
                    isArmed && 'bg-accent',
                  )}
                  data-testid={`entry-${entry.id}`}
                >
                  <button
                    type="button"
                    className="shrink-0 text-muted-foreground hover:text-foreground"
                    aria-expanded={isOpen}
                    aria-label={`Preview ${entryLabel(entry)}`}
                    onClick={() => onTogglePreview(entry.id)}
                  >
                    {isOpen ? (
                      <ChevronDownIcon className="size-3.5" />
                    ) : (
                      <ChevronRightIcon className="size-3.5" />
                    )}
                  </button>
                  <span className="min-w-0 flex-1 truncate" title={entryLabel(entry)}>
                    {entryLabel(entry)}
                  </span>
                  <span
                    className="font-mono text-[10px] text-muted-foreground"
                    title="What this entry carries"
                  >
                    {entryGlyphs(entry)}
                  </span>
                  <UsedBadge used={used.has(`${source.identity} ${entry.id}`)} />
                  <Button
                    variant={isArmed ? 'secondary' : 'ghost'}
                    size="sm"
                    aria-pressed={isArmed}
                    aria-label={`${isArmed ? 'Disarm' : 'Place'} ${entryLabel(entry)}`}
                    onClick={() =>
                      isArmed ? onDisarm() : onArm({ identity: source.identity, entryId: entry.id })
                    }
                  >
                    {isArmed ? 'Armed' : 'Place'}
                  </Button>
                </div>
                {isOpen && (
                  <div
                    className="mb-1 ml-2.5 flex flex-col gap-1 border-l pl-3"
                    data-testid={`entry-preview-${entry.id}`}
                  >
                    {entry.description !== '' && (
                      <p className="text-xs break-words whitespace-pre-wrap text-muted-foreground">
                        {entry.description}
                      </p>
                    )}
                    <ContentPreviewLines contents={entry} nameFor={nameFor} />
                    {entry.description === '' && !hasPreviewContents(entry) && (
                      <p className="text-xs text-muted-foreground italic">
                        Only the name — nothing else travels.
                      </p>
                    )}
                  </div>
                )}
              </Fragment>
            )
          })}
        </div>
      ))}
    </div>
  )
}
