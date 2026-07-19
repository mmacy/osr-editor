import { describe, expect, test } from 'vitest'

import {
  formatAreaContents,
  formatCoins,
  formatCount,
  formatEncounter,
  formatFeature,
  formatHitDice,
  formatMonsterLine,
  formatTrap,
  formatTreasure,
  formatValuables,
  formatWandering,
  parseDice,
  variantDiceSpan,
} from '@/lib/notation'
import type { FeatureSpec, KeyedEncounter, TrapSpec } from '@/types'

const NAMES: Record<string, string> = { orc: 'orc', skeleton: 'skeleton' }
const nameFor = (id: string) => NAMES[id] ?? id

const coins = (overrides: Partial<FeatureSpec['coins']> = {}): FeatureSpec['coins'] => ({
  pp: 0,
  gp: 0,
  ep: 0,
  sp: 0,
  cp: 0,
  ...overrides,
})

const feature = (overrides: Partial<FeatureSpec> = {}): FeatureSpec => ({
  id: 'feature-1',
  kind: 'custom',
  description: '',
  cell: null,
  item_ids: [],
  coins: coins(),
  valuables: [],
  trap: null,
  ...overrides,
})

const trap = (
  overrides: Partial<TrapSpec['effect']> = {},
  trigger: TrapSpec['trigger'] = 'enter',
): TrapSpec => ({
  kind: 'room',
  trigger,
  affects: 'triggerer',
  effect: {
    damage_dice: null,
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
    ...overrides,
  },
})

describe('the dice mirror', () => {
  test.each([
    ['3d6', { count: 3, sides: 6, modifier: 0, multiplier: 1 }],
    ['d%', { count: 1, sides: 100, modifier: 0, multiplier: 1 }],
    ['1d4-1', { count: 1, sides: 4, modifier: -1, multiplier: 1 }],
    ['2d6+1×10', { count: 2, sides: 6, modifier: 1, multiplier: 10 }],
    ['2D6x10', { count: 2, sides: 6, modifier: 0, multiplier: 10 }],
    [' 1d8 ', { count: 1, sides: 8, modifier: 0, multiplier: 1 }],
  ])('parses %s', (text, expected) => {
    expect(parseDice(text)).toEqual(expected)
  })

  test.each(['d5', '0d6', '01d6', 'd', '3d6 +1', '1d6+', 'x10', '1d6×10+1', 'nonsense', '³d6'])(
    'rejects %s',
    (text) => {
      expect(parseDice(text)).toBeNull()
    },
  )

  test('variantDiceSpan computes the pool span and refuses multipliers', () => {
    // 1d8 spans 8 values; 2d4 spans 1..8 → 7 values, offset from 2.
    expect(variantDiceSpan('1d8')).toBe(8)
    expect(variantDiceSpan('2d4')).toBe(7)
    expect(variantDiceSpan('1d6×10')).toBeNull()
    expect(variantDiceSpan('junk')).toBeNull()
  })
})

describe('counts and encounters', () => {
  test('a count renders the dice verbatim or the fixed integer', () => {
    expect(formatCount('3d4', null)).toBe('3d4')
    expect(formatCount(null, 6)).toBe('6')
  })

  test('a monster line is count × name', () => {
    expect(
      formatMonsterLine({ template_id: 'orc', count_dice: '3d4', count_fixed: null }, nameFor),
    ).toBe('3d4 × orc')
    expect(
      formatMonsterLine({ template_id: 'skeleton', count_dice: null, count_fixed: 6 }, nameFor),
    ).toBe('6 × skeleton')
  })

  test('an unknown template id falls back to the id itself', () => {
    expect(
      formatMonsterLine(
        { template_id: 'gloom-stalker', count_dice: null, count_fixed: 1 },
        nameFor,
      ),
    ).toBe('1 × gloom-stalker')
  })

  test('encounter lines join with +', () => {
    const encounter: KeyedEncounter = {
      monsters: [
        { template_id: 'orc', count_dice: '3d4', count_fixed: null },
        { template_id: 'skeleton', count_dice: null, count_fixed: 6 },
      ],
      alignment: null,
      aware: false,
      stance: null,
    }
    expect(formatEncounter(encounter, nameFor)).toBe('3d4 × orc + 6 × skeleton')
  })
})

describe('treasure, coins, valuables', () => {
  test('treasure renders letters or unguarded', () => {
    expect(formatTreasure({ letters: ['C'], unguarded: false })).toBe('type C')
    expect(formatTreasure({ letters: ['A', 'C'], unguarded: false })).toBe('types A, C')
    expect(formatTreasure({ letters: [], unguarded: true })).toBe('unguarded')
  })

  test('coins render nonzero denominations in pp/gp/ep/sp/cp order', () => {
    expect(formatCoins(coins({ gp: 120, sp: 30 }))).toBe('120 gp, 30 sp')
    expect(formatCoins(coins({ cp: 5, pp: 2 }))).toBe('2 pp, 5 cp')
    expect(formatCoins(coins())).toBe('')
  })

  test('valuables count by kind', () => {
    expect(
      formatValuables([
        { kind: 'gem', name: '', value_gp: 50, weight_coins: 1 },
        { kind: 'gem', name: '', value_gp: 100, weight_coins: 1 },
        { kind: 'jewellery', name: 'Signet ring', value_gp: 300, weight_coins: 10 },
      ]),
    ).toBe('2 gems, 1 jewellery')
    expect(formatValuables([{ kind: 'gem', name: '', value_gp: 50, weight_coins: 1 }])).toBe(
      '1 gem',
    )
  })
})

