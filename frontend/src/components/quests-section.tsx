// The Quests section, arriving with its trigger surface first (the quest
// builder is phase 17's): the trigger list in document order — order is
// semantics, the interpreter fires matching triggers in list order — with
// reorder, a create dialog, and a detail editor over the whole TriggerSpec:
// the pattern builder, conditions with consumes suppressed (osrlib rejects a
// consuming trigger condition at parse), the consequence list over the
// closed nine-command union, the repeatable toggle, the fired and journal
// narrative voices, and author notes.
//
// Forge mode is the Items split: no forge-assembled document can carry
// triggers, so the explanation *is* the honest section body — the
// overrides-vocabulary gap is forge's recorded decision (osr-forge#39), and
// detach is offered in place.
import { useState } from 'react'
import { ArrowDownIcon, ArrowUpIcon, PlusIcon, XIcon } from 'lucide-react'

import { AuthorNotesCard } from '@/components/author-notes-card'
import { ConditionBuilder } from '@/components/condition-builder'
import { ConsequenceBuilder } from '@/components/consequence-builder'
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
import { triggerAddress } from '@/lib/address'
import { itemNameFor, loadEquipmentCatalog, useCatalog } from '@/lib/catalogs'
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
  ConditionSpec,
  ConsequenceCommand,
  ProjectState,
  TriggerPattern,
  TriggerSpec,
} from '@/types'

export function QuestsSection({
  project,
  section,
  focusToken,
}: {
  project: ProjectState
  section: { triggerId?: string }
  focusToken: number
}) {
  const document = project.document
  const triggers = document.triggers
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [createOpen, setCreateOpen] = useState(false)

  // Consume the navigation focus once per token — a diagnostics click selects
  // its trigger.
  const [consumedToken, setConsumedToken] = useState<number | null>(null)
  if (focusToken !== consumedToken) {
    setConsumedToken(focusToken)
    if (section.triggerId) setSelectedId(section.triggerId)
  }

  if (project.forge) {
    return <ForgeQuestsBody />
  }

  // First match among foreign duplicate ids — osrlib's own resolution posture.
  const selected = triggers.find((trigger) => trigger.id === selectedId) ?? triggers[0] ?? null

  return (
    <section aria-label="Quests" className="flex min-h-0 gap-6">
      <div className="flex w-96 shrink-0 flex-col gap-3 self-start" data-testid="trigger-list-pane">
        <h2 className="font-serif text-xl font-semibold">Quests</h2>
        <div className="flex flex-col gap-1">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium">Triggers</h3>
            <Button variant="outline" size="sm" onClick={() => setCreateOpen(true)}>
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
                selected={selected === trigger}
                onSelect={() => setSelectedId(trigger.id)}
                onMove={(nextIndex) => {
                  void projectStore.getState().commit(moveTriggerOps(trigger.id, nextIndex))
                }}
                onRemove={() => {
                  void projectStore.getState().commit(removeTriggerOps(trigger.id))
                  if (selectedId === trigger.id) setSelectedId(null)
                }}
              />
            ))}
          </ol>
        )}
        {document.quests.length > 0 && (
          <p className="text-muted-foreground text-xs" data-testid="quest-presence">
            This document carries {document.quests.length}{' '}
            {document.quests.length === 1 ? 'quest' : 'quests'} (
            <span className="font-mono">{document.quests.map((quest) => quest.id).join(', ')}</span>
            ) — the quest builder arrives in a later phase.
          </p>
        )}
      </div>
      <div className="min-w-0 flex-1">
        {selected ? (
          <div className="flex max-w-2xl flex-col gap-6">
            <TriggerDetail
              key={selected.id}
              trigger={selected}
              document={document}
              onRenamed={setSelectedId}
            />
            <AuthorNotesCard address={triggerAddress(selected.id)} />
          </div>
        ) : (
          <p className="text-muted-foreground text-sm">Select a trigger to edit it.</p>
        )}
      </div>
      <CreateTriggerDialog
        open={createOpen}
        document={document}
        onOpenChange={setCreateOpen}
        onCreated={setSelectedId}
      />
    </section>
  )
}

