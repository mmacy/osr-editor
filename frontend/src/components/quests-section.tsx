// The Quests section, complete: two list groups in document order — order is
// semantics for both; the interpreter fires matching triggers in list order,
// then walks the quests in list order — each with reorder, a create dialog,
// and a detail editor over the whole spec. The trigger detail carries the
// pattern builder, conditions with consumes suppressed, the consequence list
// over the closed nine-command union, the repeatable toggle, and the fired
// and journal beats. The quest detail carries activation or the standing
// charge, the ordered objectives with names, hidden/reveal, and completion
// clauses, rewards over the same consequence kit, the all/any rule,
// concludes_adventure, and the offer and completion beats. Author notes ride
// both.
//
// Forge mode is the Items split: no forge-assembled document can carry
// triggers or quests, so the explanation *is* the honest section body — the
// overrides-vocabulary gap is forge's recorded decision (osr-forge#39), and
// detach is offered in place.
import { useState } from 'react'
import { ArrowDownIcon, ArrowUpIcon, PlusIcon, XIcon } from 'lucide-react'

import { AuthorNotesCard } from '@/components/author-notes-card'
import { ClauseBuilder } from '@/components/clause-builder'
import { ConditionList } from '@/components/condition-list'
import { ConsequenceList } from '@/components/consequence-list'
import { DetachDialog } from '@/components/detach-dialog'
import { NarrativeBlockEditor } from '@/components/narrative-block-editor'
import { PatternBuilder } from '@/components/pattern-builder'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useCommittedField } from '@/hooks/use-committed-field'
import { questAddress, triggerAddress } from '@/lib/address'
import { itemNameFor, loadEquipmentCatalog, useCatalog } from '@/lib/catalogs'
import {
  activationSummary,
  addQuestOps,
  moveQuestOps,
  nextObjectiveId,
  nextQuestId,
  questPatchOps,
  questUpdateOps,
  removeQuestOps,
  seedObjective,
  seedQuest,
} from '@/lib/quest-builders'
import {
  addTriggerOps,
  moveTriggerOps,
  nextTriggerId,
  patternSummary,
  removeTriggerOps,
  seedTrigger,
  triggerPatchOps,
  triggerUpdateOps,
} from '@/lib/trigger-builders'
import { projectStore } from '@/store/project-store'
import type {
  Adventure,
  ObjectiveSpec,
  ProjectState,
  QuestSpec,
  TriggerPattern,
  TriggerSpec,
} from '@/types'

const SELECT_CLASS = 'h-8 rounded-md border border-input bg-transparent px-2 text-sm'

type Selection = { kind: 'trigger' | 'quest'; id: string }

