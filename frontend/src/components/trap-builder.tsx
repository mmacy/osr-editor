// The composable TrapSpec builder, shared by the area trap card (kind pinned
// "room") and the treasure-cache trap (kind pinned "treasure") — the kind is
// never asked for; where the trap lives decides it. Every field change emits
// a patch through onPatch/onEffectPatch; the owner merges it against the
// committed trap inside the store's queue (patchTrapEffect holding the
// validators' implications: volley only with damage, duration only with a
// condition), so a queued edit never reverts an in-flight one.
import { useState } from 'react'

import { MiniLevelPicker } from '@/components/mini-level-picker'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { useCommittedField } from '@/hooks/use-committed-field'
import { CONDITIONS, SAVE_CATEGORIES, TIME_UNITS } from '@/lib/content-builders'
import { parseDice } from '@/lib/notation'
import type {
  Adventure,
  Condition,
  Position,
  SaveCategory,
  TimeUnit,
  TransitionSpec,
  TrapEffect,
  TrapSpec,
} from '@/types'

const SELECT_CLASS = 'h-8 rounded-md border border-input bg-transparent px-2 text-sm'

// '' clears the field; a non-dice draft reverts (the convenience mirror; the
// server's parse stays the authority).
const normalizeDice = (draft: string): string | null => {
  const trimmed = draft.trim()
  if (trimmed === '') return ''
  return parseDice(trimmed) ? trimmed : null
}

// The duration field is dice-or-fixed in one input: all digits is a fixed
// amount, anything else must be dice.
const normalizeDiceOrFixed = (draft: string): string | null => {
  const trimmed = draft.trim()
  if (trimmed === '') return ''
  if (/^[0-9]+$/.test(trimmed)) return Number(trimmed) >= 1 ? String(Number(trimmed)) : null
  return parseDice(trimmed) ? trimmed : null
}

function DiceField({
  id,
  label,
  value,
  disabled,
  onCommit,
}: {
  id: string
  label: string
  value: string | null | undefined
  disabled?: boolean
  onCommit: (value: string | null) => void
}) {
  const field = useCommittedField(
    value ?? '',
    (draft) => onCommit(draft === '' ? null : draft),
    normalizeDice,
  )
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} className="w-24 font-mono" disabled={disabled} {...field} />
    </div>
  )
}

