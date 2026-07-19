import { expect, test } from 'vitest'

import { autoReasonKey, collectCorrections } from '@/lib/corrections'
import { buildStatBlockPatch } from '@/lib/statblock'
import type { Overrides } from '@/types'

test('autoReasonKey qualifies mapped kinds and bares singletons', () => {
  expect(autoReasonKey('areas', 'd/1/2')).toBe('areas:d/1/2')
  expect(autoReasonKey('monsters', 'goblin')).toBe('monsters:goblin')
  expect(autoReasonKey('town', '')).toBe('town')
  expect(autoReasonKey('module', '')).toBe('module')
})

test('collectCorrections groups by kind in file order with summaries, addresses, and auto flags', () => {
  const overrides: Overrides = {
    monsters: { 'drowned one': { template_id: 'hobgoblin', reason: 'remapped to hobgoblin' } },
    monster_templates: {
      'vault warden': { reason: 'printed stat block corrected for vault warden' },
    },
    areas: {
      'sunken-vault/1/3': {
        description: 'Corrected.',
        remove: false,
        reason: 'area 3 description corrected against p. 2',
      },
    },
    geometry: { 'sunken-vault/1': { edges: {}, areas: {}, reason: 'level 1 edges redrawn' } },
    town: { name: 'Ashkar', reason: 'town name corrected' },
    module: null,
  }
  const entries = collectCorrections(overrides, ['areas:sunken-vault/1/3'])
  expect(entries.map((e) => e.kind)).toEqual([
    'monsters',
    'monster_templates',
    'areas',
    'geometry',
    'town',
  ])
  const area = entries.find((e) => e.kind === 'areas')!
  expect(area.summary).toBe('corrected: description')
  expect(area.address).toBe('dungeon:sunken-vault/level:1/area:3')
  expect(area.autoReason).toBe(true) // in auto_reasons
  const monster = entries.find((e) => e.kind === 'monsters')!
  expect(monster.summary).toBe('→ hobgoblin')
  expect(monster.autoReason).toBe(false) // not in auto_reasons -> human-composed
  expect(entries.find((e) => e.kind === 'geometry')!.address).toBe('dungeon:sunken-vault/level:1')
})

test('buildStatBlockPatch omits blank fields, parses numbers, and splits line fields', () => {
  const patch = buildStatBlockPatch({
    ac: '4',
    ac_notation: 'descending',
    hit_dice: '4+1',
    hp: '19',
    attacks: '1 slam (1d8)\n\n1 bite (1d6)',
    morale: '10',
    thac0: '', // blank -> omitted (untouched)
  })
  expect(patch).toEqual({
    ac: '4',
    ac_notation: 'descending',
    hit_dice: '4+1',
    hp: 19,
    attacks: ['1 slam (1d8)', '1 bite (1d6)'],
    morale: 10,
  })
  expect('thac0' in patch).toBe(false)
})
