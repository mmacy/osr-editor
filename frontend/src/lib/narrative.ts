// Pure narrative-block helpers shared by the block editor and its consumers
// — vitest-testable, no component exports.
import type { NarrativeBlock } from '@/types'

// The seven display/journal beats — everything but the audience fields
// (speaker and guidance render for every carrier).
export const DISPLAY_BEATS = [
  'refusal',
  'success',
  'fired',
  'offer',
  'progress',
  'completion',
  'journal',
] as const

export type NarrativeBeat = (typeof DISPLAY_BEATS)[number]

export const BEAT_LABELS: Record<NarrativeBeat, string> = {
  refusal: 'Refusal',
  success: 'Success',
  fired: 'Fired',
  offer: 'Offer',
  progress: 'Progress',
  completion: 'Completion',
  journal: 'Journal',
}

export function emptyNarrativeBlock(): NarrativeBlock {
  return {
    refusal: '',
    success: '',
    fired: '',
    offer: '',
    progress: '',
    completion: '',
    journal: '',
    guidance: '',
    speaker: '',
  }
}

function isAllEmpty(block: NarrativeBlock): boolean {
  return Object.values(block).every((value) => value === '')
}

// The one commit shaping rule: all-empty commits null rather than an empty
// NarrativeBlock, keeping unauthored carriers canonical; anything else
// commits the whole block. (An *arriving* all-empty block is left alone until
// the card's next commit — the editor never rewrites unprompted.)
export function normalizeBlock(block: NarrativeBlock): NarrativeBlock | null {
  return isAllEmpty(block) ? null : block
}
