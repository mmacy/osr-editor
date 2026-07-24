import { describe, expect, test } from 'vitest'

import {
  followUpLabel,
  statblockFills,
  statblockPreviewFor,
  stockRollLine,
  trapFollowUpNote,
  treasurePreviewFor,
} from '@/lib/aids'
import type { StatblockPreviewResponse, StockRoll } from '@/types'

function roll(overrides: Partial<StockRoll> = {}): StockRoll {
  return {
    area_id: '1',
    address: 'dungeon:d/level:1/area:1',
    contents: 'monster',
    treasure_present: false,
    summary: [],
    follow_ups: [],
    ...overrides,
  }
}

describe('follow-up copy', () => {
  test('names each kind honestly', () => {
    expect(followUpLabel({ kind: 'special', npc_kind: null, npc_count: null })).toMatch(
      /describe by hand/i,
    )
    expect(followUpLabel({ kind: 'trap_design', npc_kind: null, npc_count: null })).toMatch(
      /trap card/i,
    )
    expect(followUpLabel({ kind: 'no_lair_treasure', npc_kind: null, npc_count: null })).toMatch(
      /yields none/i,
    )
  })

  test('an NPC party carries its rolled kind and count', () => {
    expect(followUpLabel({ kind: 'npc_party', npc_kind: 'basic', npc_count: 4 })).toContain(
      'basic × 4',
    )
  })
})

describe('the report line', () => {
  test('joins the contents label and the module-notation summaries', () => {
    const line = stockRollLine(roll({ contents: 'monster', summary: ['5 × acolyte', 'type C'] }))
    expect(line).toBe('Monster · 5 × acolyte · type C')
  })

  test('an empty room with treasure reads as such', () => {
    expect(
      stockRollLine(roll({ contents: 'empty', treasure_present: true, summary: ['unguarded'] })),
    ).toBe('Empty (treasure) · unguarded')
  })
})

describe('the trap-over-treasure steer', () => {
  test('appears only when a trap room also rolled treasure', () => {
    const trapOnly = roll({
      contents: 'trap',
      follow_ups: [{ kind: 'trap_design', npc_kind: null, npc_count: null }],
    })
    expect(trapFollowUpNote(trapOnly)).toBeNull()
    const withTreasure = roll({
      contents: 'trap',
      treasure_present: true,
      follow_ups: [{ kind: 'trap_design', npc_kind: null, npc_count: null }],
    })
    expect(trapFollowUpNote(withTreasure)).toMatch(/guard the treasure/i)
  })
})

describe('the preview request builders', () => {
  test('treasure letters vs unguarded mirror AreaTreasureSpec', () => {
    expect(treasurePreviewFor({ letters: ['A', 'C'], unguarded: false }, 'expert', 3)).toEqual({
      kind: 'treasure',
      letters: ['A', 'C'],
      unguarded_level: null,
      tier: 'expert',
      samples: 3,
    })
    expect(treasurePreviewFor({ letters: [], unguarded: true }, 'basic', 5)).toEqual({
      kind: 'treasure',
      letters: [],
      unguarded_level: 5,
      tier: 'basic',
      samples: 3,
    })
  })

  test('statblock request carries the hit dice', () => {
    const hd = { count: 2, die: 8, modifier: 2, asterisks: 1, average_hp: null, fixed_hp: null }
    expect(statblockPreviewFor(hd)).toEqual({ kind: 'statblock', hit_dice: hd })
  })
})

describe('derive-from-HD fills', () => {
  test('maps the statblock preview to the monster editor fields', () => {
    const preview: StatblockPreviewResponse = {
      kind: 'statblock',
      xp: 35,
      thac0: 17,
      attack_bonus: 2,
      save_band: '1–3',
      saves: { death: 12, wands: 13, paralysis: 14, breath: 15, spells: 16 },
    }
    expect(statblockFills(preview)).toEqual({
      xp: 35,
      thac0: 17,
      attack_bonus: 2,
      saves: { death: 12, wands: 13, paralysis: 14, breath: 15, spells: 16 },
    })
  })
})
