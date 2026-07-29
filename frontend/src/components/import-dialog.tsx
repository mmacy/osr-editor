// The import dialog: source path → sniff (preselects the importer) → load →
// pick a source level → choose the destination → one atomic op batch through
// the ordinary ops route. The path takes a directory or a file and the picker
// offers both — sniff is what disambiguates, so no importer needs a picker of
// its own. The payload's multi-level shape is the protocol's; the dialog imports
// one level per invocation. The body mounts only while open, so
// per-invocation state initializes on mount.
import { useEffect, useState } from 'react'
import { toast } from 'sonner'

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
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { api, ApiRequestError } from '@/lib/api'
import type { NavTarget } from '@/lib/address'
import { importOps, unresolvedTransitionIndices } from '@/lib/import-mapping'
import { contentTallyLines, replacedContentTally } from '@/lib/level-content'
import { KIND_LABELS } from '@/lib/transitions'
import { projectStore } from '@/store/project-store'
import type { Adventure, ImportedGeometry, ImporterInfo } from '@/types'

function toastApiError(error: unknown): void {
  if (error instanceof ApiRequestError) {
    toast.error(error.detail.message, { description: error.detail.remedy ?? undefined })
  } else {
    toast.error(error instanceof Error ? error.message : String(error))
  }
}

interface ImportDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  document: Adventure
  dungeonId: string
  onNavigate: (target: NavTarget) => void
  // Forge-backed mode: replace-an-existing-level only (a new level has no
  // override kind — the mode is absent, not disabled), and the batch emits no
  // ResizeLevel (dimensions are derived).
  forge?: boolean
}

export function ImportDialog(props: ImportDialogProps) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      {props.open && <ImportDialogBody {...props} />}
    </Dialog>
  )
}

function nextFreeLevelNumber(document: Adventure, dungeonId: string): string {
  const dungeon = document.dungeons.find((candidate) => candidate.id === dungeonId)
  return dungeon ? String(Math.max(...dungeon.levels.map((level) => level.number)) + 1) : '1'
}

