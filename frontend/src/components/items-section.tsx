// The Items section: bundled item-template stocking — list-plus-detail, the
// detail editor always-saved per gesture over the whole ItemTemplate, one
// form per kind covering its whole model with the validators carried by
// shape (the missile toggle seeds and clears ranges in one gesture; the
// armour radio swaps the body/shield field sets whole, so the XOR is
// unrepresentable to break).
//
// Forge mode differs from Monsters by the spec's own split: a
// forge-assembled document can never carry items, so there is no list to
// render and the explanation *is* the honest section body — the
// overrides-vocabulary gap is forge's recorded decision (osr-forge#39), and
// detach is offered in place as the live destination phase 4's teaching rule
// requires.
import { useState } from 'react'
import { PlusIcon, XIcon } from 'lucide-react'
import { toast } from 'sonner'

import { AuthorNotesCard } from '@/components/author-notes-card'
import { DetachDialog } from '@/components/detach-dialog'
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
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { integerInRange, useCommittedField } from '@/hooks/use-committed-field'
import { itemAddress } from '@/lib/address'
import { api, ApiRequestError } from '@/lib/api'
import {
  effectiveItemCatalog,
  loadEquipmentCatalog,
  loadMagicItemCatalog,
  useCatalog,
  type PickerItem,
} from '@/lib/catalogs'
import {
  ARMOUR_CATEGORIES,
  ITEM_KINDS,
  MATERIALS,
  WEAPON_QUALITIES,
  addItemTemplateOps,
  armourModePatch,
  formatGearParam,
  itemReferenceCount,
  itemTemplateKindUpdateOps,
  itemTemplatePatchOps,
  itemTemplateRemoveOps,
  missilePatch,
  neutralMissileRanges,
  parseGearParam,
  seedItemTemplate,
  toggledQualities,
} from '@/lib/item-builders'
import { cloneId } from '@/lib/monster-builders'
import { parseDice } from '@/lib/notation'
import { projectStore } from '@/store/project-store'
import type {
  Adventure,
  AmmunitionTemplate,
  ArmourTemplate,
  CombatFacet,
  GearTemplate,
  ItemTemplate,
  MissileRanges,
  ProjectState,
  WeaponQuality,
  WeaponTemplate,
} from '@/types'

const SELECT_CLASS = 'h-8 rounded-md border border-input bg-transparent px-2 text-sm'

const KIND_LABELS: Record<ItemTemplate['item_type'], string> = {
  weapon: 'Weapon',
  armour: 'Armour',
  gear: 'Gear',
  ammunition: 'Ammunition',
}

function anyInteger(draft: string): string | null {
  const parsed = Number(draft)
  return Number.isInteger(parsed) ? String(parsed) : null
}

function optionalInteger(min?: number): (draft: string) => string | null {
  return (draft) => {
    const trimmed = draft.trim()
    if (trimmed === '') return ''
    const parsed = Number(trimmed)
    if (!Number.isInteger(parsed)) return null
    if (min !== undefined && parsed < min) return null
    return String(parsed)
  }
}

function requiredDice(draft: string): string | null {
  const trimmed = draft.trim()
  return trimmed !== '' && parseDice(trimmed) ? trimmed : null
}

function nonEmpty(draft: string): string | null {
  const trimmed = draft.trim()
  return trimmed === '' ? null : trimmed
}

