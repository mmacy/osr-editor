// The diagnostics address grammar, consumed: `/`-joined `kind:value` segments
// with percent-encoded values, as pinned by the backend's producers.
// Navigation resolves against the document — an address that parses to nothing
// in the document renders unnavigable rather than guessing.
import type { Adventure, LevelSpec, Position } from '@/types'

// What a level navigation focuses once the map is showing. `properties` is
// the level-scope landing for findings without a geometry segment (a
// wandering row, a missing entrance) — their editing surface is the level
// properties dialog.
export type LevelFocus =
  | { type: 'cell'; cell: Position }
  | { type: 'edge'; key: string }
  | { type: 'area'; areaId: string }
  | { type: 'properties' }

export type NavTarget =
  | { kind: 'adventure' }
  | { kind: 'town' }
  | { kind: 'level'; dungeonId: string; levelNumber: number; focus?: LevelFocus }

function segmentValue(segment: string, expected: string): string | null {
  const prefix = `${expected}:`
  if (!segment.startsWith(prefix)) return null
  try {
    return decodeURIComponent(segment.slice(prefix.length))
  } catch {
    return null
  }
}

function parseCell(value: string, level: LevelSpec): Position | null {
  const parts = value.split(',')
  if (parts.length !== 2) return null
  const x = Number(parts[0])
  const y = Number(parts[1])
  if (!Number.isInteger(x) || !Number.isInteger(y)) return null
  if (x < 0 || x >= level.width || y < 0 || y >= level.height) return null
  return [x, y]
}

function parseFocus(segment: string, level: LevelSpec): LevelFocus | null {
  const areaId = segmentValue(segment, 'area')
  if (areaId !== null) {
    return level.areas.some((area) => area.id === areaId) ? { type: 'area', areaId } : null
  }
  // The geometry segments are numeric grammar — unambiguous without encoding;
  // the general parse rule stays "kind up to the first `:`, value the rest".
  if (segment.startsWith('cell:')) {
    const cell = parseCell(segment.slice('cell:'.length), level)
    return cell ? { type: 'cell', cell } : null
  }
  if (segment.startsWith('edge:')) {
    const key = segment.slice('edge:'.length)
    return key in level.edges ? { type: 'edge', key } : null
  }
  return null
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
    // A dungeon-scope finding (a missing entrance) lands on the dungeon's
    // first level with its properties open — the entrance surface.
    return {
      kind: 'level',
      dungeonId,
      levelNumber: dungeon.levels[0].number,
      focus: { type: 'properties' },
    }
  }

  const levelValue = segmentValue(segments[1], 'level')
  if (levelValue === null) return null
  const levelNumber = Number(levelValue)
  const level = dungeon.levels.find((candidate) => candidate.number === levelNumber)
  if (!level) return null

  if (segments.length === 2) {
    // Level scope without a geometry segment (wandering_unknown_monster and
    // kin) opens the level properties.
    return { kind: 'level', dungeonId, levelNumber, focus: { type: 'properties' } }
  }

  const focus = parseFocus(segments[2], level)
  // A geometry segment that resolves to nothing stays unnavigable — never a
  // guessed coarser landing.
  if (!focus) return null
  return { kind: 'level', dungeonId, levelNumber, focus }
}
