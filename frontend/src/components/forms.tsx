import { ListEditor } from '@/components/list-editor'
import { TravelTurnsEditor } from '@/components/travel-turns-editor'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { useCommittedField } from '@/hooks/use-committed-field'
import { projectStore } from '@/store/project-store'
import type { Adventure } from '@/types'

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
