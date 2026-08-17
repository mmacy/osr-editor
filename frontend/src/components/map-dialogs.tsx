// The map editor's dialogs: dungeon and level management, level properties
// (dimensions, entrance, the wandering form with its table editor, level
// features), and the transition placement dialog. Each dialog mounts its body
// only while open, so per-invocation state initializes on mount — no reset
// effects.
import { useState } from 'react'

import { AuthorNotesCard } from '@/components/author-notes-card'
import { GateCard } from '@/components/gate-card'
import { LevelFeaturesSection } from '@/components/level-features'
import { MiniLevelPicker } from '@/components/mini-level-picker'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Textarea } from '@/components/ui/textarea'
import { WanderingTableEditor } from '@/components/wandering-table-editor'
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
import { cellAddress, levelAddress, navTargetFor, type NavTarget } from '@/lib/address'
import {
  clearLevelContentOps,
  contentTally,
  contentTallyLines,
  hasContent,
  replacedContentTally,
} from '@/lib/level-content'
import { defaultKind, defaultTargetLevel, FACING_LABELS, KIND_LABELS } from '@/lib/transitions'
import { replaceTransitionOps, transitionOps } from '@/map/gestures'
import { projectStore, useProjectStore } from '@/store/project-store'
import type {
  Adventure,
  DungeonSpec,
  GateSpec,
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
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  document: Adventure
  dungeonId: string
  levelNumber: number
  onOpenResize: () => void
  onOpenRenumber: () => void
}) {
  const dungeon = document.dungeons.find((candidate) => candidate.id === dungeonId)
  const level = dungeon?.levels.find((candidate) => candidate.number === levelNumber)
  if (!dungeon || !level) return null
  const clearEntrance = () => {
    void projectStore
      .getState()
      .commit([
        { op: 'set_entrance', dungeon_id: dungeonId, level_number: levelNumber, entrance: null },
      ])
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        aria-describedby={undefined}
        className="max-h-[85vh] overflow-y-auto sm:max-w-2xl"
      >
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
            document={document}
            dungeonId={dungeonId}
            levelNumber={levelNumber}
            wandering={level.wandering}
          />
          <GuidanceForm dungeonId={dungeonId} levelNumber={levelNumber} guidance={level.guidance} />
          <LevelFeaturesSection
            document={document}
            dungeonId={dungeonId}
            levelNumber={levelNumber}
          />
          <AuthorNotesCard address={levelAddress(dungeonId, levelNumber)} />
        </div>
      </DialogContent>
    </Dialog>
  )
}

interface ClearLevelContentProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  document: Adventure
  dungeonId: string
  levelNumber: number
}

export function ClearLevelContentDialog(props: ClearLevelContentProps) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      {props.open && <ClearLevelContentBody {...props} />}
    </Dialog>
  )
}

