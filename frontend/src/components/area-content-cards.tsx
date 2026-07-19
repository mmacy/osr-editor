// The keyed-entry content cards: encounter, treasure, trap, features — one
// compact card per content kind in the spec's order. A collapsed card is a
// one-line module-notation summary; an empty kind is a single-click add;
// cards expand in place to edit; removal is the card's own action. Every
// commit rides store.commit builders patching only their own field against
// the committed document — one batch, one undo step per gesture.
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { ChevronDownIcon, ChevronRightIcon, PlusIcon, XIcon } from 'lucide-react'

import { EquipmentPicker } from '@/components/equipment-picker'
import { MiniLevelPicker } from '@/components/map-dialogs'
import { MonsterPicker } from '@/components/monster-picker'
import { TrapBuilder } from '@/components/trap-builder'
import { TreasureTypePicker } from '@/components/treasure-type-picker'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Textarea } from '@/components/ui/textarea'
import { useCommittedField } from '@/hooks/use-committed-field'
import { effectiveMonsterCatalog, loadMonsterCatalog, useCatalog } from '@/lib/catalogs'
import {
  REACTION_RESULTS,
  alignmentIntersection,
  areaTrapOps,
  areaTrapPatchOps,
  emptyFeature,
  emptyTrap,
  encounterAddLineOps,
  encounterOps,
  encounterPatchOps,
  encounterRemoveLineOps,
  encounterSetLineOps,
  featureAddOps,
  featurePatchOps,
  featureRemoveOps,
  findLevel,
  nextFreeFeatureKey,
  parseCount,
  toggleTreasureLetter,
  treasureOps,
  type AreaTarget,
  type FeatureScope,
} from '@/lib/content-builders'
import {
  formatCount,
  formatEncounter,
  formatFeature,
  formatTrap,
  formatTreasure,
} from '@/lib/notation'
import { projectStore } from '@/store/project-store'
import type {
  Adventure,
  Alignment,
  AreaSpec,
  AreaTreasureSpec,
  Coins,
  FeatureSpec,
  KeyedMonster,
  Position,
  ReactionResult,
  ValuableSpec,
} from '@/types'

const SELECT_CLASS = 'h-8 rounded-md border border-input bg-transparent px-2 text-sm'

// The one-shot intent the stocking context menu sets: which card to expand
// and, for an add action, which flow to start. `token` distinguishes repeated
// intents for the same card.
export type ContentCardKind = 'encounter' | 'treasure' | 'trap' | 'features'
export interface CardIntent {
  card: ContentCardKind | 'description'
  action: 'edit' | 'add'
  token: number
}

// The shared add-feature commit: a blank custom feature under the next free
// feature-<n> key. At area scope it binds to the whole area (cell null); at
// level scope the caller's cellHint is the picked cell — the UI always
// creates level features with a cell in hand.
function commitAddFeature(scope: FeatureScope, cellHint: Position | null): void {
  void projectStore.getState().commit((current) => {
    const level = findLevel(current, scope.dungeonId, scope.levelNumber)
    if (!level) return []
    const cell = scope.areaId === null ? cellHint : null
    return featureAddOps(scope, emptyFeature(nextFreeFeatureKey(level), cell))
  })
}

// The card shell. Collapsed with content: a one-line module-notation summary.
// Collapsed and empty: the single-click add row. Expanded: the children edit
// in place.
function ContentCard({
  title,
  summary,
  expanded,
  onToggle,
  onAdd,
  children,
}: {
  title: string
  summary: string | null
  expanded: boolean
  onToggle: () => void
  onAdd: () => void
  children?: ReactNode
}) {
  return (
    <div className="rounded-md border" data-testid={`card-${title.toLowerCase()}`}>
      {!expanded && summary === null ? (
        <button
          type="button"
          className="text-muted-foreground hover:text-foreground flex w-full items-center gap-2 p-2 text-left text-sm"
          onClick={onAdd}
        >
          <PlusIcon className="size-4 shrink-0 opacity-50" />
          <span className="font-medium">{title}</span>
        </button>
      ) : (
        <button
          type="button"
          className="flex w-full items-center gap-2 p-2 text-left text-sm"
          aria-expanded={expanded}
          onClick={onToggle}
        >
          {expanded ? (
            <ChevronDownIcon className="size-4 shrink-0 opacity-50" />
          ) : (
            <ChevronRightIcon className="size-4 shrink-0 opacity-50" />
          )}
          <span className="font-medium">{title}</span>
          {!expanded && summary && (
            <span className="text-muted-foreground ml-auto truncate font-mono text-xs">
              {summary}
            </span>
          )}
        </button>
      )}
      {expanded && <div className="border-t p-2">{children}</div>}
    </div>
  )
}

