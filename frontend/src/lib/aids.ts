// The authoring aids' pure client logic: the stocking report's copy, the derive-
// from-HD form fills, and the treasure preview request shape. UI-free so vitest
// checks it without a DOM.
import type {
  AreaTreasureSpec,
  MonsterHitDice,
  StatblockPreviewRequest,
  StockFollowUp,
  StockRoll,
  TreasurePreviewRequest,
} from '@/types'

// One follow-up badge's honest copy — what the dice left to the author. The trap
// steer (a trap over the treasure) is added by the caller when treasure rolled too.
export function followUpLabel(followUp: StockFollowUp): string {
  switch (followUp.kind) {
    case 'special':
      return 'Special — describe by hand'
    case 'npc_party':
      return `NPC party — author by hand (${followUp.npc_kind} × ${followUp.npc_count})`
    case 'trap_design':
      return 'Trap — design it in the trap card'
    case 'no_lair_treasure':
      return "No lair treasure — the monster's type yields none"
  }
}

// The trap follow-up names the SRD's steer when treasure also rolled: the trap may
// be set on the treasure itself, which means restructuring the unguarded spec into
// a trapped cache by hand. The placeholder stays a room trap.
export function trapFollowUpNote(roll: StockRoll): string | null {
  const hasTrap = roll.follow_ups.some((followUp) => followUp.kind === 'trap_design')
  if (hasTrap && roll.treasure_present) {
    return 'The SRD lets the trap guard the treasure — move it onto a trapped cache by hand if you like.'
  }
  return null
}

// The one-line contents summary a report row renders: the contents kind plus the
// module-notation summaries the backend resolved.
export function stockRollLine(roll: StockRoll): string {
  return [contentsLabel(roll), ...roll.summary].join(' · ')
}

function contentsLabel(roll: StockRoll): string {
  if (roll.contents === 'monster') return 'Monster'
  if (roll.contents === 'trap') return 'Trap'
  if (roll.contents === 'special') return 'Special'
  return roll.treasure_present ? 'Empty (treasure)' : 'Empty'
}

// The undo-does-not-rewind-the-dice note the report always shows.
export const STOCKING_UNDO_NOTE =
  'Undo restores the rooms, but the dice stay advanced — re-rolling yields new content, never a replay.'

// The treasure preview request for an area's committed treasure spec — letters or
// the unguarded band, mirroring AreaTreasureSpec's own shape.
export function treasurePreviewFor(
  treasure: AreaTreasureSpec,
  tier: 'basic' | 'expert',
  levelNumber: number,
): TreasurePreviewRequest {
  const base = { kind: 'treasure' as const, tier, samples: 3 }
  if (treasure.unguarded) {
    return { ...base, letters: [], unguarded_level: levelNumber }
  }
  return { ...base, letters: [...treasure.letters], unguarded_level: null }
}

// The statblock preview request for a hit-dice value — the derive-from-HD button's payload.
export function statblockPreviewFor(hitDice: MonsterHitDice): StatblockPreviewRequest {
  return { kind: 'statblock', hit_dice: hitDice }
}
