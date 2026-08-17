import { expect, test } from 'vitest'

import {
  armourModePatch,
  formatGearParam,
  itemReferenceCount,
  itemTemplatePatchOps,
  itemTemplateUpdateOps,
  missilePatch,
  neutralMissileRanges,
  parseGearParam,
  seedItemTemplate,
} from '@/lib/item-builders'
import { cloneId } from '@/lib/monster-builders'
import { makeDocument } from '@/test/fixtures'
import type { Adventure, GateSpec, WeaponTemplate } from '@/types'

const KEY_GATE: GateSpec = {
  condition: { condition_type: 'has_item', item_id: 'brass-key', consumes: false },
  narrative: null,
}

function documentWithReferences(): Adventure {
  const document = makeDocument()
  document.items = [seedItemTemplate('gear', 'brass-key', 'Brass key')]
  const level = document.dungeons[0].levels[0]
  level.areas = [
    {
      id: '1',
      name: '',
      description: '',
      cells: [[1, 1]],
      encounter: null,
      trap: null,
      treasure: null,
      features: [
        {
          id: 'cache-1',
          kind: 'treasure_cache',
          description: '',
          cell: null,
          item_ids: ['brass-key', 'brass-key'],
          magic_item_ids: [],
          coins: { pp: 0, gp: 0, ep: 0, sp: 0, cp: 0 },
          valuables: [],
          trap: null,
        },
      ],
    },
  ]
  level.edges = {
    '1,1:north': {
      kind: 'door',
      door: { kind: 'normal', stuck: false, locked: false, starts_open: false, requires: KEY_GATE },
    },
  }
  level.transitions = [
    {
      kind: 'stairs_down',
      position: [2, 2],
      to_dungeon_id: 'dungeon-1',
      to_level_number: 2,
      to_position: [0, 0],
      to_facing: 'south',
      requires: {
        condition: { condition_type: 'has_item', item_id: 'brass-key', consumes: true },
        narrative: null,
      },
    },
  ]
  document.triggers = [
    {
      id: 'key-watch',
      when: { pattern_type: 'item_acquired', item_id: 'brass-key' },
      conditions: [{ condition_type: 'has_item', item_id: 'brass-key', consumes: false }],
      repeatable: false,
      consequences: [
        {
          command_type: 'grant_item',
          character_id: '@first',
          item_id: 'brass-key',
          quantity: 1,
          source: null,
        },
      ],
      narrative: null,
    },
  ]
  document.quests = [
    {
      id: 'the-key',
      name: 'The key',
      activation: null,
      objectives: [
        {
          id: 'find',
          name: '',
          when: {
            pattern: { pattern_type: 'item_acquired', item_id: 'brass-key' },
            conditions: [],
          },
          hidden: false,
          reveal_when: null,
          narrative: null,
        },
      ],
      rewards: [],
      completion: 'all',
      concludes_adventure: false,
      narrative: null,
    },
  ]
  return document
}

test('the per-kind seeds are model-shaped: every kind carries its whole surface', () => {
  const weapon = seedItemTemplate('weapon', 'w', 'W')
  expect(weapon.item_type).toBe('weapon')
  if (weapon.item_type === 'weapon') {
    expect(weapon.damage).toBe('1d6')
    expect(weapon.qualities).toEqual(['melee'])
    expect(weapon.missile_ranges).toBeNull()
  }
  const armour = seedItemTemplate('armour', 'a', 'A')
  if (armour.item_type === 'armour') {
    // The body triple — the unarmoured pair plus light, the monster-seed
    // convention; never the shield.
    expect([armour.ac, armour.ac_ascending, armour.category]).toEqual([9, 10, 'light'])
    expect(armour.ac_bonus).toBeNull()
  }
  const gear = seedItemTemplate('gear', 'g', 'G')
  if (gear.item_type === 'gear') {
    expect(gear.lot_size).toBe(1)
    expect(gear.combat).toBeNull()
    expect(gear.params).toEqual({})
  }
  const ammunition = seedItemTemplate('ammunition', 'm', 'M')
  if (ammunition.item_type === 'ammunition') {
    expect(ammunition.weight_coins).toBe(0)
    expect(ammunition.material).toBe('standard')
  }
})

test('the clone prefill walks to the next free id over the full domain', () => {
  expect(cloneId('sword', new Set(['sword']))).toBe('sword-1')
  expect(cloneId('sword', new Set(['sword', 'sword-1', 'sword-2']))).toBe('sword-3')
})

test('the missile toggle seeds an ordered three-band spread on and clears it off, one gesture', () => {
  const weapon = seedItemTemplate('weapon', 'bow', 'Bow') as WeaponTemplate
  const on = missilePatch(weapon, true)
  expect(on.qualities).toEqual(['melee', 'missile'])
  expect(on.missile_ranges).toEqual(neutralMissileRanges())
  const armed: WeaponTemplate = { ...weapon, ...on }
  const off = missilePatch(armed, false)
  expect(off.qualities).toEqual(['melee'])
  expect(off.missile_ranges).toBeNull()
})

test('the armour mode patch swaps the field sets whole — the XOR is unrepresentable to break', () => {
  expect(armourModePatch(true)).toEqual({
    ac: null,
    ac_ascending: null,
    category: null,
    ac_bonus: 1,
  })
  expect(armourModePatch(false)).toEqual({
    ac: 9,
    ac_ascending: 10,
    category: 'light',
    ac_bonus: null,
  })
})

test('patch builders compute against the committed template and skip a vanished target', () => {
  const document = documentWithReferences()
  const ops = itemTemplatePatchOps(document, 'brass-key', 'gear', { cost_gp: 5 })
  expect(ops).toEqual([
    {
      op: 'set_item_template',
      item_id: 'brass-key',
      template: expect.objectContaining({ id: 'brass-key', cost_gp: 5 }),
    },
  ])
  expect(itemTemplatePatchOps(document, 'gone', 'gear', { cost_gp: 5 })).toEqual([])
  // A kind mismatch skips rather than committing a cross-kind mongrel.
  expect(itemTemplatePatchOps(document, 'brass-key', 'weapon', { damage: '1d8' })).toEqual([])
  expect(itemTemplateUpdateOps(document, 'brass-key', () => null)).toEqual([])
})

test('the reference count spans caches, gates, and the authored-layer sites', () => {
  const document = documentWithReferences()
  // Two cache entries + door gate + transition toll + trigger pattern +
  // trigger condition + grant consequence + quest objective pattern.
  expect(itemReferenceCount(document, 'brass-key')).toBe(8)
  expect(itemReferenceCount(document, 'iron-key')).toBe(0)
})

test('gear params parse JSON-typed and fall back to plain strings', () => {
  expect(parseGearParam('6')).toBe(6)
  expect(parseGearParam('true')).toBe(true)
  expect(parseGearParam('"lit"')).toBe('lit')
  expect(parseGearParam('burns slow')).toBe('burns slow')
  expect(parseGearParam('[1, 2]')).toBeNull()
  expect(parseGearParam('')).toBeNull()
  expect(formatGearParam(6)).toBe('6')
  expect(formatGearParam(true)).toBe('true')
  expect(formatGearParam('lit')).toBe('lit')
})
