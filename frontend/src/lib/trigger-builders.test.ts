import { describe, expect, test } from 'vitest'

import {
  FIRST_LIVING_SELECTOR,
  PARTY_SELECTOR,
  TRIGGER_BLOCKED_MESSAGE,
  areaTriggersFor,
  canonicalDoorRef,
  consequenceSummary,
  doorRefKey,
  doorRefsAt,
  levelTriggersFor,
  nextTriggerId,
  patternSummary,
  seedAreaTrigger,
  seedLevelTrigger,
  seedTrigger,
  triggerAreaIds,
  triggerPatchOps,
  triggerUpdateOps,
} from '@/lib/trigger-builders'
import { makeDocument } from '@/test/fixtures'
import type { TriggerSpec } from '@/types'

function trigger(id: string, overrides: Partial<TriggerSpec> = {}): TriggerSpec {
  return {
    id,
    when: { pattern_type: 'town_entered' },
    conditions: [],
    repeatable: false,
    consequences: [],
    narrative: null,
    ...overrides,
  }
}

test('the blocked message mirrors the server table verbatim', () => {
  expect(TRIGGER_BLOCKED_MESSAGE).toBe(
    'triggers have no override kind — the overrides vocabulary has no authored-layer surface',
  )
})

test('the selector literals are osrlib’s module constants', () => {
  expect(PARTY_SELECTOR).toBe('@party')
  expect(FIRST_LIVING_SELECTOR).toBe('@first')
})

describe('id minting and seeds', () => {
  test('nextTriggerId mints the next free trigger-<n> over the trigger namespace', () => {
    expect(nextTriggerId(makeDocument())).toBe('trigger-1')
    const document = makeDocument({ triggers: [trigger('trigger-1'), trigger('trigger-3')] })
    expect(nextTriggerId(document)).toBe('trigger-2')
  })

  test('seedTrigger is complete and empty-bodied — no fake references', () => {
    expect(seedTrigger('t', { pattern_type: 'town_entered' })).toEqual({
      id: 't',
      when: { pattern_type: 'town_entered' },
      conditions: [],
      repeatable: false,
      consequences: [],
      narrative: null,
    })
  })

  test('the map seeds bind the clicked area and the level tab’s level', () => {
    const document = makeDocument()
    expect(seedAreaTrigger(document, 'dungeon-1', 1, '3').when).toEqual({
      pattern_type: 'area_entered',
      dungeon_id: 'dungeon-1',
      level_number: 1,
      area_id: '3',
    })
    expect(seedLevelTrigger(document, 'dungeon-1', 1).when).toEqual({
      pattern_type: 'level_entered',
      dungeon_id: 'dungeon-1',
      level_number: 1,
    })
  })
})

describe('the derived map sets', () => {
  const document = makeDocument({
    triggers: [
      trigger('a', {
        when: {
          pattern_type: 'area_entered',
          dungeon_id: 'dungeon-1',
          level_number: 1,
          area_id: '3',
        },
      }),
      trigger('b', {
        when: {
          pattern_type: 'area_entered',
          dungeon_id: 'dungeon-1',
          level_number: 2,
          area_id: '3',
        },
      }),
      trigger('c', {
        when: { pattern_type: 'level_entered', dungeon_id: 'dungeon-1', level_number: 1 },
      }),
    ],
  })

  test('triggerAreaIds collects the current level’s targeted areas only', () => {
    expect(triggerAreaIds(document, 'dungeon-1', 1)).toEqual(new Set(['3']))
    expect(triggerAreaIds(document, 'dungeon-1', 3)).toEqual(new Set())
  })

  test('areaTriggersFor answers the targeting triggers in document order', () => {
    expect(areaTriggersFor(document, 'dungeon-1', 1, '3').map((entry) => entry.id)).toEqual(['a'])
    expect(areaTriggersFor(document, 'dungeon-1', 1, '9')).toEqual([])
  })

  test('levelTriggersFor answers level_entered triggers alone', () => {
    expect(levelTriggersFor(document, 'dungeon-1', 1).map((entry) => entry.id)).toEqual(['c'])
    expect(levelTriggersFor(document, 'dungeon-1', 2)).toEqual([])
  })
})

describe('the compute-in-the-queue update builders', () => {
  test('triggerUpdateOps computes the next spec from the committed document', () => {
    const document = makeDocument({ triggers: [trigger('t')] })
    const ops = triggerUpdateOps(document, 't', (committed) => ({
      ...committed,
      repeatable: true,
    }))
    expect(ops).toEqual([
      { op: 'set_trigger', trigger_id: 't', trigger: { ...trigger('t'), repeatable: true } },
    ])
  })

  test('a vanished trigger or a null update skips the batch', () => {
    const document = makeDocument({ triggers: [trigger('t')] })
    expect(triggerUpdateOps(document, 'ghost', (committed) => committed)).toEqual([])
    expect(triggerUpdateOps(document, 't', () => null)).toEqual([])
  })

  test('triggerPatchOps merges over the committed spec', () => {
    const document = makeDocument({ triggers: [trigger('t')] })
    const ops = triggerPatchOps(document, 't', { id: 'renamed' })
    expect(ops).toEqual([
      { op: 'set_trigger', trigger_id: 't', trigger: { ...trigger('t'), id: 'renamed' } },
    ])
  })
})

