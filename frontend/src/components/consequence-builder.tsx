// The shared consequence builder over the closed nine-command union — the
// ConditionBuilder discipline at command scale: a command select over exactly
// the nine, per-command forms, and onCommit called only with complete values.
// Kinds whose every field has a legal default (coins, XP, an NPC party, a
// town placement, advancing time) commit the moment they are chosen; kinds
// built around a reference (an item, a monster, a flag key, a door, a landing
// cell) commit when the reference lands. The recipient of the three
// character-addressed commands is the two-value selector control — never a
// free id field, so a literal character_id is unauthorable; no form carries a
// source field, and committed commands round-trip the serialized
// `source: null` untouched.
import { useState } from 'react'

import { ItemPicker } from '@/components/item-picker'
import { MiniLevelPicker } from '@/components/mini-level-picker'
import { MonsterIdPicker } from '@/components/monster-picker'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useCommittedField, integerInRange } from '@/hooks/use-committed-field'
import { itemNameFor, loadEquipmentCatalog, useCatalog } from '@/lib/catalogs'
import { TIME_UNITS } from '@/lib/content-builders'
import { parseDice } from '@/lib/notation'
import { FACING_LABELS } from '@/lib/transitions'
import {
  COMMAND_KIND_LABELS,
  COMMAND_KINDS,
  FIRST_LIVING_SELECTOR,
  PARTY_SELECTOR,
  SELECTOR_LABELS,
  doorRefKey,
  doorRefsAt,
  type DoorRef,
} from '@/lib/trigger-builders'
import type {
  Adventure,
  Coins,
  ConsequenceCommand,
  LevelSpec,
  Position,
  SetDoorState,
  TimeUnit,
} from '@/types'

const SELECT_CLASS = 'h-8 rounded-md border border-input bg-transparent px-2 text-sm'

const COIN_KEYS = ['pp', 'gp', 'ep', 'sp', 'cp'] as const

const EMPTY_COINS: Coins = { pp: 0, gp: 0, ep: 0, sp: 0, cp: 0 }

// The kinds every field of which has a legal default — choosing one commits
// it at once; the reference-built kinds commit when their reference lands.
function immediateSeed(kind: ConsequenceCommand['command_type']): ConsequenceCommand | null {
  switch (kind) {
    case 'grant_coins':
      return { command_type: 'grant_coins', character_id: PARTY_SELECTOR, coins: EMPTY_COINS }
    case 'award_xp':
      return { command_type: 'award_xp', character_id: PARTY_SELECTOR, amount: 0 }
    case 'spawn_npc_party':
      return {
        command_type: 'spawn_npc_party',
        party_kind: 'basic',
        count_dice: null,
        distance_feet: 30,
      }
    case 'place_party':
      return { command_type: 'place_party', location: { kind: 'town' } }
    case 'advance_time':
      return { command_type: 'advance_time', n: 1, unit: 'turn' }
    default:
      return null
  }
}

