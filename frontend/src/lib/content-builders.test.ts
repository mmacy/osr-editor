import { describe, expect, test } from 'vitest'

import {
  alignmentIntersection,
  areaTrapPatchOps,
  emptyFeature,
  emptyTrap,
  encounterAddLineOps,
  encounterPatchOps,
  encounterRemoveLineOps,
  encounterSetLineOps,
  featurePatchOps,
  nextFreeFeatureKey,
  parseCount,
  patchTrapEffect,
  toggleTreasureLetter,
  type AreaTarget,
} from '@/lib/content-builders'
import { makeDocument } from '@/test/fixtures'
import type { Adventure, AreaSpec, FeatureSpec, KeyedMonster, LevelSpec } from '@/types'

const TARGET: AreaTarget = { dungeonId: 'dungeon-1', levelNumber: 1, areaId: '1' }

const LINE: KeyedMonster = { template_id: 'orc', count_dice: '3d4', count_fixed: null }

function feature(id: string, overrides: Partial<FeatureSpec> = {}): FeatureSpec {
  return { ...emptyFeature(id, null), ...overrides }
}

function withArea(overrides: Partial<AreaSpec>, levelExtras: Partial<LevelSpec> = {}): Adventure {
  const document = makeDocument()
  const dungeon = document.dungeons[0]
  const level = dungeon.levels[0]
  const area: AreaSpec = {
    id: '1',
    name: '',
    description: '',
    cells: [[0, 0]],
    encounter: null,
    features: [],
    trap: null,
    treasure: null,
    ...overrides,
  }
  return {
    ...document,
    dungeons: [{ ...dungeon, levels: [{ ...level, ...levelExtras, areas: [area] }] }],
  }
}

describe('parseCount', () => {
  test('all digits reads as fixed, anything else as dice under the mirror', () => {
    expect(parseCount('6')).toEqual({ count_dice: null, count_fixed: 6 })
    expect(parseCount('3d4')).toEqual({ count_dice: '3d4', count_fixed: null })
    expect(parseCount('0')).toBeNull()
    expect(parseCount('junk')).toBeNull()
    expect(parseCount('')).toBeNull()
  })
})

describe('encounter builders patch only their own field', () => {
  test('adding the first line creates a whole default encounter', () => {
    const ops = encounterAddLineOps(withArea({}), TARGET, LINE)
    expect(ops).toEqual([
      {
        op: 'set_encounter',
        dungeon_id: 'dungeon-1',
        level_number: 1,
        area_id: '1',
        encounter: { monsters: [LINE], alignment: null, aware: false, stance: null },
      },
    ])
  })

  test('adding to an existing encounter appends, carrying every other field', () => {
    const existing = { monsters: [LINE], alignment: 'chaotic' as const, aware: true, stance: null }
    const second: KeyedMonster = { template_id: 'skeleton', count_dice: null, count_fixed: 6 }
    const ops = encounterAddLineOps(withArea({ encounter: existing }), TARGET, second)
    expect(ops[0]).toMatchObject({
      encounter: { monsters: [LINE, second], alignment: 'chaotic', aware: true },
    })
  })

  test('a patch carries the committed encounter with one field changed', () => {
    const existing = { monsters: [LINE], alignment: null, aware: false, stance: null }
    const ops = encounterPatchOps(withArea({ encounter: existing }), TARGET, { aware: true })
    expect(ops[0]).toMatchObject({ encounter: { ...existing, aware: true } })
  })

  test('setting a line replaces exactly that index', () => {
    const second: KeyedMonster = { template_id: 'skeleton', count_dice: null, count_fixed: 6 }
    const document = withArea({
      encounter: { monsters: [LINE, second], alignment: null, aware: false, stance: null },
    })
    const replacement: KeyedMonster = {
      template_id: 'skeleton',
      count_dice: '2d4',
      count_fixed: null,
    }
    const ops = encounterSetLineOps(document, TARGET, 1, replacement)
    expect(ops[0]).toMatchObject({ encounter: { monsters: [LINE, replacement] } })
  })

  test('the last line never removes — monsters has min_length 1', () => {
    const document = withArea({
      encounter: { monsters: [LINE], alignment: null, aware: false, stance: null },
    })
    expect(encounterRemoveLineOps(document, TARGET, 0)).toEqual([])
  })

  test('builders answer [] when the target vanished', () => {
    const gone = { ...TARGET, areaId: 'no-such-area' }
    expect(encounterPatchOps(withArea({}), gone, { aware: true })).toEqual([])
    expect(encounterAddLineOps(withArea({}), gone, LINE)).toEqual([])
  })
})

