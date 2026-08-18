// The shared ordered consequence list over the closed nine-command union:
// add/remove/edit rows of ConsequenceBuilder with per-row reorder — order is
// execution order for a trigger's consequences and a quest's rewards alike
// (both issue in authored order), so the rows carry up/down and the list is
// form state committed whole through the carrier's set op, no op of its own.
// Typed over the committed command tuple, not any carrier spec: the host
// adapts its whole-value commit around the tuple update, keeping the
// compute-in-the-queue discipline on its own side of the prop. `noun` is the
// word the host's controls speak ("consequence" / "reward"); `help` is the
// host's own copy under the heading.
import { useState, type ReactNode } from 'react'
import { ArrowDownIcon, ArrowUpIcon, PlusIcon, XIcon } from 'lucide-react'

import { ConsequenceBuilder } from '@/components/consequence-builder'
import { Button } from '@/components/ui/button'
import type { Adventure, ConsequenceCommand } from '@/types'

export type ConsequenceTupleUpdate = (
  committed: readonly ConsequenceCommand[],
) => ConsequenceCommand[] | null

export function ConsequenceList({
  commands,
  document,
  idPrefix,
  noun,
  title,
  help,
  onUpdate,
}: {
  commands: readonly ConsequenceCommand[]
  document: Adventure
  idPrefix: string
  noun: string
  title: string
  help: ReactNode
  onUpdate: (build: ConsequenceTupleUpdate) => void
}) {
  const [drafting, setDrafting] = useState(false)
  const replaceAt = (index: number, command: ConsequenceCommand) =>
    onUpdate((committed) => {
      if (index >= committed.length) return null
      const next = [...committed]
      next[index] = command
      return next
    })
  const removeAt = (index: number) =>
    onUpdate((committed) => {
      if (index >= committed.length) return null
      return committed.filter((_, position) => position !== index)
    })
  const moveTo = (index: number, nextIndex: number) =>
    onUpdate((committed) => {
      if (index >= committed.length || nextIndex >= committed.length) return null
      const next = [...committed]
      const [moved] = next.splice(index, 1)
      next.splice(nextIndex, 0, moved)
      return next
    })
  return (
    <div className="flex flex-col gap-2" aria-label={title}>
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium">{title}</h3>
        {!drafting && (
          <Button variant="outline" size="sm" onClick={() => setDrafting(true)}>
            <PlusIcon /> Add {noun}
          </Button>
        )}
      </div>
      <p className="text-muted-foreground text-xs">{help}</p>
      {commands.map((command, index) => (
        <div key={index} className="flex flex-col gap-2 rounded-md border p-2">
          <div className="flex items-center justify-end gap-1">
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={`Move ${noun} ${index + 1} up`}
              disabled={index === 0}
              onClick={() => moveTo(index, index - 1)}
            >
              <ArrowUpIcon />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={`Move ${noun} ${index + 1} down`}
              disabled={index === commands.length - 1}
              onClick={() => moveTo(index, index + 1)}
            >
              <ArrowDownIcon />
            </Button>
            <button
              type="button"
              aria-label={`Remove ${noun} ${index + 1}`}
              onClick={() => removeAt(index)}
            >
              <XIcon className="size-3" />
            </button>
          </div>
          <ConsequenceBuilder
            command={command}
            document={document}
            idPrefix={`${idPrefix}-${index}`}
            onCommit={(next) => replaceAt(index, next)}
          />
        </div>
      ))}
      {drafting && (
        <div className="flex flex-col gap-2 rounded-md border border-dashed p-2">
          <div className="flex justify-end">
            <button
              type="button"
              aria-label={`Discard new ${noun}`}
              onClick={() => setDrafting(false)}
            >
              <XIcon className="size-3" />
            </button>
          </div>
          <ConsequenceBuilder
            command={null}
            document={document}
            idPrefix={`${idPrefix}-new`}
            onCommit={(command) => {
              setDrafting(false)
              onUpdate((committed) => [...committed, command])
            }}
          />
        </div>
      )}
    </div>
  )
}