export function QuestsSection({
  project,
  section,
  focusToken,
}: {
  project: ProjectState
  section: { triggerId?: string; questId?: string }
  focusToken: number
}) {
  const document = project.document
  const triggers = document.triggers
  const quests = document.quests
  const [selection, setSelection] = useState<Selection | null>(null)
  const [createTriggerOpen, setCreateTriggerOpen] = useState(false)
  const [createQuestOpen, setCreateQuestOpen] = useState(false)

  // Consume the navigation focus once per token — a diagnostics click selects
  // its trigger or quest.
  const [consumedToken, setConsumedToken] = useState<number | null>(null)
  if (focusToken !== consumedToken) {
    setConsumedToken(focusToken)
    if (section.questId) setSelection({ kind: 'quest', id: section.questId })
    else if (section.triggerId) setSelection({ kind: 'trigger', id: section.triggerId })
  }

  if (project.forge) {
    return <ForgeQuestsBody />
  }

  // First match among foreign duplicate ids — osrlib's own resolution
  // posture; nothing selected falls back to the first trigger, then the
  // first quest.
  let detail:
    { kind: 'trigger'; trigger: TriggerSpec } | { kind: 'quest'; quest: QuestSpec } | null = null
  if (selection?.kind === 'trigger') {
    const trigger = triggers.find((candidate) => candidate.id === selection.id)
    if (trigger) detail = { kind: 'trigger', trigger }
  } else if (selection?.kind === 'quest') {
    const quest = quests.find((candidate) => candidate.id === selection.id)
    if (quest) detail = { kind: 'quest', quest }
  }
  if (!detail) {
    detail = triggers[0]
      ? { kind: 'trigger', trigger: triggers[0] }
      : quests[0]
        ? { kind: 'quest', quest: quests[0] }
        : null
  }

  return (
    <section aria-label="Quests" className="flex min-h-0 gap-6">
      <div
        className="flex w-96 shrink-0 flex-col gap-3 self-start"
        data-testid="quests-triggers-pane"
      >
        <h2 className="font-serif text-xl font-semibold">Quests</h2>
        <div className="flex flex-col gap-1">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium">Triggers</h3>
            <Button variant="outline" size="sm" onClick={() => setCreateTriggerOpen(true)}>
              <PlusIcon /> New trigger
            </Button>
          </div>
          <p className="text-muted-foreground text-xs">
            Triggers fire in this order — a later trigger's conditions are checked against what an
            earlier firing changed.
          </p>
        </div>
        {triggers.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            No triggers yet — create one here, or from an area's context menu on the map.
          </p>
        ) : (
          <ol className="flex flex-col gap-1" aria-label="Triggers">
            {triggers.map((trigger, index) => (
              <TriggerRow
                key={`${trigger.id}-${index}`}
                trigger={trigger}
                index={index}
                count={triggers.length}
                document={document}
                selected={detail?.kind === 'trigger' && detail.trigger === trigger}
                onSelect={() => setSelection({ kind: 'trigger', id: trigger.id })}
                onMove={(delta) => {
                  // Computed in the queue against the committed document, so
                  // a click racing an in-flight move never posts a stale
                  // index — a same-position or out-of-range step skips.
                  void projectStore.getState().commit((current) => {
                    const position = current.triggers.findIndex(
                      (candidate) => candidate.id === trigger.id,
                    )
                    const destination = position + delta
                    if (
                      position === -1 ||
                      destination < 0 ||
                      destination >= current.triggers.length
                    ) {
                      return []
                    }
                    return moveTriggerOps(trigger.id, destination)
                  })
                }}
                onRemove={() => {
                  void projectStore.getState().commit(removeTriggerOps(trigger.id))
                  if (selection?.kind === 'trigger' && selection.id === trigger.id) {
                    setSelection(null)
                  }
                }}
              />
            ))}
          </ol>
        )}
        <div className="flex flex-col gap-1">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium">Quests</h3>
            <Button variant="outline" size="sm" onClick={() => setCreateQuestOpen(true)}>
              <PlusIcon /> New quest
            </Button>
          </div>
          <p className="text-muted-foreground text-xs">
            The interpreter seeds and walks quests in this order, after the triggers, and the
            player's quest log lists them as authored.
          </p>
        </div>
        {quests.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            No quests yet — create one to give the adventure a goal it can end on.
          </p>
        ) : (
          <ol className="flex flex-col gap-1" aria-label="Quests">
            {quests.map((quest, index) => (
              <QuestRow
                key={`${quest.id}-${index}`}
                quest={quest}
                index={index}
                count={quests.length}
                document={document}
                selected={detail?.kind === 'quest' && detail.quest === quest}
                onSelect={() => setSelection({ kind: 'quest', id: quest.id })}
                onMove={(delta) => {
                  void projectStore.getState().commit((current) => {
                    const position = current.quests.findIndex(
                      (candidate) => candidate.id === quest.id,
                    )
                    const destination = position + delta
                    if (
                      position === -1 ||
                      destination < 0 ||
                      destination >= current.quests.length
                    ) {
                      return []
                    }
                    return moveQuestOps(quest.id, destination)
                  })
                }}
                onRemove={() => {
                  void projectStore.getState().commit(removeQuestOps(quest.id))
                  if (selection?.kind === 'quest' && selection.id === quest.id) {
                    setSelection(null)
                  }
                }}
              />
            ))}
          </ol>
        )}
      </div>
      <div className="min-w-0 flex-1">
        {detail?.kind === 'trigger' ? (
          <div className="flex max-w-2xl flex-col gap-6">
            <TriggerDetail
              key={detail.trigger.id}
              trigger={detail.trigger}
              document={document}
              onRenamed={(id) => setSelection({ kind: 'trigger', id })}
            />
            <AuthorNotesCard address={triggerAddress(detail.trigger.id)} />
          </div>
        ) : detail?.kind === 'quest' ? (
          <div className="flex max-w-2xl flex-col gap-6">
            <QuestDetail
              key={detail.quest.id}
              quest={detail.quest}
              document={document}
              onRenamed={(id) => setSelection({ kind: 'quest', id })}
            />
            <AuthorNotesCard address={questAddress(detail.quest.id)} />
          </div>
        ) : (
          <p className="text-muted-foreground text-sm">Select a trigger or a quest to edit it.</p>
        )}
      </div>
      <CreateTriggerDialog
        open={createTriggerOpen}
        document={document}
        onOpenChange={setCreateTriggerOpen}
        onCreated={(id) => setSelection({ kind: 'trigger', id })}
      />
      <CreateQuestDialog
        open={createQuestOpen}
        document={document}
        onOpenChange={setCreateQuestOpen}
        onCreated={(id) => setSelection({ kind: 'quest', id })}
      />
    </section>
  )
}

// The forge explanation body: the deliberate overrides-vocabulary gap, named,
// with detach offered in place — a live destination, never a dead tooltip. No
// list renders because no forge-assembled document can carry triggers or
// quests.
function ForgeQuestsBody() {
  const [detachOpen, setDetachOpen] = useState(false)
  return (
    <section aria-label="Quests" className="flex max-w-xl flex-col gap-3">
      <h2 className="font-serif text-xl font-semibold">Quests</h2>
      <p className="text-sm">
        A forge-assembled adventure holds no triggers or quests: the overrides vocabulary has no
        authored-layer surface, so there is nothing here to review and nothing the editor could
        write back to <span className="font-mono">overrides.yaml</span>. The gap is osr-forge's
        recorded decision (
        <a
          className="underline underline-offset-2"
          href="https://github.com/mmacy/osr-forge/issues/39"
          target="_blank"
          rel="noreferrer"
        >
          osr-forge#39
        </a>
        ).
      </p>
      <p className="text-muted-foreground text-sm">
        To author triggers and quests, detach this project to a native one. Detaching severs the
        forge re-run loop and records provenance.
      </p>
      <div>
        <Button variant="outline" size="sm" onClick={() => setDetachOpen(true)}>
          Detach to a native project…
        </Button>
      </div>
      <DetachDialog open={detachOpen} onOpenChange={setDetachOpen} />
    </section>
  )
}

