import { useState } from 'react'

import { ListEditor } from '@/components/list-editor'
import { ProseAssistant } from '@/components/prose-assistant'
import { TravelTurnsEditor } from '@/components/travel-turns-editor'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { integerInRange, useCommittedField } from '@/hooks/use-committed-field'
import { projectStore, useProjectStore } from '@/store/project-store'
import type { Adventure, PartySpec } from '@/types'

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

// A party edit commits the whole PartySpec. A field edit is a builder over
// the document current at post time, so it never revives a party that
// another tab cleared in the meantime.
function commitParty(update: (current: PartySpec) => PartySpec | null): Promise<boolean> {
  return projectStore
    .getState()
    .commit((document) =>
      document.party
        ? [{ op: 'set_adventure_field', field: 'party', value: update(document.party) }]
        : [],
    )
}

function commitNewParty(): void {
  void projectStore.getState().commit([
    {
      op: 'set_adventure_field',
      field: 'party',
      value: { min_level: 1, max_level: 1, min_size: null, max_size: null },
    },
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
  const projectId = useProjectStore((state) => state.project?.id ?? null)
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
      <div className="flex flex-col gap-2">
        <ListEditor
          label="Hooks"
          serif
          items={document.hooks}
          placeholder="A rumor, a debt, a missing miller…"
          onCommit={commitHooks}
        />
        {projectId && (
          <ProseAssistant
            projectId={projectId}
            target={{ kind: 'hooks' }}
            onAcceptHooks={(hooks) =>
              void projectStore
                .getState()
                .commit([{ op: 'set_adventure_field', field: 'hooks', value: hooks }])
            }
          />
        )}
      </div>
      <PartyEditor party={document.party ?? null} />
    </section>
  )
}

// A size field may be empty, which commits the size as unstated (null).
function sizeOrEmpty(draft: string): string | null {
  return draft.trim() === '' ? '' : integerInRange(1)(draft)
}

function PartyEditor({ party }: { party: PartySpec | null }) {
  // The server checks the ranges (a highest level below the lowest, say). A
  // rejected edit bumps the generation, which remounts the fields so they
  // show the document's party again instead of the refused draft.
  const [generation, setGeneration] = useState(0)
  const commitField = (key: keyof PartySpec, value: number | null) => {
    void commitParty((current) => ({ ...current, [key]: value })).then((committed) => {
      if (!committed) setGeneration((count) => count + 1)
    })
  }
  return (
    <div className="flex flex-col gap-2">
      <Label>Party</Label>
      <p className="text-xs text-muted-foreground">
        The character levels and number of characters the adventure is written for. Leave a number
        of characters empty when the adventure doesn't say.
      </p>
      {party ? (
        <>
          <div key={generation} className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <PartyNumberField
              id="party-min-level"
              label="Lowest level"
              value={party.min_level}
              normalize={integerInRange(1)}
              onCommit={(value) => commitField('min_level', value)}
            />
            <PartyNumberField
              id="party-max-level"
              label="Highest level"
              value={party.max_level}
              normalize={integerInRange(1)}
              onCommit={(value) => commitField('max_level', value)}
            />
            <PartyNumberField
              id="party-min-size"
              label="Fewest characters"
              value={party.min_size ?? null}
              normalize={sizeOrEmpty}
              onCommit={(value) => commitField('min_size', value)}
            />
            <PartyNumberField
              id="party-max-size"
              label="Most characters"
              value={party.max_size ?? null}
              normalize={sizeOrEmpty}
              onCommit={(value) => commitField('max_size', value)}
            />
          </div>
          <div>
            <Button variant="outline" size="sm" onClick={() => void commitParty(() => null)}>
              Remove party
            </Button>
          </div>
        </>
      ) : (
        <div>
          <Button variant="outline" size="sm" onClick={commitNewParty}>
            Add party
          </Button>
        </div>
      )}
    </div>
  )
}

function PartyNumberField({
  id,
  label,
  value,
  normalize,
  onCommit,
}: {
  id: string
  label: string
  value: number | null
  normalize: (draft: string) => string | null
  onCommit: (value: number | null) => void
}) {
  const field = useCommittedField(
    value === null ? '' : String(value),
    (draft) => onCommit(draft === '' ? null : Number(draft)),
    normalize,
  )
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id} className="font-normal">
        {label}
      </Label>
      <Input id={id} className="font-mono" type="number" min={1} {...field} />
    </div>
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
