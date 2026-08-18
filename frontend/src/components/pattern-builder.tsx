// The shared trigger-pattern builder over the seven-kind union — the
// ConditionBuilder discipline: a kind select, per-kind fields, and onCommit
// called only with complete values. Switching kinds shows the new kind's
// controls and commits once they hold a complete value (town_entered is
// complete with zero fields, so selecting it commits at once); a half-picked
// pattern never reaches the document. `pattern: null` is the create dialog's
// drafting state.
import { useState } from 'react'

import { GateItemPicker } from '@/components/item-picker'
import { MonsterIdPicker } from '@/components/monster-picker'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useCommittedField } from '@/hooks/use-committed-field'
import { itemNameFor, loadEquipmentCatalog, useCatalog } from '@/lib/catalogs'
import { PATTERN_KIND_LABELS, PATTERN_KINDS } from '@/lib/trigger-builders'
import type { Adventure, TriggerPattern } from '@/types'

const SELECT_CLASS = 'h-8 rounded-md border border-input bg-transparent px-2 text-sm'

type FlagValueType = 'text' | 'number' | 'boolean'

function flagValueType(value: string | number | boolean): FlagValueType {
  if (typeof value === 'boolean') return 'boolean'
  if (typeof value === 'number') return 'number'
  return 'text'
}

function defaultValue(valueType: FlagValueType): string | number | boolean {
  if (valueType === 'number') return 0
  if (valueType === 'boolean') return true
  return ''
}