function TriggerRow({
  trigger,
  index,
  count,
  document,
  selected,
  onSelect,
  onMove,
  onRemove,
}: {
  trigger: TriggerSpec
  index: number
  count: number
  document: Adventure
  selected: boolean
  onSelect: () => void
  onMove: (delta: 1 | -1) => void
  onRemove: () => void
}) {
  const [confirming, setConfirming] = useState(false)
  const shipped = useCatalog(loadEquipmentCatalog)
  const summary = patternSummary(trigger.when, {
    itemName: (id) => itemNameFor(shipped, document.items, id),
  })
  return (
    <li
      className={`rounded-md border ${selected ? 'border-primary' : ''}`}
      data-testid={`trigger-row-${trigger.id}`}
    >
      <button
        type="button"
        className="flex w-full flex-col gap-0.5 p-2 text-left"
        onClick={onSelect}
      >
        <span className="flex items-center gap-2">
          <span className="text-muted-foreground font-mono text-xs">{index + 1}.</span>
          <span className="font-mono text-sm font-medium">{trigger.id}</span>
          {trigger.repeatable && <Badge variant="secondary">repeatable</Badge>}
        </span>
        <span className="text-muted-foreground text-xs">{summary}</span>
        <span className="text-muted-foreground text-xs">
          {trigger.conditions.length} {trigger.conditions.length === 1 ? 'condition' : 'conditions'}{' '}
          · {trigger.consequences.length}{' '}
          {trigger.consequences.length === 1 ? 'consequence' : 'consequences'}
        </span>
      </button>
      <div className="flex items-center justify-end gap-1 px-2 pb-2">
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={`Move ${trigger.id} up`}
          disabled={index === 0}
          onClick={() => onMove(-1)}
        >
          <ArrowUpIcon />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={`Move ${trigger.id} down`}
          disabled={index === count - 1}
          onClick={() => onMove(1)}
        >
          <ArrowDownIcon />
        </Button>
        {confirming ? (
          <>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => {
                setConfirming(false)
                onRemove()
              }}
            >
              Confirm remove
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setConfirming(false)}>
              Keep
            </Button>
          </>
        ) : (
          <Button variant="ghost" size="sm" onClick={() => setConfirming(true)}>
            Remove
          </Button>
        )}
      </div>
      {confirming && (
        <p className="text-muted-foreground px-2 pb-2 text-xs">
          Nothing in the document references a trigger, so removal dangles nothing. A save that
          already holds its fired mark keeps it, orphaned.
        </p>
      )}
    </li>
  )
}

function QuestRow({
  quest,
  index,
  count,
  document,
  selected,
  onSelect,
  onMove,
  onRemove,
}: {
  quest: QuestSpec
  index: number
  count: number
  document: Adventure
  selected: boolean
  onSelect: () => void
  onMove: (delta: 1 | -1) => void
  onRemove: () => void
}) {
  const [confirming, setConfirming] = useState(false)
  const shipped = useCatalog(loadEquipmentCatalog)
  const summary = activationSummary(quest.activation ?? null, {
    itemName: (id) => itemNameFor(shipped, document.items, id),
  })
  return (
    <li
      className={`rounded-md border ${selected ? 'border-primary' : ''}`}
      data-testid={`quest-row-${quest.id}`}
    >
      <button
        type="button"
        className="flex w-full flex-col gap-0.5 p-2 text-left"
        onClick={onSelect}
      >
        <span className="flex items-center gap-2">
          <span className="text-muted-foreground font-mono text-xs">{index + 1}.</span>
          <span className="text-sm font-medium">{quest.name}</span>
          <span className="text-muted-foreground font-mono text-xs">{quest.id}</span>
          {quest.concludes_adventure && <Badge variant="secondary">concludes</Badge>}
        </span>
        <span className="text-muted-foreground text-xs">{summary}</span>
        <span className="text-muted-foreground text-xs">
          {quest.objectives.length} {quest.objectives.length === 1 ? 'objective' : 'objectives'} ·{' '}
          {quest.rewards.length} {quest.rewards.length === 1 ? 'reward' : 'rewards'}
        </span>
      </button>
      <div className="flex items-center justify-end gap-1 px-2 pb-2">
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={`Move ${quest.id} up`}
          disabled={index === 0}
          onClick={() => onMove(-1)}
        >
          <ArrowUpIcon />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={`Move ${quest.id} down`}
          disabled={index === count - 1}
          onClick={() => onMove(1)}
        >
          <ArrowDownIcon />
        </Button>
        {confirming ? (
          <>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => {
                setConfirming(false)
                onRemove()
              }}
            >
              Confirm remove
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setConfirming(false)}>
              Keep
            </Button>
          </>
        ) : (
          <Button variant="ghost" size="sm" onClick={() => setConfirming(true)}>
            Remove
          </Button>
        )}
      </div>
      {confirming && (
        <p className="text-muted-foreground px-2 pb-2 text-xs">
          Nothing in the document references a quest, so removal dangles nothing. A save that
          already holds its lifecycle state keeps it, orphaned.
        </p>
      )}
    </li>
  )
}

