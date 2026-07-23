// The import dialog: source path → sniff (preselects the importer) → load →
// pick a source level → choose the destination → one atomic op batch through
// the ordinary ops route. The payload's multi-level shape is the protocol's;
// the dialog imports one level per invocation. The body mounts only while
// open, so per-invocation state initializes on mount.
import { useEffect, useState } from 'react'
import { toast } from 'sonner'

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
      })
      .catch(toastApiError)
  }

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

  const submit = () => {
    if (!source || !destinationValid || destinationNumber === null) return
    if (mode === 'replace') {
      const existing = dungeon?.levels.find((level) => level.number === destinationNumber)
      const carriesContent = existing?.areas.some(
        (area) => area.encounter || area.features.length > 0 || area.trap || area.treasure,
      )
      if (
        carriesContent &&
        !window.confirm(
          `Replacing level ${destinationNumber} removes its areas and the content they carry. Continue?`,
        )
      ) {
        return
      }
    }
    void projectStore
      .getState()
      .commit((current) =>
        importOps(source, current, {
          dungeonId: targetDungeon,
          levelNumber: destinationNumber,
          mode,
          keepUnresolved,
          forge,
        }),
      )
      .then((committed) => {
        if (committed) {
          onOpenChange(false)
          toast.success(`Imported ${source.label} as level ${destinationNumber}`)
          onNavigate({ kind: 'level', dungeonId: targetDungeon, levelNumber: destinationNumber })
        }
      })
  }

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
            <Input
              id="import-path"
              className="font-mono"
              value={path}
              placeholder="/absolute/path/to/project"
              onChange={(event) => setPath(event.target.value)}
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
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="import-format">Importer</Label>
              <select
                id="import-format"
                className="h-8 rounded-md border border-input bg-transparent px-2 text-sm"
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
                className="h-8 rounded-md border border-input bg-transparent px-2 text-sm"
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
            {source && source.notes.length > 0 && (
              <div className="flex flex-col gap-0.5" aria-label="Importer notes">
                <p className="text-sm font-medium">The importer flagged:</p>
                <ul className="max-h-28 overflow-y-auto text-xs text-muted-foreground">
                  {source.notes.map((note, index) => (
                    <li key={index}>{note}</li>
                  ))}
                </ul>
              </div>
            )}
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="import-target-dungeon">Destination dungeon</Label>
              <select
                id="import-target-dungeon"
                className="h-8 rounded-md border border-input bg-transparent px-2 text-sm"
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
                        <label className="flex items-center gap-2">
                          <input
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
                          <span className="font-mono text-xs">
                            {transition.kind} at ({transition.position[0]}, {transition.position[1]}
                            ) → {transition.to_dungeon_id}/{transition.to_level_number}
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
