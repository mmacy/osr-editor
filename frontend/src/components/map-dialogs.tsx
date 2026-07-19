// The map editor's dialogs: dungeon and level management, level properties
// (dimensions, entrance, the relocated wandering form), and the transition
// placement dialog with its mini target-level picker. Each dialog mounts its
// body only while open, so per-invocation state initializes on mount — no
// reset effects.
import { useEffect, useRef, useState } from 'react'

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
import { integerInRange, useCommittedField } from '@/hooks/use-committed-field'
import { navTargetFor, type NavTarget } from '@/lib/address'
import { transitionOps } from '@/map/gestures'
import { projectStore } from '@/store/project-store'
import type {
  Adventure,
  DungeonSpec,
  LevelSpec,
  Position,
  TransitionSpec,
  WanderingSpec,
} from '@/types'

interface Offender {
  address: string
  message: string
}

function findLevel(document: Adventure, dungeonId: string, levelNumber: number): LevelSpec | null {
  return (
    document.dungeons
      .find((dungeon) => dungeon.id === dungeonId)
      ?.levels.find((level) => level.number === levelNumber) ?? null
  )
}

// The next free dungeon id in the editor's own naming convention.
export function nextFreeDungeonId(document: Adventure): string {
  const taken = new Set(document.dungeons.map((dungeon) => dungeon.id))
  let candidate = 1
  while (taken.has(`dungeon-${candidate}`)) candidate += 1
  return `dungeon-${candidate}`
}

function parsePositiveInt(value: string): number | null {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed >= 1 ? parsed : null
}

interface AddDungeonProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  document: Adventure
  onNavigate: (target: NavTarget) => void
}

export function AddDungeonDialog(props: AddDungeonProps) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      {props.open && <AddDungeonBody {...props} />}
    </Dialog>
  )
}

function AddDungeonBody({ onOpenChange, document, onNavigate }: AddDungeonProps) {
  const [dungeonId, setDungeonId] = useState(() => nextFreeDungeonId(document))
  const [name, setName] = useState('')
  const [width, setWidth] = useState('30')
  const [height, setHeight] = useState('30')
  const parsedWidth = parsePositiveInt(width)
  const parsedHeight = parsePositiveInt(height)
  const submit = () => {
    if (!dungeonId || !parsedWidth || !parsedHeight) return
    void projectStore
      .getState()
      .commit([
        {
          op: 'add_dungeon',
          dungeon_id: dungeonId,
          name,
          width: parsedWidth,
          height: parsedHeight,
        },
      ])
      .then((committed) => {
        if (committed) {
          onOpenChange(false)
          onNavigate({ kind: 'level', dungeonId, levelNumber: 1 })
        }
      })
  }
  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle>Add dungeon</DialogTitle>
        <DialogDescription>
          A new dungeon starts with level 1 and an entrance at (0, 0) — valid from birth; move the
          entrance with the entrance tool.
        </DialogDescription>
      </DialogHeader>
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="add-dungeon-id">Dungeon id</Label>
          <Input
            id="add-dungeon-id"
            className="font-mono"
            value={dungeonId}
            onChange={(event) => setDungeonId(event.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="add-dungeon-name">Name</Label>
          <Input
            id="add-dungeon-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </div>
        <DimensionFields width={width} height={height} onWidth={setWidth} onHeight={setHeight} />
      </div>
      <DialogFooter>
        <Button onClick={submit} disabled={!dungeonId || !parsedWidth || !parsedHeight}>
          Add dungeon
        </Button>
      </DialogFooter>
    </DialogContent>
  )
}

interface RenameDungeonProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  dungeonId: string
  levelNumber: number
  onNavigate: (target: NavTarget) => void
}

export function RenameDungeonDialog(props: RenameDungeonProps) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      {props.open && <RenameDungeonBody {...props} />}
    </Dialog>
  )
}

function RenameDungeonBody({
  onOpenChange,
  dungeonId,
  levelNumber,
  onNavigate,
}: RenameDungeonProps) {
  const [newId, setNewId] = useState(dungeonId)
  const submit = () => {
    if (!newId || newId === dungeonId) return
    void projectStore
      .getState()
      .commit([{ op: 'rename_dungeon', old_id: dungeonId, new_id: newId }])
      .then((committed) => {
        if (committed) {
          onOpenChange(false)
          onNavigate({ kind: 'level', dungeonId: newId, levelNumber })
        }
      })
  }
  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle>Rename dungeon</DialogTitle>
        <DialogDescription>
          Renaming cascades: the town's travel entry and every transition targeting{' '}
          <span className="font-mono">{dungeonId}</span> follow the new id, in one undo step.
        </DialogDescription>
      </DialogHeader>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="rename-dungeon-id">New id</Label>
        <Input
          id="rename-dungeon-id"
          className="font-mono"
          value={newId}
          onChange={(event) => setNewId(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') submit()
          }}
        />
      </div>
      <DialogFooter>
        <Button onClick={submit} disabled={!newId || newId === dungeonId}>
          Rename
        </Button>
      </DialogFooter>
    </DialogContent>
  )
}