export function AreaContentCards({
  document,
  area,
  target,
  intent,
}: {
  document: Adventure
  area: AreaSpec
  target: AreaTarget
  intent: CardIntent | null
}) {
  const [expanded, setExpanded] = useState<Set<ContentCardKind>>(new Set())
  const toggle = (card: ContentCardKind) =>
    setExpanded((current) => {
      const next = new Set(current)
      if (next.has(card)) next.delete(card)
      else next.add(card)
      return next
    })
  const expand = (card: ContentCardKind) => setExpanded((current) => new Set(current).add(card))
  // The one-shot intent, consumed once per token. Expansion is a render-time
  // adjustment (the focusToken pattern); the add-action side effects — the
  // trap's single-click commit, the feature add — run in a ref-guarded
  // effect. Encounter and treasure start adding through their expanded empty
  // state (the picker, the letters radio), no commit needed here.
  const [seenToken, setSeenToken] = useState<number | null>(null)
  if (intent && intent.token !== seenToken) {
    setSeenToken(intent.token)
    if (intent.card !== 'description') {
      setExpanded((current) => new Set(current).add(intent.card as ContentCardKind))
    }
  }
  const committedToken = useRef<number | null>(null)
  useEffect(() => {
    if (!intent || intent.token === committedToken.current) return
    committedToken.current = intent.token
    if (intent.action !== 'add') return
    if (intent.card === 'trap' && !area.trap) {
      void projectStore.getState().commit(areaTrapOps(target, emptyTrap('room')))
    } else if (intent.card === 'features') {
      commitAddFeature({ ...target, areaId: target.areaId }, area.cells[0])
    }
  })
  return (
    <div className="flex flex-col gap-2" aria-label="Contents">
      <EncounterCard
        document={document}
        area={area}
        target={target}
        expanded={expanded.has('encounter')}
        onToggle={() => toggle('encounter')}
        onExpand={() => expand('encounter')}
      />
      <TreasureCard
        area={area}
        target={target}
        expanded={expanded.has('treasure')}
        onToggle={() => toggle('treasure')}
        onExpand={() => expand('treasure')}
      />
      <TrapCard
        document={document}
        area={area}
        target={target}
        expanded={expanded.has('trap')}
        onToggle={() => toggle('trap')}
        onExpand={() => expand('trap')}
      />
      <FeaturesCard
        document={document}
        features={area.features}
        scope={{ ...target, areaId: target.areaId }}
        cellHint={area.cells[0]}
        expanded={expanded.has('features')}
        onToggle={() => toggle('features')}
        onExpand={() => expand('features')}
      />
    </div>
  )
}

// --- encounter ---

