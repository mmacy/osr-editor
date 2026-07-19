import { describe, expect, test } from 'vitest'

import {
  areaAt,
  areaGlyphs,
  isAreaStocked,
  keyOrder,
  stockingMenuEntries,
  walkAreas,
} from '@/map/stocking'
import type { AreaSpec, KeyedEncounter, TrapSpec } from '@/types'

const ENCOUNTER: KeyedEncounter = {
  monsters: [{ template_id: 'orc', count_dice: '1d6', count_fixed: null }],
  alignment: null,
  aware: false,
  stance: null,
}

const ROOM_TRAP: TrapSpec = {
  kind: 'room',
  trigger: 'enter',
  affects: 'triggerer',
  effect: {
    damage_dice: '1d6',
    volley_dice: null,
    save: null,
    kills: false,
    condition: null,
    condition_duration_dice: null,
    condition_duration_amount: null,
    condition_duration_unit: null,
    fall_feet: null,
    transition: null,
    manual: null,
  },
}

function area(id: string, overrides: Partial<AreaSpec> = {}): AreaSpec {
  return {
    id,
    name: '',
    description: '',
    cells: [[0, 0]],
    encounter: null,
    features: [],
    trap: null,
    treasure: null,
    ...overrides,
  }
}

function cache(id: string, trapped: boolean): AreaSpec['features'][number] {
  return {
    id,
    kind: 'treasure_cache',
    description: '',
    cell: null,
    item_ids: [],
    coins: { pp: 0, gp: 0, ep: 0, sp: 0, cp: 0 },
    valuables: [],
    trap: trapped ? { ...ROOM_TRAP, kind: 'treasure', trigger: 'open' } : null,
  }
}

describe('the stocked predicate', () => {
  test('a described room is a keyed room before any mechanics land', () => {
    expect(isAreaStocked(area('1'))).toBe(false)
    expect(isAreaStocked(area('1', { description: 'A dusty shrine.' }))).toBe(true)
    expect(isAreaStocked(area('1', { description: '   ' }))).toBe(false)
  })

  const contentCases: Array<[string, Partial<AreaSpec>]> = [
    ['encounter', { encounter: ENCOUNTER }],
    ['trap', { trap: ROOM_TRAP }],
    ['treasure', { treasure: { letters: ['C'], unguarded: false } }],
    ['features', { features: [cache('feature-1', false)] }],
  ]
  test.each(contentCases)('any content kind stocks: %s', (_kind, overrides) => {
    expect(isAreaStocked(area('1', overrides))).toBe(true)
  })
})

describe('the content glyphs', () => {
  test('a trapped cache raises both the trap and treasure glyphs', () => {
    const glyphs = areaGlyphs(area('1', { features: [cache('feature-1', true)] }))
    expect(glyphs).toEqual({ encounter: false, trap: true, treasure: true })
  })

  test('an area trap alone raises only the trap glyph', () => {
    expect(areaGlyphs(area('1', { trap: ROOM_TRAP }))).toEqual({
      encounter: false,
      trap: true,
      treasure: false,
    })
  })

  test('an encounter raises the encounter glyph', () => {
    expect(areaGlyphs(area('1', { encounter: ENCOUNTER })).encounter).toBe(true)
  })
})

describe('key order and the walk', () => {
  const areas = [area('10'), area('2'), area('annex'), area('1'), area('Atrium')]

  test('numeric ids sort numerically first, then non-numeric lexicographically', () => {
    expect(keyOrder(areas).map((entry) => entry.id)).toEqual(['1', '2', '10', 'Atrium', 'annex'])
  })

  test('the walk traverses key order and wraps', () => {
    expect(walkAreas(areas, '1', 1, false)).toBe('2')
    expect(walkAreas(areas, '10', 1, false)).toBe('Atrium')
    expect(walkAreas(areas, 'annex', 1, false)).toBe('1')
    expect(walkAreas(areas, '1', -1, false)).toBe('annex')
  })

  test('with no current area the walk enters at its first or last stop', () => {
    expect(walkAreas(areas, null, 1, false)).toBe('1')
    expect(walkAreas(areas, null, -1, false)).toBe('annex')
  })

  test('with the filter on the walk visits unstocked areas only', () => {
    const mixed = [
      area('1', { description: 'Stocked.' }),
      area('2'),
      area('3', { encounter: ENCOUNTER }),
      area('4'),
    ]
    expect(walkAreas(mixed, '2', 1, true)).toBe('4')
    expect(walkAreas(mixed, '4', 1, true)).toBe('2')
    // A stocked current area is not in the filtered walk — enter at the start.
    expect(walkAreas(mixed, '1', 1, true)).toBe('2')
  })

  test('an empty or fully stocked filtered walk answers null', () => {
    expect(walkAreas([], null, 1, false)).toBeNull()
    expect(walkAreas([area('1', { description: 'Done.' })], null, 1, true)).toBeNull()
  })
})

describe('the stocking menu builder', () => {
  test('an empty area offers description, three adds, and add feature', () => {
    expect(stockingMenuEntries(area('1')).map((entry) => entry.id)).toEqual([
      'description',
      'add-encounter',
      'add-treasure',
      'add-trap',
      'add-feature',
    ])
  })

  test('present kinds offer edit plus remove, reflecting current state', () => {
    const stocked = area('1', { encounter: ENCOUNTER, trap: ROOM_TRAP })
    expect(stockingMenuEntries(stocked).map((entry) => entry.id)).toEqual([
      'description',
      'edit-encounter',
      'remove-encounter',
      'add-treasure',
      'edit-trap',
      'remove-trap',
      'add-feature',
    ])
  })

  test('labels stay sentence case', () => {
    for (const entry of stockingMenuEntries(area('1', { encounter: ENCOUNTER }))) {
      expect(entry.label[0]).toBe(entry.label[0].toUpperCase())
      expect(entry.label.slice(1)).toBe(entry.label.slice(1).toLowerCase())
    }
  })
})

describe('areaAt', () => {
  test("resolves the first area in authored order — osrlib's own resolution", () => {
    const level = {
      areas: [area('first', { cells: [[1, 1]] }), area('second', { cells: [[1, 1]] })],
    }
    expect(areaAt(level as never, [1, 1])?.id).toBe('first')
    expect(areaAt(level as never, [2, 2])).toBeNull()
  })
})