interface AddLevelProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  dungeon: DungeonSpec
  onNavigate: (target: NavTarget) => void
}

export function AddLevelDialog(props: AddLevelProps) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      {props.open && <AddLevelBody {...props} />}
    </Dialog>
  )
}

function AddLevelBody({ onOpenChange, dungeon, onNavigate }: AddLevelProps) {
  const [number, setNumber] = useState(() =>
    String(Math.max(...dungeon.levels.map((level) => level.number)) + 1),
  )
  const [width, setWidth] = useState('30')
  const [height, setHeight] = useState('30')
  const parsedNumber = parsePositiveInt(number)
  const parsedWidth = parsePositiveInt(width)
  const parsedHeight = parsePositiveInt(height)
  const submit = () => {
    if (!parsedNumber || !parsedWidth || !parsedHeight) return
    void projectStore
      .getState()
      .commit([
        {
          op: 'add_level',
          dungeon_id: dungeon.id,
          number: parsedNumber,
          width: parsedWidth,
          height: parsedHeight,
        },
      ])
      .then((committed) => {
        if (committed) {
          onOpenChange(false)
          onNavigate({ kind: 'level', dungeonId: dungeon.id, levelNumber: parsedNumber })
        }
      })
  }
  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle>Add level</DialogTitle>
        <DialogDescription>
          A new level has no entrance — validation requires one per dungeon, not per level.
        </DialogDescription>
      </DialogHeader>
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="add-level-number">Level number</Label>
          <Input
            id="add-level-number"
            className="w-24 font-mono"
            type="number"
            min={1}
            value={number}
            onChange={(event) => setNumber(event.target.value)}
          />
        </div>
        <DimensionFields width={width} height={height} onWidth={setWidth} onHeight={setHeight} />
      </div>
      <DialogFooter>
        <Button onClick={submit} disabled={!parsedNumber || !parsedWidth || !parsedHeight}>
          Add level
        </Button>
      </DialogFooter>
    </DialogContent>
  )
}

interface RenumberLevelProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  dungeonId: string
  levelNumber: number
  onNavigate: (target: NavTarget) => void
}

export function RenumberLevelDialog(props: RenumberLevelProps) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      {props.open && <RenumberLevelBody {...props} />}
    </Dialog>
  )
}

function RenumberLevelBody({
  onOpenChange,
  dungeonId,
  levelNumber,
  onNavigate,
}: RenumberLevelProps) {
  const [newNumber, setNewNumber] = useState(String(levelNumber))
  const parsed = parsePositiveInt(newNumber)
  const submit = () => {
    if (!parsed || parsed === levelNumber) return
    void projectStore
      .getState()
      .commit([
        {
          op: 'renumber_level',
          dungeon_id: dungeonId,
          old_number: levelNumber,
          new_number: parsed,
        },
      ])
      .then((committed) => {
        if (committed) {
          onOpenChange(false)
          onNavigate({ kind: 'level', dungeonId, levelNumber: parsed })
        }
      })
  }
  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle>Renumber level</DialogTitle>
        <DialogDescription>
          Every transition in the document targeting level {levelNumber} of{' '}
          <span className="font-mono">{dungeonId}</span> follows the new number, in one undo step.
        </DialogDescription>
      </DialogHeader>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="renumber-level-number">New number</Label>
        <Input
          id="renumber-level-number"
          className="w-24 font-mono"
          type="number"
          min={1}
          value={newNumber}
          onChange={(event) => setNewNumber(event.target.value)}
        />
      </div>
      <DialogFooter>
        <Button onClick={submit} disabled={!parsed || parsed === levelNumber}>
          Renumber
        </Button>
      </DialogFooter>
    </DialogContent>
  )
}

interface ResizeLevelProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  document: Adventure
  dungeonId: string
  levelNumber: number
  onNavigate: (target: NavTarget) => void
}

export function ResizeLevelDialog(props: ResizeLevelProps) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      {props.open && <ResizeLevelBody {...props} />}
    </Dialog>
  )
}

