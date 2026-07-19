// The author-notes card: a quiet per-entity note field backed by the sidecar,
// for both project types. Notes live in the sidecar, never the deliverable. The
// field is uncontrolled and keyed to the stored value, so an external change (a
// cascade re-key, an undo) remounts it with the fresh text; typing flushes on
// blur.
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { projectStore, useProjectStore } from '@/store/project-store'

export function AuthorNotes({ address }: { address: string }) {
  const stored = useProjectStore((state) => state.project?.sidecar.notes[address] ?? '')

  const flush = (raw: string) => {
    const next = raw.trim()
    if (next === stored) return
    void projectStore
      .getState()
      .patchSidecar([
        next ? { patch: 'set_note', address, note: next } : { patch: 'remove_note', address },
      ])
  }

  return (
    <div className="flex flex-col gap-1">
      <Label htmlFor="author-note" className="text-xs text-muted-foreground">
        Author notes
      </Label>
      <Textarea
        key={`${address}:${stored}`}
        id="author-note"
        defaultValue={stored}
        placeholder="Notes for yourself — never published."
        onBlur={(event) => flush(event.target.value)}
        className="min-h-16 text-sm"
      />
    </div>
  )
}