export function PatternBuilder({
  pattern,
  document,
  idPrefix,
  onCommit,
}: {
  pattern: TriggerPattern | null
  document: Adventure
  idPrefix: string
  onCommit: (pattern: TriggerPattern) => void
}) {
  const [draftKind, setDraftKind] = useState<TriggerPattern['pattern_type']>(
    pattern?.pattern_type ?? 'area_entered',
  )
  // The committed pattern of the drafted kind, when they agree — the controls
  // below render it; a kind switch renders empty controls until a complete
  // value commits.
  const committed = pattern?.pattern_type === draftKind ? pattern : null
  return (
    <div className="flex flex-col gap-2" aria-label="Pattern">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${idPrefix}-pattern-kind`}>Fires</Label>
        <select
          id={`${idPrefix}-pattern-kind`}
          className={SELECT_CLASS}
          value={draftKind}
          onChange={(event) => {
            const kind = event.target.value as TriggerPattern['pattern_type']
            setDraftKind(kind)
            // The one zero-field kind is complete the moment it is chosen.
            if (kind === 'town_entered') onCommit({ pattern_type: 'town_entered' })
          }}
        >
          {PATTERN_KINDS.map((kind) => (
            <option key={kind} value={kind}>
              {PATTERN_KIND_LABELS[kind]}
            </option>
          ))}
        </select>
      </div>
      {draftKind === 'area_entered' && (
        <AreaEnteredControls
          committed={committed?.pattern_type === 'area_entered' ? committed : null}
          document={document}
          idPrefix={idPrefix}
          onCommit={onCommit}
        />
      )}
      {draftKind === 'level_entered' && (
        <LevelEnteredControls
          committed={committed?.pattern_type === 'level_entered' ? committed : null}
          document={document}
          idPrefix={idPrefix}
          onCommit={onCommit}
        />
      )}
      {draftKind === 'dungeon_entered' && (
        <DungeonSelect
          id={`${idPrefix}-pattern-dungeon`}
          document={document}
          value={committed?.pattern_type === 'dungeon_entered' ? committed.dungeon_id : ''}
          onChange={(dungeonId) =>
            onCommit({ pattern_type: 'dungeon_entered', dungeon_id: dungeonId })
          }
        />
      )}
      {draftKind === 'item_acquired' && (
        <ItemAcquiredControls
          committed={committed?.pattern_type === 'item_acquired' ? committed : null}
          document={document}
          onCommit={onCommit}
        />
      )}
      {draftKind === 'monster_defeated' && (
        <div className="flex items-center gap-2">
          {committed?.pattern_type === 'monster_defeated' ? (
            <span className="text-sm" data-testid="pattern-monster">
              <span className="font-mono text-xs">{committed.template_id}</span>
            </span>
          ) : (
            <span className="text-muted-foreground text-sm">
              Pick the monster whose defeat fires it.
            </span>
          )}
          <MonsterIdPicker
            bundled={document.monsters}
            triggerLabel={committed ? 'Change monster' : 'Pick monster'}
            onPick={(templateId) =>
              onCommit({ pattern_type: 'monster_defeated', template_id: templateId })
            }
          />
        </div>
      )}
      {draftKind === 'flag_set' && (
        <FlagSetControls
          committed={committed?.pattern_type === 'flag_set' ? committed : null}
          idPrefix={idPrefix}
          onCommit={onCommit}
        />
      )}
    </div>
  )
}

// The dungeon select with an unchosen placeholder — a complete-values-only
// control never commits a guessed dungeon.
function DungeonSelect({
  id,
  document,
  value,
  onChange,
  label = 'Dungeon',
}: {
  id: string
  document: Adventure
  value: string
  onChange: (dungeonId: string) => void
  label?: string
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <select
        id={id}
        className={SELECT_CLASS}
        value={value}
        onChange={(event) => {
          if (event.target.value !== '') onChange(event.target.value)
        }}
      >
        <option value="" disabled>
          Pick a dungeon…
        </option>
        {document.dungeons.map((dungeon) => (
          <option key={dungeon.id} value={dungeon.id}>
            {dungeon.name || dungeon.id}
          </option>
        ))}
      </select>
    </div>
  )
}

function AreaEnteredControls({
  committed,
  document,
  idPrefix,
  onCommit,
}: {
  committed: Extract<TriggerPattern, { pattern_type: 'area_entered' }> | null
  document: Adventure
  idPrefix: string
  onCommit: (pattern: TriggerPattern) => void
}) {
  // Dungeon and level are draft state until the area pick completes the
  // triple — area ids are level-scoped, so the pattern names all three.
  const [draftDungeon, setDraftDungeon] = useState(committed?.dungeon_id ?? '')
  const [draftLevel, setDraftLevel] = useState(committed ? String(committed.level_number) : '')
  const dungeon = document.dungeons.find((candidate) => candidate.id === draftDungeon) ?? null
  const level = dungeon?.levels.find((candidate) => String(candidate.number) === draftLevel) ?? null
  return (
    <div className="flex flex-wrap items-end gap-2">
      <DungeonSelect
        id={`${idPrefix}-pattern-dungeon`}
        document={document}
        value={draftDungeon}
        onChange={(dungeonId) => {
          setDraftDungeon(dungeonId)
          setDraftLevel('')
        }}
      />
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${idPrefix}-pattern-level`}>Level</Label>
        <select
          id={`${idPrefix}-pattern-level`}
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
        <Label htmlFor={`${idPrefix}-pattern-area`}>Area</Label>
        <select
          id={`${idPrefix}-pattern-area`}
          className={SELECT_CLASS}
          value={committed && level ? committed.area_id : ''}
          disabled={!level}
          onChange={(event) => {
            if (event.target.value === '' || !dungeon || !level) return
            onCommit({
              pattern_type: 'area_entered',
              dungeon_id: dungeon.id,
              level_number: level.number,
              area_id: event.target.value,
            })
          }}
        >
          <option value="" disabled>
            Pick an area…
          </option>
          {(level?.areas ?? []).map((area) => (
            <option key={area.id} value={area.id}>
              {area.id}
              {area.name ? ` — ${area.name}` : ''}
            </option>
          ))}
        </select>
      </div>
    </div>
  )
}

