// The Monsters section: bundled-template stocking for both project types —
// list-plus-detail, the detail editor always-saved per gesture over the whole
// MonsterTemplate. In a forge project the section renders the assembled
// document's derived bundle as a review view, and every authoring gesture
// blocks in place: flow-entry actions (create, clone, remove) open the
// blocked-op dialog client-side with the would-be op named, and a
// detail-field commit posts and renders its 422 through the same dialog. The
// author-notes card stays live in both modes — notes are sidecar annotation,
// never ops.
import { useState } from 'react'
import { PlusIcon, XIcon } from 'lucide-react'
import { toast } from 'sonner'

import { AuthorNotesCard } from '@/components/author-notes-card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
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
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Textarea } from '@/components/ui/textarea'
import { ListEditor } from '@/components/list-editor'
import { integerInRange, useCommittedField } from '@/hooks/use-committed-field'
import { monsterAddress } from '@/lib/address'
import { api, ApiRequestError } from '@/lib/api'
import {
  effectiveMonsterCatalog,
  loadMonsterCatalog,
  rankMonsters,
  recentMonsterIds,
  useCatalog,
  type PickerMonster,
} from '@/lib/catalogs'
import { ALIGNMENTS, CONDITIONS } from '@/lib/content-builders'
import {
  BUNDLED_TEMPLATE_BLOCKED_MESSAGE,
  DAMAGE_KEYS,
  ELEMENTS,
  addMonsterTemplateOps,
  autoHitPatch,
  cloneId,
  emptyMonsterAttack,
  formatAbilityParam,
  monsterReferenceCount,
  monsterTemplatePatchOps,
  monsterTemplateRemoveOps,
  monsterTemplateUpdateOps,
  parseAbilityParam,
  seedMonsterTemplate,
} from '@/lib/monster-builders'
import { formatHitDice, parseDice } from '@/lib/notation'
import { projectStore } from '@/store/project-store'
import type {
  Adventure,
  Alignment,
  AttackRoutine,
  Condition,
  DamageKey,
  Element,
  MonsterAbility,
  MonsterAttack,
  MonsterTemplate,
  ProjectState,
} from '@/types'

const SELECT_CLASS = 'h-8 rounded-md border border-input bg-transparent px-2 text-sm'

// Normalizers beyond the shared integerInRange: signed integers (AC can be
// negative, a hit-dice modifier is signed) and blank-or-integer optionals.
function anyInteger(draft: string): string | null {
  const parsed = Number(draft)
  return Number.isInteger(parsed) ? String(parsed) : null
}

function optionalInteger(min?: number, max?: number): (draft: string) => string | null {
  return (draft) => {
    const trimmed = draft.trim()
    if (trimmed === '') return ''
    const parsed = Number(trimmed)
    if (!Number.isInteger(parsed)) return null
    if (min !== undefined && parsed < min) return null
    if (max !== undefined && parsed > max) return null
    return String(parsed)
  }
}

function optionalDice(draft: string): string | null {
  const trimmed = draft.trim()
  if (trimmed === '') return ''
  return parseDice(trimmed) ? trimmed : null
}

function nonEmpty(draft: string): string | null {
  const trimmed = draft.trim()
  return trimmed === '' ? null : trimmed
}

// Comma-separated token lists (treasure letters and parentheticals).
function splitTokens(text: string): string[] {
  return text
    .split(',')
    .map((token) => token.trim())
    .filter((token) => token !== '')
}

export function MonstersSection({
  project,
  section,
  focusToken,
}: {
  project: ProjectState
  section: { templateId?: string; create?: boolean }
  focusToken: number
}) {
  const document = project.document
  const monsters = document.monsters
  const forge = project.forge !== null
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [cloneSource, setCloneSource] = useState<MonsterTemplate | null>(null)
  const shipped = useCatalog(loadMonsterCatalog)

  // Consume the navigation focus once per token — a diagnostics click selects
  // its template; the picker's create shortcut opens the create dialog (it
  // never arrives in forge mode: the shortcut blocks at its own entry point).
  const [consumedToken, setConsumedToken] = useState<number | null>(null)
  if (focusToken !== consumedToken) {
    setConsumedToken(focusToken)
    if (section.templateId) setSelectedId(section.templateId)
    if (section.create && !forge) setCreateOpen(true)
  }

  const selected = monsters.find((template) => template.id === selectedId) ?? monsters[0] ?? null

  const blockEntry = (op: string, templateId?: string) =>
    projectStore.getState().setBlockedOp({
      op,
      address: templateId ? monsterAddress(templateId) : 'monsters',
      message: BUNDLED_TEMPLATE_BLOCKED_MESSAGE,
    })

  const startClone = (picked: PickerMonster) => {
    if (picked.bundled) {
      const source = monsters.find((template) => template.id === picked.id)
      if (source) setCloneSource(source)
      return
    }
    api.getCatalogMonster(picked.id).then(
      (source) => setCloneSource(source),
      (error: unknown) => {
        if (error instanceof ApiRequestError) {
          toast.error(error.detail.message, { description: error.detail.remedy ?? undefined })
        }
      },
    )
  }

  const takenIds = new Set([
    ...(shipped ?? []).map((monster) => monster.id),
    ...monsters.map((template) => template.id),
  ])

  return (
    <section aria-label="Monsters" className="flex min-h-0 gap-6">
      <div className="flex w-80 shrink-0 flex-col gap-3">
        <h2 className="font-serif text-xl font-semibold">Monsters</h2>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => (forge ? blockEntry('add_monster_template') : setCreateOpen(true))}
          >
            <PlusIcon /> New monster
          </Button>
          {forge ? (
            <Button variant="outline" size="sm" onClick={() => blockEntry('add_monster_template')}>
              Clone catalog monster
            </Button>
          ) : (
            <CloneSourcePicker bundled={monsters} onPick={startClone} />
          )}
        </div>
        {monsters.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            No bundled monsters yet — create one from scratch or clone a catalog monster.
          </p>
        ) : (
          <ul className="flex flex-col gap-1" aria-label="Bundled monsters">
            {monsters.map((template) => (
              <MonsterRow
                key={template.id}
                template={template}
                document={document}
                selected={selected?.id === template.id}
                onSelect={() => setSelectedId(template.id)}
                onRemove={() => {
                  if (forge) {
                    blockEntry('remove_monster_template', template.id)
                    return false
                  }
                  void projectStore.getState().commit(monsterTemplateRemoveOps(template.id))
                  if (selectedId === template.id) setSelectedId(null)
                  return true
                }}
                forge={forge}
              />
            ))}
          </ul>
        )}
      </div>
      <div className="min-w-0 flex-1">
        {selected ? (
          <div className="flex max-w-2xl flex-col gap-6">
            <MonsterDetail key={selected.id} template={selected} onRenamed={setSelectedId} />
            <AuthorNotesCard address={monsterAddress(selected.id)} />
          </div>
        ) : (
          <p className="text-muted-foreground text-sm">
            Select a bundled monster to edit its stat block.
          </p>
        )}
      </div>
      <CreateMonsterDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={setSelectedId}
      />
      <CloneMonsterDialog
        source={cloneSource}
        takenIds={takenIds}
        onOpenChange={(open) => !open && setCloneSource(null)}
        onCreated={setSelectedId}
      />
    </section>
  )
}

