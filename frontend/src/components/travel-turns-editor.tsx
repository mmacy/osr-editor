import { useState } from 'react'
import { PlusIcon, XIcon } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { integerInRange, useCommittedField } from '@/hooks/use-committed-field'

// Travel turns is the deliberate dangling-reference surface: free rows —
// dungeon id as text, turns as a number — not a picker over existing
// dungeons. Cross-reference problems are legal while editing; typing a wrong
// id is exactly how validation is watched reacting live.
export function TravelTurnsEditor({
  travelTurns,
  onCommit,
}: {
  travelTurns: Record<string, number>
  onCommit: (travelTurns: Record<string, number>) => void
}) {
  const entries = Object.entries(travelTurns)
  const [draftId, setDraftId] = useState('')
  const [draftTurns, setDraftTurns] = useState('')

  const commitEntries = (next: [string, number][]) => {
    onCommit(Object.fromEntries(next))
  }
  const add = () => {
    const turns = Number(draftTurns)
    if (!draftId || !Number.isFinite(turns) || turns < 0) return
    commitEntries([...entries, [draftId, turns]])
    setDraftId('')
    setDraftTurns('')
  }
  const remove = (index: number) => {
    commitEntries(entries.filter((_, at) => at !== index))
  }

  return (
    <div className="flex flex-col gap-2">
      <Label>Travel turns</Label>
      <p className="text-xs text-muted-foreground">
        Turns from town to each dungeon's entrance, by dungeon id. A wrong id shows up in
        diagnostics until it names a real dungeon.
      </p>
      {entries.map(([dungeonId, turns], index) => (
        <TravelRow
          key={`${index}-${dungeonId}`}
          dungeonId={dungeonId}
          turns={turns}
          onEditId={(value) =>
            commitEntries(entries.map((entry, at) => (at === index ? [value, entry[1]] : entry)))
          }
          onEditTurns={(value) =>
            commitEntries(entries.map((entry, at) => (at === index ? [entry[0], value] : entry)))
          }
          onRemove={() => remove(index)}
        />
      ))}
      <div className="flex gap-2">
        <Input
          className="font-mono"
          value={draftId}
          placeholder="dungeon-id"
          aria-label="Add travel dungeon id"
          onChange={(event) => setDraftId(event.target.value)}
        />
        <Input
          className="w-24 font-mono"
          type="number"
          min={0}
          value={draftTurns}
          placeholder="turns"
          aria-label="Add travel turns"
          onChange={(event) => setDraftTurns(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') add()
          }}
        />
        <Button
          variant="outline"
          size="icon"
          aria-label="Add travel entry"
          onClick={add}
          disabled={!draftId || draftTurns === ''}
        >
          <PlusIcon />
        </Button>
      </div>
    </div>
  )
}

function TravelRow({
  dungeonId,
  turns,
  onEditId,
  onEditTurns,
  onRemove,
}: {
  dungeonId: string
  turns: number
  onEditId: (value: string) => void
  onEditTurns: (value: number) => void
  onRemove: () => void
}) {
  const idField = useCommittedField(dungeonId, onEditId)
  const turnsField = useCommittedField(
    String(turns),
    (value) => onEditTurns(Number(value)),
    integerInRange(0),
  )
  return (
    <div className="flex items-center gap-2">
      <Input className="font-mono" aria-label="Travel dungeon id" {...idField} />
      <Input
        className="w-24 font-mono"
        type="number"
        min={0}
        aria-label="Travel turns"
        {...turnsField}
      />
      <Button variant="ghost" size="icon-sm" aria-label="Remove travel entry" onClick={onRemove}>
        <XIcon />
      </Button>
    </div>
  )
}