function CreateTriggerDialog({
  open,
  document,
  onOpenChange,
  onCreated,
}: {
  open: boolean
  document: Adventure
  onOpenChange: (open: boolean) => void
  onCreated: (id: string) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open && (
        <CreateTriggerBody document={document} onOpenChange={onOpenChange} onCreated={onCreated} />
      )}
    </Dialog>
  )
}

function CreateTriggerBody({
  document,
  onOpenChange,
  onCreated,
}: {
  document: Adventure
  onOpenChange: (open: boolean) => void
  onCreated: (id: string) => void
}) {
  const [id, setId] = useState(() => nextTriggerId(document))
  const [pattern, setPattern] = useState<TriggerPattern | null>(null)
  const [error, setError] = useState<string | null>(null)
  const submit = () => {
    const trimmedId = id.trim()
    if (!pattern) return
    setError(null)
    void projectStore
      .getState()
      .commit(addTriggerOps(seedTrigger(trimmedId, pattern)), {
        onError: (requestError) => {
          // The duplicate-id rejection surfaces inline — the rename prompt,
          // right where the id was typed.
          if (requestError.detail.code === 'op_invariant') {
            setError(requestError.detail.message)
            return true
          }
          return false
        },
      })
      .then((committed) => {
        if (committed) {
          onCreated(trimmedId)
          onOpenChange(false)
        }
      })
  }
  return (
    <DialogContent className="sm:max-w-lg">
      <DialogHeader>
        <DialogTitle>New trigger</DialogTitle>
        <DialogDescription>
          The trigger is created once-only with no conditions or consequences; everything else is
          detail-editor work.
        </DialogDescription>
      </DialogHeader>
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="create-trigger-id">Id</Label>
          <Input
            id="create-trigger-id"
            className="w-48 font-mono"
            value={id}
            onChange={(event) => setId(event.target.value)}
          />
        </div>
        <PatternBuilder
          pattern={pattern}
          document={document}
          idPrefix="create-trigger"
          onCommit={setPattern}
        />
        {error && <p className="text-destructive text-xs">{error}</p>}
      </div>
      <DialogFooter>
        <Button variant="ghost" onClick={() => onOpenChange(false)}>
          Cancel
        </Button>
        <Button onClick={submit} disabled={id.trim() === '' || pattern === null}>
          Create
        </Button>
      </DialogFooter>
    </DialogContent>
  )
}

function CreateQuestDialog({
  open,
  document,
  onOpenChange,
  onCreated,
}: {
  open: boolean
  document: Adventure
  onOpenChange: (open: boolean) => void
  onCreated: (id: string) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open && (
        <CreateQuestBody document={document} onOpenChange={onOpenChange} onCreated={onCreated} />
      )}
    </Dialog>
  )
}