function ResizeLevelBody({
  onOpenChange,
  document,
  dungeonId,
  levelNumber,
  onNavigate,
}: ResizeLevelProps) {
  const level = findLevel(document, dungeonId, levelNumber)
  const [width, setWidth] = useState(() => String(level?.width ?? ''))
  const [height, setHeight] = useState(() => String(level?.height ?? ''))
  const [offenders, setOffenders] = useState<Offender[]>([])
  const parsedWidth = parsePositiveInt(width)
  const parsedHeight = parsePositiveInt(height)
  const submit = () => {
    if (!parsedWidth || !parsedHeight) return
    setOffenders([])
    void projectStore
      .getState()
      .commit(
        [
          {
            op: 'resize_level',
            dungeon_id: dungeonId,
            level_number: levelNumber,
            width: parsedWidth,
            height: parsedHeight,
          },
        ],
        {
          onError: (error) => {
            if (error.detail.code !== 'op_invariant') return false
            const details = error.detail.details as { offenders?: Offender[] } | null
            setOffenders(details?.offenders ?? [])
            return true
          },
        },
      )
      .then((committed) => {
        if (committed) onOpenChange(false)
      })
  }
  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle>Resize level</DialogTitle>
        <DialogDescription>
          Shrinking below existing content is refused with the offenders listed; edges stranded
          outside the new bounds are pruned.
        </DialogDescription>
      </DialogHeader>
      <DimensionFields width={width} height={height} onWidth={setWidth} onHeight={setHeight} />
      {offenders.length > 0 && (
        <div className="flex flex-col gap-1" aria-label="Resize offenders">
          <p className="text-sm font-medium text-destructive">This resize would strand:</p>
          <ul className="flex max-h-40 flex-col gap-0.5 overflow-y-auto">
            {offenders.map((offender, index) => {
              const target = navTargetFor(offender.address, document)
              return (
                <li key={`${offender.address}-${index}`}>
                  {target ? (
                    <button
                      type="button"
                      className="w-full rounded-sm px-1 py-0.5 text-left text-sm hover:bg-accent"
                      onClick={() => {
                        onOpenChange(false)
                        onNavigate(target)
                      }}
                    >
                      {offender.message}
                    </button>
                  ) : (
                    <span className="px-1 text-sm">{offender.message}</span>
                  )}
                </li>
              )
            })}
          </ul>
        </div>
      )}
      <DialogFooter>
        <Button onClick={submit} disabled={!parsedWidth || !parsedHeight}>
          Resize
        </Button>
      </DialogFooter>
    </DialogContent>
  )
}

function DimensionFields({
  width,
  height,
  onWidth,
  onHeight,
}: {
  width: string
  height: string
  onWidth: (value: string) => void
  onHeight: (value: string) => void
}) {
  return (
    <div className="flex gap-3">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="dimension-width">Width</Label>
        <Input
          id="dimension-width"
          className="w-24 font-mono"
          type="number"
          min={1}
          value={width}
          onChange={(event) => onWidth(event.target.value)}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="dimension-height">Height</Label>
        <Input
          id="dimension-height"
          className="w-24 font-mono"
          type="number"
          min={1}
          value={height}
          onChange={(event) => onHeight(event.target.value)}
        />
      </div>
    </div>
  )
}

