// The printed-notation stat-block form: the raw block's fields, entered verbatim
// from the printed page. A blank field is untouched; submit builds a
// StatBlockPatch and hands it to the caller.
import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { AC_NOTATIONS, buildStatBlockPatch, STATBLOCK_FIELDS } from '@/lib/statblock'
import type { StatBlockPatch } from '@/types'

export function StatBlockForm({
  onSubmit,
  onCancel,
}: {
  onSubmit: (patch: StatBlockPatch) => void
  onCancel: () => void
}) {
  const [form, setForm] = useState<Record<string, string>>({})
  const set = (key: string, value: string) => setForm((current) => ({ ...current, [key]: value }))

  return (
    <form
      className="mt-2 flex flex-col gap-2"
      onSubmit={(event) => {
        event.preventDefault()
        onSubmit(buildStatBlockPatch(form))
      }}
    >
      {STATBLOCK_FIELDS.map((field) => (
        <div key={field.key} className="flex flex-col gap-0.5">
          <Label htmlFor={`sb-${field.key}`} className="text-[11px]">
            {field.label}
          </Label>
          {field.kind === 'lines' ? (
            <Textarea
              id={`sb-${field.key}`}
              value={form[field.key] ?? ''}
              placeholder={field.placeholder}
              onChange={(event) => set(field.key, event.target.value)}
              className="min-h-14 text-xs"
            />
          ) : field.kind === 'notation' ? (
            <select
              id={`sb-${field.key}`}
              value={form[field.key] ?? ''}
              onChange={(event) => set(field.key, event.target.value)}
              className="h-7 rounded-md border bg-background px-2 text-xs"
            >
              <option value="">—</option>
              {AC_NOTATIONS.map((notation) => (
                <option key={notation} value={notation}>
                  {notation}
                </option>
              ))}
            </select>
          ) : (
            <Input
              id={`sb-${field.key}`}
              value={form[field.key] ?? ''}
              placeholder={field.placeholder}
              inputMode={field.kind === 'number' ? 'numeric' : undefined}
              onChange={(event) => set(field.key, event.target.value)}
              className="h-7 text-xs"
            />
          )}
        </div>
      ))}
      <div className="flex items-center gap-2">
        <Button type="submit" size="sm">
          Apply patch
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  )
}