// A QuestSpec parses only with a name and at least one complete objective, so
// the dialog collects exactly those: the id, the required name, and the first
// objective's completion pattern (a complete clause with empty conditions;
// the objective's id mints objective-1, renameable in the detail editor).
// Everything else is detail-editor work: the quest is created as a standing
// charge with empty rewards, completion "all", and concludes_adventure off.
function CreateQuestBody({
  document,
  onOpenChange,
  onCreated,
}: {
  document: Adventure
  onOpenChange: (open: boolean) => void
  onCreated: (id: string) => void
}) {
  const [id, setId] = useState(() => nextQuestId(document))
  const [name, setName] = useState('')
  const [pattern, setPattern] = useState<TriggerPattern | null>(null)
  const [error, setError] = useState<string | null>(null)
  const submit = () => {
    const trimmedId = id.trim()
    const trimmedName = name.trim()
    if (!pattern || trimmedName === '') return
    setError(null)
    const objective = seedObjective('objective-1', { pattern, conditions: [] })
    void projectStore
      .getState()
      .commit(addQuestOps(seedQuest(trimmedId, trimmedName, objective)), {
        onError: (requestError) => {
          // The duplicate-id rejection surfaces inline — the rename prompt,
          // right where the id was typed.
          if (requestError.detail.code === 'op_invariant') {
            setError(requestError.detail.message)
            return true
          }
          return false
        },
      })
      .then((committed) => {
        if (committed) {
          onCreated(trimmedId)
          onOpenChange(false)
        }
      })
  }
  return (
    <DialogContent className="sm:max-w-lg">
      <DialogHeader>
        <DialogTitle>New quest</DialogTitle>
        <DialogDescription>
          A quest must have a name and one objective to exist; the objective completes on the
          pattern you pick here. Everything else — activation, more objectives, rewards — is
          detail-editor work.
        </DialogDescription>
      </DialogHeader>
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="create-quest-id">Id</Label>
          <Input
            id="create-quest-id"
            className="w-48 font-mono"
            value={id}
            onChange={(event) => setId(event.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="create-quest-name">Name</Label>
          <Input
            id="create-quest-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">First objective completes</span>
          <PatternBuilder
            pattern={pattern}
            document={document}
            idPrefix="create-quest"
            onCommit={setPattern}
          />
        </div>
        {error && <p className="text-destructive text-xs">{error}</p>}
      </div>
      <DialogFooter>
        <Button variant="ghost" onClick={() => onOpenChange(false)}>
          Cancel
        </Button>
        <Button
          onClick={submit}
          disabled={id.trim() === '' || name.trim() === '' || pattern === null}
        >
          Create
        </Button>
      </DialogFooter>
    </DialogContent>
  )
}

// --- the trigger detail editor -----------------------------------------------

function TriggerDetail({
  trigger,
  document,
  onRenamed,
}: {
  trigger: TriggerSpec
  document: Adventure
  onRenamed: (id: string) => void
}) {
  const [idError, setIdError] = useState<string | null>(null)
  // All commits flow through compute-in-the-queue update builders — the
  // consequence list edits sub-parts of a whole-value spec, so a payload
  // built from the render-time spec queued behind an in-flight commit would
  // silently revert it.
  const update = (build: (committed: TriggerSpec) => TriggerSpec | null) => {
    void projectStore.getState().commit((current) => triggerUpdateOps(current, trigger.id, build))
  }
  const commitId = (value: string) => {
    setIdError(null)
    void projectStore
      .getState()
      .commit((current) => triggerPatchOps(current, trigger.id, { id: value }), {
        onError: (error) => {
          // The duplicate-id rejection surfaces inline — the rename prompt,
          // right where the id was typed.
          if (error.detail.code === 'op_invariant') {
            setIdError(error.detail.message)
            return true
          }
          return false
        },
      })
      .then((committed) => {
        if (committed) onRenamed(value)
      })
  }
  const id = useCommittedField(trigger.id, commitId, (draft) => {
    const trimmed = draft.trim()
    return trimmed === '' ? null : trimmed
  })
  return (
    <div className="flex flex-col gap-5" data-testid={`trigger-detail-${trigger.id}`}>
      <div className="flex items-end gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="trigger-id">Id</Label>
          <Input id="trigger-id" className="w-56 font-mono" {...id} />
        </div>
        <label className="flex items-center gap-1.5 pb-2 text-sm">
          <Checkbox
            aria-label="Repeatable"
            checked={trigger.repeatable}
            onCheckedChange={(next) =>
              void projectStore
                .getState()
                .commit((current) =>
                  triggerPatchOps(current, trigger.id, { repeatable: next === true }),
                )
            }
          />
          <span>
            Repeatable
            <span className="text-muted-foreground block text-xs">
              Off means once-only: the fired state lives in saves, not the document.
            </span>
          </span>
        </label>
      </div>
      {idError && <p className="text-destructive text-xs">{idError}</p>}

      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-medium">Pattern</h3>
        <PatternBuilder
          pattern={trigger.when}
          document={document}
          idPrefix="trigger"
          onCommit={(when) => update((committed) => ({ ...committed, when }))}
        />
      </div>

      <ConditionList
        conditions={trigger.conditions}
        document={document}
        idPrefix="trigger-condition"
        consumeRule="A trigger fires, it does not take"
        onUpdate={(build) =>
          update((committed) => {
            const conditions = build(committed.conditions)
            return conditions === null ? null : { ...committed, conditions }
          })
        }
      />
      <ConsequenceList
        commands={trigger.consequences}
        document={document}
        idPrefix="trigger-consequence"
        noun="consequence"
        title="Consequences"
        help="The engine executes consequences in this order when the trigger fires. Empty is a normal shape — a trigger whose whole job is its journal beat."
        onUpdate={(build) =>
          update((committed) => {
            const consequences = build(committed.consequences)
            return consequences === null ? null : { ...committed, consequences }
          })
        }
      />

      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-medium">Narrative</h3>
        <p className="text-muted-foreground text-xs">
          Fired is the referee's line about the wiring; journal is the players' line about the same
          moment.
        </p>
        <NarrativeBlockEditor
          block={trigger.narrative ?? null}
          beats={['fired', 'journal']}
          idPrefix="trigger-narrative"
          onCommit={(updateBlock) =>
            update((committed) => ({
              ...committed,
              narrative: updateBlock(committed.narrative ?? null),
            }))
          }
        />
      </div>
    </div>
  )
}

// --- the quest detail editor -------------------------------------------------

function QuestDetail({
  quest,
  document,
  onRenamed,
}: {
  quest: QuestSpec
  document: Adventure
  onRenamed: (id: string) => void
}) {
  const [idError, setIdError] = useState<string | null>(null)
  // All commits flow through compute-in-the-queue update builders — the
  // objective and reward lists edit sub-parts of a whole-value spec, so a
  // payload built from the render-time spec queued behind an in-flight
  // commit would silently revert it.
  const update = (build: (committed: QuestSpec) => QuestSpec | null) => {
    void projectStore.getState().commit((current) => questUpdateOps(current, quest.id, build))
  }
  const commitId = (value: string) => {
    setIdError(null)
    void projectStore
      .getState()
      .commit((current) => questPatchOps(current, quest.id, { id: value }), {
        onError: (error) => {
          // The duplicate-id rejection surfaces inline — the rename prompt,
          // right where the id was typed.
          if (error.detail.code === 'op_invariant') {
            setIdError(error.detail.message)
            return true
          }
          return false
        },
      })
      .then((committed) => {
        if (committed) onRenamed(value)
      })
  }
  const id = useCommittedField(quest.id, commitId, (draft) => {
    const trimmed = draft.trim()
    return trimmed === '' ? null : trimmed
  })
  // The name refuses an empty commit client-side; osrlib's min_length
  // rejection at request parse is the authority behind it.
  const name = useCommittedField(
    quest.name,
    (value) =>
      void projectStore
        .getState()
        .commit((current) => questPatchOps(current, quest.id, { name: value })),
    (draft) => {
      const trimmed = draft.trim()
      return trimmed === '' ? null : trimmed
    },
  )
  return (
    <div className="flex flex-col gap-5" data-testid={`quest-detail-${quest.id}`}>
      <div className="flex items-end gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="quest-id">Id</Label>
          <Input id="quest-id" className="w-56 font-mono" {...id} />
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <Label htmlFor="quest-name">Name</Label>
          <Input id="quest-name" {...name} />
        </div>
      </div>
      {idError && <p className="text-destructive text-xs">{idError}</p>}

      <ActivationCard quest={quest} document={document} onUpdate={update} />
      <ObjectiveList quest={quest} document={document} onUpdate={update} />

      <ConsequenceList
        commands={quest.rewards}
        document={document}
        idPrefix="quest-reward"
        noun="reward"
        title="Rewards"
        help="The engine issues rewards in this order when the quest completes. On a concluding quest the session is already victorious by then: spawns and placements drop, while grants, awards, and flags land."
        onUpdate={(build) =>
          update((committed) => {
            const rewards = build(committed.rewards)
            return rewards === null ? null : { ...committed, rewards }
          })
        }
      />

      <div className="flex flex-col gap-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="quest-completion">Completion</Label>
          <select
            id="quest-completion"
            className={`${SELECT_CLASS} w-56`}
            value={quest.completion}
            onChange={(event) => {
              // Captured before the queue runs — the controlled select may
              // re-render to the committed value underneath the callback.
              const completion = event.target.value as QuestSpec['completion']
              void projectStore
                .getState()
                .commit((current) => questPatchOps(current, quest.id, { completion }))
            }}
          >
            <option value="all">All objectives</option>
            <option value="any">Any objective</option>
          </select>
        </div>
        <p className="text-muted-foreground text-xs">
          Under "any", the first authored objective whose clause lands in the walk completes the
          quest.
        </p>
      </div>

      <label className="flex items-start gap-1.5 text-sm">
        <Checkbox
          aria-label="Concludes the adventure"
          checked={quest.concludes_adventure}
          onCheckedChange={(next) =>
            void projectStore
              .getState()
              .commit((current) =>
                questPatchOps(current, quest.id, { concludes_adventure: next === true }),
              )
          }
        />
        <span>
          Concludes the adventure
          <span className="text-muted-foreground block text-xs">
            Completing this quest ends the adventure in victory, and the engine journals the
            completion text with it. Author one concluding quest — osrlib caps nothing, and a second
            one completing merely adds a journal line.
          </span>
        </span>
      </label>

      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-medium">Narrative</h3>
        <p className="text-muted-foreground text-xs">
          The engine journals the offer at activation and the completion at quest completion — each
          beat as itself, on its own lifecycle event — so no separate journal voice exists.
        </p>
        <NarrativeBlockEditor
          block={quest.narrative ?? null}
          beats={['offer', 'completion']}
          idPrefix="quest-narrative"
          onCommit={(updateBlock) =>
            update((committed) => ({
              ...committed,
              narrative: updateBlock(committed.narrative ?? null),
            }))
          }
        />
      </div>
    </div>
  )
}

// Activation: absent is the standing charge — the stateless default, stated
// honestly — and a clause makes activation an event the party crosses.
function ActivationCard({
  quest,
  document,
  onUpdate,
}: {
  quest: QuestSpec
  document: Adventure
  onUpdate: (build: (committed: QuestSpec) => QuestSpec | null) => void
}) {
  const [drafting, setDrafting] = useState(false)
  const activation = quest.activation ?? null
  return (
    <div className="flex flex-col gap-2" aria-label="Activation">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium">Activation</h3>
        {activation === null && !drafting && (
          <Button variant="outline" size="sm" onClick={() => setDrafting(true)}>
            <PlusIcon /> Add activation
          </Button>
        )}
      </div>
      {activation === null && !drafting ? (
        <p className="text-muted-foreground text-xs">
          Standing charge — the quest is active from the session's first moment. With no activation
          moment the engine never journals the offer text, but the quest still shows in the player's
          quest log.
        </p>
      ) : (
        <>
          <p className="text-muted-foreground text-xs">
            The quest activates when this clause matches; the engine journals the offer text at that
            moment.
          </p>
          <ClauseBuilder
            clause={activation}
            document={document}
            idPrefix="quest-activation"
            onCommit={(build) =>
              onUpdate((committed) => {
                const next = build(committed.activation ?? null)
                return next === null ? null : { ...committed, activation: next }
              })
            }
          />
          <div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setDrafting(false)
                onUpdate((committed) =>
                  committed.activation == null ? null : { ...committed, activation: null },
                )
              }}
            >
              {activation === null ? 'Cancel' : 'Remove activation'}
            </Button>
          </div>
        </>
      )}
    </div>
  )
}

