// "Clear content": a level reduced to its geometry, as one op batch.
//
// The use it exists for is an imported map — a One Page Dungeon export arrives
// with a description on every keyed room, and an author who wants the rooms and
// not the prose currently empties them one card at a time. Composed from the
// ordinary content ops rather than given an op of its own, which is what makes
// it one undo step, one revision, and — for a forge-backed project — an
// ordinary area override per area rather than a translation with no override
// kind.
//
// Geometry is what the geometry importers call geometry: the grid, the edges,
// the areas and their cells and keys, the entrance, and the transitions. Names
// and descriptions go because a key with prose is content wearing an id.
import type { AnyEditOp, LevelSpec } from '@/types'

/** What a clear would remove from a level, for the confirmation's copy. */
export interface ContentTally {
  names: number
  descriptions: number
  encounters: number
  traps: number
  treasures: number
  features: number
  areas: number
}

export function contentTally(level: LevelSpec): ContentTally {
  const tally: ContentTally = {
    names: 0,
    descriptions: 0,
    encounters: 0,
    traps: 0,
    treasures: 0,
    features: level.features.length,
    areas: level.areas.length,
  }
  for (const area of level.areas) {
    if (area.name !== '') tally.names += 1
    if (area.description !== '') tally.descriptions += 1
    if (area.encounter) tally.encounters += 1
    if (area.trap) tally.traps += 1
    if (area.treasure) tally.treasures += 1
    tally.features += area.features.length
  }
  return tally
}

/**
 * Whether the level carries content a clear would empty out. The area count is
 * deliberately not content: a level of blank rooms has nothing to empty, even
 * though the areas themselves are something the dialog can offer to remove.
 */
export function hasContent(level: LevelSpec): boolean {
  const tally = contentTally(level)
  return CONTENT_KEYS.some((key) => tally[key] > 0)
}

const CONTENT_KEYS = [
  'names',
  'descriptions',
  'encounters',
  'traps',
  'treasures',
  'features',
] as const satisfies ReadonlyArray<keyof ContentTally>

/**
 * Whether the control has anything to offer at all — content to empty, or keyed
 * areas to remove. A level of blank rooms has the second without the first.
 */
export function hasClearable(level: LevelSpec): boolean {
  return hasContent(level) || level.areas.length > 0
}

/**
 * The batch that strips one level's keyed content, leaving its geometry.
 *
 * Only what actually differs is emitted, so a level already clear answers `[]`
 * and the commit is skipped rather than posted as a batch of no-ops.
 *
 * Args:
 *     level: The level as committed — the builder form, so the batch is
 *         computed against what is on the server, not a stale render.
 *     dungeonId: The level's dungeon.
 *     levelNumber: The level's number.
 *     removeAreas: Also unkey the emptied areas. Their cells become corridor
 *         (osrlib's convention for a cell in no area) while the walls and doors
 *         that draw the rooms are edges and stay — so the map still reads the
 *         same and only the keying goes. Emptying an area and then removing it
 *         would be two ops saying one thing, so this replaces the per-field
 *         clears rather than following them.
 *
 * Returns:
 *     The ops, in document order: each area's identity, then its content, then
 *     its features, and finally the level's own features.
 */
export function clearLevelContentOps(
  level: LevelSpec,
  dungeonId: string,
  levelNumber: number,
  removeAreas = false,
): AnyEditOp[] {
  const target = { dungeon_id: dungeonId, level_number: levelNumber }
  const ops: AnyEditOp[] = []
  for (const area of level.areas) {
    if (removeAreas) {
      ops.push({ op: 'remove_area', ...target, area_id: area.id })
      continue
    }
    if (area.name !== '') {
      ops.push({ op: 'set_area_field', ...target, area_id: area.id, field: 'name', value: '' })
    }
    if (area.description !== '') {
      ops.push({
        op: 'set_area_field',
        ...target,
        area_id: area.id,
        field: 'description',
        value: '',
      })
    }
    if (area.encounter) {
      ops.push({ op: 'set_encounter', ...target, area_id: area.id, encounter: null })
    }
    if (area.trap) ops.push({ op: 'set_trap', ...target, area_id: area.id, trap: null })
    if (area.treasure) {
      ops.push({ op: 'set_treasure', ...target, area_id: area.id, treasure: null })
    }
    for (const feature of area.features) {
      ops.push({ op: 'remove_feature', ...target, area_id: area.id, feature_id: feature.id })
    }
  }
  // Level-scope features are the one op here with no override kind: a forge
  // project rejects the whole batch on it with the detach offer
  // (`overrides.py` `ensure_forge_supported`). Unreachable rather than guarded,
  // and closed on all three sides: forge's `assemble` never populates
  // `LevelSpec.features`, no importer authors one, and `AddFeature` with a null
  // `area_id` is blocked by that same table — so a forge project cannot even
  // acquire the feature this would trip over. In a native project every op here
  // translates to nothing and applies plainly.
  for (const feature of level.features) {
    ops.push({ op: 'remove_feature', ...target, area_id: null, feature_id: feature.id })
  }
  return ops
}