export function ConsequenceBuilder({
  command,
  document,
  idPrefix,
  onCommit,
}: {
  command: ConsequenceCommand | null
  document: Adventure
  idPrefix: string
  onCommit: (command: ConsequenceCommand) => void
}) {
  const [draftKind, setDraftKind] = useState<ConsequenceCommand['command_type']>(
    command?.command_type ?? 'set_flag',
  )
  const committed = command?.command_type === draftKind ? command : null
  return (
    <div className="flex flex-col gap-2" aria-label="Consequence">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${idPrefix}-command-kind`}>Command</Label>
        <select
          id={`${idPrefix}-command-kind`}
          className={SELECT_CLASS}
          value={draftKind}
          onChange={(event) => {
            const kind = event.target.value as ConsequenceCommand['command_type']
            setDraftKind(kind)
            const seed = immediateSeed(kind)
            if (seed) onCommit(seed)
          }}
        >
          {COMMAND_KINDS.map((kind) => (
            <option key={kind} value={kind}>
              {COMMAND_KIND_LABELS[kind]}
            </option>
          ))}
        </select>
      </div>
      {draftKind === 'grant_item' && (
        <GrantItemForm
          committed={committed?.command_type === 'grant_item' ? committed : null}
          document={document}
          idPrefix={idPrefix}
          onCommit={onCommit}
        />
      )}
      {draftKind === 'grant_coins' && committed?.command_type === 'grant_coins' && (
        <div className="flex items-end gap-3">
          <SelectorControl
            id={`${idPrefix}-recipient`}
            value={committed.character_id}
            onChange={(selector) => onCommit({ ...committed, character_id: selector })}
          />
          <CoinsRow
            idPrefix={idPrefix}
            coins={committed.coins}
            onCommit={(denomination, value) =>
              onCommit({ ...committed, coins: { ...committed.coins, [denomination]: value } })
            }
          />
        </div>
      )}
      {draftKind === 'award_xp' && committed?.command_type === 'award_xp' && (
        <div className="flex items-end gap-3">
          <SelectorControl
            id={`${idPrefix}-recipient`}
            value={committed.character_id}
            onChange={(selector) => onCommit({ ...committed, character_id: selector })}
          />
          <NumberField
            id={`${idPrefix}-xp-amount`}
            label="Amount"
            value={String(committed.amount)}
            normalize={integerInRange(0)}
            onCommit={(draft) => onCommit({ ...committed, amount: Number(draft) })}
          />
        </div>
      )}
      {draftKind === 'set_flag' && (
        <SetFlagForm
          committed={committed?.command_type === 'set_flag' ? committed : null}
          idPrefix={idPrefix}
          onCommit={onCommit}
        />
      )}
      {draftKind === 'spawn_monsters' && (
        <SpawnMonstersForm
          committed={committed?.command_type === 'spawn_monsters' ? committed : null}
          document={document}
          idPrefix={idPrefix}
          onCommit={onCommit}
        />
      )}
      {draftKind === 'spawn_npc_party' && committed?.command_type === 'spawn_npc_party' && (
        <div className="flex items-end gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${idPrefix}-npc-kind`}>Party kind</Label>
            <select
              id={`${idPrefix}-npc-kind`}
              className={SELECT_CLASS}
              value={committed.party_kind}
              onChange={(event) =>
                onCommit({ ...committed, party_kind: event.target.value as 'basic' | 'expert' })
              }
            >
              <option value="basic">basic</option>
              <option value="expert">expert</option>
            </select>
          </div>
          <NpcCountField
            id={`${idPrefix}-npc-count`}
            value={committed.count_dice ?? ''}
            onCommit={(dice) => onCommit({ ...committed, count_dice: dice })}
          />
          <NumberField
            id={`${idPrefix}-npc-distance`}
            label="Distance (ft)"
            value={String(committed.distance_feet)}
            normalize={integerInRange(0)}
            onCommit={(draft) => onCommit({ ...committed, distance_feet: Number(draft) })}
          />
        </div>
      )}
      {draftKind === 'set_door_state' && (
        <SetDoorStateForm
          committed={committed?.command_type === 'set_door_state' ? committed : null}
          document={document}
          idPrefix={idPrefix}
          onCommit={onCommit}
        />
      )}
      {draftKind === 'place_party' && (
        <PlacePartyForm
          committed={committed?.command_type === 'place_party' ? committed : null}
          document={document}
          idPrefix={idPrefix}
          onCommit={onCommit}
        />
      )}
      {draftKind === 'advance_time' && committed?.command_type === 'advance_time' && (
        <div className="flex items-end gap-3">
          <NumberField
            id={`${idPrefix}-time-n`}
            label="Count"
            value={String(committed.n)}
            normalize={integerInRange(0)}
            onCommit={(draft) => onCommit({ ...committed, n: Number(draft) })}
          />
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${idPrefix}-time-unit`}>Unit</Label>
            <select
              id={`${idPrefix}-time-unit`}
              className={SELECT_CLASS}
              value={committed.unit}
              onChange={(event) => onCommit({ ...committed, unit: event.target.value as TimeUnit })}
            >
              {TIME_UNITS.map((unit) => (
                <option key={unit} value={unit}>
                  {unit}
                </option>
              ))}
            </select>
          </div>
        </div>
      )}
    </div>
  )
}

// The recipient control: exactly the two osrlib selector literals — a free
// character id is unauthorable here, so a foreign literal surfaces as the
// trigger_selector_violation diagnostic rather than something the form
// perpetuates.
export function SelectorControl({
  id,
  value,
  onChange,
}: {
  id: string
  value: string
  onChange: (selector: string) => void
}) {
  const known = value === PARTY_SELECTOR || value === FIRST_LIVING_SELECTOR
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>Recipient</Label>
      <select
        id={id}
        className={SELECT_CLASS}
        value={known ? value : ''}
        onChange={(event) => {
          if (event.target.value !== '') onChange(event.target.value)
        }}
      >
        {!known && (
          <option value="" disabled>
            {value === '' ? 'Pick a recipient…' : `character '${value}' — pick a selector`}
          </option>
        )}
        <option value={PARTY_SELECTOR}>{SELECTOR_LABELS[PARTY_SELECTOR]}</option>
        <option value={FIRST_LIVING_SELECTOR}>{SELECTOR_LABELS[FIRST_LIVING_SELECTOR]}</option>
      </select>
    </div>
  )
}

function NumberField({
  id,
  label,
  value,
  normalize,
  onCommit,
}: {
  id: string
  label: string
  value: string
  normalize: (draft: string) => string | null
  onCommit: (draft: string) => void
}) {
  const field = useCommittedField(value, onCommit, normalize)
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} className="w-24 font-mono" {...field} />
    </div>
  )
}

function CoinsRow({
  idPrefix,
  coins,
  onCommit,
}: {
  idPrefix: string
  coins: Coins
  onCommit: (denomination: (typeof COIN_KEYS)[number], value: number) => void
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label>Coins</Label>
      <div className="flex gap-2">
        {COIN_KEYS.map((denomination) => (
          <CoinField
            key={denomination}
            id={`${idPrefix}-coins-${denomination}`}
            label={denomination}
            value={coins[denomination] ?? 0}
            onCommit={(value) => onCommit(denomination, value)}
          />
        ))}
      </div>
    </div>
  )
}

function CoinField({
  id,
  label,
  value,
  onCommit,
}: {
  id: string
  label: string
  value: number
  onCommit: (value: number) => void
}) {
  const field = useCommittedField(
    String(value),
    (draft) => onCommit(Number(draft)),
    integerInRange(0),
  )
  return (
    <div className="flex flex-col items-center gap-0.5">
      <Input id={id} aria-label={label} className="h-7 w-14 font-mono text-xs" {...field} />
      <label htmlFor={id} className="text-muted-foreground font-mono text-[10px]">
        {label}
      </label>
    </div>
  )
}

function GrantItemForm({
  committed,
  document,
  idPrefix,
  onCommit,
}: {
  committed: Extract<ConsequenceCommand, { command_type: 'grant_item' }> | null
  document: Adventure
  idPrefix: string
  onCommit: (command: ConsequenceCommand) => void
}) {
  const shipped = useCatalog(loadEquipmentCatalog)
  const [draftSelector, setDraftSelector] = useState(committed?.character_id ?? PARTY_SELECTOR)
  return (
    <div className="flex flex-wrap items-end gap-3">
      <SelectorControl
        id={`${idPrefix}-recipient`}
        value={committed?.character_id ?? draftSelector}
        onChange={(selector) => {
          setDraftSelector(selector)
          if (committed) onCommit({ ...committed, character_id: selector })
        }}
      />
      <div className="flex items-center gap-2 pb-1">
        {committed ? (
          <span className="text-sm" data-testid="grant-item">
            {itemNameFor(shipped, document.items, committed.item_id)}{' '}
            <span className="text-muted-foreground font-mono text-xs">{committed.item_id}</span>
          </span>
        ) : (
          <span className="text-muted-foreground text-sm">Pick the granted item.</span>
        )}
        {/* The cache-domain picker: effective equipment, no magic — grants
            exclude magic items, matching the engine. */}
        <ItemPicker
          document={document}
          triggerLabel={committed ? 'Change item' : 'Pick item'}
          onPick={(itemId) =>
            onCommit(
              committed
                ? { ...committed, item_id: itemId }
                : {
                    command_type: 'grant_item',
                    character_id: draftSelector,
                    item_id: itemId,
                    quantity: 1,
                  },
            )
          }
        />
      </div>
      {committed && (
        <NumberField
          id={`${idPrefix}-grant-quantity`}
          label="Quantity"
          value={String(committed.quantity)}
          normalize={integerInRange(1)}
          onCommit={(draft) => onCommit({ ...committed, quantity: Number(draft) })}
        />
      )}
    </div>
  )
}

function SetFlagForm({
  committed,
  idPrefix,
  onCommit,
}: {
  committed: Extract<ConsequenceCommand, { command_type: 'set_flag' }> | null
  idPrefix: string
  onCommit: (command: ConsequenceCommand) => void
}) {
  // The typed value control end to end — osrlib's flag equality is strict,
  // so a true committed as 1 would be a different authored value. The value
  // is required here (a flag write always carries one), defaulting to the
  // boolean true when the key first commits.
  type FlagValueType = 'text' | 'number' | 'boolean'
  const committedType: FlagValueType =
    committed == null
      ? 'boolean'
      : typeof committed.value === 'boolean'
        ? 'boolean'
        : typeof committed.value === 'number'
          ? 'number'
          : 'text'
  const [valueType, setValueType] = useState<FlagValueType>(committedType)
  const defaultFor = (type: FlagValueType): string | number | boolean =>
    type === 'number' ? 0 : type === 'boolean' ? true : ''
  const commitWith = (key: string, value: string | number | boolean) => {
    if (key.trim() === '') return
    onCommit({ command_type: 'set_flag', key: key.trim(), value })
  }
  const key = useCommittedField(committed?.key ?? '', (draft) => {
    if (draft.trim() === '') return
    commitWith(draft, committed?.value ?? defaultFor(valueType))
  })
  const textValue = useCommittedField(
    committed && typeof committed.value === 'string' ? committed.value : '',
    (draft) => committed && commitWith(committed.key, draft),
  )
  const numberValue = useCommittedField(
    committed && typeof committed.value === 'number' ? String(committed.value) : '',
    (draft) => committed && commitWith(committed.key, Number(draft)),
    (draft) => {
      const trimmed = draft.trim()
      if (trimmed === '') return null
      return Number.isFinite(Number(trimmed)) ? trimmed : null
    },
  )
  return (
    <div className="flex items-end gap-2">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${idPrefix}-setflag-key`}>Flag key</Label>
        <Input id={`${idPrefix}-setflag-key`} className="w-36 font-mono" {...key} />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${idPrefix}-setflag-type`}>Type</Label>
        <select
          id={`${idPrefix}-setflag-type`}
          className={SELECT_CLASS}
          value={valueType}
          onChange={(event) => {
            const next = event.target.value as FlagValueType
            setValueType(next)
            if (committed) commitWith(committed.key, defaultFor(next))
          }}
        >
          <option value="text">text</option>
          <option value="number">number</option>
          <option value="boolean">boolean</option>
        </select>
      </div>
      {valueType === 'text' && (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${idPrefix}-setflag-value`}>Value</Label>
          <Input id={`${idPrefix}-setflag-value`} className="w-28 font-mono" {...textValue} />
        </div>
      )}
      {valueType === 'number' && (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${idPrefix}-setflag-value`}>Value</Label>
          <Input id={`${idPrefix}-setflag-value`} className="w-28 font-mono" {...numberValue} />
        </div>
      )}
      {valueType === 'boolean' && (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${idPrefix}-setflag-value`}>Value</Label>
          <select
            id={`${idPrefix}-setflag-value`}
            className={SELECT_CLASS}
            value={
              committed && typeof committed.value === 'boolean' ? String(committed.value) : 'true'
            }
            onChange={(event) =>
              committed && commitWith(committed.key, event.target.value === 'true')
            }
          >
            <option value="true">true</option>
            <option value="false">false</option>
          </select>
        </div>
      )}
    </div>
  )
}

