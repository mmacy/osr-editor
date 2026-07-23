// The quiet author-notes field: sidecar-backed, never the deliverable. Lives
// in the area panel and the level properties for both project types.
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { useCommittedField } from '@/hooks/use-committed-field'
import { projectStore, useProjectStore } from '@/store/project-store'

export function AuthorNotesCard({ address }: { address: string }) {
  // A cascade (rename, renumber, re-key) or an undo can move the note under
  // us; the committed-field hook resyncs the draft when that happens.
  const note = useProjectStore((state) => state.project?.sidecar.notes[address] ?? '')
  const field = useCommittedField(note, (value) => {
    const trimmed = value.trim()
    void projectStore
      .getState()
      .patchSidecar([
        trimmed
          ? { action: 'set_note', address, text: trimmed }
          : { action: 'remove_note', address },
      ])
  })
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={`note-${address}`} className="text-muted-foreground">
        Author notes
      </Label>
      <Textarea
        id={`note-${address}`}
        data-testid="author-notes"
        placeholder="Private notes — never part of the adventure"
        className="min-h-16 text-sm"
        value={field.value}
        onChange={field.onChange}
        onBlur={field.onBlur}
      />
    </div>
  )
}