// The ordered objectives: order is semantics — objectives seed, walk, list,
// and validate in authored order, and the "any" rule completes on the first
// authored objective whose clause lands — so the rows carry reorder, all
// riding SetQuest whole (no objective op exists, the consequence-list grain).
function ObjectiveList({
  quest,
  document,
  onUpdate,
}: {
  quest: QuestSpec
  document: Adventure
  onUpdate: (build: (committed: QuestSpec) => QuestSpec | null) => void
}) {
  const [drafting, setDrafting] = useState(false)
  const moveObjective = (objectiveId: string, delta: 1 | -1) =>
    onUpdate((committed) => {
      const position = committed.objectives.findIndex((candidate) => candidate.id === objectiveId)
      const destination = position + delta
      if (position === -1 || destination < 0 || destination >= committed.objectives.length) {
        return null
      }
      const objectives = [...committed.objectives]
      const [moved] = objectives.splice(position, 1)
      objectives.splice(destination, 0, moved)
      return { ...committed, objectives }
    })
  const removeObjective = (objectiveId: string) =>
    onUpdate((committed) => {
      // The last objective never removes — osrlib rejects an objective-less
      // quest at parse — and the button disables with the reason named.
      if (committed.objectives.length <= 1) return null
      const objectives = committed.objectives.filter((candidate) => candidate.id !== objectiveId)
      return objectives.length === committed.objectives.length ? null : { ...committed, objectives }
    })
  return (
    <div className="flex flex-col gap-2" aria-label="Objectives">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium">Objectives</h3>
        {!drafting && (
          <Button variant="outline" size="sm" onClick={() => setDrafting(true)}>
            <PlusIcon /> New objective
          </Button>
        )}
      </div>
      <p className="text-muted-foreground text-xs">
        Objectives keep this order everywhere — the quest log, the walk, and the "any" rule's
        first-to-land all read it.
      </p>
      {quest.objectives.map((objective, index) => (
        <ObjectiveCard
          key={objective.id}
          quest={quest}
          objective={objective}
          index={index}
          count={quest.objectives.length}
          document={document}
          onUpdate={onUpdate}
          onMove={(delta) => moveObjective(objective.id, delta)}
          onRemove={() => removeObjective(objective.id)}
        />
      ))}
      {drafting && (
        <DraftObjectiveRow
          quest={quest}
          document={document}
          onDiscard={() => setDrafting(false)}
          onCommit={(objective) => {
            setDrafting(false)
            onUpdate((committed) => {
              // The quest-scoped duplicate is refused client-side before this
              // runs; recheck against the committed quest anyway — the
              // server's parse rejection is the authority.
              if (committed.objectives.some((candidate) => candidate.id === objective.id)) {
                return null
              }
              return { ...committed, objectives: [...committed.objectives, objective] }
            })
          }}
        />
      )}
    </div>
  )
}