function SpawnMonstersForm({
  committed,
  document,
  idPrefix,
  onCommit,
}: {
  committed: Extract<ConsequenceCommand, { command_type: 'spawn_monsters' }> | null
  document: Adventure
  idPrefix: string
  onCommit: (command: ConsequenceCommand) => void
}) {
  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="flex items-center gap-2 pb-1">
        {committed ? (
          <span className="text-sm" data-testid="spawn-monster">
            <span className="font-mono text-xs">{committed.template_id}</span>
          </span>
        ) : (
          <span className="text-muted-foreground text-sm">Pick the spawned monster.</span>
        )}
        <MonsterIdPicker
          bundled={document.monsters}
          triggerLabel={committed ? 'Change monster' : 'Pick monster'}
          onPick={(templateId) =>
            onCommit(
              committed
                ? { ...committed, template_id: templateId }
                : {
                    command_type: 'spawn_monsters',
                    template_id: templateId,
                    count_dice: null,
                    count_fixed: 1,
                    distance_feet: 30,
                  },
            )
          }
        />
      </div>
      {committed && (
        <>
          <SpawnCountField
            id={`${idPrefix}-spawn-count`}
            value={committed.count_dice ?? String(committed.count_fixed ?? '')}
            onCommit={(count) => onCommit({ ...committed, ...count })}
          />
          <NumberField
            id={`${idPrefix}-spawn-distance`}
            label="Distance (ft)"
            value={String(committed.distance_feet)}
            normalize={integerInRange(0)}
            onCommit={(draft) => onCommit({ ...committed, distance_feet: Number(draft) })}
          />
        </>
      )}
    </div>
  )
}

