import { AlertCircleIcon } from 'lucide-react'

import { ListEditor } from '@/components/list-editor'
import { TravelTurnsEditor } from '@/components/travel-turns-editor'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { integerInRange, useCommittedField } from '@/hooks/use-committed-field'
import { projectStore } from '@/store/project-store'
import type { Adventure, WanderingSpec } from '@/types'

// Every form commits through the store's single-flight queue: one committed
// field, one op batch, one undo step. Scalar sets carry their value directly;
// anything whose payload derives from the document (a whole tuple or mapping,
// a spread wandering spec) commits a BUILDER the queue evaluates against the
// document current at post time — see OpsInput in the store.

function commitScalar(field: 'name' | 'description', value: string): void {
  void projectStore.getState().commit([{ op: 'set_adventure_field', field, value }])
}

function commitTownScalar(field: 'name' | 'description', value: string): void {
  void projectStore.getState().commit([{ op: 'set_town_field', field, value }])
}

function commitHooks(update: (current: string[]) => string[]): void {
  void projectStore
    .getState()
    .commit((document) => [
      { op: 'set_adventure_field', field: 'hooks', value: update([...document.hooks]) },
    ])
}

function commitServices(update: (current: string[]) => string[]): void {
  void projectStore
    .getState()
    .commit((document) => [
      { op: 'set_town_field', field: 'services', value: update([...document.town.services]) },
    ])
}

function commitTravelTurns(
  update: (current: Record<string, number>) => Record<string, number>,
): void {
  void projectStore.getState().commit((document) => [
    {
      op: 'set_town_field',
      field: 'travel_turns',
      value: update({ ...document.town.travel_turns }),
    },
  ])
}

export function AdventureForm({ document }: { document: Adventure }) {
  const name = useCommittedField(document.name, (value) => commitScalar('name', value))
  const description = useCommittedField(document.description, (value) =>
    commitScalar('description', value),
  )
  return (
    <section aria-label="Adventure" className="flex max-w-2xl flex-col gap-6">
      <h2 className="font-serif text-xl font-semibold">Adventure</h2>
      <div className="flex flex-col gap-2">
        <Label htmlFor="adventure-name">Name</Label>
        <Input id="adventure-name" className="font-serif" {...name} />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="adventure-description">Description</Label>
        <Textarea
          id="adventure-description"
          className="min-h-32 font-serif"
          value={description.value}
          onChange={description.onChange}
          onBlur={description.onBlur}
        />
      </div>
      <ListEditor
        label="Hooks"
        serif
        items={document.hooks}
        placeholder="A rumor, a debt, a missing miller…"
        onCommit={commitHooks}
      />
    </section>
  )
}

export function TownForm({ document }: { document: Adventure }) {
  const name = useCommittedField(document.town.name, (value) => commitTownScalar('name', value))
  const description = useCommittedField(document.town.description, (value) =>
    commitTownScalar('description', value),
  )
  return (
    <section aria-label="Town" className="flex max-w-2xl flex-col gap-6">
      <h2 className="font-serif text-xl font-semibold">Town</h2>
      <div className="flex flex-col gap-2">
        <Label htmlFor="town-name">Name</Label>
        <Input id="town-name" className="font-serif" {...name} />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="town-description">Description</Label>
        <Textarea
          id="town-description"
          className="min-h-24 font-serif"
          value={description.value}
          onChange={description.onChange}
          onBlur={description.onBlur}
        />
      </div>
      <ListEditor
        label="Services"
        items={document.town.services}
        placeholder="Inn, temple, trading post…"
        onCommit={commitServices}
      />
      <TravelTurnsEditor travelTurns={document.town.travel_turns} onCommit={commitTravelTurns} />
    </section>
  )
}

export function LevelForm({
  document,
  dungeonId,
  levelNumber,
}: {
  document: Adventure
  dungeonId: string
  levelNumber: number
}) {
  const dungeon = document.dungeons.find((candidate) => candidate.id === dungeonId)
  const level = dungeon?.levels.find((candidate) => candidate.number === levelNumber)
  if (!dungeon || !level) {
    return <p className="text-sm text-muted-foreground">This level no longer exists.</p>
  }
  const wandering = level.wandering

  // Each field commits only its own change; the rest of the spec — the other
  // field and the inline table phase 1 must never destroy — is read from the
  // post-time document inside the builder.
  const commitWanderingPatch = (
    patch: Partial<Pick<WanderingSpec, 'chance_in_six' | 'interval_turns'>>,
  ) => {
    void projectStore.getState().commit((current) => {
      const target = current.dungeons
        .find((candidate) => candidate.id === dungeonId)
        ?.levels.find((candidate) => candidate.number === levelNumber)
      if (!target) return []
      return [
        {
          op: 'set_wandering',
          dungeon_id: dungeonId,
          level_number: levelNumber,
          wandering: { ...target.wandering, ...patch },
        },
      ]
    })
  }

  return (
    <section aria-label={`Level ${levelNumber}`} className="flex max-w-2xl flex-col gap-6">
      <h2 className="font-serif text-xl font-semibold">
        {dungeon.name || <span className="font-mono text-lg">{dungeon.id}</span>} — level{' '}
        <span className="font-mono">{levelNumber}</span>
      </h2>
      <p className="text-sm text-muted-foreground">
        Grid{' '}
        <span className="font-mono">
          {level.width}×{level.height}
        </span>
        ; the map editor arrives in a later release.
      </p>
      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-medium">Wandering monsters</h3>
        <div className="flex items-end gap-4">
          <WanderingNumberField
            id="wandering-chance"
            label="Chance-in-six"
            value={wandering.chance_in_six}
            min={0}
            max={6}
            onCommit={(value) => commitWanderingPatch({ chance_in_six: value })}
          />
          <WanderingNumberField
            id="wandering-interval"
            label="Check interval (turns)"
            value={wandering.interval_turns}
            min={1}
            onCommit={(value) => commitWanderingPatch({ interval_turns: value })}
          />
        </div>
        {wandering.table && (
          <Alert>
            <AlertCircleIcon />
            <AlertTitle>This level has an inline encounter table</AlertTitle>
            <AlertDescription>
              The table (<span className="font-mono">{wandering.table.id}</span>) is preserved
              unchanged; its editor arrives in a later release.
            </AlertDescription>
          </Alert>
        )}
      </div>
    </section>
  )
}

function WanderingNumberField({
  id,
  label,
  value,
  min,
  max,
  onCommit,
}: {
  id: string
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
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} className="w-32 font-mono" type="number" min={min} max={max} {...field} />
    </div>
  )
}
