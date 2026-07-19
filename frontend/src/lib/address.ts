// The diagnostics address grammar, consumed: `/`-joined `kind:value` segments
// with percent-encoded values, as pinned by the backend's validation tier.
// Navigation resolves against the document — an address that parses to nothing
// in the document renders unnavigable rather than guessing.
import type { Adventure } from '@/types'

export type NavTarget =
  | { kind: 'adventure' }
  | { kind: 'town' }
  | { kind: 'level'; dungeonId: string; levelNumber: number }

function segmentValue(segment: string, expected: string): string | null {
  const prefix = `${expected}:`
  if (!segment.startsWith(prefix)) return null
  try {
    return decodeURIComponent(segment.slice(prefix.length))
  } catch {
    return null
  }
}

export function navTargetFor(
  address: string | null | undefined,
  document: Adventure,
): NavTarget | null {
  if (!address) return null
  if (address === 'town') return { kind: 'town' }
  // Bundled monsters are adventure scope; their own surface is phase 4's.
  if (address === 'monsters') return { kind: 'adventure' }

  const segments = address.split('/')
  const dungeonId = segmentValue(segments[0], 'dungeon')
  if (dungeonId === null) return null
  const dungeon = document.dungeons.find((candidate) => candidate.id === dungeonId)
  if (!dungeon) return null

  if (segments.length === 1) {
    // A dungeon-scope finding (a missing entrance) navigates to the dungeon's
    // first level — the nearest form phase 1 has.
    return { kind: 'level', dungeonId, levelNumber: dungeon.levels[0].number }
  }

  const levelValue = segmentValue(segments[1], 'level')
  if (levelValue === null) return null
  const levelNumber = Number(levelValue)
  if (!dungeon.levels.some((level) => level.number === levelNumber)) return null
  // Area-scope addresses (from opened richer documents) navigate to their
  // level; the area surface is phase 3's.
  return { kind: 'level', dungeonId, levelNumber }
}