// The dice-or-fixed count in one segmented input — the encounter count
// control's exact gesture: all digits reads as fixed, anything else as dice;
// exactly one of the pair is ever set.
function SpawnCountField({
  id,
  value,
  onCommit,
}: {
  id: string
  value: string
  onCommit: (count: { count_dice: string | null; count_fixed: number | null }) => void
}) {
  const field = useCommittedField(
    value,
    (draft) => {
      const trimmed = draft.trim()
      if (/^[0-9]+$/.test(trimmed)) {
        onCommit({ count_dice: null, count_fixed: Number(trimmed) })
      } else {
        onCommit({ count_dice: trimmed, count_fixed: null })
      }
    },
    (draft) => {
      const trimmed = draft.trim()
      if (trimmed === '') return null
      if (/^[0-9]+$/.test(trimmed)) return Number(trimmed) >= 1 ? trimmed : null
      return parseDice(trimmed) ? trimmed : null
    },
  )
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>Count (dice or number)</Label>
      <Input id={id} className="w-28 font-mono" {...field} />
    </div>
  )
}

// The NPC party's optional composition dice: empty rolls the compiled dice.
function NpcCountField({
  id,
  value,
  onCommit,
}: {
  id: string
  value: string
  onCommit: (dice: string | null) => void
}) {
  const field = useCommittedField(
    value,
    (draft) => onCommit(draft.trim() === '' ? null : draft.trim()),
    (draft) => {
      const trimmed = draft.trim()
      if (trimmed === '') return ''
      return parseDice(trimmed) ? trimmed : null
    },
  )
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>Count dice (empty = compiled)</Label>
      <Input id={id} className="w-32 font-mono" {...field} />
    </div>
  )
}

