import { AlertCircleIcon } from 'lucide-react'

import { ListEditor } from '@/components/list-editor'
import { TravelTurnsEditor } from '@/components/travel-turns-editor'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { integerInRange, useCommittedField } from '@/hooks/use-committed-field'
import { projectStore } from '@/store/project-store'
import type { Adventure, SetAdventureField, SetTownField } from '@/types'

// Every form commits through the store's single-flight queue: one committed
// field, one op batch, one undo step.

function commitAdventureField(field: SetAdventureField['field'], value: string | string[]): void {
  void projectStore.getState().commit([{ op: 'set_adventure_field', field, value }])
}

function commitTownField(
  field: SetTownField['field'],
  value: string | string[] | Record<string, number>,
): void {
  void projectStore.getState().commit([{ op: 'set_town_field', field, value }])
}

export function AdventureForm({ document }: { document: Adventure }) {
  const name = useCommittedField(document.name, (value) => commitAdventureField('name', value))
  const description = useCommittedField(document.description, (value) =>
    commitAdventureField('description', value),
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
        onCommit={(hooks) => commitAdventureField('hooks', hooks)}
      />
    </section>
  )
}

export function TownForm({ document }: { document: Adventure }) {
  const name = useCommittedField(document.town.name, (value) => commitTownField('name', value))
  const description = useCommittedField(document.town.description, (value) =>
    commitTownField('description', value),
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
        onCommit={(services) => commitTownField('services', services)}
      />
      <TravelTurnsEditor
        travelTurns={document.town.travel_turns}
        onCommit={(travelTurns) => commitTownField('travel_turns', travelTurns)}
      />
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

  const commitWandering = (chanceInSix: number, intervalTurns: number) => {
    void projectStore.getState().commit([
      {
        op: 'set_wandering',
        dungeon_id: dungeonId,
        level_number: levelNumber,
        // The form authors only the chance and interval; an inline table on an
        // opened document rides through unchanged — phase 1 must never destroy
        // a table it can't author.
        wandering: { ...wandering, chance_in_six: chanceInSix, interval_turns: intervalTurns },
      },
    ])
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
            onCommit={(value) => commitWandering(value, wandering.interval_turns)}
          />
          <WanderingNumberField
            id="wandering-interval"
            label="Check interval (turns)"
            value={wandering.interval_turns}
            min={1}
            onCommit={(value) => commitWandering(wandering.chance_in_six, value)}
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