describe('traps', () => {
  test('trigger plus populated effect parts in model field order', () => {
    expect(
      formatTrap(
        trap({ damage_dice: '2d6', save: { category: 'breath', modifier: 0, on_save: 'half' } }),
      ),
    ).toBe('enter: 2d6, save vs. breath for half')
  })

  test('kills renders save-or-die', () => {
    expect(
      formatTrap(
        trap({ save: { category: 'death', modifier: 0, on_save: 'negates' }, kills: true }, 'open'),
      ),
    ).toBe('open: save vs. death or dies')
  })

  test('a negating save renders negates', () => {
    expect(
      formatTrap(trap({ save: { category: 'spells', modifier: -2, on_save: 'negates' } })),
    ).toBe('enter: save vs. spells negates')
  })

  test('a volley rides its per-projectile damage', () => {
    expect(formatTrap(trap({ damage_dice: '1d4', volley_dice: '1d6' }))).toBe(
      'enter: 1d4, volley 1d6',
    )
  })

  test('a condition carries its duration', () => {
    expect(
      formatTrap(
        trap({
          condition: 'blind',
          condition_duration_dice: '1d4',
          condition_duration_unit: 'turn',
        }),
      ),
    ).toBe('enter: blind 1d4 turns')
    expect(
      formatTrap(
        trap({
          condition: 'poisoned',
          condition_duration_amount: 1,
          condition_duration_unit: 'day',
        }),
      ),
    ).toBe('enter: poisoned 1 day')
  })

  test('falls and slides render tersely', () => {
    expect(formatTrap(trap({ fall_feet: 10 }))).toBe("enter: 10' fall")
    expect(
      formatTrap(
        trap({
          transition: {
            kind: 'chute',
            position: [0, 0],
            to_dungeon_id: 'mill-caves',
            to_level_number: 2,
            to_position: [3, 3],
            to_facing: 'north',
          },
        }),
      ),
    ).toBe('enter: slide to mill-caves level 2')
  })

  test('manual prose rides verbatim when alone, dash-joined otherwise', () => {
    expect(formatTrap(trap({ manual: 'The idol whispers.' }))).toBe('enter: The idol whispers.')
    expect(formatTrap(trap({ damage_dice: '1d6', manual: 'Resets each dawn.' }))).toBe(
      'enter: 1d6 — Resets each dawn.',
    )
  })
})

describe('features and wandering', () => {
  test('a cache summarizes payload and trap state', () => {
    expect(
      formatFeature(
        feature({
          kind: 'treasure_cache',
          coins: coins({ gp: 120 }),
          valuables: [
            { kind: 'gem', name: '', value_gp: 50, weight_coins: 1 },
            { kind: 'gem', name: '', value_gp: 50, weight_coins: 1 },
          ],
          item_ids: ['sword'],
          trap: trap({ damage_dice: '1d4' }, 'open'),
        }),
      ),
    ).toBe('cache: 120 gp, 2 gems, 1 item — trapped')
  })

  test('payloadless kinds render the bare label', () => {
    expect(formatFeature(feature({ kind: 'construction_trick' }))).toBe('trick')
    expect(formatFeature(feature())).toBe('custom')
  })

  test('wandering renders chance, interval, and the custom-table flag', () => {
    expect(formatWandering({ chance_in_six: 1, interval_turns: 2, table: null })).toBe(
      '1-in-6 every 2 turns',
    )
    expect(formatWandering({ chance_in_six: 2, interval_turns: 1, table: null })).toBe(
      '2-in-6 every turn',
    )
    expect(
      formatWandering({
        chance_in_six: 1,
        interval_turns: 2,
        table: {
          id: 't',
          label: 'T',
          min_level: 1,
          max_level: null,
          rows: [],
          overrides_applied: [],
        },
      }),
    ).toBe('1-in-6 every 2 turns, custom table')
  })
})

describe('hit dice and area contents', () => {
  test('hit dice render as the stat block prints them', () => {
    expect(
      formatHitDice({
        count: 3,
        die: 8,
        modifier: 1,
        asterisks: 1,
        average_hp: null,
        fixed_hp: null,
      }),
    ).toBe('3+1*')
    expect(
      formatHitDice({
        count: 1,
        die: 8,
        modifier: -1,
        asterisks: 0,
        average_hp: null,
        fixed_hp: null,
      }),
    ).toBe('1-1')
    expect(
      formatHitDice({
        count: 1,
        die: 4,
        modifier: 0,
        asterisks: 0,
        average_hp: null,
        fixed_hp: null,
      }),
    ).toBe('½')
    expect(
      formatHitDice({ count: 0, die: 8, modifier: 0, asterisks: 0, average_hp: null, fixed_hp: 1 }),
    ).toBe('1hp')
  })

  test('area contents join every kind with middots', () => {
    const contents = formatAreaContents(
      {
        encounter: {
          monsters: [{ template_id: 'orc', count_dice: '3d4', count_fixed: null }],
          alignment: null,
          aware: false,
          stance: null,
        },
        treasure: { letters: ['C'], unguarded: false },
        trap: trap({ damage_dice: '2d6' }),
        features: [feature({ kind: 'construction_trick' })],
      },
      nameFor,
    )
    expect(contents).toBe('3d4 × orc · type C · enter: 2d6 · trick')
  })
})
