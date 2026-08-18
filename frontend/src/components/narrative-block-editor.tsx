// The shared narrative-block editor: the carrier declares its read beats
// (a gate's are refusal and success; a trigger's fired and journal; a
// quest's offer and completion; an objective's offer and progress), and
// speaker and guidance render for every carrier — attribution and narrator
// steering are audience fields, not display beats.
//
// Non-empty beats *outside* the carrier's read set — a foreign block carrying
// `fired` on a gate — warn by name with a one-patch clear as the offered
// repair: never silently rewritten, never hidden (the warn-and-name posture).
// A block whose every field is empty commits as null rather than an empty
// NarrativeBlock, keeping unauthored carriers canonical; an *arriving*
// all-empty block is left alone until the card's next commit.
//
// Commits are *updates*, not values: each gesture emits a function over the
// committed block, applied by the host inside its commit queue — the
// compute-in-the-queue discipline, without which a second beat committed
// behind an in-flight first would silently revert it.
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { useCommittedField } from '@/hooks/use-committed-field'
import {
  BEAT_LABELS,
  DISPLAY_BEATS,
  emptyNarrativeBlock,
  normalizeBlock,
  type NarrativeBeat,
} from '@/lib/narrative'
import type { NarrativeBlock } from '@/types'

export type NarrativeBlockUpdate = (committed: NarrativeBlock | null) => NarrativeBlock | null

export function NarrativeBlockEditor({
  block,
  beats,
  idPrefix,
  onCommit,
}: {
  block: NarrativeBlock | null
  beats: readonly NarrativeBeat[]
  idPrefix: string
  onCommit: (update: NarrativeBlockUpdate) => void
}) {
  const current = block ?? emptyNarrativeBlock()
  const commitField = (field: keyof NarrativeBlock, value: string) => {
    onCommit((committed) =>
      normalizeBlock({ ...(committed ?? emptyNarrativeBlock()), [field]: value }),
    )
  }
  const unreadBeats = DISPLAY_BEATS.filter((beat) => !beats.includes(beat) && current[beat] !== '')
  return (
    <div className="flex flex-col gap-3" aria-label="Narrative">
      {beats.map((beat) => (
        <BeatField
          key={beat}
          id={`${idPrefix}-${beat}`}
          label={BEAT_LABELS[beat]}
          value={current[beat]}
          onCommit={(value) => commitField(beat, value)}
        />
      ))}
      <SpeakerField
        id={`${idPrefix}-speaker`}
        value={current.speaker}
        onCommit={(value) => commitField('speaker', value)}
      />
      <GuidanceField
        id={`${idPrefix}-guidance`}
        value={current.guidance}
        onCommit={(value) => commitField('guidance', value)}
      />
      {unreadBeats.map((beat) => (
        <div key={beat} className="flex flex-col items-start gap-1.5" aria-label="Unread beat">
          <p className="text-xs text-amber-700 dark:text-amber-400">
            This block holds <span className="font-mono">{beat}</span> text, which the engine never
            reads for this carrier: <span className="font-serif">“{current[beat]}”</span>
          </p>
          <Button variant="outline" size="sm" onClick={() => commitField(beat, '')}>
            Clear the {BEAT_LABELS[beat].toLowerCase()} text
          </Button>
        </div>
      ))}
    </div>
  )
}

// Read-aloud prose takes the serif voice; the committed-field gesture is the
// standing one-batch-per-commit grain.
function BeatField({
  id,
  label,
  value,
  onCommit,
}: {
  id: string
  label: string
  value: string
  onCommit: (value: string) => void
}) {
  const field = useCommittedField(value, onCommit)
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Textarea
        id={id}
        className="min-h-16 font-serif"
        value={field.value}
        onChange={field.onChange}
        onBlur={field.onBlur}
      />
    </div>
  )
}

// Attribution — the voice a renderer credits the line to.
function SpeakerField({
  id,
  value,
  onCommit,
}: {
  id: string
  value: string
  onCommit: (value: string) => void
}) {
  const field = useCommittedField(value, onCommit)
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>Speaker</Label>
      <Input id={id} className="font-serif" {...field} />
    </div>
  )
}

// Guidance is narrator steering, never read aloud — the UI voice, not the
// serif.
function GuidanceField({
  id,
  value,
  onCommit,
}: {
  id: string
  value: string
  onCommit: (value: string) => void
}) {
  const field = useCommittedField(value, onCommit)
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>Guidance</Label>
      <Textarea
        id={id}
        className="min-h-12"
        value={field.value}
        onChange={field.onChange}
        onBlur={field.onBlur}
      />
      <p className="text-muted-foreground text-xs">
        Steering for a narrating front end — never shown to players verbatim.
      </p>
    </div>
  )
}