function MonsterRow({
  template,
  document,
  selected,
  onSelect,
  onRemove,
  forge,
}: {
  template: MonsterTemplate
  document: Adventure
  selected: boolean
  onSelect: () => void
  onRemove: () => boolean
  forge: boolean
}) {
  const [confirming, setConfirming] = useState(false)
  const references = monsterReferenceCount(document, template.id)
  return (
    <li
      className={`rounded-md border ${selected ? 'border-primary' : ''}`}
      data-testid={`monster-row-${template.id}`}
    >
      <button
        type="button"
        className="flex w-full flex-col gap-0.5 p-2 text-left"
        onClick={onSelect}
      >
        <span className="font-serif text-sm font-medium">{template.name || template.id}</span>
        <span className="text-muted-foreground font-mono text-xs">
          {template.id} · HD {formatHitDice(template.hit_dice)} · {template.xp} XP
        </span>
        <span className="text-muted-foreground text-xs">
          {references === 1 ? 'referenced by 1 entry' : `referenced by ${references} entries`}
        </span>
      </button>
      <div className="flex justify-end gap-2 px-2 pb-2">
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
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              // The forge flow-entry rule: the first gesture opens the
              // blocked-op dialog; the two-step confirm is native-only.
              if (forge) {
                onRemove()
                return
              }
              setConfirming(true)
            }}
          >
            Remove
          </Button>
        )}
      </div>
      {confirming && (
        <p className="text-muted-foreground px-2 pb-2 text-xs">
          {references > 0
            ? `${references} encounter or wandering ${references === 1 ? 'entry keeps' : 'entries keep'} naming this id and become diagnostics.`
            : 'Nothing references this template.'}
        </p>
      )}
    </li>
  )
}