function DraftObjectiveRow({
  quest,
  document,
  onDiscard,
  onCommit,
}: {
  quest: QuestSpec
  document: Adventure
  onDiscard: () => void
  onCommit: (objective: ObjectiveSpec) => void
}) {
  const [id, setId] = useState(() => nextObjectiveId(quest))
  const [pattern, setPattern] = useState<TriggerPattern | null>(null)
  const trimmed = id.trim()
  const duplicate = quest.objectives.some((candidate) => candidate.id === trimmed)
  return (
    <div className="flex flex-col gap-2 rounded-md border border-dashed p-2">
      <div className="flex justify-end">
        <button type="button" aria-label="Discard new objective" onClick={onDiscard}>
          <XIcon className="size-3" />
        </button>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="objective-new-id">Id</Label>
        <Input
          id="objective-new-id"
          className="w-48 font-mono"
          value={id}
          onChange={(event) => setId(event.target.value)}
        />
      </div>
      {duplicate && (
        <p className="text-destructive text-xs">
          The quest already has an objective '{trimmed}' — objective ids are unique within a quest.
        </p>
      )}
      <div className="flex flex-col gap-1.5">
        <span className="text-sm font-medium">Completes</span>
        <PatternBuilder
          pattern={pattern}
          document={document}
          idPrefix="objective-new"
          onCommit={setPattern}
        />
      </div>
      <div>
        <Button
          size="sm"
          disabled={trimmed === '' || duplicate || pattern === null}
          onClick={() => {
            if (!pattern) return
            onCommit(seedObjective(trimmed, { pattern, conditions: [] }))
          }}
        >
          Add
        </Button>
      </div>
    </div>
  )
}

