import { useState } from 'react'
import { ArrowDownIcon, ArrowUpIcon, PlusIcon, XIcon } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useCommittedField } from '@/hooks/use-committed-field'
import { cn } from '@/lib/utils'

// An ordered list editor: add, remove, edit, reorder. Every gesture commits
// the whole tuple as one batch — one undo step by construction.
export function ListEditor({
  label,
  items,
  onCommit,
  serif = false,
  placeholder,
}: {
  label: string
  items: readonly string[]
  onCommit: (items: string[]) => void
  serif?: boolean
  placeholder?: string
}) {
  const [draft, setDraft] = useState('')
  const add = () => {
    if (!draft) return
    onCommit([...items, draft])
    setDraft('')
  }
  const remove = (index: number) => {
    onCommit(items.filter((_, at) => at !== index))
  }
  const move = (index: number, delta: -1 | 1) => {
    const target = index + delta
    if (target < 0 || target >= items.length) return
    const next = [...items]
    ;[next[index], next[target]] = [next[target], next[index]]
    onCommit(next)
  }
  const edit = (index: number, value: string) => {
    onCommit(items.map((item, at) => (at === index ? value : item)))
  }

  return (
    <div className="flex flex-col gap-2">
      <Label>{label}</Label>
      {items.map((item, index) => (
        <ListRow
          // Index keys are correct here: rows are positional and commit-driven.
          key={`${index}-${item}`}
          item={item}
          serif={serif}
          onEdit={(value) => edit(index, value)}
          onRemove={() => remove(index)}
          onMoveUp={index > 0 ? () => move(index, -1) : undefined}
          onMoveDown={index < items.length - 1 ? () => move(index, 1) : undefined}
        />
      ))}
      <div className="flex gap-2">
        <Input
          className={cn(serif && 'font-serif')}
          value={draft}
          placeholder={placeholder}
          aria-label={`Add ${label.toLowerCase()} entry`}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') add()
          }}
        />
        <Button
          variant="outline"
          size="icon"
          aria-label={`Add to ${label.toLowerCase()}`}
          onClick={add}
          disabled={!draft}
        >
          <PlusIcon />
        </Button>
      </div>
    </div>
  )
}

function ListRow({
  item,
  serif,
  onEdit,
  onRemove,
  onMoveUp,
  onMoveDown,
}: {
  item: string
  serif: boolean
  onEdit: (value: string) => void
  onRemove: () => void
  onMoveUp?: () => void
  onMoveDown?: () => void
}) {
  const field = useCommittedField(item, onEdit)
  return (
    <div className="flex items-center gap-1">
      <Input className={cn(serif && 'font-serif')} {...field} />
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Move up"
        onClick={onMoveUp}
        disabled={!onMoveUp}
      >
        <ArrowUpIcon />
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Move down"
        onClick={onMoveDown}
        disabled={!onMoveDown}
      >
        <ArrowDownIcon />
      </Button>
      <Button variant="ghost" size="icon-sm" aria-label="Remove" onClick={onRemove}>
        <XIcon />
      </Button>
    </div>
  )
}
