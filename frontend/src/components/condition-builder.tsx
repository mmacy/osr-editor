// The shared gate/clause condition builder over the three-member union.
// Built with gates as first consumer and phase 16's parameters designed in:
// `offerConsumes` is the unrepresentable rule made a prop (gates true; the
// trigger and quest clause builders pass false and the control never
// renders, because osrlib rejects a consuming clause condition at parse).
//
// The builder renders from the committed condition and calls onCommit only
// with model-valid values: switching kinds shows the new kind's controls and
// commits once they hold a complete value (a has_item pick, a non-empty flag
// key, a non-empty effect kind) — a half-typed condition never reaches the
// document. `condition: null` is the drafting state the gate card's "Add
// gate" uses: nothing committed yet, the first complete value commits.
import { useState } from 'react'

import { GateItemPicker } from '@/components/item-picker'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useCommittedField } from '@/hooks/use-committed-field'
import { itemNameFor, loadEquipmentCatalog, useCatalog } from '@/lib/catalogs'
import type { Adventure, ConditionSpec } from '@/types'

const SELECT_CLASS = 'h-8 rounded-md border border-input bg-transparent px-2 text-sm'

const KIND_LABELS: Record<ConditionSpec['condition_type'], string> = {
  has_item: 'Carries an item',
  flag_equals: 'A flag equals',
  effect_active: 'An effect is active',
}

type FlagValueType = 'text' | 'number' | 'boolean'

function flagValueType(value: string | number | boolean): FlagValueType {
  if (typeof value === 'boolean') return 'boolean'
  if (typeof value === 'number') return 'number'
  return 'text'
}

export function ConditionBuilder({
  condition,
  document,
  offerConsumes,
  idPrefix,
  onCommit,
}: {
  condition: ConditionSpec | null
  document: Adventure
  offerConsumes: boolean
  idPrefix: string
  onCommit: (condition: ConditionSpec) => void
}) {
  const [draftKind, setDraftKind] = useState<ConditionSpec['condition_type']>(
    condition?.condition_type ?? 'has_item',
  )
  // The committed condition of the drafted kind, when they agree — the
  // controls below render it; a kind switch renders empty controls until a
  // complete value commits.
  const committed = condition?.condition_type === draftKind ? condition : null
  return (
    <div className="flex flex-col gap-2" aria-label="Condition">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${idPrefix}-condition-kind`}>Condition kind</Label>
        <select
          id={`${idPrefix}-condition-kind`}
          className={SELECT_CLASS}
          value={draftKind}
          onChange={(event) => setDraftKind(event.target.value as ConditionSpec['condition_type'])}
        >
          {(Object.keys(KIND_LABELS) as ConditionSpec['condition_type'][]).map((kind) => (
            <option key={kind} value={kind}>
              {KIND_LABELS[kind]}
            </option>
          ))}
        </select>
      </div>
      {draftKind === 'has_item' && (
        <HasItemControls
          committed={committed?.condition_type === 'has_item' ? committed : null}
          document={document}
          offerConsumes={offerConsumes}
          onCommit={onCommit}
        />
      )}
      {draftKind === 'flag_equals' && (
        <FlagControls
          committed={committed?.condition_type === 'flag_equals' ? committed : null}
          idPrefix={idPrefix}
          onCommit={onCommit}
        />
      )}
      {draftKind === 'effect_active' && (
        <EffectControls
          committed={committed?.condition_type === 'effect_active' ? committed : null}
          idPrefix={idPrefix}
          onCommit={onCommit}
        />
      )}
    </div>
  )
}

function HasItemControls({
  committed,
  document,
  offerConsumes,
  onCommit,
}: {
  committed: Extract<ConditionSpec, { condition_type: 'has_item' }> | null
  document: Adventure
  offerConsumes: boolean
  onCommit: (condition: ConditionSpec) => void
}) {
  const shipped = useCatalog(loadEquipmentCatalog)
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        {committed ? (
          <span className="text-sm" data-testid="condition-item">
            {itemNameFor(shipped, document.items, committed.item_id)}{' '}
            <span className="text-muted-foreground font-mono text-xs">{committed.item_id}</span>
          </span>
        ) : (
          <span className="text-muted-foreground text-sm">Pick the item the party must carry.</span>
        )}
        <GateItemPicker
          document={document}
          triggerLabel={committed ? 'Change item' : 'Pick item'}
          onPick={(itemId) =>
            onCommit({
              condition_type: 'has_item',
              item_id: itemId,
              consumes: committed?.consumes ?? false,
            })
          }
        />
      </div>
      {offerConsumes && (
        <label className="flex items-start gap-2 text-sm">
          <Checkbox
            className="mt-0.5"
            checked={committed?.consumes ?? false}
            disabled={!committed}
            onCheckedChange={(next) =>
              committed &&
              onCommit({
                condition_type: 'has_item',
                item_id: committed.item_id,
                consumes: next === true,
              })
            }
          />
          <span>
            Consumes the item — a toll
            <span className="text-muted-foreground block text-xs">
              One instance is taken from the first carrier in marching order, per success — a door
              that swings shut wants another key.
            </span>
          </span>
        </label>
      )}
    </div>
  )
}

function FlagControls({
  committed,
  idPrefix,
  onCommit,
}: {
  committed: Extract<ConditionSpec, { condition_type: 'flag_equals' }> | null
  idPrefix: string
  onCommit: (condition: ConditionSpec) => void
}) {
  // The typed value control: the committed value's type end to end, because
  // osrlib's equality is strict — a `true` that arrives as `1` is a different
  // authored value. Switching the type re-commits the current draft under the
  // new type only when the key is already committed.
  const [valueType, setValueType] = useState<FlagValueType>(
    committed ? flagValueType(committed.value) : 'text',
  )
  const commitWith = (key: string, value: string | number | boolean) => {
    if (key.trim() === '') return
    onCommit({ condition_type: 'flag_equals', key: key.trim(), value })
  }
  const key = useCommittedField(committed?.key ?? '', (draft) => {
    if (draft.trim() === '') return
    commitWith(draft, committed?.value ?? defaultValue(valueType))
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
        <Label htmlFor={`${idPrefix}-flag-key`}>Flag key</Label>
        <Input id={`${idPrefix}-flag-key`} className="w-36 font-mono" {...key} />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${idPrefix}-flag-type`}>Type</Label>
        <select
          id={`${idPrefix}-flag-type`}
          className={SELECT_CLASS}
          value={valueType}
          onChange={(event) => {
            const next = event.target.value as FlagValueType
            setValueType(next)
            if (committed) commitWith(committed.key, defaultValue(next))
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

function defaultValue(valueType: FlagValueType): string | number | boolean {
  if (valueType === 'number') return 0
  if (valueType === 'boolean') return true
  return ''
}

function EffectControls({
  committed,
  idPrefix,
  onCommit,
}: {
  committed: Extract<ConditionSpec, { condition_type: 'effect_active' }> | null
  idPrefix: string
  onCommit: (condition: ConditionSpec) => void
}) {
  // Effect kinds are an open, data-driven vocabulary — a free string by
  // osrlib's design, so the control is a plain input.
  const kind = useCommittedField(committed?.kind ?? '', (draft) => {
    if (draft.trim() === '') return
    onCommit({ condition_type: 'effect_active', kind: draft.trim() })
  })
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={`${idPrefix}-effect-kind`}>Effect kind</Label>
      <Input id={`${idPrefix}-effect-kind`} className="w-36 font-mono" {...kind} />
    </div>
  )
}
