// The inline d20 wandering-table editor. "Override the compiled table" seeds
// all twenty rows from the level's band table — blind row-by-row authoring
// cannot produce a valid table — then rows edit in place: name, entry
// (monsters through the multi-select picker with an optional variant_dice, or
// an NPC party), and the dice-or-fixed count. Every commit rides SetWandering
// builders patching only their own fields against the committed document.
import { useMemo, useState } from 'react'
import { CheckIcon, XIcon } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useCommittedField } from '@/hooks/use-committed-field'
import {
  bandTableForLevel,
  effectiveMonsterCatalog,
  loadEncounterTables,
  loadMonsterCatalog,
  useCatalog,
} from '@/lib/catalogs'
import {
  findLevel,
  parseCount,
  replaceEncounterTableRow,
  seededWanderingTable,
} from '@/lib/content-builders'
import { formatCount, variantDiceSpan } from '@/lib/notation'
import { cn } from '@/lib/utils'
import { projectStore } from '@/store/project-store'
import type {
  Adventure,
  AnyEditOp,
  EncounterTable,
  EncounterTableRow,
  MonsterEncounterEntry,
  WanderingSpec,
} from '@/types'

const SELECT_CLASS = 'h-8 rounded-md border border-input bg-transparent px-2 text-sm'

export function WanderingTableEditor({
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
  const tables = useCatalog(loadEncounterTables)
  const commitSpec = (build: (current: WanderingSpec) => WanderingSpec | null): void => {
    void projectStore.getState().commit((current): AnyEditOp[] => {
      const level = findLevel(current, dungeonId, levelNumber)
      if (!level) return []
      const next = build(level.wandering)
      if (next === null) return []
      return [
        { op: 'set_wandering', dungeon_id: dungeonId, level_number: levelNumber, wandering: next },
      ]
    })
  }
  const overrideTable = () => {
    if (!tables) return
    const band = bandTableForLevel(tables, levelNumber)
    if (!band) return
    commitSpec((current) => ({
      ...current,
      table: seededWanderingTable(band, dungeonId, levelNumber, current.table ?? null),
    }))
  }
  const removeOverride = () => {
    if (!window.confirm('Remove the custom table? The compiled band table takes over.')) return
    commitSpec((current) => ({ ...current, table: null }))
  }
  const table = wandering.table
  if (!table) {
    return (
      <div className="flex flex-col gap-1">
        <Button
          variant="outline"
          size="sm"
          className="self-start"
          disabled={!tables}
          onClick={overrideTable}
        >
          Override the compiled table
        </Button>
        <p className="text-muted-foreground text-xs">
          Wandering checks roll on the compiled level-band table; overriding seeds a copy you can
          edit.
        </p>
      </div>
    )
  }
  return (
    <div className="flex flex-col gap-2" aria-label="Custom wandering table">
      <TableLabelField
        table={table}
        onCommit={(label) =>
          commitSpec((current) =>
            current.table ? { ...current, table: { ...current.table, label } } : null,
          )
        }
      />
      <div className="flex max-h-72 flex-col gap-1 overflow-y-auto rounded-md border p-1">
        {table.rows.map((row, index) => (
          <WanderingRowEditor
            key={row.roll}
            document={document}
            row={row}
            onUpdate={(build) =>
              // The next row computes from the committed row inside the queue
              // — a payload built from the render-time row queued behind an
              // in-flight commit would silently revert it.
              commitSpec((current) => {
                const committed = current.table?.rows[index]
                if (!current.table || !committed) return null
                const next = build(committed)
                if (next === null) return null
                return { ...current, table: replaceEncounterTableRow(current.table, index, next) }
              })
            }
          />
        ))}
      </div>
      <Button variant="destructive" size="sm" className="self-start" onClick={removeOverride}>
        Remove the override
      </Button>
    </div>
  )
}

function TableLabelField({
  table,
  onCommit,
}: {
  table: EncounterTable
  onCommit: (label: string) => void
}) {
  const label = useCommittedField(table.label, onCommit)
  return (
    <div className="flex items-end gap-3">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="wandering-table-label">Table label</Label>
        <Input id="wandering-table-label" className="w-56" {...label} />
      </div>
      <span className="text-muted-foreground pb-2 font-mono text-xs">{table.id}</span>
    </div>
  )
}

function WanderingRowEditor({
  document,
  row,
  onUpdate,
}: {
  document: Adventure
  row: EncounterTableRow
  onUpdate: (build: (committed: EncounterTableRow) => EncounterTableRow | null) => void
}) {
  const [open, setOpen] = useState(false)
  const name = useCommittedField(row.name, (value) => {
    if (value.trim() === '') return
    onUpdate((committed) => ({ ...committed, name: value }))
  })
  const count = useCommittedField(formatCount(row.count_dice, row.count_fixed), (text) => {
    const parsed = parseCount(text)
    if (!parsed) return
    onUpdate((committed) => ({ ...committed, ...parsed }))
  })
  const entrySummary =
    row.entry.kind === 'monster'
      ? row.entry.monster_ids.join(', ')
      : `${row.entry.party_kind} party`
  return (
    <div className="rounded-sm border" data-testid={`wandering-row-${row.roll}`}>
      <button
        type="button"
        className="flex w-full items-center gap-2 px-2 py-1 text-left text-xs"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <span className="text-muted-foreground w-6 shrink-0 font-mono">{row.roll}</span>
        <span className="truncate">{row.name}</span>
        <span className="text-muted-foreground ml-auto truncate font-mono">
          {formatCount(row.count_dice, row.count_fixed)} × {entrySummary}
        </span>
      </button>
      {open && (
        <div className="flex flex-col gap-2 border-t p-2">
          <div className="flex items-end gap-2">
            <div className="flex flex-col gap-1">
              <Label htmlFor={`row-${row.roll}-name`}>Name</Label>
              <Input id={`row-${row.roll}-name`} className="h-7 w-40 text-xs" {...name} />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor={`row-${row.roll}-count`}>Count</Label>
              <Input
                id={`row-${row.roll}-count`}
                className="h-7 w-20 font-mono text-xs"
                {...count}
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor={`row-${row.roll}-party`}>Party</Label>
              <select
                id={`row-${row.roll}-party`}
                className={SELECT_CLASS}
                value={row.entry.kind === 'npc_party' ? row.entry.party_kind : ''}
                onChange={(event) => {
                  const kind = event.target.value
                  if (kind === 'basic' || kind === 'expert') {
                    onUpdate((committed) => ({
                      ...committed,
                      entry: { kind: 'npc_party', party_kind: kind },
                    }))
                  }
                }}
              >
                <option value="">monsters</option>
                <option value="basic">basic</option>
                <option value="expert">expert</option>
              </select>
            </div>
          </div>
          <MonsterEntryEditor document={document} row={row} onUpdate={onUpdate} />
        </div>
      )}
    </div>
  )
}

// The monster half of a row's entry: the pool as removable chips, the
// multi-select picker, and the variant_dice input with its span rule
// mirrored inline — the server's request_invalid stays the honest backstop,
// not the primary experience.
function MonsterEntryEditor({
  document,
  row,
  onUpdate,
}: {
  document: Adventure
  row: EncounterTableRow
  onUpdate: (build: (committed: EncounterTableRow) => EncounterTableRow | null) => void
}) {
  const entry = row.entry.kind === 'monster' ? row.entry : null
  const updateEntry = (build: (committed: MonsterEncounterEntry) => MonsterEncounterEntry | null) =>
    onUpdate((committed) => {
      if (committed.entry.kind !== 'monster') return null
      const next = build(committed.entry)
      return next === null ? null : { ...committed, entry: next }
    })
  const variantField = useCommittedField(entry?.variant_dice ?? '', (draft) => {
    if (!entry) return
    if (draft === '') {
      updateEntry((committed) => ({ ...committed, variant_dice: null }))
      return
    }
    // Only a span-matching expression commits — valid by construction; the
    // span rule re-checks against the committed pool inside the queue.
    if (variantDiceSpan(draft) === entry.monster_ids.length) {
      updateEntry((committed) =>
        variantDiceSpan(draft) === committed.monster_ids.length
          ? { ...committed, variant_dice: draft }
          : null,
      )
    }
  })
  if (!entry) {
    return (
      <MonsterMultiPicker
        document={document}
        selected={[]}
        triggerLabel="Replace with monsters…"
        onToggle={(id) =>
          onUpdate((committed) => ({
            ...committed,
            entry: { kind: 'monster', monster_ids: [id], variant_dice: null },
          }))
        }
      />
    )
  }
  const draftSpan = variantField.value === '' ? null : variantDiceSpan(variantField.value)
  const spanMismatch = variantField.value !== '' && draftSpan !== entry.monster_ids.length
  const poolLocked = entry.variant_dice != null
  return (
    <div className="flex flex-col gap-1.5">
      <ul className="flex flex-wrap gap-1" aria-label="Monster pool">
        {entry.monster_ids.map((id, index) => (
          <li
            key={`${id}-${index}`}
            className="bg-muted flex items-center gap-1 rounded px-1.5 py-0.5 font-mono text-xs"
          >
            {id}
            <button
              type="button"
              aria-label={`Remove ${id}`}
              disabled={entry.monster_ids.length === 1 || poolLocked}
              title={
                entry.monster_ids.length === 1
                  ? 'A monster entry needs at least one id.'
                  : poolLocked
                    ? 'The variant dice span this pool — clear them before editing it.'
                    : undefined
              }
              onClick={() =>
                updateEntry((committed) =>
                  committed.monster_ids.length > 1 && committed.variant_dice == null
                    ? {
                        ...committed,
                        monster_ids: committed.monster_ids.filter(
                          (existing, at) => !(existing === id && at === index),
                        ),
                      }
                    : null,
                )
              }
            >
              <XIcon className="size-3" />
            </button>
          </li>
        ))}
      </ul>
      <div className="flex items-end gap-2">
        <MonsterMultiPicker
          document={document}
          selected={entry.monster_ids}
          triggerLabel="Edit pool…"
          disabled={poolLocked}
          onToggle={(id) => {
            // The picker stays open across toggles — the next pool computes
            // against the committed entry, never the render-time one.
            updateEntry((committed) => {
              if (committed.variant_dice != null) return null
              const next = committed.monster_ids.includes(id)
                ? committed.monster_ids.filter((existing) => existing !== id)
                : [...committed.monster_ids, id]
              return next.length === 0 ? null : { ...committed, monster_ids: next }
            })
          }}
        />
        <div className="flex flex-col gap-1">
          <Label htmlFor={`row-${row.roll}-variant`}>Variant dice</Label>
          <Input
            id={`row-${row.roll}-variant`}
            className="h-7 w-20 font-mono text-xs"
            aria-invalid={spanMismatch}
            {...variantField}
          />
        </div>
      </div>
      {spanMismatch && (
        <p className="text-destructive text-xs">
          {draftSpan === null
            ? 'Variant dice must be plain dice with no multiplier.'
            : `These dice span ${draftSpan} values for ${entry.monster_ids.length} pool entries.`}
        </p>
      )}
      {poolLocked && !spanMismatch && (
        <p className="text-muted-foreground text-xs">
          The variant dice roll once and the total picks from the pool in order.
        </p>
      )}
    </div>
  )
}

function MonsterMultiPicker({
  document,
  selected,
  triggerLabel,
  disabled,
  onToggle,
}: {
  document: Adventure
  selected: readonly string[]
  triggerLabel: string
  disabled?: boolean
  onToggle: (id: string) => void
}) {
  const [popoverOpen, setPopoverOpen] = useState(false)
  const shipped = useCatalog(loadMonsterCatalog)
  const monsters = useMemo(
    () => (shipped ? effectiveMonsterCatalog(shipped, document.monsters) : []),
    [shipped, document.monsters],
  )
  return (
    <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" disabled={disabled}>
          {triggerLabel}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-0" align="start">
        <Command>
          <CommandInput placeholder="Search monsters…" />
          <CommandList>
            <CommandEmpty>{shipped ? 'No monster matches.' : 'Loading the catalog…'}</CommandEmpty>
            <CommandGroup>
              {monsters.map((monster) => {
                const checked = selected.includes(monster.id)
                return (
                  <CommandItem
                    key={monster.id}
                    value={`${monster.id} ${monster.name}`}
                    onSelect={() => onToggle(monster.id)}
                  >
                    <CheckIcon className={cn('size-4', checked ? 'opacity-100' : 'opacity-0')} />
                    <span className="truncate">{monster.name}</span>
                  </CommandItem>
                )
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