function EncounterCard({
  document,
  area,
  target,
  expanded,
  onToggle,
  onExpand,
}: {
  document: Adventure
  area: AreaSpec
  target: AreaTarget
  expanded: boolean
  onToggle: () => void
  onExpand: () => void
}) {
  const shipped = useCatalog(loadMonsterCatalog)
  const monsters = useMemo(
    () => (shipped ? effectiveMonsterCatalog(shipped, document.monsters) : []),
    [shipped, document.monsters],
  )
  const nameFor = (templateId: string) =>
    monsters.find((monster) => monster.id === templateId)?.name ?? templateId
  const optionsFor = (templateId: string) =>
    monsters.find((monster) => monster.id === templateId)?.alignmentOptions ?? null
  const encounter = area.encounter
  const addLine = (line: KeyedMonster) => {
    void projectStore.getState().commit((current) => encounterAddLineOps(current, target, line))
  }
  return (
    <ContentCard
      title="Encounter"
      summary={encounter ? formatEncounter(encounter, nameFor) : null}
      expanded={expanded}
      onToggle={onToggle}
      onAdd={onExpand}
    >
      {encounter ? (
        <div className="flex flex-col gap-3">
          <ul className="flex flex-col gap-1.5" aria-label="Monster lines">
            {encounter.monsters.map((line, index) => (
              <MonsterLine
                key={`${line.template_id}-${index}`}
                line={line}
                name={nameFor(line.template_id)}
                lastLine={encounter.monsters.length === 1}
                onCommitCount={(text) => {
                  const count = parseCount(text)
                  if (!count) return
                  void projectStore
                    .getState()
                    .commit((current) =>
                      encounterSetLineOps(current, target, index, { ...line, ...count }),
                    )
                }}
                onRemove={() => {
                  void projectStore
                    .getState()
                    .commit((current) => encounterRemoveLineOps(current, target, index))
                }}
              />
            ))}
          </ul>
          <MonsterPicker bundled={document.monsters} onPick={addLine} />
          <div className="flex items-end gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="encounter-alignment">Alignment</Label>
              <AlignmentSelect
                encounterAlignment={encounter.alignment ?? null}
                options={alignmentIntersection(encounter.monsters, optionsFor)}
                onCommit={(alignment) => {
                  void projectStore
                    .getState()
                    .commit((current) => encounterPatchOps(current, target, { alignment }))
                }}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="encounter-stance">Stance</Label>
              <select
                id="encounter-stance"
                className={SELECT_CLASS}
                value={encounter.stance ?? ''}
                onChange={(event) => {
                  const stance =
                    event.target.value === '' ? null : (event.target.value as ReactionResult)
                  void projectStore
                    .getState()
                    .commit((current) => encounterPatchOps(current, target, { stance }))
                }}
              >
                <option value="">none</option>
                {REACTION_RESULTS.map((stance) => (
                  <option key={stance} value={stance}>
                    {stance}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={encounter.aware}
              onChange={(event) => {
                const aware = event.target.checked
                void projectStore
                  .getState()
                  .commit((current) => encounterPatchOps(current, target, { aware }))
              }}
            />
            Aware — the monsters expect intruders
          </label>
          <Button
            variant="destructive"
            size="sm"
            className="self-start"
            onClick={() => {
              void projectStore.getState().commit(encounterOps(target, null))
            }}
          >
            Remove encounter
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <p className="text-muted-foreground text-sm">Pick the first monster line.</p>
          <MonsterPicker bundled={document.monsters} onPick={addLine} />
        </div>
      )}
    </ContentCard>
  )
}

function MonsterLine({
  line,
  name,
  lastLine,
  onCommitCount,
  onRemove,
}: {
  line: KeyedMonster
  name: string
  lastLine: boolean
  onCommitCount: (text: string) => void
  onRemove: () => void
}) {
  const count = useCommittedField(formatCount(line.count_dice, line.count_fixed), onCommitCount)
  return (
    <li className="flex items-center gap-2 text-sm">
      <Input className="h-7 w-16 font-mono text-xs" aria-label={`Count for ${name}`} {...count} />
      <span className="text-muted-foreground">×</span>
      <span className="truncate">{name}</span>
      <Button
        variant="ghost"
        size="icon-sm"
        className="ml-auto"
        aria-label={`Remove ${name}`}
        disabled={lastLine}
        title={
          lastLine
            ? 'An encounter needs at least one line — remove the encounter itself.'
            : undefined
        }
        onClick={onRemove}
      >
        <XIcon />
      </Button>
    </li>
  )
}

// The alignment select: unpinned plus the intersection of every line's
// template options. An existing pin outside the intersection stays offered —
// the already-parsed encounter_alignment_invalid finding is legal and
// navigable, never destroyed by the form.
function AlignmentSelect({
  encounterAlignment,
  options,
  onCommit,
}: {
  encounterAlignment: Alignment | null
  options: Alignment[]
  onCommit: (alignment: Alignment | null) => void
}) {
  const offered =
    encounterAlignment && !options.includes(encounterAlignment)
      ? [...options, encounterAlignment]
      : options
  return (
    <select
      id="encounter-alignment"
      className={SELECT_CLASS}
      value={encounterAlignment ?? ''}
      onChange={(event) =>
        onCommit(event.target.value === '' ? null : (event.target.value as Alignment))
      }
    >
      <option value="">unpinned</option>
      {offered.map((alignment) => (
        <option key={alignment} value={alignment}>
          {alignment}
        </option>
      ))}
    </select>
  )
}

// --- treasure ---

function TreasureCard({
  area,
  target,
  expanded,
  onToggle,
  onExpand,
}: {
  area: AreaSpec
  target: AreaTarget
  expanded: boolean
  onToggle: () => void
  onExpand: () => void
}) {
  const treasure = area.treasure ?? null
  const mode = treasure?.unguarded ? 'unguarded' : 'letters'
  const commitTreasure = (value: AreaTreasureSpec | null) => {
    void projectStore.getState().commit(treasureOps(target, value))
  }
  return (
    <ContentCard
      title="Treasure"
      summary={treasure ? formatTreasure(treasure) : null}
      expanded={expanded}
      onToggle={onToggle}
      onAdd={onExpand}
    >
      <div className="flex flex-col gap-3">
        <RadioGroup
          value={mode}
          onValueChange={(next) => {
            // The model's XOR by construction: unguarded commits whole;
            // switching back to letters clears to the empty add state, where
            // the first letter toggle commits.
            if (next === 'unguarded') commitTreasure({ letters: [], unguarded: true })
            else if (treasure?.unguarded) commitTreasure(null)
          }}
        >
          <label className="flex items-center gap-2 text-sm">
            <RadioGroupItem value="letters" /> Treasure types
          </label>
          <label className="flex items-center gap-2 text-sm">
            <RadioGroupItem value="unguarded" /> Unguarded band roll
          </label>
        </RadioGroup>
        {mode === 'letters' && (
          <div className="flex flex-col gap-1.5">
            <TreasureTypePicker
              selected={treasure && !treasure.unguarded ? treasure.letters : []}
              onToggle={(letter) => {
                const next = toggleTreasureLetter(treasure, letter)
                if (next) commitTreasure(next)
              }}
            />
            {!treasure && (
              <p className="text-muted-foreground text-xs">Pick at least one type letter.</p>
            )}
          </div>
        )}
        {treasure && (
          <Button
            variant="destructive"
            size="sm"
            className="self-start"
            onClick={() => commitTreasure(null)}
          >
            Remove treasure
          </Button>
        )}
      </div>
    </ContentCard>
  )
}

// --- trap ---

function TrapCard({
  document,
  area,
  target,
  expanded,
  onToggle,
  onExpand,
}: {
  document: Adventure
  area: AreaSpec
  target: AreaTarget
  expanded: boolean
  onToggle: () => void
  onExpand: () => void
}) {
  const trap = area.trap
  return (
    <ContentCard
      title="Trap"
      summary={trap ? formatTrap(trap) : null}
      expanded={expanded}
      onToggle={onToggle}
      onAdd={() => {
        // Kind pinned "room" by construction — an area carries room traps —
        // and an all-empty effect is a valid model, so the single-click add
        // commits immediately.
        void projectStore.getState().commit(areaTrapOps(target, emptyTrap('room')))
        onExpand()
      }}
    >
      {trap && (
        <div className="flex flex-col gap-3">
          <TrapBuilder
            trap={trap}
            document={document}
            sourceCell={area.cells[0]}
            idPrefix="area-trap"
            onCommit={(next) => {
              void projectStore
                .getState()
                .commit((current) => areaTrapPatchOps(current, target, next))
            }}
          />
          <Button
            variant="destructive"
            size="sm"
            className="self-start"
            onClick={() => {
              void projectStore.getState().commit(areaTrapOps(target, null))
            }}
          >
            Remove trap
          </Button>
        </div>
      )}
    </ContentCard>
  )
}

// --- features ---

export function FeaturesCard({
  document,
  features,
  scope,
  cellHint,
  expanded,
  onToggle,
  onExpand,
}: {
  document: Adventure
  features: readonly FeatureSpec[]
  scope: FeatureScope
  cellHint: Position | null
  expanded: boolean
  onToggle: () => void
  onExpand: () => void
}) {
  const addFeature = () => {
    commitAddFeature(scope, cellHint)
    onExpand()
  }
  const summary =
    features.length === 0 ? null : features.map((feature) => formatFeature(feature)).join(' · ')
  return (
    <ContentCard
      title="Features"
      summary={summary}
      expanded={expanded}
      onToggle={onToggle}
      onAdd={addFeature}
    >
      <div className="flex flex-col gap-2">
        {features.map((feature) => (
          <FeatureEditor
            key={feature.id}
            document={document}
            feature={feature}
            scope={scope}
            cellHint={cellHint}
          />
        ))}
        <Button variant="outline" size="sm" className="self-start" onClick={addFeature}>
          Add feature
        </Button>
      </div>
    </ContentCard>
  )
}

const FEATURE_KINDS: FeatureSpec['kind'][] = ['treasure_cache', 'construction_trick', 'custom']
const COIN_KEYS = ['pp', 'gp', 'ep', 'sp', 'cp'] as const

export function FeatureEditor({
  document,
  feature,
  scope,
  cellHint,
}: {
  document: Adventure
  feature: FeatureSpec
  scope: FeatureScope
  cellHint: Position | null
}) {
  const [open, setOpen] = useState(false)
  const [idError, setIdError] = useState<string | null>(null)
  const [pickingCell, setPickingCell] = useState(false)
  const level = findLevel(document, scope.dungeonId, scope.levelNumber)
  const patch = (value: Partial<FeatureSpec>) => {
    void projectStore
      .getState()
      .commit((current) => featurePatchOps(current, scope, feature.id, value))
  }
  const commitId = (value: string) => {
    setIdError(null)
    void projectStore
      .getState()
      .commit((current) => featurePatchOps(current, scope, feature.id, { id: value }), {
        onError: (error) => {
          // The AddFeature id rules surface inline — a duplicate, empty, or
          // reserved id names its rejection right where it was typed.
          if (error.detail.code === 'op_invariant') {
            setIdError(error.detail.message)
            return true
          }
          return false
        },
      })
  }
  const id = useCommittedField(feature.id, commitId)
  const description = useCommittedField(feature.description, (value) =>
    patch({ description: value }),
  )
  return (
    <div className="rounded-md border" data-testid={`feature-${feature.id}`}>
      <button
        type="button"
        className="flex w-full items-center gap-2 p-2 text-left text-sm"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        {open ? (
          <ChevronDownIcon className="size-4 shrink-0 opacity-50" />
        ) : (
          <ChevronRightIcon className="size-4 shrink-0 opacity-50" />
        )}
        <span className="font-mono text-xs">{feature.id}</span>
        <span className="text-muted-foreground ml-auto truncate font-mono text-xs">
          {formatFeature(feature)}
        </span>
      </button>
      {open && (
        <div className="flex flex-col gap-3 border-t p-2">
          <div className="flex items-end gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`feature-${feature.id}-id`}>Id</Label>
              <Input id={`feature-${feature.id}-id`} className="w-36 font-mono" {...id} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`feature-${feature.id}-kind`}>Kind</Label>
              <select
                id={`feature-${feature.id}-kind`}
                className={SELECT_CLASS}
                value={feature.kind}
                onChange={(event) => {
                  const kind = event.target.value as FeatureSpec['kind']
                  // The spec pins treasure traps to caches, so leaving the
                  // cache kind drops the trap with the kind change — one
                  // batch, one undo step.
                  patch(kind === 'treasure_cache' ? { kind } : { kind, trap: null })
                }}
              >
                {FEATURE_KINDS.map((kind) => (
                  <option key={kind} value={kind}>
                    {kind}
                  </option>
                ))}
              </select>
            </div>
          </div>
          {idError && <p className="text-destructive text-xs">{idError}</p>}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`feature-${feature.id}-description`}>Description</Label>
            <Textarea
              id={`feature-${feature.id}-description`}
              className="min-h-16 font-serif"
              value={description.value}
              onChange={description.onChange}
              onBlur={description.onBlur}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Cell</Label>
            <div className="flex items-center gap-2 text-sm">
              {feature.cell ? (
                <span className="font-mono text-xs">
                  ({feature.cell[0]}, {feature.cell[1]})
                </span>
              ) : (
                <span className="text-muted-foreground text-xs">
                  {scope.areaId === null ? 'no cell — pick one' : 'the whole area'}
                </span>
              )}
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPickingCell((current) => !current)}
              >
                {pickingCell ? 'Cancel pick' : 'Pick cell…'}
              </Button>
              {feature.cell && scope.areaId !== null && (
                <Button variant="outline" size="sm" onClick={() => patch({ cell: null })}>
                  Bind to area
                </Button>
              )}
            </div>
            {pickingCell && level && (
              <MiniLevelPicker
                level={level}
                selected={feature.cell ?? cellHint}
                onPick={(cell) => {
                  setPickingCell(false)
                  patch({ cell })
                }}
              />
            )}
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Items</Label>
            {feature.item_ids.length > 0 && (
              <ul className="flex flex-wrap gap-1.5" aria-label="Cache items">
                {feature.item_ids.map((itemId, index) => (
                  <li
                    key={`${itemId}-${index}`}
                    className="bg-muted flex items-center gap-1 rounded px-1.5 py-0.5 font-mono text-xs"
                  >
                    {itemId}
                    <button
                      type="button"
                      aria-label={`Remove ${itemId}`}
                      onClick={() =>
                        patch({ item_ids: feature.item_ids.filter((_, at) => at !== index) })
                      }
                    >
                      <XIcon className="size-3" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <EquipmentPicker
              onPick={(itemId) => patch({ item_ids: [...feature.item_ids, itemId] })}
            />
          </div>
          <CoinsEditor
            idPrefix={`feature-${feature.id}`}
            coins={feature.coins}
            onCommit={(coins) => patch({ coins })}
          />
          <ValuablesEditor
            valuables={feature.valuables}
            onCommit={(valuables) => patch({ valuables })}
          />
          {feature.kind === 'treasure_cache' && (
            <div className="flex flex-col gap-2">
              <Label>Treasure trap</Label>
              {feature.trap ? (
                <>
                  <TrapBuilder
                    trap={feature.trap}
                    document={document}
                    sourceCell={feature.cell ?? cellHint ?? [0, 0]}
                    idPrefix={`feature-${feature.id}-trap`}
                    onCommit={(trap) => patch({ trap })}
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    className="self-start"
                    onClick={() => patch({ trap: null })}
                  >
                    Remove the trap
                  </Button>
                </>
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  className="self-start"
                  onClick={() => patch({ trap: emptyTrap('treasure') })}
                >
                  Trap this cache
                </Button>
              )}
            </div>
          )}
          <Button
            variant="destructive"
            size="sm"
            className="self-start"
            onClick={() => {
              void projectStore.getState().commit(featureRemoveOps(scope, feature.id))
            }}
          >
            Remove feature
          </Button>
        </div>
      )}
    </div>
  )
}

function CoinsEditor({
  idPrefix,
  coins,
  onCommit,
}: {
  idPrefix: string
  coins: Coins
  onCommit: (coins: Coins) => void
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label>Coins</Label>
      <div className="flex gap-2">
        {COIN_KEYS.map((denomination) => (
          <CoinField
            key={denomination}
            id={`${idPrefix}-${denomination}`}
            label={denomination}
            value={coins[denomination]}
            onCommit={(value) => onCommit({ ...coins, [denomination]: value })}
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
    nonNegativeInteger,
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

function ValuablesEditor({
  valuables,
  onCommit,
}: {
  valuables: readonly ValuableSpec[]
  onCommit: (valuables: ValuableSpec[]) => void
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label>Valuables</Label>
      {valuables.map((valuable, index) => (
        <ValuableRow
          key={index}
          valuable={valuable}
          onCommit={(next) =>
            onCommit(valuables.map((existing, at) => (at === index ? next : existing)))
          }
          onRemove={() => onCommit(valuables.filter((_, at) => at !== index))}
        />
      ))}
      <Button
        variant="outline"
        size="sm"
        className="self-start"
        onClick={() =>
          onCommit([...valuables, { kind: 'gem', name: '', value_gp: 0, weight_coins: 0 }])
        }
      >
        Add valuable
      </Button>
    </div>
  )
}

function ValuableRow({
  valuable,
  onCommit,
  onRemove,
}: {
  valuable: ValuableSpec
  onCommit: (valuable: ValuableSpec) => void
  onRemove: () => void
}) {
  const name = useCommittedField(valuable.name, (value) => onCommit({ ...valuable, name: value }))
  const value = useCommittedField(
    String(valuable.value_gp),
    (draft) => onCommit({ ...valuable, value_gp: Number(draft) }),
    nonNegativeInteger,
  )
  const weight = useCommittedField(
    String(valuable.weight_coins),
    (draft) => onCommit({ ...valuable, weight_coins: Number(draft) }),
    nonNegativeInteger,
  )
  return (
    <div className="flex items-center gap-2">
      <select
        className={SELECT_CLASS}
        aria-label="Valuable kind"
        value={valuable.kind}
        onChange={(event) =>
          onCommit({ ...valuable, kind: event.target.value as ValuableSpec['kind'] })
        }
      >
        <option value="gem">gem</option>
        <option value="jewellery">jewellery</option>
      </select>
      <Input
        className="h-7 flex-1 text-xs"
        placeholder="Name"
        aria-label="Valuable name"
        {...name}
      />
      <Input className="h-7 w-16 font-mono text-xs" aria-label="Value (gp)" {...value} />
      <Input className="h-7 w-14 font-mono text-xs" aria-label="Weight (coins)" {...weight} />
      <Button variant="ghost" size="icon-sm" aria-label="Remove valuable" onClick={onRemove}>
        <XIcon />
      </Button>
    </div>
  )
}

function nonNegativeInteger(draft: string): string | null {
  const parsed = Number(draft.trim() === '' ? '0' : draft)
  return Number.isInteger(parsed) && parsed >= 0 ? String(parsed) : null
}
