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
  // The always-present Monsters section (both project types): the `monsters`
  // scope's landing, a `monster:<id>` finding's landing with that template
  // selected, and the picker's create shortcut with the create dialog open.
  | { kind: 'monsters'; templateId?: string; create?: boolean }
  // The always-present Items section, the Monsters mirror: the `items`
  // scope's landing and an `item:<id>` finding's landing with that template
  // selected.
  | { kind: 'items'; itemId?: string; create?: boolean }
  // The always-present Quests section (its trigger surface first): the
  // `triggers` scope's landing and a `trigger:<id>` finding's landing with
  // that trigger open. No `create` flag — nothing anywhere picks a trigger.
  | { kind: 'quests'; triggerId?: string }
  // The forge review surfaces — nav sections, never address-mapped (the
  // grammar's producers stay validation, lint, and the forge tier).
  | { kind: 'review' }
  | { kind: 'corrections' }
  | { kind: 'pipeline' }
  | { kind: 'monster-resolution' }

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

// The address builders, mirroring the backend's percent-encoding rule (RFC
// 3986, everything reserved) — the notes map and view state key on these.
export function dungeonAddress(dungeonId: string): string {
  return `dungeon:${encodeURIComponent(dungeonId)}`
}

export function levelAddress(dungeonId: string, levelNumber: number): string {
  return `${dungeonAddress(dungeonId)}/level:${levelNumber}`
}

export function areaAddress(dungeonId: string, levelNumber: number, areaId: string): string {
  return `${levelAddress(dungeonId, levelNumber)}/area:${encodeURIComponent(areaId)}`
}

// The geometry segments are numeric grammar — unencoded, mirroring the
// backend's builders.
export function cellAddress(dungeonId: string, levelNumber: number, cell: Position): string {
  return `${levelAddress(dungeonId, levelNumber)}/cell:${cell[0]},${cell[1]}`
}

export function edgeAddress(dungeonId: string, levelNumber: number, edgeKey: string): string {
  return `${levelAddress(dungeonId, levelNumber)}/edge:${edgeKey}`
}

export function monsterAddress(templateId: string): string {
  return `monster:${encodeURIComponent(templateId)}`
}

export function itemAddress(itemId: string): string {
  return `item:${encodeURIComponent(itemId)}`
}

export function triggerAddress(triggerId: string): string {
  return `trigger:${encodeURIComponent(triggerId)}`
}

export function navTargetFor(
  address: string | null | undefined,
  document: Adventure,
): NavTarget | null {
  if (!address) return null
  if (address === 'town') return { kind: 'town' }
  if (address === 'monsters') return { kind: 'monsters' }
  if (address === 'items') return { kind: 'items' }
  if (address === 'triggers') return { kind: 'quests' }

  const segments = address.split('/')
  const templateId = segmentValue(segments[0], 'monster')
  if (templateId !== null) {
    // A `monster:<id>` finding lands on the Monsters section with that
    // template selected; an id the document no longer bundles stays
    // unnavigable — never a guessed coarser landing.
    if (segments.length !== 1) return null
    return document.monsters.some((template) => template.id === templateId)
      ? { kind: 'monsters', templateId }
      : null
  }
  const itemId = segmentValue(segments[0], 'item')
  if (itemId !== null) {
    // The `item:<id>` mirror, with the same not-bundled refusal.
    if (segments.length !== 1) return null
    return document.items.some((template) => template.id === itemId)
      ? { kind: 'items', itemId }
      : null
  }
  const triggerId = segmentValue(segments[0], 'trigger')
  if (triggerId !== null) {
    // The `trigger:<id>` mirror: the Quests section with the trigger open; an
    // id the document no longer carries stays unnavigable.
    if (segments.length !== 1) return null
    return document.triggers.some((trigger) => trigger.id === triggerId)
      ? { kind: 'quests', triggerId }
      : null
  }
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