// The forge explanation body: the deliberate overrides-vocabulary gap, named,
// with detach offered in place — a live destination, never a dead tooltip. No
// list renders because no forge-assembled document can carry triggers.
function ForgeQuestsBody() {
  const [detachOpen, setDetachOpen] = useState(false)
  return (
    <section aria-label="Quests" className="flex max-w-xl flex-col gap-3">
      <h2 className="font-serif text-xl font-semibold">Quests</h2>
      <p className="text-sm">
        A forge-assembled adventure carries no triggers or quests: the overrides vocabulary has no
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
        To author triggers — and later quests — detach this project to a native one. Detaching
        severs the forge re-run loop and records provenance.
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
  onMove: (index: number) => void
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
          onClick={() => onMove(index - 1)}
        >
          <ArrowUpIcon />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={`Move ${trigger.id} down`}
          disabled={index === count - 1}
          onClick={() => onMove(index + 1)}
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
          already marked it fired keeps the orphaned mark.
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

// --- the detail editor -------------------------------------------------------

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

      <ConditionList trigger={trigger} document={document} onUpdate={update} />
      <ConsequenceList trigger={trigger} document={document} onUpdate={update} />

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

// The trigger conditions: an add/remove/edit list of ConditionBuilder rows
// with consumes suppressed — the control never renders, because osrlib
// rejects a consuming trigger condition at parse.
function ConditionList({
  trigger,
  document,
  onUpdate,
}: {
  trigger: TriggerSpec
  document: Adventure
  onUpdate: (build: (committed: TriggerSpec) => TriggerSpec | null) => void
}) {
  const [drafting, setDrafting] = useState(false)
  const replaceAt = (index: number, condition: ConditionSpec) =>
    onUpdate((committed) => {
      if (index >= committed.conditions.length) return null
      const conditions = [...committed.conditions]
      conditions[index] = condition
      return { ...committed, conditions }
    })
  const removeAt = (index: number) =>
    onUpdate((committed) => {
      if (index >= committed.conditions.length) return null
      return {
        ...committed,
        conditions: committed.conditions.filter((_, position) => position !== index),
      }
    })
  return (
    <div className="flex flex-col gap-2" aria-label="Conditions">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium">Conditions</h3>
        {!drafting && (
          <Button variant="outline" size="sm" onClick={() => setDrafting(true)}>
            <PlusIcon /> Add condition
          </Button>
        )}
      </div>
      <p className="text-muted-foreground text-xs">
        All conditions must hold at the moment of the match. A trigger fires, it does not take —
        conditions here never consume.
      </p>
      {trigger.conditions.map((condition, index) => (
        <div key={index} className="flex flex-col gap-2 rounded-md border p-2">
          <div className="flex justify-end">
            <button
              type="button"
              aria-label={`Remove condition ${index + 1}`}
              onClick={() => removeAt(index)}
            >
              <XIcon className="size-3" />
            </button>
          </div>
          <ConditionBuilder
            condition={condition}
            document={document}
            offerConsumes={false}
            idPrefix={`trigger-condition-${index}`}
            onCommit={(next) => replaceAt(index, next)}
          />
        </div>
      ))}
      {drafting && (
        <div className="flex flex-col gap-2 rounded-md border border-dashed p-2">
          <div className="flex justify-end">
            <button
              type="button"
              aria-label="Discard new condition"
              onClick={() => setDrafting(false)}
            >
              <XIcon className="size-3" />
            </button>
          </div>
          <ConditionBuilder
            condition={null}
            document={document}
            offerConsumes={false}
            idPrefix="trigger-condition-new"
            onCommit={(condition) => {
              setDrafting(false)
              onUpdate((committed) => ({
                ...committed,
                conditions: [...committed.conditions, condition],
              }))
            }}
          />
        </div>
      )}
    </div>
  )
}

// The consequence list: execution order is authored order, so the rows carry
// per-row up/down — the list is form state committed whole through
// SetTrigger, no op involved.
function ConsequenceList({
  trigger,
  document,
  onUpdate,
}: {
  trigger: TriggerSpec
  document: Adventure
  onUpdate: (build: (committed: TriggerSpec) => TriggerSpec | null) => void
}) {
  const [drafting, setDrafting] = useState(false)
  const replaceAt = (index: number, command: ConsequenceCommand) =>
    onUpdate((committed) => {
      if (index >= committed.consequences.length) return null
      const consequences = [...committed.consequences]
      consequences[index] = command
      return { ...committed, consequences }
    })
  const removeAt = (index: number) =>
    onUpdate((committed) => {
      if (index >= committed.consequences.length) return null
      return {
        ...committed,
        consequences: committed.consequences.filter((_, position) => position !== index),
      }
    })
  const moveTo = (index: number, nextIndex: number) =>
    onUpdate((committed) => {
      if (index >= committed.consequences.length || nextIndex >= committed.consequences.length) {
        return null
      }
      const consequences = [...committed.consequences]
      const [moved] = consequences.splice(index, 1)
      consequences.splice(nextIndex, 0, moved)
      return { ...committed, consequences }
    })
  return (
    <div className="flex flex-col gap-2" aria-label="Consequences">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium">Consequences</h3>
        {!drafting && (
          <Button variant="outline" size="sm" onClick={() => setDrafting(true)}>
            <PlusIcon /> Add consequence
          </Button>
        )}
      </div>
      <p className="text-muted-foreground text-xs">
        Consequences execute in this order when the trigger fires. Empty is a normal shape — a
        trigger whose whole job is its journal beat.
      </p>
      {trigger.consequences.map((command, index) => (
        <div key={index} className="flex flex-col gap-2 rounded-md border p-2">
          <div className="flex items-center justify-end gap-1">
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={`Move consequence ${index + 1} up`}
              disabled={index === 0}
              onClick={() => moveTo(index, index - 1)}
            >
              <ArrowUpIcon />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={`Move consequence ${index + 1} down`}
              disabled={index === trigger.consequences.length - 1}
              onClick={() => moveTo(index, index + 1)}
            >
              <ArrowDownIcon />
            </Button>
            <button
              type="button"
              aria-label={`Remove consequence ${index + 1}`}
              onClick={() => removeAt(index)}
            >
              <XIcon className="size-3" />
            </button>
          </div>
          <ConsequenceBuilder
            command={command}
            document={document}
            idPrefix={`trigger-consequence-${index}`}
            onCommit={(next) => replaceAt(index, next)}
          />
        </div>
      ))}
      {drafting && (
        <div className="flex flex-col gap-2 rounded-md border border-dashed p-2">
          <div className="flex justify-end">
            <button
              type="button"
              aria-label="Discard new consequence"
              onClick={() => setDrafting(false)}
            >
              <XIcon className="size-3" />
            </button>
          </div>
          <ConsequenceBuilder
            command={null}
            document={document}
            idPrefix="trigger-consequence-new"
            onCommit={(command) => {
              setDrafting(false)
              onUpdate((committed) => ({
                ...committed,
                consequences: [...committed.consequences, command],
              }))
            }}
          />
        </div>
      )}
    </div>
  )
}
