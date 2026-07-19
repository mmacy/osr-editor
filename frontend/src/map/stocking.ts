// The map stocking layer's pure logic: the stocked predicate, the content
// glyphs, the key-order walk, and the context-menu builder — all
// vitest-testable without a canvas.
import type { AreaSpec, LevelSpec } from '@/types'

// Stocked means a non-empty description or any content kind — a described
// room is a keyed room in module terms before any mechanics land. The
// remove-area confirm adopts the same predicate, so a described area never
// vanishes without a confirm.
export function isAreaStocked(area: AreaSpec): boolean {
  return Boolean(
    area.description.trim() !== '' ||
    area.encounter ||
    area.trap ||
    area.treasure ||
    area.features.length > 0,
  )
}

// The at-a-glance glyphs beside the key number, pencil-weight: encounter;
// trap — an area trap *or any trapped cache*, since both are traps the party
// can spring; treasure — an area treasure *or any treasure_cache feature*,
// since a cache is treasure.
export interface AreaGlyphs {
  encounter: boolean
  trap: boolean
  treasure: boolean
}

export function areaGlyphs(area: AreaSpec): AreaGlyphs {
  return {
    encounter: Boolean(area.encounter),
    trap: Boolean(area.trap || area.features.some((feature) => feature.trap)),
    treasure: Boolean(
      area.treasure || area.features.some((feature) => feature.kind === 'treasure_cache'),
    ),
  }
}

// Key order: numeric ids numerically first, then non-numeric ids
// lexicographically — so foreign ids participate in the walk.
export function keyOrder(areas: readonly AreaSpec[]): AreaSpec[] {
  const numeric = areas
    .filter((area) => /^[0-9]+$/.test(area.id))
    .sort((a, b) => Number(a.id) - Number(b.id))
  const rest = areas
    .filter((area) => !/^[0-9]+$/.test(area.id))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  return [...numeric, ...rest]
}

// The previous/next-area walk: `[` and `]` traverse key order, wrapping; with
// the unstocked filter on, the walk visits unstocked areas only — stocking a
// big dungeon is a walk through it. Answers null when nothing qualifies.
export function walkAreas(
  areas: readonly AreaSpec[],
  currentAreaId: string | null,
  direction: 1 | -1,
  unstockedOnly: boolean,
): string | null {
  const ordered = keyOrder(areas).filter((area) => !unstockedOnly || !isAreaStocked(area))
  if (ordered.length === 0) return null
  const currentIndex = ordered.findIndex((area) => area.id === currentAreaId)
  if (currentIndex === -1) {
    // No qualifying current area: enter the walk at its first or last stop.
    return direction === 1 ? ordered[0].id : ordered[ordered.length - 1].id
  }
  const next = (currentIndex + direction + ordered.length) % ordered.length
  return ordered[next].id
}

// One stocking-menu entry: a stable id for tests, the user-facing label, and
// the card intent the panel consumes.
export interface StockingMenuEntry {
  id: string
  label: string
  card: 'description' | 'encounter' | 'treasure' | 'trap' | 'features'
  action: 'edit' | 'add' | 'remove'
}

// The stocking context menu's entries: exactly what the area can hold,
// reflecting current state — description; encounter, treasure, and trap each
// as add or edit-plus-remove; add feature. The roll-stocking entry arrives
// with phase 7, absent rather than disabled (the phase 1 rule).
export function stockingMenuEntries(area: AreaSpec): StockingMenuEntry[] {
  const entries: StockingMenuEntry[] = [
    { id: 'description', label: 'Edit description', card: 'description', action: 'edit' },
  ]
  const contentKinds = [
    { card: 'encounter' as const, label: 'encounter', present: Boolean(area.encounter) },
    { card: 'treasure' as const, label: 'treasure', present: Boolean(area.treasure) },
    { card: 'trap' as const, label: 'trap', present: Boolean(area.trap) },
  ]
  for (const kind of contentKinds) {
    if (kind.present) {
      entries.push({
        id: `edit-${kind.card}`,
        label: `Edit ${kind.label}`,
        card: kind.card,
        action: 'edit',
      })
      entries.push({
        id: `remove-${kind.card}`,
        label: `Remove ${kind.label}`,
        card: kind.card,
        action: 'remove',
      })
    } else {
      entries.push({
        id: `add-${kind.card}`,
        label: `Add ${kind.label}`,
        card: kind.card,
        action: 'add',
      })
    }
  }
  entries.push({ id: 'add-feature', label: 'Add feature', card: 'features', action: 'add' })
  return entries
}

// The hover line's area resolution — the first area covering the cell, in
// authored order (osrlib's area_at).
export function areaAt(level: LevelSpec, cell: readonly [number, number]): AreaSpec | null {
  for (const area of level.areas) {
    if (area.cells.some(([x, y]) => x === cell[0] && y === cell[1])) return area
  }
  return null
}