const DOOR_WRITE_FIELDS = ['open', 'wedged', 'discovered', 'unlocked'] as const

function SetDoorStateForm({
  committed,
  document,
  idPrefix,
  onCommit,
}: {
  committed: SetDoorState | null
  document: Adventure
  idPrefix: string
  onCommit: (command: ConsequenceCommand) => void
}) {
  return (
    <div className="flex flex-col gap-3">
      <DoorEdgePicker
        committed={committed}
        document={document}
        idPrefix={idPrefix}
        onPick={(dungeonId, levelNumber, ref) =>
          onCommit(
            committed
              ? {
                  ...committed,
                  dungeon_id: dungeonId,
                  level_number: levelNumber,
                  x: ref.x,
                  y: ref.y,
                  direction: ref.direction,
                }
              : {
                  command_type: 'set_door_state',
                  dungeon_id: dungeonId,
                  level_number: levelNumber,
                  x: ref.x,
                  y: ref.y,
                  direction: ref.direction,
                  open: true,
                  wedged: null,
                  discovered: null,
                  unlocked: null,
                },
          )
        }
      />
      {committed && (
        <div className="flex flex-wrap gap-3" aria-label="Door writes">
          {DOOR_WRITE_FIELDS.map((field) => (
            <div key={field} className="flex flex-col gap-1.5">
              <Label htmlFor={`${idPrefix}-door-${field}`}>{field}</Label>
              <select
                id={`${idPrefix}-door-${field}`}
                className={SELECT_CLASS}
                value={committed[field] == null ? 'unchanged' : String(committed[field])}
                onChange={(event) => {
                  const raw = event.target.value
                  onCommit({
                    ...committed,
                    [field]: raw === 'unchanged' ? null : raw === 'true',
                  })
                }}
              >
                <option value="unchanged">leave unchanged</option>
                <option value="true">set</option>
                <option value="false">clear</option>
              </select>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// The door picker: dungeon and level selects plus the mini level at
// thumbnail scale — clicking a cell offers the door edges incident to it (in
// canonical storage form), auto-picking a lone door and disambiguating
// between several. Only actual doors are offerable, so "names no door" is
// unrepresentable by the control; a foreign no-door value renders as its
// canonical triple and surfaces through diagnostics, never repaired unasked.
function DoorEdgePicker({
  committed,
  document,
  idPrefix,
  onPick,
}: {
  committed: SetDoorState | null
  document: Adventure
  idPrefix: string
  onPick: (dungeonId: string, levelNumber: number, ref: DoorRef) => void
}) {
  const [draftDungeon, setDraftDungeon] = useState(committed?.dungeon_id ?? '')
  const [draftLevel, setDraftLevel] = useState(committed ? String(committed.level_number) : '')
  const [choices, setChoices] = useState<DoorRef[]>([])
  const dungeon = document.dungeons.find((candidate) => candidate.id === draftDungeon) ?? null
  const level: LevelSpec | null =
    dungeon?.levels.find((candidate) => String(candidate.number) === draftLevel) ?? null
  const selectedCell: Position | null =
    committed &&
    committed.dungeon_id === draftDungeon &&
    String(committed.level_number) === draftLevel
      ? [committed.x, committed.y]
      : null
  const pickCell = (cell: Position) => {
    if (!dungeon || !level) return
    const refs = doorRefsAt(level.edges, cell)
    if (refs.length === 1) {
      setChoices([])
      onPick(dungeon.id, level.number, refs[0])
    } else {
      // Zero doors: nothing offerable, nothing picked. Several: the
      // disambiguation row below names each door edge.
      setChoices(refs)
    }
  }
  return (
    <div className="flex flex-col gap-2" aria-label="Door">
      <div className="flex flex-wrap items-end gap-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${idPrefix}-door-dungeon`}>Dungeon</Label>
          <select
            id={`${idPrefix}-door-dungeon`}
            className={SELECT_CLASS}
            value={draftDungeon}
            onChange={(event) => {
              setDraftDungeon(event.target.value)
              setDraftLevel('')
              setChoices([])
            }}
          >
            <option value="" disabled>
              Pick a dungeon…
            </option>
            {document.dungeons.map((candidate) => (
              <option key={candidate.id} value={candidate.id}>
                {candidate.name || candidate.id}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${idPrefix}-door-level`}>Level</Label>
          <select
            id={`${idPrefix}-door-level`}
            className={SELECT_CLASS}
            value={draftLevel}
            disabled={!dungeon}
            onChange={(event) => {
              setDraftLevel(event.target.value)
              setChoices([])
            }}
          >
            <option value="" disabled>
              Pick a level…
            </option>
            {(dungeon?.levels ?? [])
              .slice()
              .sort((a, b) => a.number - b.number)
              .map((candidate) => (
                <option key={candidate.number} value={String(candidate.number)}>
                  Level {candidate.number}
                </option>
              ))}
          </select>
        </div>
        {committed && (
          <p className="pb-2 font-mono text-xs" data-testid="door-ref">
            ({committed.x}, {committed.y}) {committed.direction}
          </p>
        )}
      </div>
      {level && (
        <>
          <p className="text-muted-foreground text-xs">
            Click a cell with a door on it; the door edge is what the write addresses.
          </p>
          <MiniLevelPicker level={level} selected={selectedCell} onPick={pickCell} />
          {choices.length > 1 && (
            <div className="flex flex-wrap gap-2" aria-label="Door choices">
              {choices.map((ref) => (
                <button
                  key={doorRefKey(ref)}
                  type="button"
                  className="rounded-md border px-2 py-1 font-mono text-xs hover:bg-accent"
                  onClick={() => {
                    setChoices([])
                    if (dungeon && level) onPick(dungeon.id, level.number, ref)
                  }}
                >
                  ({ref.x}, {ref.y}) {ref.direction}
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}

function PlacePartyForm({
  committed,
  document,
  idPrefix,
  onCommit,
}: {
  committed: Extract<ConsequenceCommand, { command_type: 'place_party' }> | null
  document: Adventure
  idPrefix: string
  onCommit: (command: ConsequenceCommand) => void
}) {
  const location = committed?.location ?? null
  const [draftKind, setDraftKind] = useState<'town' | 'dungeon'>(location?.kind ?? 'town')
  const [draftDungeon, setDraftDungeon] = useState(location?.dungeon_id ?? '')
  const [draftLevel, setDraftLevel] = useState(
    location?.level_number != null ? String(location.level_number) : '',
  )
  const [draftFacing, setDraftFacing] = useState<keyof typeof FACING_LABELS>(
    location?.facing ?? 'north',
  )
  const dungeon = document.dungeons.find((candidate) => candidate.id === draftDungeon) ?? null
  const level = dungeon?.levels.find((candidate) => String(candidate.number) === draftLevel) ?? null
  const selectedCell: Position | null =
    location?.kind === 'dungeon' &&
    location.dungeon_id === draftDungeon &&
    String(location.level_number) === draftLevel &&
    location.position != null
      ? (location.position as Position)
      : null
  const commitDungeonLocation = (cell: Position, facing: keyof typeof FACING_LABELS) => {
    if (!dungeon || !level) return
    onCommit({
      command_type: 'place_party',
      location: {
        kind: 'dungeon',
        dungeon_id: dungeon.id,
        level_number: level.number,
        position: cell,
        facing,
      },
    })
  }
  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-4" role="radiogroup" aria-label="Placement">
        <label className="flex items-center gap-1.5 text-sm">
          <input
            type="radio"
            name={`${idPrefix}-place-kind`}
            checked={draftKind === 'town'}
            onChange={() => {
              setDraftKind('town')
              // A town placement carries no dungeon fields — complete at once.
              onCommit({ command_type: 'place_party', location: { kind: 'town' } })
            }}
          />
          Town
        </label>
        <label className="flex items-center gap-1.5 text-sm">
          <input
            type="radio"
            name={`${idPrefix}-place-kind`}
            checked={draftKind === 'dungeon'}
            onChange={() => setDraftKind('dungeon')}
          />
          Dungeon cell
        </label>
      </div>
      {draftKind === 'dungeon' && (
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-end gap-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`${idPrefix}-place-dungeon`}>Dungeon</Label>
              <select
                id={`${idPrefix}-place-dungeon`}
                className={SELECT_CLASS}
                value={draftDungeon}
                onChange={(event) => {
                  setDraftDungeon(event.target.value)
                  setDraftLevel('')
                }}
              >
                <option value="" disabled>
                  Pick a dungeon…
                </option>
                {document.dungeons.map((candidate) => (
                  <option key={candidate.id} value={candidate.id}>
                    {candidate.name || candidate.id}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`${idPrefix}-place-level`}>Level</Label>
              <select
                id={`${idPrefix}-place-level`}
                className={SELECT_CLASS}
                value={draftLevel}
                disabled={!dungeon}
                onChange={(event) => setDraftLevel(event.target.value)}
              >
                <option value="" disabled>
                  Pick a level…
                </option>
                {(dungeon?.levels ?? [])
                  .slice()
                  .sort((a, b) => a.number - b.number)
                  .map((candidate) => (
                    <option key={candidate.number} value={String(candidate.number)}>
                      Level {candidate.number}
                    </option>
                  ))}
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`${idPrefix}-place-facing`}>Facing</Label>
              <select
                id={`${idPrefix}-place-facing`}
                className={SELECT_CLASS}
                value={draftFacing}
                onChange={(event) => {
                  const facing = event.target.value as keyof typeof FACING_LABELS
                  setDraftFacing(facing)
                  if (selectedCell) commitDungeonLocation(selectedCell, facing)
                }}
              >
                {(Object.keys(FACING_LABELS) as (keyof typeof FACING_LABELS)[]).map((facing) => (
                  <option key={facing} value={facing}>
                    {FACING_LABELS[facing]}
                  </option>
                ))}
              </select>
            </div>
          </div>
          {level && (
            <MiniLevelPicker
              level={level}
              selected={selectedCell}
              onPick={(cell) => commitDungeonLocation(cell, draftFacing)}
            />
          )}
        </div>
      )}
    </div>
  )
}