function ImportDialogBody({
  onOpenChange,
  document,
  dungeonId,
  onNavigate,
  forge = false,
}: ImportDialogProps) {
  const [importers, setImporters] = useState<ImporterInfo[]>([])
  const [path, setPath] = useState('')
  const [matches, setMatches] = useState<string[] | null>(null)
  const [formatId, setFormatId] = useState<string | null>(null)
  const [geometry, setGeometry] = useState<ImportedGeometry | null>(null)
  const [sourceIndex, setSourceIndex] = useState(0)
  const [targetDungeon, setTargetDungeon] = useState(dungeonId)
  const [mode, setMode] = useState<'new' | 'replace'>(forge ? 'replace' : 'new')
  const [newNumber, setNewNumber] = useState(() => nextFreeLevelNumber(document, dungeonId))
  const [replaceNumber, setReplaceNumber] = useState<number | null>(
    () =>
      document.dungeons.find((candidate) => candidate.id === dungeonId)?.levels[0]?.number ?? null,
  )
  const [keepUnresolved, setKeepUnresolved] = useState<number[]>([])
  // Adoption defaults off: an import is a geometry gesture, and silently
  // rewriting the adventure's name is not what the author asked for.
  const [adoptTitle, setAdoptTitle] = useState(false)
  const [adoptDescription, setAdoptDescription] = useState(false)
  // The replace-mode confirm step, with the stash offer defaulting on: losing
  // stocking is expensive, and a surplus stash pack is cheap and deletable.
  const [confirmingReplace, setConfirmingReplace] = useState(false)
  const [stashFirst, setStashFirst] = useState(true)

  useEffect(() => {
    api
      .listImporters()
      .then((response) => setImporters(response.importers))
      .catch(toastApiError)
  }, [])

  const dungeon = document.dungeons.find((candidate) => candidate.id === targetDungeon)

  const changeTargetDungeon = (nextId: string) => {
    setTargetDungeon(nextId)
    setNewNumber(nextFreeLevelNumber(document, nextId))
    setReplaceNumber(
      document.dungeons.find((candidate) => candidate.id === nextId)?.levels[0]?.number ?? null,
    )
    setKeepUnresolved([])
  }

  const sniff = () => {
    if (!path) return
    api
      .sniffImporters(path)
      .then((result) => {
        setMatches(result.format_ids)
        setFormatId(result.format_ids[0] ?? null)
        setGeometry(null)
      })
      .catch(toastApiError)
  }

  const load = () => {
    if (!formatId || !path) return
    api
      .loadGeometry(formatId, path)
      .then((loaded) => {
        setGeometry(loaded)
        setSourceIndex(0)
        setKeepUnresolved([])
        setAdoptTitle(false)
        setAdoptDescription(false)
      })
      .catch(toastApiError)
  }

  // Each control appears only when the source actually carries the field and
  // its value differs from the project's own — there is nothing to adopt
  // otherwise, and an inert checkbox is noise.
  const titleAdoptable = geometry?.title != null && geometry.title !== document.name
  const descriptionAdoptable =
    geometry?.description != null && geometry.description !== document.description

  const source = geometry?.levels[sourceIndex] ?? null
  const destinationNumber = mode === 'new' ? Number(newNumber) : replaceNumber
  const destinationValid =
    dungeon !== undefined &&
    destinationNumber !== null &&
    Number.isInteger(destinationNumber) &&
    destinationNumber >= 1 &&
    (mode === 'replace' || !dungeon.levels.some((level) => level.number === destinationNumber))
  const unresolved =
    source && destinationValid
      ? unresolvedTransitionIndices(source, document, {
          dungeonId: targetDungeon,
          levelNumber: destinationNumber,
        })
      : []

  const existingReplaced =
    mode === 'replace' && destinationNumber !== null
      ? (dungeon?.levels.find((level) => level.number === destinationNumber) ?? null)
      : null
  const replacedTally = existingReplaced ? replacedContentTally(existingReplaced) : null
  const replacesContent = replacedTally !== null && contentTallyLines(replacedTally).length > 0

  const proceed = async () => {
    if (!source || !destinationValid || destinationNumber === null) return
    if (mode === 'replace' && stashFirst && replacesContent) {
      // The capture runs at the verified revision before the batch; a failed
      // capture (a raced 409) stops here with the level intact.
      const stashed = await projectStore.getState().stashLevel(targetDungeon, destinationNumber)
      if (!stashed) return
    }
    const adopt: { name?: string; description?: string } = {}
    if (adoptTitle && titleAdoptable) adopt.name = geometry?.title ?? ''
    if (adoptDescription && descriptionAdoptable) adopt.description = geometry?.description ?? ''
    const committed = await projectStore.getState().commit((current) =>
      importOps(source, current, {
        dungeonId: targetDungeon,
        levelNumber: destinationNumber,
        mode,
        keepUnresolved,
        forge,
        adopt,
      }),
    )
    if (committed) {
      onOpenChange(false)
      toast.success(`Imported ${source.label} as level ${destinationNumber}`)
      onNavigate({ kind: 'level', dungeonId: targetDungeon, levelNumber: destinationNumber })
    }
  }

  const submit = () => {
    if (!source || !destinationValid || destinationNumber === null) return
    if (mode === 'replace' && replacesContent) {
      setConfirmingReplace(true)
      return
    }
    void proceed()
  }

  if (confirmingReplace && replacedTally) {
    return (
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Replace level {destinationNumber}</DialogTitle>
          <DialogDescription>
            The new map replaces the level&apos;s keyed areas and the content they carry, in one
            undo step. Level-scope features and the wandering monsters stay.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-1">
          <p className="text-sm font-medium">This removes:</p>
          <ul className="flex flex-col gap-0.5" aria-label="Content the replacement removes">
            {contentTallyLines(replacedTally).map((line) => (
              <li key={line} className="text-sm text-muted-foreground">
                {line}
              </li>
            ))}
          </ul>
        </div>
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={stashFirst}
            onChange={(event) => setStashFirst(event.target.checked)}
            aria-label="Stash this level's content in the library first"
          />
          <span>
            Stash this level&apos;s content in the library first
            <span className="block text-xs text-muted-foreground">
              Banks the rooms and the wandering table as a stash pack — re-place them on the new
              map, room by room, from the library panel.
            </span>
          </span>
        </label>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setConfirmingReplace(false)}>
            Back
          </Button>
          <Button variant="destructive" onClick={() => void proceed()}>
            Replace level
          </Button>
        </DialogFooter>
      </DialogContent>
    )
  }

  // This dialog is the one that found the grid-child `min-width: auto` trap
  // `DialogContent` now zeroes for every dialog — see the comment there. What
  // stays local is what that fix alone does not cover: a `<select>` is sized by
  // its widest option and needs `max-w-full` to be capped, and the long strings
  // need somewhere to break.
  return (
    <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
      <DialogHeader>
        <DialogTitle>Import geometry</DialogTitle>
        <DialogDescription>
          Imported geometry lands as one ordinary op batch — undoable, immediately linted, a starter
          map rather than a locked artifact.
        </DialogDescription>
      </DialogHeader>
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="import-path">Source path</Label>
          <div className="flex gap-2">
            <PathField
              id="import-path"
              className="flex-1"
              kind="any"
              title="Choose a geometry source"
              value={path}
              placeholder="~/maps/dungeon.json"
              onChange={setPath}
              onKeyDown={(event) => {
                if (event.key === 'Enter') sniff()
              }}
            />
            <Button variant="outline" onClick={sniff} disabled={!path}>
              Sniff
            </Button>
          </div>
        </div>
        {matches !== null && matches.length === 0 && (
          <p className="text-sm text-muted-foreground">
            No installed importer recognizes this path.
          </p>
        )}
        {matches !== null && matches.length > 0 && (
          <div className="flex items-end gap-2">
            <div className="flex min-w-0 flex-col gap-1.5">
              <Label htmlFor="import-format">Importer</Label>
              <select
                id="import-format"
                className="h-8 max-w-full rounded-md border border-input bg-transparent px-2 text-sm"
                value={formatId ?? ''}
                onChange={(event) => setFormatId(event.target.value)}
              >
                {matches.map((match) => (
                  <option key={match} value={match}>
                    {importers.find((importer) => importer.format_id === match)?.label ?? match}
                  </option>
                ))}
              </select>
            </div>
            <Button onClick={load} disabled={!formatId}>
              Load
            </Button>
          </div>
        )}
        {geometry && (
          <>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="import-source-level">Source level</Label>
              <select
                id="import-source-level"
                className="h-8 max-w-full rounded-md border border-input bg-transparent px-2 text-sm"
                value={sourceIndex}
                onChange={(event) => {
                  setSourceIndex(Number(event.target.value))
                  setKeepUnresolved([])
                }}
              >
                {geometry.levels.map((level, index) => (
                  <option key={index} value={index}>
                    {level.label} ({level.width}×{level.height})
                  </option>
                ))}
              </select>
            </div>
            {(titleAdoptable || descriptionAdoptable) && (
              <div className="flex flex-col gap-1" aria-label="Adopt source metadata">
                <p className="text-sm font-medium">
                  The source carries metadata of its own. Adopting rides the same undo step as the
                  map.
                </p>
                {titleAdoptable && (
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={adoptTitle}
                      onChange={(event) => setAdoptTitle(event.target.checked)}
                    />
                    Adopt the title
                    <span className="min-w-0 truncate text-xs text-muted-foreground">
                      {geometry.title}
                    </span>
                  </label>
                )}
                {descriptionAdoptable && (
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={adoptDescription}
                      onChange={(event) => setAdoptDescription(event.target.checked)}
                    />
                    Adopt the description
                    <span className="min-w-0 truncate text-xs text-muted-foreground">
                      {geometry.description}
                    </span>
                  </label>
                )}
              </div>
            )}
            {source && source.notes.length > 0 && (
              <div className="flex min-w-0 flex-col gap-0.5" aria-label="Importer notes">
                <p className="text-sm font-medium">The importer flagged:</p>
                {/* A note wraps onto two or three lines now that it is allowed
                    to, so the box is taller than the one-line-per-note version
                    it replaces — same handful of notes visible before scrolling.
                    `break-words` is for the ones that name a cell or an id: an
                    unbreakable token is the one string wrapping alone cannot
                    fit. */}
                <ul className="flex max-h-56 flex-col gap-1 overflow-y-auto text-xs text-muted-foreground">
                  {source.notes.map((note, index) => (
                    <li key={index} className="break-words">
                      {note}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="import-target-dungeon">Destination dungeon</Label>
              <select
                id="import-target-dungeon"
                className="h-8 max-w-full rounded-md border border-input bg-transparent px-2 text-sm"
                value={targetDungeon}
                onChange={(event) => changeTargetDungeon(event.target.value)}
              >
                {document.dungeons.map((candidate) => (
                  <option key={candidate.id} value={candidate.id}>
                    {candidate.id}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-2">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="import-mode"
                  checked={mode === 'new'}
                  onChange={() => {
                    // The offer-in-place posture, backported from phase 4: in
                    // a forge project the new-level mode stays a visible
                    // choice, and choosing it opens the blocked-op dialog (a
                    // new level has no override kind) with detach as the
                    // unlock — the mode itself never engages.
                    if (forge) {
                      projectStore.getState().setBlockedOp({
                        op: 'add_level',
                        address: `dungeon:${encodeURIComponent(targetDungeon)}`,
                        // Mirrors the server's _BLOCKED_MESSAGES entry for
                        // add_level — op_unsupported_forge stays the authority.
                        message: 'level structure has no override kind',
                      })
                      return
                    }
                    setMode('new')
                  }}
                />
                Add as a new level, number
                <Input
                  aria-label="New level number"
                  className="h-7 w-20 font-mono"
                  type="number"
                  min={1}
                  value={newNumber}
                  onChange={(event) => setNewNumber(event.target.value)}
                  disabled={mode !== 'new'}
                />
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="import-mode"
                  checked={mode === 'replace'}
                  onChange={() => setMode('replace')}
                />
                Replace the geometry of level
                <select
                  aria-label="Replace level"
                  className="h-7 rounded-md border border-input bg-transparent px-2 text-sm"
                  value={replaceNumber ?? ''}
                  onChange={(event) => setReplaceNumber(Number(event.target.value))}
                  disabled={mode !== 'replace'}
                >
                  {[...(dungeon?.levels ?? [])]
                    .sort((a, b) => a.number - b.number)
                    .map((level) => (
                      <option key={level.number} value={level.number}>
                        {level.number}
                      </option>
                    ))}
                </select>
              </label>
              {forge && (
                <p className="text-xs text-muted-foreground">
                  The replacement lands as geometry: overrides — the reproducible loop keeps
                  running. Level dimensions are derived, so the grid never shrinks below the
                  synthesized floor plan&apos;s extent.
                </p>
              )}
            </div>
            {source && unresolved.length > 0 && (
              <div className="flex flex-col gap-1" aria-label="Unresolved transitions">
                <p className="text-sm font-medium">
                  These transitions target levels the destination does not resolve; kept ones land
                  as authored and surface as validation findings.
                </p>
                <ul className="flex flex-col gap-0.5 text-sm">
                  {unresolved.map((index) => {
                    const transition = source.transitions[index]
                    return (
                      <li key={index}>
                        <label className="flex items-start gap-2">
                          <input
                            className="mt-0.5 shrink-0"
                            type="checkbox"
                            checked={keepUnresolved.includes(index)}
                            onChange={(event) =>
                              setKeepUnresolved((current) =>
                                event.target.checked
                                  ? [...current, index]
                                  : current.filter((kept) => kept !== index),
                              )
                            }
                          />
                          <span className="min-w-0 break-words text-xs">
                            {KIND_LABELS[transition.kind]} at{' '}
                            <span className="font-mono">
                              ({transition.position[0]}, {transition.position[1]}) →{' '}
                              {transition.to_dungeon_id}/{transition.to_level_number}
                            </span>
                          </span>
                        </label>
                      </li>
                    )
                  })}
                </ul>
              </div>
            )}
          </>
        )}
      </div>
      <DialogFooter>
        <Button onClick={submit} disabled={!source || !destinationValid}>
          Import
        </Button>
      </DialogFooter>
    </DialogContent>
  )
}