describe('alignment intersection', () => {
  const optionsFor = (id: string) =>
    ({
      orc: ['chaotic' as const],
      bandit: ['neutral' as const, 'chaotic' as const],
    })[id] ?? null

  test('intersects every resolvable line', () => {
    expect(alignmentIntersection([LINE], optionsFor)).toEqual(['chaotic'])
    const bandit: KeyedMonster = { template_id: 'bandit', count_dice: null, count_fixed: 1 }
    expect(alignmentIntersection([bandit], optionsFor)).toEqual(['neutral', 'chaotic'])
    expect(alignmentIntersection([LINE, bandit], optionsFor)).toEqual(['chaotic'])
  })

  test('a dangling template constrains nothing', () => {
    const unknown: KeyedMonster = { template_id: 'gloom-stalker', count_dice: null, count_fixed: 1 }
    expect(alignmentIntersection([unknown], optionsFor)).toEqual(['lawful', 'neutral', 'chaotic'])
  })
})

describe('trap builders', () => {
  test('the kind pins by location: room for areas, treasure with open trigger for caches', () => {
    expect(emptyTrap('room')).toMatchObject({ kind: 'room', trigger: 'enter' })
    expect(emptyTrap('treasure')).toMatchObject({ kind: 'treasure', trigger: 'open' })
  })

  test('clearing damage clears the volley — the validator implication by construction', () => {
    const effect = patchTrapEffect(
      { ...emptyTrap('room').effect, damage_dice: '1d4', volley_dice: '1d6' },
      { damage_dice: null },
    )
    expect(effect.volley_dice).toBeNull()
  })

  test('clearing the condition clears every duration field', () => {
    const effect = patchTrapEffect(
      {
        ...emptyTrap('room').effect,
        condition: 'blind',
        condition_duration_dice: '1d4',
        condition_duration_unit: 'turn',
      },
      { condition: null },
    )
    expect(effect.condition_duration_dice).toBeNull()
    expect(effect.condition_duration_amount).toBeNull()
    expect(effect.condition_duration_unit).toBeNull()
  })

  test('a trap patch carries the committed trap with the patch merged', () => {
    const trap = emptyTrap('room')
    const ops = areaTrapPatchOps(withArea({ trap }), TARGET, { trigger: 'open' })
    expect(ops[0]).toMatchObject({ op: 'set_trap', trap: { ...trap, trigger: 'open' } })
  })
})

describe('treasure toggling holds the XOR', () => {
  test('toggling letters builds a letters spec, never both or neither', () => {
    expect(toggleTreasureLetter(null, 'C')).toEqual({ letters: ['C'], unguarded: false })
    expect(toggleTreasureLetter({ letters: ['C'], unguarded: false }, 'A')).toEqual({
      letters: ['C', 'A'],
      unguarded: false,
    })
    expect(toggleTreasureLetter({ letters: ['C', 'A'], unguarded: false }, 'C')).toEqual({
      letters: ['A'],
      unguarded: false,
    })
  })

  test('removing the last letter is refused — the card removes, never empties', () => {
    expect(toggleTreasureLetter({ letters: ['C'], unguarded: false }, 'C')).toBeNull()
  })

  test('toggling from unguarded starts a fresh letters spec', () => {
    expect(toggleTreasureLetter({ letters: [], unguarded: true }, 'C')).toEqual({
      letters: ['C'],
      unguarded: false,
    })
  })
})

describe('feature builders', () => {
  test('feature keys assign the smallest free feature-n across both scopes', () => {
    const document = withArea(
      { features: [feature('feature-1')] },
      { features: [feature('feature-3', { cell: [0, 0] })] },
    )
    const level = document.dungeons[0].levels[0]
    expect(nextFreeFeatureKey(level)).toBe('feature-2')
  })

  test('a feature patch replaces whole-value with the patch merged', () => {
    const existing = feature('feature-1', { description: 'Old.' })
    const document = withArea({ features: [existing] })
    const ops = featurePatchOps(
      document,
      { dungeonId: 'dungeon-1', levelNumber: 1, areaId: '1' },
      'feature-1',
      { description: 'New.' },
    )
    expect(ops).toEqual([
      {
        op: 'set_feature',
        dungeon_id: 'dungeon-1',
        level_number: 1,
        area_id: '1',
        feature_id: 'feature-1',
        feature: { ...existing, description: 'New.' },
      },
    ])
  })

  test('level-scope patches address the level container', () => {
    const existing = feature('feature-1', { cell: [0, 0] })
    const document = withArea({}, { features: [existing] })
    const ops = featurePatchOps(
      document,
      { dungeonId: 'dungeon-1', levelNumber: 1, areaId: null },
      'feature-1',
      { description: 'New.' },
    )
    expect(ops[0]).toMatchObject({ area_id: null, feature: { description: 'New.' } })
  })

  test('a vanished feature answers []', () => {
    const ops = featurePatchOps(
      withArea({}),
      { dungeonId: 'dungeon-1', levelNumber: 1, areaId: '1' },
      'no-such-feature',
      { description: 'New.' },
    )
    expect(ops).toEqual([])
  })
})