export function LevelPropertiesDialog({
  open,
  onOpenChange,
  document,
  dungeonId,
  levelNumber,
  onOpenResize,
  onOpenRenumber,
  onNavigate,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  document: Adventure
  dungeonId: string
  levelNumber: number
  onOpenResize: () => void
  onOpenRenumber: () => void
  onNavigate: (target: NavTarget) => void
}) {
  const dungeon = document.dungeons.find((candidate) => candidate.id === dungeonId)
  const level = dungeon?.levels.find((candidate) => candidate.number === levelNumber)
  if (!dungeon || !level) return null
  const lastLevel = dungeon.levels.length === 1
  const clearEntrance = () => {
    void projectStore
      .getState()
      .commit([
        { op: 'set_entrance', dungeon_id: dungeonId, level_number: levelNumber, entrance: null },
      ])
  }
  const removeLevel = () => {
    if (
      !window.confirm(`Remove level ${levelNumber} of ${dungeonId}? Its geometry is discarded.`)
    ) {
      return
    }
    const fallback = dungeon.levels.find((candidate) => candidate.number !== levelNumber)
    void projectStore
      .getState()
      .commit([{ op: 'remove_level', dungeon_id: dungeonId, level_number: levelNumber }])
      .then((committed) => {
        if (committed && fallback) {
          onOpenChange(false)
          onNavigate({ kind: 'level', dungeonId, levelNumber: fallback.number })
        }
      })
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>Level properties</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-3">
            <p className="text-sm">
              Grid{' '}
              <span className="font-mono">
                {level.width}×{level.height}
              </span>
            </p>
            <Button variant="outline" size="sm" onClick={onOpenResize}>
              Resize…
            </Button>
            <Button variant="outline" size="sm" onClick={onOpenRenumber}>
              Renumber…
            </Button>
          </div>
          <div className="flex items-center gap-3">
            <p className="text-sm">
              Entrance{' '}
              {level.entrance ? (
                <span className="font-mono">
                  ({level.entrance[0]}, {level.entrance[1]})
                </span>
              ) : (
                <span className="text-muted-foreground">
                  none — place one with the entrance tool
                </span>
              )}
            </p>
            {level.entrance && (
              <Button variant="outline" size="sm" onClick={clearEntrance}>
                Clear entrance
              </Button>
            )}
          </div>
          <WanderingForm
            dungeonId={dungeonId}
            levelNumber={levelNumber}
            wandering={level.wandering}
          />
          <div>
            <Button
              variant="destructive"
              size="sm"
              onClick={removeLevel}
              disabled={lastLevel}
              title={lastLevel ? 'A dungeon needs at least one level.' : undefined}
            >
              Remove level
            </Button>
            {lastLevel && (
              <p className="mt-1 text-xs text-muted-foreground">
                A dungeon needs at least one level.
              </p>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// The wandering form, relocated from phase 1's LevelForm — same ops, new home.
function WanderingForm({
  dungeonId,
  levelNumber,
  wandering,
}: {
  dungeonId: string
  levelNumber: number
  wandering: WanderingSpec
}) {
  const commitPatch = (patch: Partial<Pick<WanderingSpec, 'chance_in_six' | 'interval_turns'>>) => {
    void projectStore.getState().commit((current) => {
      const target = findLevel(current, dungeonId, levelNumber)
      if (!target) return []
      return [
        {
          op: 'set_wandering',
          dungeon_id: dungeonId,
          level_number: levelNumber,
          wandering: { ...target.wandering, ...patch },
        },
      ]
    })
  }
  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-sm font-medium">Wandering monsters</h3>
      <div className="flex items-end gap-4">
        <WanderingNumberField
          id="wandering-chance"
          label="Chance-in-six"
          value={wandering.chance_in_six}
          min={0}
          max={6}
          onCommit={(value) => commitPatch({ chance_in_six: value })}
        />
        <WanderingNumberField
          id="wandering-interval"
          label="Check interval (turns)"
          value={wandering.interval_turns}
          min={1}
          onCommit={(value) => commitPatch({ interval_turns: value })}
        />
      </div>
      {wandering.table && (
        <p className="text-xs text-muted-foreground">
          This level's inline encounter table (
          <span className="font-mono">{wandering.table.id}</span>) is preserved unchanged; its
          editor arrives in a later release.
        </p>
      )}
    </div>
  )
}

function WanderingNumberField({
  id,
  label,
  value,
  min,
  max,
  onCommit,
}: {
  id: string
  label: string
  value: number
  min: number
  max?: number
  onCommit: (value: number) => void
}) {
  const field = useCommittedField(
    String(value),
    (draft) => onCommit(Number(draft)),
    integerInRange(min, max),
  )
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} className="w-28 font-mono" type="number" min={min} max={max} {...field} />
    </div>
  )
}

const KINDS: Array<TransitionSpec['kind']> = ['stairs_down', 'stairs_up', 'trapdoor', 'chute']
const FACINGS: Array<TransitionSpec['to_facing']> = ['north', 'east', 'south', 'west']

interface TransitionDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  document: Adventure
  dungeonId: string
  levelNumber: number
  sourceCell: Position
}

export function TransitionDialog(props: TransitionDialogProps) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      {props.open && <TransitionBody {...props} />}
    </Dialog>
  )
}