describe('the door canonicalization', () => {
  test('south and east map onto the neighbouring cell’s north and west', () => {
    expect(canonicalDoorRef({ x: 2, y: 0, direction: 'south' })).toEqual({
      x: 2,
      y: 1,
      direction: 'north',
    })
    expect(canonicalDoorRef({ x: 2, y: 0, direction: 'east' })).toEqual({
      x: 3,
      y: 0,
      direction: 'west',
    })
    expect(canonicalDoorRef({ x: 2, y: 0, direction: 'north' })).toEqual({
      x: 2,
      y: 0,
      direction: 'north',
    })
  })

  test('doorRefsAt offers exactly the door edges incident to the cell, canonical form', () => {
    const edges = {
      '2,1:north': { kind: 'door' },
      '2,1:west': { kind: 'open' },
      '3,1:west': { kind: 'door' },
      '2,2:north': { kind: 'door' },
    }
    const refs = doorRefsAt(edges, [2, 1])
    expect(refs.map(doorRefKey)).toEqual(['2,1:north', '2,2:north', '3,1:west'])
  })
})

describe('the module-notation summaries', () => {
  test('every pattern kind renders', () => {
    expect(
      patternSummary({
        pattern_type: 'area_entered',
        dungeon_id: 'stone-halls',
        level_number: 1,
        area_id: '3',
      }),
    ).toBe("on entering area 3, level 1 of 'stone-halls'")
    expect(
      patternSummary({ pattern_type: 'level_entered', dungeon_id: 'stone-halls', level_number: 2 }),
    ).toBe("on entering level 2 of 'stone-halls'")
    expect(patternSummary({ pattern_type: 'dungeon_entered', dungeon_id: 'stone-halls' })).toBe(
      "on entering 'stone-halls'",
    )
    expect(patternSummary({ pattern_type: 'town_entered' })).toBe('on arriving in town')
    expect(patternSummary({ pattern_type: 'flag_set', key: 'lever', value: null })).toBe(
      "on flag 'lever' being written",
    )
    expect(patternSummary({ pattern_type: 'flag_set', key: 'lever', value: 'pulled' })).toBe(
      "on flag 'lever' set to 'pulled'",
    )
    expect(patternSummary({ pattern_type: 'flag_set', key: 'lever', value: true })).toBe(
      "on flag 'lever' set to true",
    )
  })

  test('name resolution resolves, and a dangling id degrades to itself', () => {
    const names = {
      itemName: (id: string) => (id === 'millers-key' ? "The miller's brass key" : id),
      monsterName: (id: string) => (id === 'orc' ? 'Orc' : id),
    }
    expect(patternSummary({ pattern_type: 'item_acquired', item_id: 'millers-key' }, names)).toBe(
      "on acquiring The miller's brass key",
    )
    expect(patternSummary({ pattern_type: 'item_acquired', item_id: 'ghost' }, names)).toBe(
      'on acquiring ghost',
    )
    expect(patternSummary({ pattern_type: 'monster_defeated', template_id: 'orc' }, names)).toBe(
      'on defeating Orc',
    )
  })

  test('every command kind renders', () => {
    expect(
      consequenceSummary({
        command_type: 'grant_item',
        character_id: '@party',
        item_id: 'torch',
        quantity: 2,
      }),
    ).toBe('grant 2× torch to whole party')
    expect(
      consequenceSummary({
        command_type: 'grant_coins',
        character_id: '@first',
        coins: { pp: 0, gp: 5, ep: 0, sp: 10, cp: 0 },
      }),
    ).toBe('grant 5 gp, 10 sp to first living character')
    expect(
      consequenceSummary({ command_type: 'award_xp', character_id: '@party', amount: 200 }),
    ).toBe('award 200 XP to whole party')
    expect(consequenceSummary({ command_type: 'set_flag', key: 'lever', value: 'pulled' })).toBe(
      "set flag 'lever' to 'pulled'",
    )
    expect(
      consequenceSummary({
        command_type: 'spawn_monsters',
        template_id: 'orc',
        count_dice: '2d4',
        count_fixed: null,
        distance_feet: 30,
      }),
    ).toBe('spawn 2d4 orc at 30 ft')
    expect(
      consequenceSummary({
        command_type: 'set_door_state',
        dungeon_id: 'crypt',
        level_number: 1,
        x: 2,
        y: 0,
        direction: 'north',
        open: true,
        wedged: null,
        discovered: null,
        unlocked: null,
      }),
    ).toBe("door at (2, 0) north, level 1 of 'crypt': open true")
    expect(consequenceSummary({ command_type: 'place_party', location: { kind: 'town' } })).toBe(
      'place the party in town',
    )
    expect(consequenceSummary({ command_type: 'advance_time', n: 3, unit: 'turn' })).toBe(
      'advance time 3 turns',
    )
  })

  test('a foreign literal character id renders honestly, never as a selector', () => {
    expect(
      consequenceSummary({
        command_type: 'award_xp',
        character_id: 'c-1',
        amount: 10,
      }),
    ).toBe("award 10 XP to character 'c-1'")
  })
})