function ClearLevelContentBody({
  onOpenChange,
  document,
  dungeonId,
  levelNumber,
}: ClearLevelContentProps) {
  // Sticky for the session, so stripping level after level of an imported module
  // does not mean re-checking the box each time.
  const removeAreas = useProjectStore((state) => state.clearRemovesAreas)
  const setRemoveAreas = useProjectStore((state) => state.setClearRemovesAreas)
  // The stash offer, default on: losing stocking is expensive, and a surplus
  // stash pack is cheap, deletable, and honestly labeled.
  const [stashFirst, setStashFirst] = useState(true)
  const level = findLevel(document, dungeonId, levelNumber)
  if (!level) return null
  const tally = contentTally(level)
  const lines = contentTallyLines(tally)
  // The offer shows only when the capture would hold something: area-scope
  // content. A level whose only content is level-scope features has nothing
  // the stash can bank — offering an empty pack would be noise.
  const stashable = contentTallyLines(replacedContentTally(level)).length > 0
  if (removeAreas && tally.areas > 0) {
    lines.push(`${tally.areas} keyed ${tally.areas === 1 ? 'area' : 'areas'}`)
  }
  const submit = async () => {
    const store = projectStore.getState()
    if (stashFirst && stashable) {
      // The capture is computed against the verified revision before the
      // batch; a failed capture (a raced 409) stops here with the level
      // intact — the destruction never proceeds uncaptured.
      const stashed = await store.stashLevel(dungeonId, levelNumber)
      if (!stashed) return
    }
    const committed = await store.commit((current) => {
      const target = findLevel(current, dungeonId, levelNumber)
      return target ? clearLevelContentOps(target, dungeonId, levelNumber, removeAreas) : []
    })
    if (committed) onOpenChange(false)
  }
  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle>Clear content</DialogTitle>
        <DialogDescription>
          Strips level {levelNumber} of <span className="font-mono">{dungeonId}</span> back to its
          geometry, in one undo step. The grid, the walls and doors, the cells they enclose, the
          entrance, the transitions, and the wandering monsters all stay.
        </DialogDescription>
      </DialogHeader>
      {lines.length > 0 ? (
        <div className="flex flex-col gap-1">
          <p className="text-sm font-medium">This clears:</p>
          <ul className="flex flex-col gap-0.5" aria-label="Content to clear">
            {lines.map((line) => (
              <li key={line} className="text-sm text-muted-foreground">
                {line}
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          This level carries no content — there is nothing to clear.
        </p>
      )}
      {stashable && (
        <label className="flex items-start gap-2 text-sm">
          <Checkbox
            className="mt-0.5"
            checked={stashFirst}
            onCheckedChange={(next) => setStashFirst(next === true)}
            aria-label="Stash this level's content in the library first"
          />
          <span>
            Stash this level&apos;s content in the library first
            <span className="block text-xs text-muted-foreground">
              Banks the rooms — and the wandering table, when one is authored — as a stash pack:
              deletable, and re-placeable room by room from the library. Level-scope features are
              not captured; undo is their way back.
            </span>
          </span>
        </label>
      )}
      {tally.areas > 0 && (
        <label className="flex items-start gap-2 text-sm">
          <Checkbox
            className="mt-0.5"
            checked={removeAreas}
            onCheckedChange={(next) => setRemoveAreas(next === true)}
            aria-label="Also remove the emptied areas"
          />
          <span>
            Also remove the emptied areas
            <span className="block text-xs text-muted-foreground">
              Their key numbers go and their cells become corridor. The walls and doors that draw
              the rooms are edges, so the map still reads the same.
            </span>
          </span>
        </label>
      )}
      <DialogFooter>
        <Button
          variant="destructive"
          onClick={() => void submit()}
          disabled={!hasContent(level) && !(removeAreas && tally.areas > 0)}
        >
          Clear content
        </Button>
      </DialogFooter>
    </DialogContent>
  )
}

// The level's ambient guidance: steering for a narrating front end, never
// shown to players verbatim — the UI voice, not the serif. In forge mode the
// field routes to the blocked-op dialog on entry (level guidance has no
// override kind), the server's 422 behind it.
function GuidanceForm({
  dungeonId,
  levelNumber,
  guidance,
}: {
  dungeonId: string
  levelNumber: number
  guidance: string
}) {
  const forge = useProjectStore((state) => state.project?.forge != null)
  const field = useCommittedField(guidance, (value) => {
    void projectStore.getState().commit([
      {
        op: 'set_level_field',
        dungeon_id: dungeonId,
        level_number: levelNumber,
        field: 'guidance',
        value,
      },
    ])
  })
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor="level-guidance">Guidance</Label>
      <Textarea
        id="level-guidance"
        className="min-h-16"
        value={field.value}
        onChange={field.onChange}
        onBlur={field.onBlur}
        onFocus={(event) => {
          if (!forge) return
          event.currentTarget.blur()
          projectStore.getState().setBlockedOp({
            op: 'set_level_field',
            address: levelAddress(dungeonId, levelNumber),
            message: 'level guidance has no override kind',
          })
        }}
      />
      <p className="text-muted-foreground text-xs">
        Ambient steering for a narrating front end — per-level narrator direction, inert to the
        engine and never shown to players verbatim.
      </p>
    </div>
  )
}

// The wandering form: the scalar parameters plus the inline d20 table editor.
function WanderingForm({
  document,
  dungeonId,
  levelNumber,
  wandering,
}: {
  document: Adventure
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
      <WanderingTableEditor
        document={document}
        dungeonId={dungeonId}
        levelNumber={levelNumber}
        wandering={wandering}
      />
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

interface TransitionDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  document: Adventure
  dungeonId: string
  levelNumber: number
  sourceCell: Position
  // An existing transition on the source cell puts the dialog in edit mode:
  // fields prefill, submit replaces in one batch, and no reciprocal is
  // offered — the other flight already exists or is the author's business.
  existing?: TransitionSpec | null
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
  existing = null,
}: TransitionDialogProps) {
  const editing = existing !== null
  const [kind, setKind] = useState<TransitionSpec['kind']>(
    () =>
      existing?.kind ??
      defaultKind(levelNumber, defaultTargetLevel(document, dungeonId, levelNumber), true),
  )
  // Until the author touches the kind, it follows the target: retargeting to a
  // deeper level suggests stairs down, to a shallower one stairs up.
  const [kindTouched, setKindTouched] = useState(editing)
  const [targetDungeon, setTargetDungeon] = useState(existing?.to_dungeon_id ?? dungeonId)
  const [targetLevel, setTargetLevel] = useState<number | null>(
    () => existing?.to_level_number ?? defaultTargetLevel(document, dungeonId, levelNumber),
  )
  const [targetCell, setTargetCell] = useState<Position | null>(existing?.to_position ?? null)
  const [hoverCell, setHoverCell] = useState<Position | null>(null)
  const [facing, setFacing] = useState<TransitionSpec['to_facing']>(existing?.to_facing ?? 'north')
  const [reciprocal, setReciprocal] = useState(true)
  // The edit path seeds the gate from the committed transition — without
  // which an unrelated edit to a foreign gated transition would silently
  // strip its gate.
  const [gate, setGate] = useState<GateSpec | null>(existing?.requires ?? null)
  const forge = useProjectStore((state) => state.project?.forge != null)
  const dungeon = document.dungeons.find((candidate) => candidate.id === targetDungeon)
  const level = dungeon?.levels.find((candidate) => candidate.number === targetLevel)
  const stairs = kind === 'stairs_up' || kind === 'stairs_down'
  const landingOccupied =
    targetCell !== null &&
    (level?.transitions.some(
      (candidate) =>
        candidate.position[0] === targetCell[0] && candidate.position[1] === targetCell[1],
    ) ??
      false)
  // The landing that is the departing cell itself: legal to author (a self
  // loop is a diagnostic, not an error), but the auto-reciprocal skips it —
  // the first op occupies the cell — so the warning below has to say so.
  const landsOnSource =
    targetCell !== null &&
    targetDungeon === dungeonId &&
    targetLevel === levelNumber &&
    targetCell[0] === sourceCell[0] &&
    targetCell[1] === sourceCell[1]
  const sourceInTargetBounds =
    level !== undefined && sourceCell[0] < level.width && sourceCell[1] < level.height
  // An edit whose transition vanished underneath (another tab, an undo) has
  // nothing to replace: the builder would skip the batch silently, so the
  // dialog says so and disables saving instead.
  const editTargetGone =
    editing &&
    !document.dungeons
      .find((candidate) => candidate.id === dungeonId)
      ?.levels.find((candidate) => candidate.number === levelNumber)
      ?.transitions.some(
        (candidate) =>
          candidate.position[0] === sourceCell[0] && candidate.position[1] === sourceCell[1],
      )
  const retarget = (nextDungeon: string, nextLevel: number | null) => {
    setTargetLevel(nextLevel)
    setTargetCell(null)
    if (!kindTouched) setKind(defaultKind(levelNumber, nextLevel, nextDungeon === dungeonId))
  }
  const commitAxis = (axis: 0 | 1, value: number) => {
    const base: Position = targetCell ?? [0, 0]
    setTargetCell(axis === 0 ? [value, base[1]] : [base[0], value])
  }
  // The committed-field gesture with an empty-draft guard: integerInRange
  // alone would read '' as 0 and commit a cell on a mere focus-and-leave.
  const axisNormalizer = (limit: number) => (draft: string) =>
    draft.trim() === '' ? null : integerInRange(0, limit - 1)(draft)
  const xField = useCommittedField(
    targetCell === null ? '' : String(targetCell[0]),
    (value) => commitAxis(0, Number(value)),
    axisNormalizer(level?.width ?? 1),
  )
  const yField = useCommittedField(
    targetCell === null ? '' : String(targetCell[1]),
    (value) => commitAxis(1, Number(value)),
    axisNormalizer(level?.height ?? 1),
  )
  const submit = () => {
    if (targetLevel === null || !targetCell) return
    const spec: TransitionSpec = {
      kind,
      position: sourceCell,
      to_dungeon_id: targetDungeon,
      to_level_number: targetLevel,
      to_position: targetCell,
      to_facing: facing,
      requires: gate,
    }
    void projectStore
      .getState()
      .commit((current) =>
        editing
          ? replaceTransitionOps(spec, dungeonId, levelNumber, current)
          : transitionOps(spec, dungeonId, levelNumber, reciprocal && stairs, current),
      )
      .then((committed) => {
        if (committed) onOpenChange(false)
      })
  }
  return (
    <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
      <DialogHeader>
        <DialogTitle>{editing ? 'Edit transition' : 'Add transition'}</DialogTitle>
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
              onChange={(event) => {
                setKind(event.target.value as TransitionSpec['kind'])
                setKindTouched(true)
              }}
            >
              {(Object.keys(KIND_LABELS) as Array<TransitionSpec['kind']>).map((candidate) => (
                <option key={candidate} value={candidate}>
                  {KIND_LABELS[candidate]}
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
              {(Object.keys(FACING_LABELS) as Array<TransitionSpec['to_facing']>).map(
                (candidate) => (
                  <option key={candidate} value={candidate}>
                    {FACING_LABELS[candidate]}
                  </option>
                ),
              )}
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
                const numbers = (next?.levels ?? []).map((candidate) => candidate.number)
                retarget(event.target.value, numbers.length ? Math.min(...numbers) : null)
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
              onChange={(event) => retarget(targetDungeon, Number(event.target.value))}
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
            <MiniLevelPicker
              level={level}
              selected={targetCell}
              onPick={setTargetCell}
              sourceCell={sourceCell}
              onHover={setHoverCell}
            />
            <div className="flex items-end gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="transition-x">X</Label>
                <Input
                  id="transition-x"
                  className="w-20 font-mono"
                  type="number"
                  min={0}
                  max={level.width - 1}
                  {...xField}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="transition-y">Y</Label>
                <Input
                  id="transition-y"
                  className="w-20 font-mono"
                  type="number"
                  min={0}
                  max={level.height - 1}
                  {...yField}
                />
              </div>
              <span
                title={sourceInTargetBounds ? undefined : 'The source cell is outside this level'}
              >
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!sourceInTargetBounds}
                  onClick={() => setTargetCell([sourceCell[0], sourceCell[1]])}
                >
                  Use the source cell
                </Button>
              </span>
              <p className="pb-2 font-mono text-xs text-muted-foreground">
                {hoverCell
                  ? `(${hoverCell[0]}, ${hoverCell[1]})`
                  : targetCell
                    ? `(${targetCell[0]}, ${targetCell[1]})`
                    : 'Click a cell'}
              </p>
            </div>
            {!editing && (landingOccupied || landsOnSource) && targetCell && (
              <p className="text-sm text-destructive">
                ({targetCell[0]}, {targetCell[1]}){' '}
                {landsOnSource ? 'is the departing cell itself.' : 'already carries a transition.'}
                {stairs && reciprocal && ' The reciprocal stairs will not be created there.'}
              </p>
            )}
          </div>
        )}
        <GateCard
          gate={gate}
          document={document}
          idPrefix="transition-gate"
          forge={forge}
          blockedAddress={cellAddress(dungeonId, levelNumber, sourceCell)}
          blockedOpCode="add_transition"
          onCommit={setGate}
        />
        {stairs && !editing && (
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={reciprocal}
              onCheckedChange={(next) => setReciprocal(next === true)}
            />
            Create the reciprocal stairs on the target level
            {gate !== null && (
              <span className="text-muted-foreground text-xs">
                — created ungated: a gate guards one threshold's attempt
              </span>
            )}
          </label>
        )}
        {!stairs && (
          <p className="text-sm text-muted-foreground">
            Trapdoors and chutes are one-way — no return transition is created.
          </p>
        )}
        {editTargetGone && (
          <p className="text-sm text-destructive">
            This transition no longer exists — it was removed while the dialog was open.
          </p>
        )}
      </div>
      <DialogFooter>
        <Button onClick={submit} disabled={targetLevel === null || !targetCell || editTargetGone}>
          {editing ? 'Save transition' : 'Add transition'}
        </Button>
      </DialogFooter>
    </DialogContent>
  )
}