export function TrapBuilder({
  trap,
  document,
  sourceCell,
  idPrefix,
  onPatch,
  onEffectPatch,
}: {
  trap: TrapSpec
  document: Adventure
  sourceCell: Position
  idPrefix: string
  onPatch: (patch: Partial<TrapSpec>) => void
  onEffectPatch: (patch: Partial<TrapEffect>) => void
}) {
  const patchEffect = onEffectPatch
  const effect = trap.effect
  const duration = useCommittedField(
    effect.condition_duration_dice ??
      (effect.condition_duration_amount != null ? String(effect.condition_duration_amount) : ''),
    (draft) => {
      if (draft === '') {
        patchEffect({ condition_duration_dice: null, condition_duration_amount: null })
      } else if (/^[0-9]+$/.test(draft)) {
        patchEffect({
          condition_duration_dice: null,
          condition_duration_amount: Number(draft),
          condition_duration_unit: effect.condition_duration_unit ?? 'turn',
        })
      } else {
        patchEffect({
          condition_duration_dice: draft,
          condition_duration_amount: null,
          condition_duration_unit: effect.condition_duration_unit ?? 'turn',
        })
      }
    },
    normalizeDiceOrFixed,
  )
  const fallFeet = useCommittedField(
    effect.fall_feet != null ? String(effect.fall_feet) : '',
    (draft) => patchEffect({ fall_feet: draft === '' ? null : Number(draft) }),
    (draft) => {
      const trimmed = draft.trim()
      if (trimmed === '') return ''
      const parsed = Number(trimmed)
      return Number.isInteger(parsed) && parsed >= 1 ? String(parsed) : null
    },
  )
  const manual = useCommittedField(effect.manual ?? '', (draft) =>
    patchEffect({ manual: draft === '' ? null : draft }),
  )
  return (
    <div className="flex flex-col gap-3" aria-label="Trap">
      <div className="flex gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${idPrefix}-trigger`}>Trigger</Label>
          <select
            id={`${idPrefix}-trigger`}
            className={SELECT_CLASS}
            value={trap.trigger}
            onChange={(event) => onPatch({ trigger: event.target.value as TrapSpec['trigger'] })}
          >
            <option value="enter">enter</option>
            <option value="open">open</option>
          </select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${idPrefix}-affects`}>Affects</Label>
          <select
            id={`${idPrefix}-affects`}
            className={SELECT_CLASS}
            value={trap.affects}
            onChange={(event) => onPatch({ affects: event.target.value as TrapSpec['affects'] })}
          >
            <option value="triggerer">triggerer</option>
            <option value="party">party</option>
          </select>
        </div>
      </div>
      <div className="flex items-end gap-3">
        <DiceField
          id={`${idPrefix}-damage`}
          label="Damage"
          value={effect.damage_dice}
          onCommit={(value) => patchEffect({ damage_dice: value })}
        />
        <DiceField
          id={`${idPrefix}-volley`}
          label="Volley"
          value={effect.volley_dice}
          disabled={effect.damage_dice == null}
          onCommit={(value) => patchEffect({ volley_dice: value })}
        />
      </div>
      <div className="flex items-end gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${idPrefix}-save`}>Save</Label>
          <select
            id={`${idPrefix}-save`}
            className={SELECT_CLASS}
            value={effect.save?.category ?? ''}
            onChange={(event) => {
              const category = event.target.value
              if (category === '') patchEffect({ save: null })
              else
                patchEffect({
                  save: {
                    category: category as SaveCategory,
                    modifier: effect.save?.modifier ?? 0,
                    on_save: effect.save?.on_save ?? 'negates',
                  },
                })
            }}
          >
            <option value="">none</option>
            {SAVE_CATEGORIES.map((category) => (
              <option key={category} value={category}>
                {category}
              </option>
            ))}
          </select>
        </div>
        {effect.save && (
          <>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`${idPrefix}-save-modifier`}>Modifier</Label>
              <Input
                id={`${idPrefix}-save-modifier`}
                type="number"
                className="w-16 font-mono"
                value={effect.save.modifier}
                onChange={(event) =>
                  effect.save &&
                  patchEffect({
                    save: { ...effect.save, modifier: Number(event.target.value) },
                  })
                }
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`${idPrefix}-on-save`}>On save</Label>
              <select
                id={`${idPrefix}-on-save`}
                className={SELECT_CLASS}
                value={effect.save.on_save}
                onChange={(event) =>
                  effect.save &&
                  patchEffect({
                    save: {
                      ...effect.save,
                      on_save: event.target.value as 'negates' | 'half',
                    },
                  })
                }
              >
                <option value="negates">negates</option>
                <option value="half">half</option>
              </select>
            </div>
          </>
        )}
      </div>
      <label className="flex items-center gap-2 text-sm">
        <Checkbox
          checked={effect.kills}
          onCheckedChange={(checked) => patchEffect({ kills: checked === true })}
        />
        Save or die
      </label>
      <div className="flex items-end gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${idPrefix}-condition`}>Condition</Label>
          <select
            id={`${idPrefix}-condition`}
            className={SELECT_CLASS}
            value={effect.condition ?? ''}
            onChange={(event) =>
              patchEffect({
                condition: event.target.value === '' ? null : (event.target.value as Condition),
              })
            }
          >
            <option value="">none</option>
            {CONDITIONS.map((condition) => (
              <option key={condition} value={condition}>
                {condition}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${idPrefix}-duration`}>Duration</Label>
          <Input
            id={`${idPrefix}-duration`}
            className="w-20 font-mono"
            disabled={effect.condition == null}
            {...duration}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${idPrefix}-duration-unit`}>Unit</Label>
          <select
            id={`${idPrefix}-duration-unit`}
            className={SELECT_CLASS}
            disabled={effect.condition == null}
            value={effect.condition_duration_unit ?? 'turn'}
            onChange={(event) =>
              patchEffect({ condition_duration_unit: event.target.value as TimeUnit })
            }
          >
            {TIME_UNITS.map((unit) => (
              <option key={unit} value={unit}>
                {unit}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${idPrefix}-fall`}>Fall (feet)</Label>
        <Input id={`${idPrefix}-fall`} className="w-20 font-mono" {...fallFeet} />
      </div>
      <SlideEditor
        idPrefix={idPrefix}
        document={document}
        sourceCell={sourceCell}
        transition={effect.transition ?? null}
        onCommit={(transition) => patchEffect({ transition })}
      />
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${idPrefix}-manual`}>Manual effect</Label>
        <Textarea
          id={`${idPrefix}-manual`}
          className="min-h-16 font-serif"
          value={manual.value}
          onChange={manual.onChange}
          onBlur={manual.onBlur}
        />
      </div>
    </div>
  )
}

// The slide destination, reusing the transition tool's target gesture: dungeon
// and level selects plus the thumbnail cell pick. A slide is authored as a
// chute from the trap's cell — one-way by osrlib's design.
function SlideEditor({
  idPrefix,
  document,
  sourceCell,
  transition,
  onCommit,
}: {
  idPrefix: string
  document: Adventure
  sourceCell: Position
  transition: TransitionSpec | null
  onCommit: (transition: TransitionSpec | null) => void
}) {
  const [editing, setEditing] = useState(false)
  const [targetDungeon, setTargetDungeon] = useState(
    transition?.to_dungeon_id ?? document.dungeons[0]?.id ?? '',
  )
  const [targetLevel, setTargetLevel] = useState<number | null>(
    transition?.to_level_number ??
      document.dungeons.find((dungeon) => dungeon.id === targetDungeon)?.levels[0]?.number ??
      null,
  )
  const [facing, setFacing] = useState<TransitionSpec['to_facing']>(
    transition?.to_facing ?? 'north',
  )
  const dungeon = document.dungeons.find((candidate) => candidate.id === targetDungeon)
  const level = dungeon?.levels.find((candidate) => candidate.number === targetLevel)
  if (!editing && !transition) {
    return (
      <button
        type="button"
        className="text-muted-foreground self-start text-sm underline underline-offset-2"
        onClick={() => setEditing(true)}
      >
        Add slide destination…
      </button>
    )
  }
  return (
    <div className="flex flex-col gap-2 rounded-md border p-2" aria-label="Slide">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">Slide</span>
        {transition && (
          <button
            type="button"
            className="text-muted-foreground text-xs underline underline-offset-2"
            onClick={() => {
              onCommit(null)
              setEditing(false)
            }}
          >
            Clear
          </button>
        )}
      </div>
      <div className="flex gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${idPrefix}-slide-dungeon`}>Dungeon</Label>
          <select
            id={`${idPrefix}-slide-dungeon`}
            className={SELECT_CLASS}
            value={targetDungeon}
            onChange={(event) => {
              setTargetDungeon(event.target.value)
              const next = document.dungeons.find(
                (candidate) => candidate.id === event.target.value,
              )
              setTargetLevel(next?.levels[0]?.number ?? null)
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
          <Label htmlFor={`${idPrefix}-slide-level`}>Level</Label>
          <select
            id={`${idPrefix}-slide-level`}
            className={SELECT_CLASS}
            value={targetLevel ?? ''}
            onChange={(event) => setTargetLevel(Number(event.target.value))}
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
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${idPrefix}-slide-facing`}>Facing</Label>
          <select
            id={`${idPrefix}-slide-facing`}
            className={SELECT_CLASS}
            value={facing}
            onChange={(event) => {
              const next = event.target.value as TransitionSpec['to_facing']
              setFacing(next)
              if (transition) onCommit({ ...transition, to_facing: next })
            }}
          >
            {(['north', 'east', 'south', 'west'] as const).map((candidate) => (
              <option key={candidate} value={candidate}>
                {candidate}
              </option>
            ))}
          </select>
        </div>
      </div>
      {level && targetLevel !== null && (
        <>
          <MiniLevelPicker
            level={level}
            selected={
              transition?.to_dungeon_id === targetDungeon &&
              transition.to_level_number === targetLevel
                ? transition.to_position
                : null
            }
            onPick={(cell) =>
              onCommit({
                kind: 'chute',
                position: sourceCell,
                to_dungeon_id: targetDungeon,
                to_level_number: targetLevel,
                to_position: cell,
                to_facing: facing,
              })
            }
          />
          <p className="text-muted-foreground font-mono text-xs">
            {transition
              ? `(${transition.to_position[0]}, ${transition.to_position[1]})`
              : 'Click a cell'}
          </p>
        </>
      )}
    </div>
  )
}