function TransitionBody({
  onOpenChange,
  document,
  dungeonId,
  levelNumber,
  sourceCell,
}: TransitionDialogProps) {
  const [kind, setKind] = useState<TransitionSpec['kind']>('stairs_down')
  const [targetDungeon, setTargetDungeon] = useState(dungeonId)
  const [targetLevel, setTargetLevel] = useState<number | null>(() => {
    const home = document.dungeons.find((candidate) => candidate.id === dungeonId)
    const other = home?.levels.find((level) => level.number !== levelNumber)
    return other?.number ?? home?.levels[0]?.number ?? null
  })
  const [targetCell, setTargetCell] = useState<Position | null>(null)
  const [facing, setFacing] = useState<TransitionSpec['to_facing']>('north')
  const [reciprocal, setReciprocal] = useState(true)
  const dungeon = document.dungeons.find((candidate) => candidate.id === targetDungeon)
  const level = dungeon?.levels.find((candidate) => candidate.number === targetLevel)
  const stairs = kind === 'stairs_up' || kind === 'stairs_down'
  const submit = () => {
    if (targetLevel === null || !targetCell) return
    const spec: TransitionSpec = {
      kind,
      position: sourceCell,
      to_dungeon_id: targetDungeon,
      to_level_number: targetLevel,
      to_position: targetCell,
      to_facing: facing,
    }
    void projectStore
      .getState()
      .commit((current) =>
        transitionOps(spec, dungeonId, levelNumber, reciprocal && stairs, current),
      )
      .then((committed) => {
        if (committed) onOpenChange(false)
      })
  }
  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle>Add transition</DialogTitle>
        <DialogDescription>
          From{' '}
          <span className="font-mono">
            ({sourceCell[0]}, {sourceCell[1]})
          </span>{' '}
          on level <span className="font-mono">{levelNumber}</span>. Pick the destination on the
          target level.
        </DialogDescription>
      </DialogHeader>
      <div className="flex flex-col gap-3">
        <div className="flex gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="transition-kind">Kind</Label>
            <select
              id="transition-kind"
              className="h-8 rounded-md border border-input bg-transparent px-2 text-sm"
              value={kind}
              onChange={(event) => setKind(event.target.value as TransitionSpec['kind'])}
            >
              {KINDS.map((candidate) => (
                <option key={candidate} value={candidate}>
                  {candidate}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="transition-facing">Arrival facing</Label>
            <select
              id="transition-facing"
              className="h-8 rounded-md border border-input bg-transparent px-2 text-sm"
              value={facing}
              onChange={(event) => setFacing(event.target.value as TransitionSpec['to_facing'])}
            >
              {FACINGS.map((candidate) => (
                <option key={candidate} value={candidate}>
                  {candidate}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="flex gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="transition-dungeon">Target dungeon</Label>
            <select
              id="transition-dungeon"
              className="h-8 rounded-md border border-input bg-transparent px-2 text-sm"
              value={targetDungeon}
              onChange={(event) => {
                setTargetDungeon(event.target.value)
                const next = document.dungeons.find(
                  (candidate) => candidate.id === event.target.value,
                )
                setTargetLevel(next?.levels[0]?.number ?? null)
                setTargetCell(null)
              }}
            >
              {document.dungeons.map((candidate) => (
                <option key={candidate.id} value={candidate.id}>
                  {candidate.id}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="transition-level">Target level</Label>
            <select
              id="transition-level"
              className="h-8 rounded-md border border-input bg-transparent px-2 text-sm"
              value={targetLevel ?? ''}
              onChange={(event) => {
                setTargetLevel(Number(event.target.value))
                setTargetCell(null)
              }}
            >
              {[...(dungeon?.levels ?? [])]
                .sort((a, b) => a.number - b.number)
                .map((candidate) => (
                  <option key={candidate.number} value={candidate.number}>
                    Level {candidate.number}
                  </option>
                ))}
            </select>
          </div>
        </div>
        {level && (
          <div className="flex flex-col gap-1.5">
            <Label>Target cell</Label>
            <MiniLevelPicker level={level} selected={targetCell} onPick={setTargetCell} />
            <p className="font-mono text-xs text-muted-foreground">
              {targetCell ? `(${targetCell[0]}, ${targetCell[1]})` : 'Click a cell'}
            </p>
          </div>
        )}
        {stairs && (
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={reciprocal}
              onChange={(event) => setReciprocal(event.target.checked)}
            />
            Create the reciprocal stairs on the target level
          </label>
        )}
      </div>
      <DialogFooter>
        <Button onClick={submit} disabled={targetLevel === null || !targetCell}>
          Add transition
        </Button>
      </DialogFooter>
    </DialogContent>
  )
}

// The mini target-level picker: the target grid at thumbnail scale, click to
// choose the landing cell. Exported as the shared one-shot cell-pick gesture —
// the trap builder's slide destination and the feature cards' cell binding
// reuse it.
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
