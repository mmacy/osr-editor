// The catalogs client cache and the picker's ranking rules. The shipped
// catalogs are immutable per process server-side, so each fetches once per
// session through a module-level promise cache — no state-library ceremony. A
// failed fetch clears its slot so the next consumer retries.
import { useEffect, useState } from 'react'

import { api } from '@/lib/api'
import type {
  CatalogItem,
  CatalogMonster,
  CatalogTreasureType,
  EncounterTable,
  MonsterHitDice,
  MonsterTemplate,
} from '@/types'

function once<T>(load: () => Promise<T>): () => Promise<T> {
  let cached: Promise<T> | null = null
  return () => {
    cached ??= load().catch((error: unknown) => {
      cached = null
      throw error
    })
    return cached
  }
}

export const loadMonsterCatalog = once(async () => (await api.getMonsterCatalog()).monsters)
export const loadEquipmentCatalog = once(async () => (await api.getEquipmentCatalog()).items)
export const loadTreasureTypeCatalog = once(
  async () => (await api.getTreasureTypeCatalog()).treasure_types,
)
export const loadEncounterTables = once(async () => (await api.getEncounterTableCatalog()).tables)

// A catalog for a component: null while loading, then the loaded value.
// Errors stay quiet here — the picker renders its empty state and the cleared
// cache slot retries on the next mount.
export function useCatalog<T>(loader: () => Promise<T>): T | null {
  const [value, setValue] = useState<T | null>(null)
  useEffect(() => {
    let live = true
    loader().then(
      (loaded) => {
        if (live) setValue(loaded)
      },
      () => undefined,
    )
    return () => {
      live = false
    }
  }, [loader])
  return value
}

// One monster entry as the picker consumes it — shipped and bundled shapes
// merged to a common surface.
export interface PickerMonster {
  id: string
  name: string
  hitDice: MonsterHitDice
  alignmentOptions: CatalogMonster['alignment_options']
  bundled: boolean
}

// The effective catalog: the shipped list plus the open document's bundled
// templates, bundled entries ranked first per the spec's picker contract. A
// bundled id colliding with the shipped catalog is skipped — osrlib's own
// first-occurrence-wins resolution, where the base catalog is first.
export function effectiveMonsterCatalog(
  shipped: readonly CatalogMonster[],
  bundled: readonly MonsterTemplate[],
): PickerMonster[] {
  const shippedIds = new Set(shipped.map((monster) => monster.id))
  const bundledEntries: PickerMonster[] = bundled
    .filter((template) => !shippedIds.has(template.id))
    .map((template) => ({
      id: template.id,
      name: template.name,
      hitDice: template.hit_dice,
      alignmentOptions: template.alignment.options,
      bundled: true,
    }))
  const shippedEntries: PickerMonster[] = shipped.map((monster) => ({
    id: monster.id,
    name: monster.name,
    hitDice: monster.hit_dice,
    alignmentOptions: monster.alignment_options,
    bundled: false,
  }))
  return [...bundledEntries, ...shippedEntries]
}

// Recently-used is in-memory session state; persisted stocking state is
// phase 7's sidecar work.
const MAX_RECENT_MONSTERS = 10
let recentMonsters: string[] = []

export function recordRecentMonster(id: string): void {
  recentMonsters = [id, ...recentMonsters.filter((existing) => existing !== id)].slice(
    0,
    MAX_RECENT_MONSTERS,
  )
}

export function recentMonsterIds(): readonly string[] {
  return recentMonsters
}

export function clearRecentMonsters(): void {
  recentMonsters = []
}

// The picker's ranking: filter case-insensitively on name and id, then order
// bundled templates first, this session's recently used next (most recent
// first), then shipped order.
export function rankMonsters(
  monsters: readonly PickerMonster[],
  recents: readonly string[],
  query: string,
): PickerMonster[] {
  const needle = query.trim().toLowerCase()
  const matches = monsters.filter(
    (monster) =>
      needle === '' ||
      monster.id.toLowerCase().includes(needle) ||
      monster.name.toLowerCase().includes(needle),
  )
  const recency = new Map(recents.map((id, index) => [id, index]))
  const bundled = matches.filter((monster) => monster.bundled)
  const recent = matches
    .filter((monster) => !monster.bundled && recency.has(monster.id))
    .sort((a, b) => (recency.get(a.id) ?? 0) - (recency.get(b.id) ?? 0))
  const rest = matches.filter((monster) => !monster.bundled && !recency.has(monster.id))
  return [...bundled, ...recent, ...rest]
}

// Equipment grouped by item_type for the picker's sections, catalog order
// preserved within each group.
export function groupEquipment(items: readonly CatalogItem[]): [string, CatalogItem[]][] {
  const groups = new Map<string, CatalogItem[]>()
  for (const item of items) {
    const group = groups.get(item.item_type)
    if (group) group.push(item)
    else groups.set(item.item_type, [item])
  }
  return [...groups.entries()]
}

// Treasure types grouped by section (hoard, individual, group), table order
// preserved within each.
export function groupTreasureTypes(
  types: readonly CatalogTreasureType[],
): [CatalogTreasureType['kind'], CatalogTreasureType[]][] {
  const groups = new Map<CatalogTreasureType['kind'], CatalogTreasureType[]>()
  for (const type of types) {
    const group = groups.get(type.kind)
    if (group) group.push(type)
    else groups.set(type.kind, [type])
  }
  return [...groups.entries()]
}

// The compiled band table for a level, `for_level`'s printed-band clamp
// mirrored: the first table whose max_level is open or admits the level.
export function bandTableForLevel(
  tables: readonly EncounterTable[],
  level: number,
): EncounterTable | null {
  for (const table of tables) {
    if (table.max_level == null || level <= table.max_level) return table
  }
  return null
}