export function ItemsSection({
  project,
  section,
  focusToken,
}: {
  project: ProjectState
  section: { itemId?: string; create?: boolean }
  focusToken: number
}) {
  const document = project.document
  const items = document.items
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [clone, setClone] = useState<{
    source: ItemTemplate
    takenIds: ReadonlySet<string>
  } | null>(null)

  // Consume the navigation focus once per token — a diagnostics click selects
  // its template.
  const [consumedToken, setConsumedToken] = useState<number | null>(null)
  if (focusToken !== consumedToken) {
    setConsumedToken(focusToken)
    if (section.itemId) setSelectedId(section.itemId)
    if (section.create && !project.forge) setCreateOpen(true)
  }

  if (project.forge) {
    return <ForgeItemsBody />
  }

  const selected = items.find((template) => template.id === selectedId) ?? items[0] ?? null

  // The clone prefill's scope is the full collision domain — shipped
  // equipment, shipped magic, and the bundle — so a prefill never lands on a
  // rejection. Computed from the *resolved* catalogs at pick time (the
  // module-level caches, settled instantly after their first load), never
  // from hook state a still-loading fetch could leave half-empty.
  const startClone = (picked: PickerItem) => {
    const open = (source: ItemTemplate) => {
      void Promise.all([loadEquipmentCatalog(), loadMagicItemCatalog()]).then(
        ([equipment, magic]) => {
          setClone({
            source,
            takenIds: new Set([
              ...equipment.map((item) => item.id),
              ...magic.map((item) => item.id),
              ...items.map((template) => template.id),
            ]),
          })
        },
        () => undefined,
      )
    }
    if (picked.bundled) {
      const source = items.find((template) => template.id === picked.id)
      if (source) open(source)
      return
    }
    api.getCatalogItem(picked.id).then(open, (error: unknown) => {
      if (error instanceof ApiRequestError) {
        toast.error(error.detail.message, { description: error.detail.remedy ?? undefined })
      }
    })
  }

  return (
    <section aria-label="Items" className="flex min-h-0 gap-6">
      <div className="flex w-80 shrink-0 flex-col gap-3">
        <h2 className="font-serif text-xl font-semibold">Items</h2>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => setCreateOpen(true)}>
            <PlusIcon /> New item
          </Button>
          <CloneSourcePicker bundled={items} onPick={startClone} />
        </div>
        {items.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            No bundled items yet — create one from scratch or clone a catalog item.
          </p>
        ) : (
          <ul className="flex flex-col gap-1" aria-label="Bundled items">
            {items.map((template) => (
              <ItemRow
                key={template.id}
                template={template}
                document={document}
                selected={selected?.id === template.id}
                onSelect={() => setSelectedId(template.id)}
                onRemove={() => {
                  void projectStore.getState().commit(itemTemplateRemoveOps(template.id))
                  if (selectedId === template.id) setSelectedId(null)
                }}
              />
            ))}
          </ul>
        )}
      </div>
      <div className="min-w-0 flex-1">
        {selected ? (
          <div className="flex max-w-2xl flex-col gap-6">
            <ItemDetail key={selected.id} template={selected} onRenamed={setSelectedId} />
            <AuthorNotesCard address={itemAddress(selected.id)} />
          </div>
        ) : (
          <p className="text-muted-foreground text-sm">Select a bundled item to edit it.</p>
        )}
      </div>
      <CreateItemDialog open={createOpen} onOpenChange={setCreateOpen} onCreated={setSelectedId} />
      <CloneItemDialog
        clone={clone}
        onOpenChange={(open) => !open && setClone(null)}
        onCreated={setSelectedId}
      />
    </section>
  )
}

// The forge explanation body: the deliberate overrides-vocabulary gap, named,
// with detach offered in place — a live destination, never a dead tooltip.
function ForgeItemsBody() {
  const [detachOpen, setDetachOpen] = useState(false)
  return (
    <section aria-label="Items" className="flex max-w-xl flex-col gap-3">
      <h2 className="font-serif text-xl font-semibold">Items</h2>
      <p className="text-sm">
        A forge-assembled adventure carries no bundled items: the overrides vocabulary has no
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
        To author bundled items — and the gates and level guidance that go with them — detach this
        project to a native one. Detaching severs the forge re-run loop and records provenance.
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

function ItemRow({
  template,
  document,
  selected,
  onSelect,
  onRemove,
}: {
  template: ItemTemplate
  document: Adventure
  selected: boolean
  onSelect: () => void
  onRemove: () => void
}) {
  const [confirming, setConfirming] = useState(false)
  const references = itemReferenceCount(document, template.id)
  return (
    <li
      className={`rounded-md border ${selected ? 'border-primary' : ''}`}
      data-testid={`item-row-${template.id}`}
    >
      <button
        type="button"
        className="flex w-full flex-col gap-0.5 p-2 text-left"
        onClick={onSelect}
      >
        <span className="font-serif text-sm font-medium">{template.name || template.id}</span>
        <span className="text-muted-foreground font-mono text-xs">
          {template.id} · {template.item_type} · {template.cost_gp} gp
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
          <Button variant="ghost" size="sm" onClick={() => setConfirming(true)}>
            Remove
          </Button>
        )}
      </div>
      {confirming && (
        <p className="text-muted-foreground px-2 pb-2 text-xs">
          {references > 0
            ? `${references} ${references === 1 ? 'reference keeps' : 'references keep'} naming this id and become diagnostics.`
            : 'Nothing references this template.'}
        </p>
      )}
    </li>
  )
}

