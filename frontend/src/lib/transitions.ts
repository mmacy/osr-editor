// The transition vocabulary's user-facing labels and the add-dialog's
// defaults. Labels are display only — option values, specs, and ops carry the
// schema's raw enum strings untouched.
import type { Adventure, TransitionSpec } from '@/types'

export const KIND_LABELS: Record<TransitionSpec['kind'], string> = {
  stairs_down: 'Stairs down',
  stairs_up: 'Stairs up',
  trapdoor: 'Trapdoor',
  chute: 'Chute',
}

export const FACING_LABELS: Record<TransitionSpec['to_facing'], string> = {
  north: 'North',
  east: 'East',
  south: 'South',
  west: 'West',
}

// The add-dialog's initial target within the source dungeon: the nearest
// level below, else the nearest above, else the source level itself (a
// one-level dungeon still needs a valid selection).
export function defaultTargetLevel(
  document: Adventure,
  dungeonId: string,
  levelNumber: number,
): number | null {
  const home = document.dungeons.find((dungeon) => dungeon.id === dungeonId)
  if (!home) return null
  const numbers = home.levels.map((level) => level.number).sort((a, b) => a - b)
  return (
    numbers.find((number) => number > levelNumber) ??
    numbers.filter((number) => number < levelNumber).at(-1) ??
    numbers[0] ??
    null
  )
}

// The kind that matches the travel direction: down to a higher level number,
// up to a lower one. Cross-dungeon travel and a same-level target carry no
// vertical direction, so they keep the stairs-down default.
export function defaultKind(
  sourceLevel: number,
  targetLevel: number | null,
  sameDungeon: boolean,
): TransitionSpec['kind'] {
  if (sameDungeon && targetLevel !== null && targetLevel < sourceLevel) return 'stairs_up'
  return 'stairs_down'
}
