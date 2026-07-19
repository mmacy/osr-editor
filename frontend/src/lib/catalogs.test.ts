import { afterEach, describe, expect, test } from 'vitest'

import {
  bandTableForLevel,
  clearRecentMonsters,
  effectiveMonsterCatalog,
  groupEquipment,
  groupTreasureTypes,
  rankMonsters,
  recentMonsterIds,
  recordRecentMonster,
  type PickerMonster,
} from '@/lib/catalogs'
import type { CatalogItem, CatalogMonster, EncounterTable, MonsterTemplate } from '@/types'

const HIT_DICE = { count: 1, die: 8, modifier: 0, asterisks: 0, average_hp: null, fixed_hp: null }

const shippedMonster = (id: string): CatalogMonster => ({
  id,
  name: id,
  page: 'p',
  categories: [],
  alignment_options: ['chaotic'],
  usual_alignment: null,
  hit_dice: HIT_DICE,
})

const bundledTemplate = (id: string): MonsterTemplate =>
  ({
    id,
    name: id,
    page: 'p',
    hit_dice: HIT_DICE,
    alignment: { options: ['neutral'], usual: null },
  }) as unknown as MonsterTemplate

const picker = (id: string, bundled = false): PickerMonster => ({
  id,
  name: id,
  hitDice: HIT_DICE,
  alignmentOptions: ['chaotic'],
  bundled,
})

afterEach(() => {
  clearRecentMonsters()
})

describe('the effective monster catalog', () => {
  test('bundled entries rank first', () => {
    const merged = effectiveMonsterCatalog(
      [shippedMonster('orc')],
      [bundledTemplate('gloom-stalker')],
    )
    expect(merged.map((monster) => [monster.id, monster.bundled])).toEqual([
      ['gloom-stalker', true],
      ['orc', false],
    ])
    expect(merged[0].alignmentOptions).toEqual(['neutral'])
  })

  test('a bundled id colliding with the shipped catalog is skipped — base wins', () => {
    const merged = effectiveMonsterCatalog([shippedMonster('orc')], [bundledTemplate('orc')])
    expect(merged).toHaveLength(1)
    expect(merged[0].bundled).toBe(false)
  })
})

describe('picker ranking', () => {
  test('bundled first, then recents in recency order, then shipped order', () => {
    const monsters = [picker('bandit'), picker('orc'), picker('skeleton'), picker('wight', true)]
    const ranked = rankMonsters(monsters, ['skeleton', 'orc'], '')
    expect(ranked.map((monster) => monster.id)).toEqual(['wight', 'skeleton', 'orc', 'bandit'])
  })

  test('filters case-insensitively on name and id', () => {
    const monsters = [
      { ...picker('orc'), name: 'Orc' },
      { ...picker('orc_chieftain'), name: 'Orc chieftain' },
      picker('skeleton'),
    ]
    expect(rankMonsters(monsters, [], 'ORC').map((monster) => monster.id)).toEqual([
      'orc',
      'orc_chieftain',
    ])
    expect(rankMonsters(monsters, [], 'chief').map((monster) => monster.id)).toEqual([
      'orc_chieftain',
    ])
  })

  test('recording a recent moves it to the front and deduplicates', () => {
    recordRecentMonster('orc')
    recordRecentMonster('skeleton')
    recordRecentMonster('orc')
    expect(recentMonsterIds()).toEqual(['orc', 'skeleton'])
  })
})

describe('grouping', () => {
  test('equipment groups by item_type, catalog order preserved', () => {
    const item = (id: string, itemType: string): CatalogItem => ({
      id,
      name: id,
      item_type: itemType,
      cost_gp: 1,
    })
    const groups = groupEquipment([
      item('sword', 'weapon'),
      item('mace', 'weapon'),
      item('torch', 'gear'),
    ])
    expect(groups).toEqual([
      ['weapon', [item('sword', 'weapon'), item('mace', 'weapon')]],
      ['gear', [item('torch', 'gear')]],
    ])
  })

  test('treasure types group by section', () => {
    const groups = groupTreasureTypes([
      { letter: 'A', kind: 'hoard' },
      { letter: 'P', kind: 'individual' },
      { letter: 'B', kind: 'hoard' },
    ])
    expect(groups.map(([kind, types]) => [kind, types.map((type) => type.letter)])).toEqual([
      ['hoard', ['A', 'B']],
      ['individual', ['P']],
    ])
  })
})

describe('the band table clamp', () => {
  const table = (id: string, min: number, max: number | null): EncounterTable => ({
    id,
    label: id,
    min_level: min,
    max_level: max,
    rows: [],
    overrides_applied: [],
  })
  const tables = [
    table('1', 1, 1),
    table('2', 2, 2),
    table('3', 3, 3),
    table('4-5', 4, 5),
    table('8+', 6, null),
  ]

  test('clamps into the printed bands like for_level', () => {
    expect(bandTableForLevel(tables, 1)?.id).toBe('1')
    expect(bandTableForLevel(tables, 5)?.id).toBe('4-5')
    expect(bandTableForLevel(tables, 12)?.id).toBe('8+')
    expect(bandTableForLevel([], 1)).toBeNull()
  })
})