function LevelEnteredControls({
  committed,
  document,
  idPrefix,
  onCommit,
}: {
  committed: Extract<TriggerPattern, { pattern_type: 'level_entered' }> | null
  document: Adventure
  idPrefix: string
  onCommit: (pattern: TriggerPattern) => void
}) {
  const [draftDungeon, setDraftDungeon] = useState(committed?.dungeon_id ?? '')
  const dungeon = document.dungeons.find((candidate) => candidate.id === draftDungeon) ?? null
  return (
    <div className="flex flex-wrap items-end gap-2">
      <DungeonSelect
        id={`${idPrefix}-pattern-dungeon`}
        document={document}
        value={draftDungeon}
        onChange={setDraftDungeon}
      />
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${idPrefix}-pattern-level`}>Level</Label>
        <select
          id={`${idPrefix}-pattern-level`}
          className={SELECT_CLASS}
          value={
            committed && committed.dungeon_id === draftDungeon ? String(committed.level_number) : ''
          }
          disabled={!dungeon}
          onChange={(event) => {
            if (event.target.value === '' || !dungeon) return
            onCommit({
              pattern_type: 'level_entered',
              dungeon_id: dungeon.id,
              level_number: Number(event.target.value),
            })
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
    </div>
  )
}

function ItemAcquiredControls({
  committed,
  document,
  onCommit,
}: {
  committed: Extract<TriggerPattern, { pattern_type: 'item_acquired' }> | null
  document: Adventure
  onCommit: (pattern: TriggerPattern) => void
}) {
  const shipped = useCatalog(loadEquipmentCatalog)
  return (
    <div className="flex items-center gap-2">
      {committed ? (
        <span className="text-sm" data-testid="pattern-item">
          {itemNameFor(shipped, document.items, committed.item_id)}{' '}
          <span className="text-muted-foreground font-mono text-xs">{committed.item_id}</span>
        </span>
      ) : (
        <span className="text-muted-foreground text-sm">
          Pick the item whose acquisition fires it.
        </span>
      )}
      <GateItemPicker
        document={document}
        triggerLabel={committed ? 'Change item' : 'Pick item'}
        onPick={(itemId) => onCommit({ pattern_type: 'item_acquired', item_id: itemId })}
      />
    </div>
  )
}

// The flag pattern's key plus an any-value toggle, on by default — a value of
// null matches any written value; toggled off, the typed value control
// preserves the value's type end to end (osrlib's flag equality is strict).
function FlagSetControls({
  committed,
  idPrefix,
  onCommit,
}: {
  committed: Extract<TriggerPattern, { pattern_type: 'flag_set' }> | null
  idPrefix: string
  onCommit: (pattern: TriggerPattern) => void
}) {
  const anyValue = committed ? committed.value == null : true
  const [valueType, setValueType] = useState<FlagValueType>(
    committed?.value != null ? flagValueType(committed.value) : 'text',
  )
  const commitWith = (key: string, value: string | number | boolean | null) => {
    if (key.trim() === '') return
    onCommit({ pattern_type: 'flag_set', key: key.trim(), value })
  }
  const key = useCommittedField(committed?.key ?? '', (draft) => {
    if (draft.trim() === '') return
    commitWith(draft, committed?.value ?? null)
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
    <div className="flex flex-col gap-2">
      <div className="flex items-end gap-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${idPrefix}-flag-key`}>Flag key</Label>
          <Input id={`${idPrefix}-flag-key`} className="w-36 font-mono" {...key} />
        </div>
        <label className="flex items-center gap-1.5 pb-2 text-sm">
          <Checkbox
            aria-label="Any written value"
            checked={anyValue}
            disabled={!committed}
            onCheckedChange={(next) =>
              committed && commitWith(committed.key, next === true ? null : defaultValue(valueType))
            }
          />
          Any written value
        </label>
      </div>
      {!anyValue && committed && (
        <div className="flex items-end gap-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${idPrefix}-flag-type`}>Type</Label>
            <select
              id={`${idPrefix}-flag-type`}
              className={SELECT_CLASS}
              value={valueType}
              onChange={(event) => {
                const next = event.target.value as FlagValueType
                setValueType(next)
                commitWith(committed.key, defaultValue(next))
              }}
            >
              <option value="text">text</option>
              <option value="number">number</option>
              <option value="boolean">boolean</option>
            </select>
          </div>
          {valueType === 'text' && (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`${idPrefix}-flag-value`}>Value</Label>
              <Input id={`${idPrefix}-flag-value`} className="w-28 font-mono" {...textValue} />
            </div>
          )}
          {valueType === 'number' && (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`${idPrefix}-flag-value`}>Value</Label>
              <Input id={`${idPrefix}-flag-value`} className="w-28 font-mono" {...numberValue} />
            </div>
          )}
          {valueType === 'boolean' && (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`${idPrefix}-flag-value`}>Value</Label>
              <select
                id={`${idPrefix}-flag-value`}
                className={SELECT_CLASS}
                value={typeof committed.value === 'boolean' ? String(committed.value) : 'true'}
                onChange={(event) => commitWith(committed.key, event.target.value === 'true')}
              >
                <option value="true">true</option>
                <option value="false">false</option>
              </select>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