// The clone source picker: the item command palette over the effective
// catalog — picking hands the source to the clone dialog.
function CloneSourcePicker({
  bundled,
  onPick,
}: {
  bundled: readonly ItemTemplate[]
  onPick: (item: PickerItem) => void
}) {
  const [open, setOpen] = useState(false)
  const shipped = useCatalog(loadEquipmentCatalog)
  const items = shipped ? effectiveItemCatalog(shipped, bundled) : []
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm">
          Clone catalog item
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0" align="start">
        <Command>
          <CommandInput placeholder="Search items…" />
          <CommandList>
            <CommandEmpty>{shipped ? 'No item matches.' : 'Loading the catalog…'}</CommandEmpty>
            <CommandGroup>
              {items.map((item) => (
                <CommandItem
                  key={item.id}
                  value={`${item.id} ${item.name}`}
                  onSelect={() => {
                    setOpen(false)
                    onPick(item)
                  }}
                >
                  <span className="truncate">{item.name}</span>
                  {item.bundled && <Badge variant="secondary">bundled</Badge>}
                  <span className="text-muted-foreground ml-auto font-mono text-xs">
                    {item.itemType}
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

function CreateItemDialog({
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
      {open && <CreateItemBody onOpenChange={onOpenChange} onCreated={onCreated} />}
    </Dialog>
  )
}

function CreateItemBody({
  onOpenChange,
  onCreated,
}: {
  onOpenChange: (open: boolean) => void
  onCreated: (id: string) => void
}) {
  const [kind, setKind] = useState<ItemTemplate['item_type']>('gear')
  const [id, setId] = useState('')
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const submit = () => {
    const trimmedId = id.trim()
    setError(null)
    void projectStore
      .getState()
      .commit(addItemTemplateOps(seedItemTemplate(kind, trimmedId, name.trim())), {
        onError: (requestError) => {
          // The collision and empty-id rejections surface inline — the
          // rename prompt, right where the id was typed.
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
        <DialogTitle>New item</DialogTitle>
        <DialogDescription>
          A model-valid stock template of the chosen kind is created; edit every field in the detail
          editor.
        </DialogDescription>
      </DialogHeader>
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="create-item-kind">Kind</Label>
          <select
            id="create-item-kind"
            className={SELECT_CLASS}
            value={kind}
            onChange={(event) => setKind(event.target.value as ItemTemplate['item_type'])}
          >
            {ITEM_KINDS.map((candidate) => (
              <option key={candidate} value={candidate}>
                {KIND_LABELS[candidate]}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="create-item-id">Id</Label>
          <Input
            id="create-item-id"
            className="font-mono"
            value={id}
            onChange={(event) => setId(event.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="create-item-name">Name</Label>
          <Input
            id="create-item-name"
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

function CloneItemDialog({
  clone,
  onOpenChange,
  onCreated,
}: {
  clone: { source: ItemTemplate; takenIds: ReadonlySet<string> } | null
  onOpenChange: (open: boolean) => void
  onCreated: (id: string) => void
}) {
  return (
    <Dialog open={clone !== null} onOpenChange={onOpenChange}>
      {clone && (
        <CloneItemBody
          source={clone.source}
          takenIds={clone.takenIds}
          onOpenChange={onOpenChange}
          onCreated={onCreated}
        />
      )}
    </Dialog>
  )
}

function CloneItemBody({
  source,
  takenIds,
  onOpenChange,
  onCreated,
}: {
  source: ItemTemplate
  takenIds: ReadonlySet<string>
  onOpenChange: (open: boolean) => void
  onCreated: (id: string) => void
}) {
  const [id, setId] = useState(() => cloneId(source.id, takenIds))
  const [name, setName] = useState(source.name)
  const [error, setError] = useState<string | null>(null)
  const submit = () => {
    const trimmedId = id.trim()
    setError(null)
    // Clone-and-modify under the editor-authored conventions: no compiler
    // provenance (items have no page).
    const template: ItemTemplate = {
      ...source,
      id: trimmedId,
      name: name.trim(),
      overrides_applied: [],
    }
    void projectStore
      .getState()
      .commit(addItemTemplateOps(template), {
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
          The whole template is copied; edit any field afterwards.
        </DialogDescription>
      </DialogHeader>
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="clone-item-id">Id</Label>
          <Input
            id="clone-item-id"
            className="font-mono"
            value={id}
            onChange={(event) => setId(event.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="clone-item-name">Name</Label>
          <Input
            id="clone-item-name"
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

function ItemDetail({
  template,
  onRenamed,
}: {
  template: ItemTemplate
  onRenamed: (id: string) => void
}) {
  const [idError, setIdError] = useState<string | null>(null)
  const commitId = (value: string) => {
    setIdError(null)
    void projectStore
      .getState()
      .commit(
        (current) => itemTemplatePatchOps(current, template.id, template.item_type, { id: value }),
        {
          onError: (error) => {
            // The collision rejection surfaces inline — the rename prompt,
            // right where the id was typed.
            if (error.detail.code === 'op_invariant') {
              setIdError(error.detail.message)
              return true
            }
            return false
          },
        },
      )
      .then((committed) => {
        if (committed) onRenamed(value)
      })
  }
  const id = useCommittedField(template.id, commitId, nonEmpty)
  const name = useCommittedField(template.name, (value) => {
    void projectStore
      .getState()
      .commit((current) =>
        itemTemplatePatchOps(current, template.id, template.item_type, { name: value }),
      )
  })
  return (
    <div className="flex flex-col gap-4" data-testid={`item-detail-${template.id}`}>
      <div className="flex items-end gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="item-id">Id</Label>
          <Input id="item-id" className="w-48 font-mono" {...id} />
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <Label htmlFor="item-name">Name</Label>
          <Input id="item-name" className="font-serif" {...name} />
        </div>
        <p className="text-muted-foreground pb-2 font-mono text-xs">{template.item_type}</p>
      </div>
      {idError && <p className="text-destructive text-xs">{idError}</p>}
      {template.item_type === 'weapon' && <WeaponForm template={template} />}
      {template.item_type === 'armour' && <ArmourForm template={template} />}
      {template.item_type === 'gear' && <GearForm template={template} />}
      {template.item_type === 'ammunition' && <AmmunitionForm template={template} />}
    </div>
  )
}

function NumberField({
  id,
  label,
  value,
  normalize,
  width = 'w-24',
  onCommit,
}: {
  id: string
  label: string
  value: string
  normalize: (draft: string) => string | null
  width?: string
  onCommit: (draft: string) => void
}) {
  const field = useCommittedField(value, onCommit, normalize)
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} className={`${width} font-mono`} {...field} />
    </div>
  )
}

function WeaponForm({ template }: { template: WeaponTemplate }) {
  const patch = (value: Partial<WeaponTemplate>) => {
    void projectStore
      .getState()
      .commit((current) => itemTemplatePatchOps(current, template.id, 'weapon', value))
  }
  // Collection edits (qualities, ranges) compute their next value from the
  // committed template inside the queue — never from the render-time prop.
  const update = (build: (committed: WeaponTemplate) => Partial<WeaponTemplate> | null) => {
    void projectStore
      .getState()
      .commit((current) => itemTemplateKindUpdateOps(current, template.id, 'weapon', build))
  }
  const missile = template.qualities.includes('missile')
  return (
    <div className="flex flex-col gap-3" aria-label="Weapon">
      <div className="flex items-end gap-3">
        <NumberField
          id="weapon-cost"
          label="Cost (gp)"
          value={String(template.cost_gp)}
          normalize={integerInRange(0)}
          onCommit={(draft) => patch({ cost_gp: Number(draft) })}
        />
        <NumberField
          id="weapon-weight"
          label="Weight (coins)"
          value={String(template.weight_coins)}
          normalize={integerInRange(0)}
          onCommit={(draft) => patch({ weight_coins: Number(draft) })}
        />
        <NumberField
          id="weapon-damage"
          label="Damage"
          value={template.damage}
          normalize={requiredDice}
          onCommit={(draft) => patch({ damage: draft })}
        />
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="weapon-material">Material</Label>
          <select
            id="weapon-material"
            className={SELECT_CLASS}
            value={template.material}
            onChange={(event) =>
              patch({ material: event.target.value as WeaponTemplate['material'] })
            }
          >
            {MATERIALS.map((material) => (
              <option key={material} value={material}>
                {material}
              </option>
            ))}
          </select>
        </div>
      </div>
      <QualitiesEditor
        qualities={template.qualities}
        onToggle={(quality, next) => {
          // The missile quality travels with its ranges in one gesture — the
          // model's own coupling, unrepresentable to break through the form.
          update((committed) =>
            quality === 'missile'
              ? missilePatch(committed, next)
              : { qualities: toggledQualities(committed.qualities, quality, next) },
          )
        }}
      />
      {missile && template.missile_ranges && (
        <RangesEditor
          idPrefix="weapon"
          ranges={template.missile_ranges}
          onCommit={(band, field, value) =>
            update((committed) =>
              committed.missile_ranges
                ? {
                    missile_ranges: {
                      ...committed.missile_ranges,
                      [band]: { ...committed.missile_ranges[band], [field]: value },
                    },
                  }
                : null,
            )
          }
        />
      )}
    </div>
  )
}

function QualitiesEditor({
  qualities,
  onToggle,
}: {
  qualities: readonly WeaponQuality[]
  onToggle: (quality: WeaponQuality, next: boolean) => void
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label>Qualities</Label>
      <div className="flex flex-wrap gap-x-4 gap-y-1.5" aria-label="Weapon qualities">
        {WEAPON_QUALITIES.map((quality) => (
          <label key={quality} className="flex items-center gap-1.5 font-mono text-xs">
            <Checkbox
              checked={qualities.includes(quality)}
              onCheckedChange={(next) => onToggle(quality, next === true)}
            />
            {quality}
          </label>
        ))}
      </div>
    </div>
  )
}

const BAND_LABELS = { short: 'Short', medium: 'Medium', long: 'Long' } as const

type RangeBandKey = keyof MissileRanges

// The editor emits one field of one band per commit; the owner merges it into
// the *committed* ranges inside its queue, so two bands edited in quick
// succession never revert each other.
function RangesEditor({
  idPrefix,
  ranges,
  onCommit,
}: {
  idPrefix: string
  ranges: MissileRanges
  onCommit: (band: RangeBandKey, field: 'min_feet' | 'max_feet', value: number) => void
}) {
  return (
    <div className="flex flex-col gap-2" aria-label="Missile ranges">
      <Label>Missile ranges (feet)</Label>
      {(['short', 'medium', 'long'] as const).map((band) => (
        <div key={band} className="flex items-end gap-3">
          <span className="text-muted-foreground w-16 pb-2 text-xs">{BAND_LABELS[band]}</span>
          <NumberField
            id={`${idPrefix}-${band}-min`}
            label="Min"
            width="w-20"
            value={String(ranges[band].min_feet)}
            normalize={integerInRange(0)}
            onCommit={(draft) => onCommit(band, 'min_feet', Number(draft))}
          />
          <NumberField
            id={`${idPrefix}-${band}-max`}
            label="Max"
            width="w-20"
            value={String(ranges[band].max_feet)}
            normalize={integerInRange(0)}
            onCommit={(draft) => onCommit(band, 'max_feet', Number(draft))}
          />
        </div>
      ))}
    </div>
  )
}

function ArmourForm({ template }: { template: ArmourTemplate }) {
  const patch = (value: Partial<ArmourTemplate>) => {
    void projectStore
      .getState()
      .commit((current) => itemTemplatePatchOps(current, template.id, 'armour', value))
  }
  const shield = template.ac_bonus !== null && template.ac_bonus !== undefined
  return (
    <div className="flex flex-col gap-3" aria-label="Armour">
      <div className="flex items-end gap-3">
        <NumberField
          id="armour-cost"
          label="Cost (gp)"
          value={String(template.cost_gp)}
          normalize={integerInRange(0)}
          onCommit={(draft) => patch({ cost_gp: Number(draft) })}
        />
        <NumberField
          id="armour-weight"
          label="Weight (coins)"
          value={String(template.weight_coins)}
          normalize={integerInRange(0)}
          onCommit={(draft) => patch({ weight_coins: Number(draft) })}
        />
      </div>
      <div className="flex gap-4" role="radiogroup" aria-label="Armour form">
        <label className="flex items-center gap-1.5 text-sm">
          <input
            type="radio"
            name="armour-mode"
            checked={!shield}
            onChange={() => patch(armourModePatch(false))}
          />
          Body armour
        </label>
        <label className="flex items-center gap-1.5 text-sm">
          <input
            type="radio"
            name="armour-mode"
            checked={shield}
            onChange={() => patch(armourModePatch(true))}
          />
          Shield
        </label>
      </div>
      {shield ? (
        <NumberField
          id="armour-ac-bonus"
          label="AC bonus"
          value={String(template.ac_bonus ?? 1)}
          normalize={anyInteger}
          onCommit={(draft) => patch({ ac_bonus: Number(draft) })}
        />
      ) : (
        <div className="flex items-end gap-3">
          <NumberField
            id="armour-ac"
            label="AC"
            value={String(template.ac ?? 9)}
            normalize={anyInteger}
            onCommit={(draft) => patch({ ac: Number(draft) })}
          />
          <NumberField
            id="armour-ac-ascending"
            label="AC (ascending)"
            value={String(template.ac_ascending ?? 10)}
            normalize={anyInteger}
            onCommit={(draft) => patch({ ac_ascending: Number(draft) })}
          />
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="armour-category">Category</Label>
            <select
              id="armour-category"
              className={SELECT_CLASS}
              value={template.category ?? 'light'}
              onChange={(event) =>
                patch({ category: event.target.value as ArmourTemplate['category'] })
              }
            >
              {ARMOUR_CATEGORIES.map((category) => (
                <option key={category} value={category}>
                  {category}
                </option>
              ))}
            </select>
          </div>
        </div>
      )}
    </div>
  )
}

function GearForm({ template }: { template: GearTemplate }) {
  const patch = (value: Partial<GearTemplate>) => {
    void projectStore
      .getState()
      .commit((current) => itemTemplatePatchOps(current, template.id, 'gear', value))
  }
  // Collection edits (the combat facet, params) compute their next value from
  // the committed template inside the queue — never from the render-time prop.
  const update = (build: (committed: GearTemplate) => Partial<GearTemplate> | null) => {
    void projectStore
      .getState()
      .commit((current) => itemTemplateKindUpdateOps(current, template.id, 'gear', build))
  }
  return (
    <div className="flex flex-col gap-3" aria-label="Gear">
      <div className="flex items-end gap-3">
        <NumberField
          id="gear-cost"
          label="Cost (gp)"
          value={String(template.cost_gp)}
          normalize={integerInRange(0)}
          onCommit={(draft) => patch({ cost_gp: Number(draft) })}
        />
        <NumberField
          id="gear-lot"
          label="Lot size"
          value={String(template.lot_size)}
          normalize={integerInRange(1)}
          onCommit={(draft) => patch({ lot_size: Number(draft) })}
        />
        <NumberField
          id="gear-capacity"
          label="Capacity (coins)"
          value={template.capacity_coins != null ? String(template.capacity_coins) : ''}
          normalize={optionalInteger(0)}
          onCommit={(draft) => patch({ capacity_coins: draft === '' ? null : Number(draft) })}
        />
      </div>
      <CombatFacetEditor facet={template.combat ?? null} onUpdate={update} />
      <ParamsEditor params={template.params} onUpdate={update} />
    </div>
  )
}

type GearUpdate = (build: (committed: GearTemplate) => Partial<GearTemplate> | null) => void

// The optional combat facet as a disclosure. The missile-quality↔ranges
// gesture here is the editor's form shaping, not model parity: CombatFacet
// carries only the damage-parse validator, so a foreign facet legally
// carrying the missile quality with no ranges renders honestly and is never
// repaired unasked. Every commit merges over the *committed* facet inside
// the queue — never the render-time prop.
function CombatFacetEditor({
  facet,
  onUpdate,
}: {
  facet: CombatFacet | null
  onUpdate: GearUpdate
}) {
  const patchFacet = (build: (committedFacet: CombatFacet) => Partial<CombatFacet> | null) =>
    onUpdate((committed) => {
      if (!committed.combat) return null
      const patch = build(committed.combat)
      return patch === null ? null : { combat: { ...committed.combat, ...patch } }
    })
  if (!facet) {
    return (
      <button
        type="button"
        className="text-muted-foreground self-start text-sm underline underline-offset-2"
        onClick={() =>
          onUpdate(() => ({ combat: { damage: '1d6', qualities: [], missile_ranges: null } }))
        }
      >
        Add combat facet…
      </button>
    )
  }
  const missile = facet.qualities.includes('missile')
  return (
    <div className="flex flex-col gap-2 rounded-md border p-2" aria-label="Combat facet">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">Combat facet</span>
        <button
          type="button"
          className="text-muted-foreground text-xs underline underline-offset-2"
          onClick={() => onUpdate(() => ({ combat: null }))}
        >
          Clear
        </button>
      </div>
      <div className="flex items-end gap-3">
        <NumberField
          id="gear-combat-damage"
          label="Damage"
          value={facet.damage}
          normalize={requiredDice}
          onCommit={(draft) => patchFacet(() => ({ damage: draft }))}
        />
      </div>
      <QualitiesEditor
        qualities={facet.qualities}
        onToggle={(quality, next) => {
          patchFacet((committedFacet) => {
            const qualities = toggledQualities(committedFacet.qualities, quality, next)
            if (quality === 'missile') {
              return { qualities, missile_ranges: next ? neutralMissileRanges() : null }
            }
            return { qualities }
          })
        }}
      />
      {missile && facet.missile_ranges && (
        <RangesEditor
          idPrefix="gear-combat"
          ranges={facet.missile_ranges}
          onCommit={(band, field, value) =>
            patchFacet((committedFacet) =>
              committedFacet.missile_ranges
                ? {
                    missile_ranges: {
                      ...committedFacet.missile_ranges,
                      [band]: { ...committedFacet.missile_ranges[band], [field]: value },
                    },
                  }
                : null,
            )
          }
        />
      )}
    </div>
  )
}

// Params as key/value rows with JSON-typed values — the monster-ability
// params precedent over gear's own value domain. Adds and removes merge over
// the committed map inside the queue.
function ParamsEditor({
  params,
  onUpdate,
}: {
  params: GearTemplate['params']
  onUpdate: GearUpdate
}) {
  const [newKey, setNewKey] = useState('')
  const [newValue, setNewValue] = useState('')
  const entries = Object.entries(params)
  const addParam = () => {
    const key = newKey.trim()
    const value = parseGearParam(newValue)
    if (key === '' || value === null) return
    onUpdate((committed) => ({ params: { ...committed.params, [key]: value } }))
    setNewKey('')
    setNewValue('')
  }
  return (
    <div className="flex flex-col gap-2" aria-label="Params">
      <Label>Params</Label>
      {entries.length > 0 && (
        <ul className="flex flex-col gap-1">
          {entries.map(([key, value]) => (
            <li key={key} className="flex items-center gap-2 font-mono text-xs">
              <span>{key}</span>
              <span className="text-muted-foreground">{formatGearParam(value)}</span>
              <button
                type="button"
                aria-label={`Remove ${key}`}
                onClick={() =>
                  onUpdate((committed) => {
                    const next = { ...committed.params }
                    delete next[key]
                    return { params: next }
                  })
                }
              >
                <XIcon className="size-3" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex items-end gap-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="gear-param-key">Key</Label>
          <Input
            id="gear-param-key"
            className="w-36 font-mono"
            value={newKey}
            onChange={(event) => setNewKey(event.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="gear-param-value">Value</Label>
          <Input
            id="gear-param-value"
            className="w-28 font-mono"
            value={newValue}
            onChange={(event) => setNewValue(event.target.value)}
          />
        </div>
        <Button variant="outline" size="sm" onClick={addParam} disabled={newKey.trim() === ''}>
          Add param
        </Button>
      </div>
    </div>
  )
}

function AmmunitionForm({ template }: { template: AmmunitionTemplate }) {
  const patch = (value: Partial<AmmunitionTemplate>) => {
    void projectStore
      .getState()
      .commit((current) => itemTemplatePatchOps(current, template.id, 'ammunition', value))
  }
  return (
    <div className="flex items-end gap-3" aria-label="Ammunition">
      <NumberField
        id="ammunition-cost"
        label="Cost (gp)"
        value={String(template.cost_gp)}
        normalize={integerInRange(0)}
        onCommit={(draft) => patch({ cost_gp: Number(draft) })}
      />
      <NumberField
        id="ammunition-lot"
        label="Lot size"
        value={String(template.lot_size)}
        normalize={integerInRange(1)}
        onCommit={(draft) => patch({ lot_size: Number(draft) })}
      />
      <NumberField
        id="ammunition-weight"
        label="Weight (coins)"
        value={String(template.weight_coins)}
        normalize={integerInRange(0)}
        onCommit={(draft) => patch({ weight_coins: Number(draft) })}
      />
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="ammunition-material">Material</Label>
        <select
          id="ammunition-material"
          className={SELECT_CLASS}
          value={template.material}
          onChange={(event) =>
            patch({ material: event.target.value as AmmunitionTemplate['material'] })
          }
        >
          {MATERIALS.map((material) => (
            <option key={material} value={material}>
              {material}
            </option>
          ))}
        </select>
      </div>
    </div>
  )
}