function ObjectiveCard({
  quest,
  objective,
  index,
  count,
  document,
  onUpdate,
  onMove,
  onRemove,
}: {
  quest: QuestSpec
  objective: ObjectiveSpec
  index: number
  count: number
  document: Adventure
  onUpdate: (build: (committed: QuestSpec) => QuestSpec | null) => void
  onMove: (delta: 1 | -1) => void
  onRemove: () => void
}) {
  const [idError, setIdError] = useState<string | null>(null)
  const [revealDrafting, setRevealDrafting] = useState(false)
  // Objective-grained edits resolve the objective by id inside the committed
  // quest — unambiguous, because osrlib enforces quest-scoped uniqueness at
  // parse on every loaded document.
  const updateObjective = (build: (committed: ObjectiveSpec) => ObjectiveSpec | null) =>
    onUpdate((committedQuest) => {
      const position = committedQuest.objectives.findIndex(
        (candidate) => candidate.id === objective.id,
      )
      if (position === -1) return null
      const next = build(committedQuest.objectives[position])
      if (next === null) return null
      const objectives = [...committedQuest.objectives]
      objectives[position] = next
      return { ...committedQuest, objectives }
    })
  const commitId = (value: string) => {
    setIdError(null)
    // The quest-scoped duplicate refuses client-side with an inline message;
    // osrlib's parse rejection is the authority behind it.
    if (quest.objectives.some((candidate) => candidate.id === value && candidate !== objective)) {
      setIdError(`The quest already has an objective '${value}'.`)
      return
    }
    updateObjective((committed) => ({ ...committed, id: value }))
  }
  const id = useCommittedField(objective.id, commitId, (draft) => {
    const trimmed = draft.trim()
    return trimmed === '' ? null : trimmed
  })
  const name = useCommittedField(objective.name, (value) =>
    updateObjective((committed) => ({ ...committed, name: value })),
  )
  return (
    <div
      className="flex flex-col gap-3 rounded-md border p-3"
      data-testid={`objective-card-${objective.id}`}
    >
      <div className="flex items-center justify-end gap-1">
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={`Move objective ${objective.id} up`}
          disabled={index === 0}
          onClick={() => onMove(-1)}
        >
          <ArrowUpIcon />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={`Move objective ${objective.id} down`}
          disabled={index === count - 1}
          onClick={() => onMove(1)}
        >
          <ArrowDownIcon />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          aria-label={`Remove objective ${objective.id}`}
          disabled={count <= 1}
          title={
            count <= 1
              ? 'A quest keeps at least one objective — an objective-less quest would be born complete.'
              : undefined
          }
          onClick={onRemove}
        >
          Remove
        </Button>
      </div>
      {count <= 1 && (
        <p className="text-muted-foreground text-xs">
          The editor never removes the last objective — an objective-less quest would be born
          complete, and osrlib rejects it.
        </p>
      )}
      <div className="flex items-end gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`objective-${index}-id`}>Id</Label>
          <Input id={`objective-${index}-id`} className="w-48 font-mono" {...id} />
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <Label htmlFor={`objective-${index}-name`}>Name</Label>
          <Input id={`objective-${index}-name`} {...name} />
        </div>
      </div>
      {idError && <p className="text-destructive text-xs">{idError}</p>}
      <p className="text-muted-foreground text-xs">
        The name is the quest log's label; leave it empty and the id shows everywhere a label does.
      </p>
      <div className="flex flex-col gap-2">
        <h4 className="text-sm font-medium">Completes</h4>
        <ClauseBuilder
          clause={objective.when}
          document={document}
          idPrefix={`objective-${index}-when`}
          onCommit={(build) =>
            updateObjective((committed) => {
              const when = build(committed.when)
              return when === null ? null : { ...committed, when }
            })
          }
        />
      </div>
      <label className="flex items-start gap-1.5 text-sm">
        <Checkbox
          aria-label={`Hidden objective ${objective.id}`}
          checked={objective.hidden}
          onCheckedChange={(next) => {
            // Unchecking hidden clears the reveal clause in the same gesture
            // — osrlib rejects a reveal clause on a visible objective at
            // parse, so the pair moves together.
            setRevealDrafting(false)
            updateObjective((committed) =>
              next === true
                ? { ...committed, hidden: true }
                : { ...committed, hidden: false, reveal_when: null },
            )
          }}
        />
        <span>
          Hidden
          <span className="text-muted-foreground block text-xs">
            A hidden objective stays off the quest log until revealed — or until it completes, which
            reveals it.
          </span>
        </span>
      </label>
      {objective.hidden && (
        <div className="flex flex-col gap-2" aria-label={`Reveal ${objective.id}`}>
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-medium">Reveals</h4>
            {objective.reveal_when == null && !revealDrafting && (
              <Button variant="outline" size="sm" onClick={() => setRevealDrafting(true)}>
                <PlusIcon /> Add reveal clause
              </Button>
            )}
          </div>
          {objective.reveal_when == null && !revealDrafting ? (
            <p className="text-muted-foreground text-xs">
              No reveal clause — the normal shape: the objective surfaces by completing. The engine
              reads the offer beat only at the reveal.
            </p>
          ) : (
            <>
              <ClauseBuilder
                clause={objective.reveal_when ?? null}
                document={document}
                idPrefix={`objective-${index}-reveal`}
                onCommit={(build) =>
                  updateObjective((committed) => {
                    const reveal = build(committed.reveal_when ?? null)
                    return reveal === null ? null : { ...committed, reveal_when: reveal }
                  })
                }
              />
              <div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setRevealDrafting(false)
                    updateObjective((committed) =>
                      committed.reveal_when == null ? null : { ...committed, reveal_when: null },
                    )
                  }}
                >
                  {objective.reveal_when == null ? 'Cancel' : 'Remove reveal clause'}
                </Button>
              </div>
            </>
          )}
        </div>
      )}
      <div className="flex flex-col gap-2">
        <h4 className="text-sm font-medium">Narrative</h4>
        <p className="text-muted-foreground text-xs">
          The engine reads the offer at the reveal and the progress at completion, and journals each
          as itself. A born-visible objective's offer is read at no moment.
        </p>
        <NarrativeBlockEditor
          block={objective.narrative ?? null}
          beats={['offer', 'progress']}
          idPrefix={`objective-${index}-narrative`}
          onCommit={(updateBlock) =>
            updateObjective((committed) => ({
              ...committed,
              narrative: updateBlock(committed.narrative ?? null),
            }))
          }
        />
      </div>
    </div>
  )
}