// The clone source picker: the monster command palette over the effective
// catalog, sans the count row — picking hands the source to the clone dialog.
function CloneSourcePicker({
  bundled,
  onPick,
}: {
  bundled: readonly MonsterTemplate[]
  onPick: (monster: PickerMonster) => void
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const shipped = useCatalog(loadMonsterCatalog)
  const monsters = shipped ? effectiveMonsterCatalog(shipped, bundled) : []
  const ranked = rankMonsters(monsters, recentMonsterIds(), query)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm">
          Clone catalog monster
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput placeholder="Search monsters…" value={query} onValueChange={setQuery} />
          <CommandList>
            <CommandEmpty>{shipped ? 'No monster matches.' : 'Loading the catalog…'}</CommandEmpty>
            <CommandGroup>
              {ranked.map((monster) => (
                <CommandItem
                  key={monster.id}
                  value={monster.id}
                  onSelect={() => {
                    setOpen(false)
                    setQuery('')
                    onPick(monster)
                  }}
                >
                  <span className="truncate">{monster.name}</span>
                  {monster.bundled && <Badge variant="secondary">bundled</Badge>}
                  <span className="text-muted-foreground ml-auto font-mono text-xs">
                    HD {formatHitDice(monster.hitDice)}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

function CreateMonsterDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: (id: string) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open && <CreateMonsterBody onOpenChange={onOpenChange} onCreated={onCreated} />}
    </Dialog>
  )
}

function CreateMonsterBody({
  onOpenChange,
  onCreated,
}: {
  onOpenChange: (open: boolean) => void
  onCreated: (id: string) => void
}) {
  const [id, setId] = useState('')
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const submit = () => {
    const trimmedId = id.trim()
    setError(null)
    void projectStore
      .getState()
      .commit(addMonsterTemplateOps(seedMonsterTemplate(trimmedId, name.trim())), {
        onError: (requestError) => {
          // The collision and empty-id rejections surface inline — the
          // rename prompt the spec names, right where the id was typed.
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
    <DialogContent className="sm:max-w-md">
      <DialogHeader>
        <DialogTitle>New monster</DialogTitle>
        <DialogDescription>
          A stock 1-HD stat block is created; edit every field in the detail editor.
        </DialogDescription>
      </DialogHeader>
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="create-monster-id">Id</Label>
          <Input
            id="create-monster-id"
            className="font-mono"
            value={id}
            onChange={(event) => setId(event.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="create-monster-name">Name</Label>
          <Input
            id="create-monster-name"
            className="font-serif"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </div>
        {error && <p className="text-destructive text-xs">{error}</p>}
      </div>
      <DialogFooter>
        <Button variant="ghost" onClick={() => onOpenChange(false)}>
          Cancel
        </Button>
        <Button onClick={submit} disabled={id.trim() === ''}>
          Create
        </Button>
      </DialogFooter>
    </DialogContent>
  )
}

function CloneMonsterDialog({
  source,
  takenIds,
  onOpenChange,
  onCreated,
}: {
  source: MonsterTemplate | null
  takenIds: ReadonlySet<string>
  onOpenChange: (open: boolean) => void
  onCreated: (id: string) => void
}) {
  return (
    <Dialog open={source !== null} onOpenChange={onOpenChange}>
      {source && (
        <CloneMonsterBody
          source={source}
          takenIds={takenIds}
          onOpenChange={onOpenChange}
          onCreated={onCreated}
        />
      )}
    </Dialog>
  )
}

function CloneMonsterBody({
  source,
  takenIds,
  onOpenChange,
  onCreated,
}: {
  source: MonsterTemplate
  takenIds: ReadonlySet<string>
  onOpenChange: (open: boolean) => void
  onCreated: (id: string) => void
}) {
  // The prefill: next-free <source-id>-<n> over the effective catalog — the
  // collision invariant's own scope, so a prefill never lands on a rejection.
  const [id, setId] = useState(() => cloneId(source.id, takenIds))
  const [name, setName] = useState(source.name)
  const [error, setError] = useState<string | null>(null)
  const submit = () => {
    const trimmedId = id.trim()
    setError(null)
    // Clone-and-modify: the source's whole stat block under the
    // editor-authored conventions — page "" and no compiler provenance.
    const template: MonsterTemplate = {
      ...source,
      id: trimmedId,
      name: name.trim(),
      page: '',
      overrides_applied: [],
    }
    void projectStore
      .getState()
      .commit(addMonsterTemplateOps(template), {
        onError: (requestError) => {
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
    <DialogContent className="sm:max-w-md">
      <DialogHeader>
        <DialogTitle>Clone {source.name}</DialogTitle>
        <DialogDescription>
          The whole stat block is copied; edit any field afterwards.
        </DialogDescription>
      </DialogHeader>
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="clone-monster-id">Id</Label>
          <Input
            id="clone-monster-id"
            className="font-mono"
            value={id}
            onChange={(event) => setId(event.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="clone-monster-name">Name</Label>
          <Input
            id="clone-monster-name"
            className="font-serif"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </div>
        {error && <p className="text-destructive text-xs">{error}</p>}
      </div>
      <DialogFooter>
        <Button variant="ghost" onClick={() => onOpenChange(false)}>
          Cancel
        </Button>
        <Button onClick={submit} disabled={id.trim() === ''}>
          Add to the adventure
        </Button>
      </DialogFooter>
    </DialogContent>
  )
}

// --- the detail editor -------------------------------------------------------

function MonsterDetail({
  template,
  onRenamed,
}: {
  template: MonsterTemplate
  onRenamed: (id: string) => void
}) {
  const [idError, setIdError] = useState<string | null>(null)
  const patch = (value: Partial<MonsterTemplate>) => {
    void projectStore
      .getState()
      .commit((current) => monsterTemplatePatchOps(current, template.id, value))
  }
  // Collection edits (routines, movement rows, abilities, defense rows)
  // compute their next value from the committed template inside the queue —
  // never from the render-time prop.
  const update = (build: (committed: MonsterTemplate) => Partial<MonsterTemplate> | null) => {
    void projectStore
      .getState()
      .commit((current) => monsterTemplateUpdateOps(current, template.id, build))
  }
  const commitId = (value: string) => {
    setIdError(null)
    void projectStore
      .getState()
      .commit((current) => monsterTemplatePatchOps(current, template.id, { id: value }), {
        onError: (error) => {
          // The collision rejection surfaces inline — the rename prompt the
          // spec names, right where the id was typed.
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
  const id = useCommittedField(template.id, commitId, nonEmpty)
  const name = useCommittedField(template.name, (value) => patch({ name: value }))
  const intro = useCommittedField(template.intro, (value) => patch({ intro: value }))
  const xp = useCommittedField(
    String(template.xp),
    (draft) => patch({ xp: Number(draft) }),
    integerInRange(0),
  )
  return (
    <div className="flex flex-col gap-6" data-testid={`monster-detail-${template.id}`}>
      <div className="flex flex-col gap-3">
        <h3 className="font-serif text-lg font-semibold">{template.name || template.id}</h3>
        <div className="flex items-end gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="monster-id">Id</Label>
            <Input id="monster-id" className="w-48 font-mono" {...id} />
          </div>
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <Label htmlFor="monster-name">Name</Label>
            <Input id="monster-name" className="font-serif" {...name} />
          </div>
        </div>
        {idError && <p className="text-destructive text-xs">{idError}</p>}
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="monster-intro">Intro</Label>
          <Textarea
            id="monster-intro"
            className="min-h-16 font-serif"
            value={intro.value}
            onChange={intro.onChange}
            onBlur={intro.onBlur}
          />
        </div>
      </div>

      <CombatSection template={template} patch={patch} update={update} />
      <MovementSection template={template} update={update} />
      <SavesSection template={template} update={update} />
      <MoraleSection template={template} patch={patch} update={update} />
      <AlignmentSection template={template} update={update} />

      <div className="flex flex-col gap-3">
        <h4 className="text-sm font-semibold">Experience</h4>
        <div className="flex items-end gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="monster-xp">XP</Label>
            <Input id="monster-xp" className="w-24 font-mono" {...xp} />
          </div>
        </div>
        <XpNotesEditor template={template} update={update} />
      </div>

      <NumberAppearingSection template={template} update={update} />
      <TreasureSection template={template} update={update} />
      <AbilitiesSection template={template} update={update} />
      <DefensesSection template={template} update={update} />

      <ListEditor
        label="Categories"
        items={template.categories}
        onCommit={(mutate) =>
          update((committed) => ({ categories: mutate([...committed.categories]) }))
        }
      />
    </div>
  )
}

type Update = (build: (committed: MonsterTemplate) => Partial<MonsterTemplate> | null) => void

function CombatSection({
  template,
  patch,
  update,
}: {
  template: MonsterTemplate
  patch: (value: Partial<MonsterTemplate>) => void
  update: Update
}) {
  const ac = useCommittedField(
    template.ac == null ? '' : String(template.ac),
    (draft) => patch({ ac: Number(draft) }),
    anyInteger,
  )
  const acAscending = useCommittedField(
    template.ac_ascending == null ? '' : String(template.ac_ascending),
    (draft) => patch({ ac_ascending: Number(draft) }),
    anyInteger,
  )
  const thac0 = useCommittedField(
    String(template.thac0),
    (draft) => patch({ thac0: Number(draft) }),
    integerInRange(2, 20),
  )
  const attackBonus = useCommittedField(
    String(template.attack_bonus),
    (draft) => patch({ attack_bonus: Number(draft) }),
    integerInRange(-1),
  )
  return (
    <div className="flex flex-col gap-3">
      <h4 className="text-sm font-semibold">Combat</h4>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={template.attack_roll_required}
          onChange={(event) => patch(autoHitPatch(event.target.checked))}
        />
        Requires an attack roll
      </label>
      {template.attack_roll_required && (
        <div className="flex items-end gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="monster-ac">AC</Label>
            <Input id="monster-ac" className="w-20 font-mono" {...ac} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="monster-ac-ascending">AC (ascending)</Label>
            <Input id="monster-ac-ascending" className="w-20 font-mono" {...acAscending} />
          </div>
        </div>
      )}
      <AcAlternatesEditor template={template} update={update} />
      <HitDiceEditor template={template} update={update} />
      <div className="flex items-end gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="monster-thac0">THAC0</Label>
          <Input id="monster-thac0" className="w-20 font-mono" {...thac0} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="monster-attack-bonus">Attack bonus</Label>
          <Input id="monster-attack-bonus" className="w-20 font-mono" {...attackBonus} />
        </div>
      </div>
      <RoutinesEditor template={template} update={update} />
    </div>
  )
}

function AcAlternatesEditor({ template, update }: { template: MonsterTemplate; update: Update }) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label>Alternate ACs</Label>
      {template.ac_alternates.map((alternate, index) => (
        <div key={index} className="flex items-center gap-2">
          <IntField
            label="Alternate AC"
            value={alternate.ac}
            onCommit={(value) =>
              update((committed) => patchRow(committed, 'ac_alternates', index, { ac: value }))
            }
          />
          <IntField
            label="Alternate AC (ascending)"
            value={alternate.ac_ascending}
            onCommit={(value) =>
              update((committed) =>
                patchRow(committed, 'ac_alternates', index, { ac_ascending: value }),
              )
            }
          />
          <TextField
            label="Condition"
            value={alternate.condition}
            placeholder="in human form"
            onCommit={(value) =>
              update((committed) =>
                patchRow(committed, 'ac_alternates', index, { condition: value }),
              )
            }
          />
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Remove alternate AC"
            onClick={() =>
              update((committed) => ({
                ac_alternates: committed.ac_alternates.filter((_, at) => at !== index),
              }))
            }
          >
            <XIcon />
          </Button>
        </div>
      ))}
      <Button
        variant="outline"
        size="sm"
        className="self-start"
        onClick={() =>
          update((committed) => ({
            ac_alternates: [...committed.ac_alternates, { ac: 9, ac_ascending: 10, condition: '' }],
          }))
        }
      >
        Add alternate AC
      </Button>
    </div>
  )
}

// Patch one row of a template's tuple field — the shared row-edit shape.
function patchRow<Field extends 'ac_alternates' | 'morale_alternates' | 'xp_notes' | 'movement'>(
  committed: MonsterTemplate,
  field: Field,
  index: number,
  rowPatch: Partial<MonsterTemplate[Field][number]>,
): Partial<MonsterTemplate> | null {
  const rows = committed[field]
  if (index >= rows.length) return null
  return {
    [field]: rows.map((existing, at) => (at === index ? { ...existing, ...rowPatch } : existing)),
  } as Partial<MonsterTemplate>
}

function HitDiceEditor({ template, update }: { template: MonsterTemplate; update: Update }) {
  const dice = template.hit_dice
  const patchDice = (dicePatch: Partial<MonsterTemplate['hit_dice']>) =>
    update((committed) => {
      const next = { ...committed.hit_dice, ...dicePatch }
      // The count-0-needs-fixed rule, carried by shape: dropping the count to
      // 0 seeds fixed hit points in the same value.
      if (next.count === 0 && next.fixed_hp == null) next.fixed_hp = 1
      return { hit_dice: next }
    })
  const count = useCommittedField(
    String(dice.count),
    (draft) => patchDice({ count: Number(draft) }),
    integerInRange(0),
  )
  const modifier = useCommittedField(
    String(dice.modifier),
    (draft) => patchDice({ modifier: Number(draft) }),
    anyInteger,
  )
  const asterisks = useCommittedField(
    String(dice.asterisks),
    (draft) => patchDice({ asterisks: Number(draft) }),
    integerInRange(0),
  )
  const averageHp = useCommittedField(
    dice.average_hp == null ? '' : String(dice.average_hp),
    (draft) => patchDice({ average_hp: draft === '' ? null : Number(draft) }),
    optionalInteger(1),
  )
  const fixedHp = useCommittedField(
    dice.fixed_hp == null ? '' : String(dice.fixed_hp),
    (draft) => {
      // Clearing fixed hp under count 0 would leave nothing to roll — the
      // form refuses the shape rather than surface a rejection.
      if (draft === '' && dice.count === 0) return
      patchDice({ fixed_hp: draft === '' ? null : Number(draft) })
    },
    optionalInteger(1),
  )
  return (
    <div className="flex flex-col gap-1.5">
      <Label>Hit dice</Label>
      <div className="flex items-end gap-2">
        <LabeledColumn label="count">
          <Input aria-label="Hit dice count" className="h-8 w-14 font-mono text-xs" {...count} />
        </LabeledColumn>
        <LabeledColumn label="die">
          <select
            className={SELECT_CLASS}
            aria-label="Hit die"
            value={dice.die}
            onChange={(event) => patchDice({ die: Number(event.target.value) })}
          >
            <option value={8}>d8</option>
            <option value={4}>d4 (half HD)</option>
          </select>
        </LabeledColumn>
        <LabeledColumn label="modifier">
          <Input
            aria-label="Hit dice modifier"
            className="h-8 w-14 font-mono text-xs"
            {...modifier}
          />
        </LabeledColumn>
        <LabeledColumn label="asterisks">
          <Input aria-label="Asterisks" className="h-8 w-14 font-mono text-xs" {...asterisks} />
        </LabeledColumn>
        <LabeledColumn label="average hp">
          <Input aria-label="Average HP" className="h-8 w-16 font-mono text-xs" {...averageHp} />
        </LabeledColumn>
        <LabeledColumn label="fixed hp">
          <Input aria-label="Fixed HP" className="h-8 w-16 font-mono text-xs" {...fixedHp} />
        </LabeledColumn>
      </div>
    </div>
  )
}

function LabeledColumn({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-muted-foreground font-mono text-[10px]">{label}</span>
      {children}
    </div>
  )
}

function RoutinesEditor({ template, update }: { template: MonsterTemplate; update: Update }) {
  const patchAttack = (
    routineIndex: number,
    attackIndex: number,
    attackPatch: Partial<MonsterAttack>,
  ) =>
    update((committed) => {
      const routine = committed.attacks[routineIndex]
      if (!routine || attackIndex >= routine.attacks.length) return null
      const attacks: AttackRoutine[] = committed.attacks.map((existing, at) =>
        at === routineIndex
          ? {
              attacks: existing.attacks.map((attack, index) =>
                index === attackIndex ? { ...attack, ...attackPatch } : attack,
              ),
            }
          : existing,
      )
      return { attacks }
    })
  return (
    <div className="flex flex-col gap-2">
      <Label>Attack routines</Label>
      {template.attacks.map((routine, routineIndex) => (
        <div key={routineIndex} className="flex flex-col gap-2 rounded-md border p-2">
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground text-xs">Routine {routineIndex + 1}</span>
            <Button
              variant="ghost"
              size="sm"
              onClick={() =>
                update((committed) => ({
                  attacks: committed.attacks.filter((_, at) => at !== routineIndex),
                }))
              }
            >
              Remove routine
            </Button>
          </div>
          {routine.attacks.map((attack, attackIndex) => (
            <AttackRow
              key={attackIndex}
              attack={attack}
              onPatch={(attackPatch) => patchAttack(routineIndex, attackIndex, attackPatch)}
              onRemove={
                routine.attacks.length > 1
                  ? () =>
                      update((committed) => {
                        const committedRoutine = committed.attacks[routineIndex]
                        if (!committedRoutine || committedRoutine.attacks.length <= 1) return null
                        return {
                          attacks: committed.attacks.map((existing, at) =>
                            at === routineIndex
                              ? {
                                  attacks: existing.attacks.filter(
                                    (_, index) => index !== attackIndex,
                                  ),
                                }
                              : existing,
                          ),
                        }
                      })
                  : undefined
              }
            />
          ))}
          <Button
            variant="outline"
            size="sm"
            className="self-start"
            onClick={() =>
              update((committed) => {
                const committedRoutine = committed.attacks[routineIndex]
                if (!committedRoutine) return null
                return {
                  attacks: committed.attacks.map((existing, at) =>
                    at === routineIndex
                      ? { attacks: [...existing.attacks, emptyMonsterAttack()] }
                      : existing,
                  ),
                }
              })
            }
          >
            Add attack
          </Button>
        </div>
      ))}
      <Button
        variant="outline"
        size="sm"
        className="self-start"
        onClick={() =>
          update((committed) => ({
            attacks: [...committed.attacks, { attacks: [emptyMonsterAttack()] }],
          }))
        }
      >
        Add routine
      </Button>
    </div>
  )
}

function AttackRow({
  attack,
  onPatch,
  onRemove,
}: {
  attack: MonsterAttack
  onPatch: (patch: Partial<MonsterAttack>) => void
  onRemove?: () => void
}) {
  const count = useCommittedField(
    String(attack.count),
    (draft) => onPatch({ count: Number(draft) }),
    integerInRange(1),
  )
  const name = useCommittedField(attack.name, (value) => onPatch({ name: value }), nonEmpty)
  const damage = useCommittedField(
    attack.damage ?? '',
    (draft) => onPatch({ damage: draft === '' ? null : draft }),
    optionalDice,
  )
  const fixedDamage = useCommittedField(
    attack.fixed_damage == null ? '' : String(attack.fixed_damage),
    (draft) => onPatch({ fixed_damage: draft === '' ? null : Number(draft) }),
    optionalInteger(0),
  )
  const byWeaponModifier = useCommittedField(
    String(attack.by_weapon_modifier),
    (draft) => onPatch({ by_weapon_modifier: Number(draft) }),
    anyInteger,
  )
  return (
    <div className="flex flex-col gap-2 border-t pt-2 first:border-t-0 first:pt-0">
      <div className="flex items-end gap-2">
        <LabeledColumn label="count">
          <Input aria-label="Attack count" className="h-8 w-12 font-mono text-xs" {...count} />
        </LabeledColumn>
        <LabeledColumn label="name">
          <Input aria-label="Attack name" className="h-8 w-28 text-xs" {...name} />
        </LabeledColumn>
        <LabeledColumn label="damage">
          <Input
            aria-label="Attack damage"
            className="h-8 w-20 font-mono text-xs"
            placeholder="1d6"
            {...damage}
          />
        </LabeledColumn>
        <LabeledColumn label="fixed">
          <Input
            aria-label="Fixed damage"
            className="h-8 w-14 font-mono text-xs"
            {...fixedDamage}
          />
        </LabeledColumn>
        {onRemove && (
          <Button variant="ghost" size="icon-sm" aria-label="Remove attack" onClick={onRemove}>
            <XIcon />
          </Button>
        )}
      </div>
      <div className="flex items-center gap-3">
        <label className="flex items-center gap-2 text-xs">
          <input
            type="checkbox"
            checked={attack.by_weapon}
            onChange={(event) => onPatch({ by_weapon: event.target.checked })}
          />
          or by weapon
        </label>
        {attack.by_weapon && (
          <LabeledColumn label="weapon modifier">
            <Input
              aria-label="By-weapon modifier"
              className="h-8 w-14 font-mono text-xs"
              {...byWeaponModifier}
            />
          </LabeledColumn>
        )}
      </div>
      <ListEditor
        label="Effects"
        items={attack.effects}
        placeholder="poison, energy_drain…"
        onCommit={(mutate) => onPatch({ effects: mutate([...attack.effects]) })}
      />
    </div>
  )
}

function MovementSection({ template, update }: { template: MonsterTemplate; update: Update }) {
  return (
    <div className="flex flex-col gap-1.5">
      <h4 className="text-sm font-semibold">Movement</h4>
      {template.movement.map((mode, index) => (
        <div key={index} className="flex items-end gap-2">
          <LabeledColumn label="rate (per turn)">
            <IntInput
              label="Movement rate"
              value={mode.rate_feet}
              min={0}
              onCommit={(value) =>
                update((committed) => patchRow(committed, 'movement', index, { rate_feet: value }))
              }
            />
          </LabeledColumn>
          <LabeledColumn label="encounter (per round)">
            <IntInput
              label="Encounter rate"
              value={mode.encounter_rate_feet}
              min={0}
              onCommit={(value) =>
                update((committed) =>
                  patchRow(committed, 'movement', index, { encounter_rate_feet: value }),
                )
              }
            />
          </LabeledColumn>
          <LabeledColumn label="descriptor">
            <OptionalTextInput
              label="Movement descriptor"
              value={mode.descriptor ?? ''}
              placeholder="flying, swimming…"
              onCommit={(value) =>
                update((committed) =>
                  patchRow(committed, 'movement', index, {
                    descriptor: value === '' ? null : value,
                  }),
                )
              }
            />
          </LabeledColumn>
          {template.movement.length > 1 && (
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Remove movement mode"
              onClick={() =>
                update((committed) =>
                  committed.movement.length > 1
                    ? { movement: committed.movement.filter((_, at) => at !== index) }
                    : null,
                )
              }
            >
              <XIcon />
            </Button>
          )}
        </div>
      ))}
      <Button
        variant="outline"
        size="sm"
        className="self-start"
        onClick={() =>
          update((committed) => ({
            movement: [
              ...committed.movement,
              { rate_feet: 120, encounter_rate_feet: 40, descriptor: null },
            ],
          }))
        }
      >
        Add movement mode
      </Button>
    </div>
  )
}

const SAVE_FIELDS = ['death', 'wands', 'paralysis', 'breath', 'spells'] as const

function SavesSection({ template, update }: { template: MonsterTemplate; update: Update }) {
  const saveAs = useCommittedField(template.saves.save_as, (value) =>
    update((committed) => ({ saves: { ...committed.saves, save_as: value } })),
  )
  return (
    <div className="flex flex-col gap-1.5">
      <h4 className="text-sm font-semibold">Saving throws</h4>
      <div className="flex items-end gap-2">
        {SAVE_FIELDS.map((save) => (
          <LabeledColumn key={save} label={save}>
            <IntInput
              label={`Save versus ${save}`}
              value={template.saves.values[save]}
              min={2}
              max={20}
              onCommit={(value) =>
                update((committed) => ({
                  saves: {
                    ...committed.saves,
                    values: { ...committed.saves.values, [save]: value },
                  },
                }))
              }
            />
          </LabeledColumn>
        ))}
        <LabeledColumn label="save as">
          <Input aria-label="Save as" className="h-8 w-16 font-mono text-xs" {...saveAs} />
        </LabeledColumn>
      </div>
    </div>
  )
}

function MoraleSection({
  template,
  patch,
  update,
}: {
  template: MonsterTemplate
  patch: (value: Partial<MonsterTemplate>) => void
  update: Update
}) {
  const morale = useCommittedField(
    template.morale == null ? '' : String(template.morale),
    (draft) => patch({ morale: draft === '' ? null : Number(draft) }),
    optionalInteger(2, 12),
  )
  return (
    <div className="flex flex-col gap-1.5">
      <h4 className="text-sm font-semibold">Morale</h4>
      <div className="flex items-end gap-2">
        <LabeledColumn label="morale (blank for none)">
          <Input aria-label="Morale" className="h-8 w-16 font-mono text-xs" {...morale} />
        </LabeledColumn>
      </div>
      {template.morale_alternates.map((alternate, index) => (
        <div key={index} className="flex items-end gap-2">
          <LabeledColumn label="score">
            <IntInput
              label="Alternate morale score"
              value={alternate.score}
              min={2}
              max={12}
              onCommit={(value) =>
                update((committed) =>
                  patchRow(committed, 'morale_alternates', index, { score: value }),
                )
              }
            />
          </LabeledColumn>
          <LabeledColumn label="condition">
            <TextField
              label="Morale condition"
              value={alternate.condition}
              placeholder="fear of fire"
              onCommit={(value) =>
                update((committed) =>
                  patchRow(committed, 'morale_alternates', index, { condition: value }),
                )
              }
              required
            />
          </LabeledColumn>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Remove morale alternate"
            onClick={() =>
              update((committed) => ({
                morale_alternates: committed.morale_alternates.filter((_, at) => at !== index),
              }))
            }
          >
            <XIcon />
          </Button>
        </div>
      ))}
      <Button
        variant="outline"
        size="sm"
        className="self-start"
        onClick={() =>
          update((committed) => ({
            morale_alternates: [
              ...committed.morale_alternates,
              { score: 8, condition: 'condition' },
            ],
          }))
        }
      >
        Add morale alternate
      </Button>
    </div>
  )
}

function AlignmentSection({ template, update }: { template: MonsterTemplate; update: Update }) {
  const options = template.alignment.options
  const toggle = (alignment: Alignment, checked: boolean) =>
    update((committed) => {
      const current = committed.alignment.options
      const next = checked
        ? [...current, alignment]
        : current.filter((existing) => existing !== alignment)
      // The model demands at least one option — unchecking the last is
      // refused by shape rather than surfaced as a rejection.
      if (next.length === 0) return null
      const usual =
        committed.alignment.usual && next.includes(committed.alignment.usual)
          ? committed.alignment.usual
          : null
      return { alignment: { options: next, usual } }
    })
  return (
    <div className="flex flex-col gap-1.5">
      <h4 className="text-sm font-semibold">Alignment</h4>
      <div className="flex items-center gap-4">
        {ALIGNMENTS.map((alignment) => (
          <label key={alignment} className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={options.includes(alignment)}
              onChange={(event) => toggle(alignment, event.target.checked)}
            />
            {alignment}
          </label>
        ))}
        <label className="flex items-center gap-2 text-sm">
          usually
          <select
            className={SELECT_CLASS}
            aria-label="Usual alignment"
            value={template.alignment.usual ?? ''}
            onChange={(event) =>
              update((committed) => ({
                alignment: {
                  options: committed.alignment.options,
                  usual: event.target.value === '' ? null : (event.target.value as Alignment),
                },
              }))
            }
          >
            <option value="">—</option>
            {options.map((alignment) => (
              <option key={alignment} value={alignment}>
                {alignment}
              </option>
            ))}
          </select>
        </label>
      </div>
    </div>
  )
}

function XpNotesEditor({ template, update }: { template: MonsterTemplate; update: Update }) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label>Role XP notes</Label>
      {template.xp_notes.map((note, index) => (
        <div key={index} className="flex items-end gap-2">
          <LabeledColumn label="role">
            <TextField
              label="XP note role"
              value={note.role}
              placeholder="chieftain"
              onCommit={(value) =>
                update((committed) => patchRow(committed, 'xp_notes', index, { role: value }))
              }
              required
            />
          </LabeledColumn>
          <LabeledColumn label="xp">
            <IntInput
              label="XP note value"
              value={note.xp}
              min={0}
              onCommit={(value) =>
                update((committed) => patchRow(committed, 'xp_notes', index, { xp: value }))
              }
            />
          </LabeledColumn>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Remove XP note"
            onClick={() =>
              update((committed) => ({
                xp_notes: committed.xp_notes.filter((_, at) => at !== index),
              }))
            }
          >
            <XIcon />
          </Button>
        </div>
      ))}
      <Button
        variant="outline"
        size="sm"
        className="self-start"
        onClick={() =>
          update((committed) => ({
            xp_notes: [...committed.xp_notes, { role: 'leader', xp: 0 }],
          }))
        }
      >
        Add XP note
      </Button>
    </div>
  )
}

function NumberAppearingSection({
  template,
  update,
}: {
  template: MonsterTemplate
  update: Update
}) {
  return (
    <div className="flex flex-col gap-3">
      <h4 className="text-sm font-semibold">Number appearing</h4>
      {(['dungeon', 'lair'] as const).map((slot) => (
        <NumberAppearingValueEditor
          key={slot}
          slot={slot}
          value={template.number_appearing[slot]}
          onCommit={(value) =>
            update((committed) => ({
              number_appearing: { ...committed.number_appearing, [slot]: value },
            }))
          }
        />
      ))}
    </div>
  )
}

function NumberAppearingValueEditor({
  slot,
  value,
  onCommit,
}: {
  slot: 'dungeon' | 'lair'
  value: MonsterTemplate['number_appearing']['dungeon']
  onCommit: (value: MonsterTemplate['number_appearing']['dungeon']) => void
}) {
  const mode = value.see_below ? 'see_below' : value.dice != null ? 'dice' : 'fixed'
  const dice = useCommittedField(
    value.dice ?? '',
    (draft) => onCommit({ dice: draft, fixed: null, see_below: false }),
    (draft) => (parseDice(draft.trim()) ? draft.trim() : null),
  )
  const fixed = useCommittedField(
    value.fixed == null ? '' : String(value.fixed),
    (draft) => onCommit({ dice: null, fixed: Number(draft), see_below: false }),
    integerInRange(0),
  )
  return (
    <div className="flex items-end gap-3">
      <span className="text-muted-foreground w-16 text-xs">{slot}</span>
      <div
        className="flex items-center gap-3"
        role="radiogroup"
        aria-label={`${slot} number appearing`}
      >
        <label className="flex items-center gap-1.5 text-xs">
          <input
            type="radio"
            name={`na-${slot}`}
            checked={mode === 'dice'}
            onChange={() => onCommit({ dice: '1d6', fixed: null, see_below: false })}
          />
          dice
        </label>
        <label className="flex items-center gap-1.5 text-xs">
          <input
            type="radio"
            name={`na-${slot}`}
            checked={mode === 'fixed'}
            onChange={() => onCommit({ dice: null, fixed: 1, see_below: false })}
          />
          fixed
        </label>
        <label className="flex items-center gap-1.5 text-xs">
          <input
            type="radio"
            name={`na-${slot}`}
            checked={mode === 'see_below'}
            onChange={() => onCommit({ dice: null, fixed: null, see_below: true })}
          />
          see below
        </label>
      </div>
      {mode === 'dice' && (
        <Input aria-label={`${slot} dice`} className="h-8 w-20 font-mono text-xs" {...dice} />
      )}
      {mode === 'fixed' && (
        <Input
          aria-label={`${slot} fixed count`}
          className="h-8 w-20 font-mono text-xs"
          {...fixed}
        />
      )}
    </div>
  )
}

function TreasureSection({ template, update }: { template: MonsterTemplate; update: Update }) {
  const treasure = template.treasure
  const letters = useCommittedField(treasure.letters.join(', '), (draft) =>
    update((committed) => ({
      treasure: { ...committed.treasure, letters: splitTokens(draft) },
    })),
  )
  const parenthetical = useCommittedField(treasure.parenthetical.join(', '), (draft) =>
    update((committed) => ({
      treasure: { ...committed.treasure, parenthetical: splitTokens(draft) },
    })),
  )
  const extraGp = useCommittedField(
    String(treasure.extra_gp),
    (draft) =>
      update((committed) => ({
        treasure: { ...committed.treasure, extra_gp: Number(draft) },
      })),
    integerInRange(0),
  )
  const multiplier = useCommittedField(
    String(treasure.multiplier),
    (draft) =>
      update((committed) => ({
        treasure: { ...committed.treasure, multiplier: Number(draft) },
      })),
    integerInRange(1),
  )
  return (
    <div className="flex flex-col gap-1.5">
      <h4 className="text-sm font-semibold">Treasure</h4>
      <div className="flex items-end gap-2">
        <LabeledColumn label="letters">
          <Input
            aria-label="Treasure letters"
            className="h-8 w-24 font-mono text-xs"
            placeholder="R, S"
            {...letters}
          />
        </LabeledColumn>
        <LabeledColumn label="parenthetical">
          <Input
            aria-label="Parenthetical letters"
            className="h-8 w-24 font-mono text-xs"
            placeholder="B"
            {...parenthetical}
          />
        </LabeledColumn>
        <LabeledColumn label="extra gp">
          <Input aria-label="Extra gp" className="h-8 w-16 font-mono text-xs" {...extraGp} />
        </LabeledColumn>
        <LabeledColumn label="multiplier">
          <Input aria-label="Multiplier" className="h-8 w-14 font-mono text-xs" {...multiplier} />
        </LabeledColumn>
        <label className="flex items-center gap-2 pb-1.5 text-xs">
          <input
            type="checkbox"
            checked={treasure.see_below}
            onChange={(event) =>
              update((committed) => ({
                treasure: { ...committed.treasure, see_below: event.target.checked },
              }))
            }
          />
          see below
        </label>
      </div>
      <ListEditor
        label="Special treasure"
        items={treasure.special}
        placeholder="Tusks, Honey…"
        onCommit={(mutate) =>
          update((committed) => ({
            treasure: { ...committed.treasure, special: mutate([...committed.treasure.special]) },
          }))
        }
      />
    </div>
  )
}

function AbilitiesSection({ template, update }: { template: MonsterTemplate; update: Update }) {
  const patchAbility = (index: number, abilityPatch: Partial<MonsterAbility>) =>
    update((committed) => {
      if (index >= committed.abilities.length) return null
      return {
        abilities: committed.abilities.map((existing, at) =>
          at === index ? { ...existing, ...abilityPatch } : existing,
        ),
      }
    })
  return (
    <div className="flex flex-col gap-2">
      <h4 className="text-sm font-semibold">Abilities</h4>
      {template.abilities.map((ability, index) => (
        <AbilityEditor
          key={index}
          ability={ability}
          onPatch={(abilityPatch) => patchAbility(index, abilityPatch)}
          onRemove={() =>
            update((committed) => ({
              abilities: committed.abilities.filter((_, at) => at !== index),
            }))
          }
        />
      ))}
      <Button
        variant="outline"
        size="sm"
        className="self-start"
        onClick={() =>
          update((committed) => ({
            abilities: [
              ...committed.abilities,
              { tag: 'custom', name: 'New ability', prose: '', manual: true, params: {} },
            ],
          }))
        }
      >
        Add ability
      </Button>
    </div>
  )
}

function AbilityEditor({
  ability,
  onPatch,
  onRemove,
}: {
  ability: MonsterAbility
  onPatch: (patch: Partial<MonsterAbility>) => void
  onRemove: () => void
}) {
  const tag = useCommittedField(ability.tag, (value) => onPatch({ tag: value }), nonEmpty)
  const name = useCommittedField(ability.name, (value) => onPatch({ name: value }), nonEmpty)
  const prose = useCommittedField(ability.prose, (value) => onPatch({ prose: value }))
  const [paramKey, setParamKey] = useState('')
  const [paramValue, setParamValue] = useState('')
  const addParam = () => {
    const key = paramKey.trim()
    const parsed = parseAbilityParam(paramValue)
    if (key === '' || parsed === null) return
    onPatch({ params: { ...ability.params, [key]: parsed } })
    setParamKey('')
    setParamValue('')
  }
  return (
    <div className="flex flex-col gap-2 rounded-md border p-2">
      <div className="flex items-end gap-2">
        <LabeledColumn label="tag">
          <Input aria-label="Ability tag" className="h-8 w-32 font-mono text-xs" {...tag} />
        </LabeledColumn>
        <LabeledColumn label="name">
          <Input aria-label="Ability name" className="h-8 w-40 text-xs" {...name} />
        </LabeledColumn>
        <label className="flex items-center gap-2 pb-1.5 text-xs">
          <input
            type="checkbox"
            checked={ability.manual}
            onChange={(event) => onPatch({ manual: event.target.checked })}
          />
          manual (the kernel doesn't execute it)
        </label>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Remove ability"
          className="ml-auto"
          onClick={onRemove}
        >
          <XIcon />
        </Button>
      </div>
      <Textarea
        aria-label="Ability prose"
        className="min-h-16 font-serif text-sm"
        value={prose.value}
        onChange={prose.onChange}
        onBlur={prose.onBlur}
      />
      <div className="flex flex-col gap-1.5">
        <Label>Params</Label>
        {Object.entries(ability.params).map(([key, value]) => (
          <div key={key} className="flex items-center gap-2">
            <span className="font-mono text-xs">{key}</span>
            <ParamValueField
              paramKey={key}
              value={value}
              onCommit={(next) => onPatch({ params: { ...ability.params, [key]: next } })}
            />
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={`Remove param ${key}`}
              onClick={() => {
                const params = { ...ability.params }
                delete params[key]
                onPatch({ params })
              }}
            >
              <XIcon />
            </Button>
          </div>
        ))}
        <div className="flex items-center gap-2">
          <Input
            aria-label="New param key"
            className="h-7 w-28 font-mono text-xs"
            placeholder="key"
            value={paramKey}
            onChange={(event) => setParamKey(event.target.value)}
          />
          <Input
            aria-label="New param value"
            className="h-7 w-36 font-mono text-xs"
            placeholder='3, true, "cone"'
            value={paramValue}
            onChange={(event) => setParamValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') addParam()
            }}
          />
          <Button
            variant="outline"
            size="icon-sm"
            aria-label="Add param"
            onClick={addParam}
            disabled={paramKey.trim() === '' || parseAbilityParam(paramValue) === null}
          >
            <PlusIcon />
          </Button>
        </div>
      </div>
    </div>
  )
}

function ParamValueField({
  paramKey,
  value,
  onCommit,
}: {
  paramKey: string
  value: MonsterAbility['params'][string]
  onCommit: (value: MonsterAbility['params'][string]) => void
}) {
  const field = useCommittedField(formatAbilityParam(value), (draft) => {
    const parsed = parseAbilityParam(draft)
    if (parsed !== null) onCommit(parsed)
  })
  return (
    <Input
      aria-label={`Param ${paramKey} value`}
      className="h-7 w-36 font-mono text-xs"
      {...field}
    />
  )
}

function DefensesSection({ template, update }: { template: MonsterTemplate; update: Update }) {
  const defenses = template.defenses
  const energyEntries = Object.entries(defenses.energy) as [
    Element,
    (typeof defenses.energy)[string],
  ][]
  const freeElements = ELEMENTS.filter((element) => !(element in defenses.energy))
  const toggleKey = (list: 'harmed_only_by', key: DamageKey, checked: boolean) =>
    update((committed) => {
      const current = committed.defenses[list]
      const next = checked ? [...current, key] : current.filter((existing) => existing !== key)
      return { defenses: { ...committed.defenses, [list]: next } }
    })
  return (
    <div className="flex flex-col gap-3">
      <h4 className="text-sm font-semibold">Defenses</h4>
      <div className="flex flex-col gap-1.5">
        <Label>Harmed only by</Label>
        <div className="flex items-center gap-4">
          {DAMAGE_KEYS.map((key) => (
            <label key={key} className="flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={defenses.harmed_only_by.includes(key)}
                onChange={(event) => toggleKey('harmed_only_by', key, event.target.checked)}
              />
              {key}
            </label>
          ))}
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label>Damage reductions</Label>
        {defenses.reductions.map((reduction, index) => (
          <div key={index} className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              {DAMAGE_KEYS.map((key) => (
                <label key={key} className="flex items-center gap-1 text-xs">
                  <input
                    type="checkbox"
                    checked={reduction.keys.includes(key)}
                    onChange={(event) =>
                      update((committed) => {
                        const committedReduction = committed.defenses.reductions[index]
                        if (!committedReduction) return null
                        const keys = event.target.checked
                          ? [...committedReduction.keys, key]
                          : committedReduction.keys.filter((existing) => existing !== key)
                        return {
                          defenses: {
                            ...committed.defenses,
                            reductions: committed.defenses.reductions.map((existing, at) =>
                              at === index ? { ...existing, keys } : existing,
                            ),
                          },
                        }
                      })
                    }
                  />
                  {key}
                </label>
              ))}
            </div>
            <LabeledColumn label="divisor">
              <IntInput
                label="Reduction divisor"
                value={reduction.divisor}
                min={2}
                onCommit={(value) =>
                  update((committed) => {
                    if (index >= committed.defenses.reductions.length) return null
                    return {
                      defenses: {
                        ...committed.defenses,
                        reductions: committed.defenses.reductions.map((existing, at) =>
                          at === index ? { ...existing, divisor: value } : existing,
                        ),
                      },
                    }
                  })
                }
              />
            </LabeledColumn>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Remove reduction"
              onClick={() =>
                update((committed) => ({
                  defenses: {
                    ...committed.defenses,
                    reductions: committed.defenses.reductions.filter((_, at) => at !== index),
                  },
                }))
              }
            >
              <XIcon />
            </Button>
          </div>
        ))}
        <Button
          variant="outline"
          size="sm"
          className="self-start"
          onClick={() =>
            update((committed) => ({
              defenses: {
                ...committed.defenses,
                reductions: [...committed.defenses.reductions, { keys: [], divisor: 2 }],
              },
            }))
          }
        >
          Add reduction
        </Button>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label>Energy defenses</Label>
        {energyEntries.map(([element, defense]) => (
          <div key={element} className="flex items-center gap-3">
            <span className="w-20 font-mono text-xs">{element}</span>
            <select
              className={SELECT_CLASS}
              aria-label={`${element} immunity`}
              value={defense.immunity}
              onChange={(event) =>
                update((committed) => {
                  const committedDefense = committed.defenses.energy[element]
                  if (!committedDefense) return null
                  return {
                    defenses: {
                      ...committed.defenses,
                      energy: {
                        ...committed.defenses.energy,
                        [element]: {
                          ...committedDefense,
                          immunity: event.target.value as 'all' | 'nonmagical',
                        },
                      },
                    },
                  }
                })
              }
            >
              <option value="all">immune to all</option>
              <option value="nonmagical">immune to nonmagical</option>
            </select>
            <label className="flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={defense.auto_save_magical}
                onChange={(event) =>
                  update((committed) => {
                    const committedDefense = committed.defenses.energy[element]
                    if (!committedDefense) return null
                    return {
                      defenses: {
                        ...committed.defenses,
                        energy: {
                          ...committed.defenses.energy,
                          [element]: {
                            ...committedDefense,
                            auto_save_magical: event.target.checked,
                          },
                        },
                      },
                    }
                  })
                }
              />
              auto-save vs magical
            </label>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={`Remove ${element} defense`}
              onClick={() =>
                update((committed) => {
                  const energy = { ...committed.defenses.energy }
                  delete energy[element]
                  return { defenses: { ...committed.defenses, energy } }
                })
              }
            >
              <XIcon />
            </Button>
          </div>
        ))}
        {freeElements.length > 0 && (
          <select
            className={SELECT_CLASS + ' self-start'}
            aria-label="Add energy defense"
            value=""
            onChange={(event) => {
              const element = event.target.value as Element
              if (!element) return
              update((committed) => ({
                defenses: {
                  ...committed.defenses,
                  energy: {
                    ...committed.defenses.energy,
                    [element]: { immunity: 'all', auto_save_magical: false },
                  },
                },
              }))
            }}
          >
            <option value="">Add energy defense…</option>
            {freeElements.map((element) => (
              <option key={element} value={element}>
                {element}
              </option>
            ))}
          </select>
        )}
      </div>
      <div className="flex flex-col gap-1.5">
        <Label>Condition immunities</Label>
        {defenses.condition_immunities.length > 0 && (
          <ul className="flex flex-wrap gap-1.5" aria-label="Condition immunities">
            {defenses.condition_immunities.map((condition) => (
              <li
                key={condition}
                className="bg-muted flex items-center gap-1 rounded px-1.5 py-0.5 font-mono text-xs"
              >
                {condition}
                <button
                  type="button"
                  aria-label={`Remove immunity ${condition}`}
                  onClick={() =>
                    update((committed) => ({
                      defenses: {
                        ...committed.defenses,
                        condition_immunities: committed.defenses.condition_immunities.filter(
                          (existing) => existing !== condition,
                        ),
                      },
                    }))
                  }
                >
                  <XIcon className="size-3" />
                </button>
              </li>
            ))}
          </ul>
        )}
        <select
          className={SELECT_CLASS + ' self-start'}
          aria-label="Add condition immunity"
          value=""
          onChange={(event) => {
            const condition = event.target.value as Condition
            if (!condition) return
            update((committed) =>
              committed.defenses.condition_immunities.includes(condition)
                ? null
                : {
                    defenses: {
                      ...committed.defenses,
                      condition_immunities: [...committed.defenses.condition_immunities, condition],
                    },
                  },
            )
          }}
        >
          <option value="">Add condition immunity…</option>
          {CONDITIONS.filter((condition) => !defenses.condition_immunities.includes(condition)).map(
            (condition) => (
              <option key={condition} value={condition}>
                {condition}
              </option>
            ),
          )}
        </select>
      </div>
    </div>
  )
}

// --- small committed-input helpers --------------------------------------------

function IntField({
  label,
  value,
  onCommit,
}: {
  label: string
  value: number
  onCommit: (value: number) => void
}) {
  const field = useCommittedField(String(value), (draft) => onCommit(Number(draft)), anyInteger)
  return <Input aria-label={label} className="h-8 w-16 font-mono text-xs" {...field} />
}

function IntInput({
  label,
  value,
  min,
  max,
  onCommit,
}: {
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
  return <Input aria-label={label} className="h-8 w-16 font-mono text-xs" {...field} />
}

function TextField({
  label,
  value,
  placeholder,
  onCommit,
  required = false,
}: {
  label: string
  value: string
  placeholder?: string
  onCommit: (value: string) => void
  required?: boolean
}) {
  const field = useCommittedField(value, onCommit, required ? nonEmpty : undefined)
  return (
    <Input aria-label={label} className="h-8 w-40 text-xs" placeholder={placeholder} {...field} />
  )
}

function OptionalTextInput({
  label,
  value,
  placeholder,
  onCommit,
}: {
  label: string
  value: string
  placeholder?: string
  onCommit: (value: string) => void
}) {
  const field = useCommittedField(value, onCommit)
  return (
    <Input aria-label={label} className="h-8 w-32 text-xs" placeholder={placeholder} {...field} />
  )
}
