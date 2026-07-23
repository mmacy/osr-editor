import { describe, expect, it } from 'vitest'

import {
  addMonsterTemplateOps,
  autoHitPatch,
  cloneId,
  emptyMonsterAttack,
  findMonsterTemplate,
  formatAbilityParam,
  monsterReferenceCount,
  monsterTemplatePatchOps,
  monsterTemplateRemoveOps,
  monsterTemplateSetOps,
  monsterTemplateUpdateOps,
  parseAbilityParam,
  seedMonsterTemplate,
} from '@/lib/monster-builders'
import { makeDocument } from '@/test/fixtures'
import type { Adventure, MonsterTemplate } from '@/types'

const SEED = seedMonsterTemplate('bespoke-1', 'Bespoke horror')

function documentWithMonsters(...monsters: MonsterTemplate[]): Adventure {
  return makeDocument({ monsters })
}

describe('seedMonsterTemplate', () => {
  it('seeds the pinned stock 1-HD block', () => {
    expect(SEED.id).toBe('bespoke-1')
    expect(SEED.name).toBe('Bespoke horror')
    // The editor-authored conventions: unpaged, no compiler provenance.
    expect(SEED.page).toBe('')
    expect(SEED.overrides_applied).toEqual([])
    // Unarmoured, 1d8, the 1 HD attack row, 120' (40'), the 1-3 save band.
    expect(SEED.ac).toBe(9)
    expect(SEED.ac_ascending).toBe(10)
    expect(SEED.attack_roll_required).toBe(true)
    expect(SEED.hit_dice).toEqual({
      count: 1,
      die: 8,
      modifier: 0,
      asterisks: 0,
      average_hp: null,
      fixed_hp: null,
    })
    expect(SEED.thac0).toBe(19)
    expect(SEED.attack_bonus).toBe(0)
    expect(SEED.attacks).toEqual([{ attacks: [emptyMonsterAttack()] }])
    expect(SEED.attacks[0].attacks[0].by_weapon).toBe(true)
    expect(SEED.movement).toEqual([{ rate_feet: 120, encounter_rate_feet: 40, descriptor: null }])
    expect(SEED.saves.values).toEqual({
      death: 12,
      wands: 13,
      paralysis: 14,
      breath: 15,
      spells: 16,
    })
    expect(SEED.saves.save_as).toBe('1')
    expect(SEED.morale).toBe(7)
    expect(SEED.alignment).toEqual({ options: ['neutral'], usual: null })
    expect(SEED.xp).toBe(10)
    expect(SEED.number_appearing.dungeon).toEqual({ dice: '1d6', fixed: null, see_below: false })
    expect(SEED.number_appearing.lair).toEqual({ dice: '1d6', fixed: null, see_below: false })
    expect(SEED.treasure.letters).toEqual([])
    expect(SEED.abilities).toEqual([])
    expect(SEED.defenses).toEqual({
      harmed_only_by: [],
      reductions: [],
      energy: {},
      condition_immunities: [],
    })
    expect(SEED.categories).toEqual([])
  })
})

describe('cloneId', () => {
  it('prefills the next-free <source-id>-<n> over the given ids', () => {
    expect(cloneId('orc', new Set(['orc']))).toBe('orc-1')
    expect(cloneId('orc', new Set(['orc', 'orc-1', 'orc-3']))).toBe('orc-2')
    expect(cloneId('orc', new Set(['orc', 'orc-1', 'orc-2']))).toBe('orc-3')
  })
})

describe('autoHitPatch', () => {
  it('disabling the hit roll clears both ACs in the same gesture', () => {
    expect(autoHitPatch(false)).toEqual({
      attack_roll_required: false,
      ac: null,
      ac_ascending: null,
    })
  })

  it('re-enabling seeds the unarmoured pair', () => {
    expect(autoHitPatch(true)).toEqual({ attack_roll_required: true, ac: 9, ac_ascending: 10 })
  })
})

describe('monsterReferenceCount', () => {
  it('counts keyed-encounter lines and wandering rows', () => {
    const document = makeDocument()
    const level = document.dungeons[0].levels[0]
    level.areas = [
      {
        id: '1',
        name: '',
        description: '',
        cells: [[1, 1]],
        encounter: {
          monsters: [
            { template_id: 'bespoke-1', count_dice: null, count_fixed: 2 },
            { template_id: 'orc', count_dice: '1d4', count_fixed: null },
          ],
          alignment: null,
          aware: false,
          stance: null,
        },
        features: [],
        trap: null,
        treasure: null,
      },
    ]
    level.wandering = {
      chance_in_six: 1,
      interval_turns: 2,
      table: {
        id: 't',
        label: 'T',
        min_level: 1,
        max_level: null,
        rows: [
          {
            roll: 1,
            name: 'row',
            entry: { kind: 'monster', monster_ids: ['bespoke-1'], variant_dice: null },
            count_dice: null,
            count_fixed: 1,
          },
        ],
        overrides_applied: [],
      },
    }
    expect(monsterReferenceCount(document, 'bespoke-1')).toBe(2)
    expect(monsterReferenceCount(document, 'orc')).toBe(1)
    expect(monsterReferenceCount(document, 'unused')).toBe(0)
  })
})

describe('the op builders', () => {
  it('add wraps the template', () => {
    expect(addMonsterTemplateOps(SEED)).toEqual([{ op: 'add_monster_template', template: SEED }])
  })

  it('set targets by id with the whole template', () => {
    expect(monsterTemplateSetOps('bespoke-1', SEED)).toEqual([
      { op: 'set_monster_template', template_id: 'bespoke-1', template: SEED },
    ])
  })

  it('remove targets by id', () => {
    expect(monsterTemplateRemoveOps('bespoke-1')).toEqual([
      { op: 'remove_monster_template', template_id: 'bespoke-1' },
    ])
  })

  it('patch computes the whole next template against the committed document', () => {
    const document = documentWithMonsters(SEED)
    const ops = monsterTemplatePatchOps(document, 'bespoke-1', { morale: 9 })
    expect(ops).toEqual([
      {
        op: 'set_monster_template',
        template_id: 'bespoke-1',
        template: { ...SEED, morale: 9 },
      },
    ])
  })

  it('patch skips the batch when the template vanished', () => {
    expect(monsterTemplatePatchOps(makeDocument(), 'gone', { morale: 9 })).toEqual([])
  })

  it('update computes collection edits inside the queue and null skips', () => {
    const document = documentWithMonsters(SEED)
    const ops = monsterTemplateUpdateOps(document, 'bespoke-1', (committed) => ({
      categories: [...committed.categories, 'undead'],
    }))
    expect(ops).toHaveLength(1)
    expect(ops[0]).toMatchObject({ op: 'set_monster_template' })
    const skipped = monsterTemplateUpdateOps(document, 'bespoke-1', () => null)
    expect(skipped).toEqual([])
  })
})

describe('findMonsterTemplate', () => {
  it('answers the bundled template or null', () => {
    const document = documentWithMonsters(SEED)
    expect(findMonsterTemplate(document, 'bespoke-1')).toEqual(SEED)
    expect(findMonsterTemplate(document, 'nope')).toBeNull()
  })
})

describe('ability params', () => {
  it('parses JSON fragments to param-typed values', () => {
    expect(parseAbilityParam('3')).toBe(3)
    expect(parseAbilityParam('true')).toBe(true)
    expect(parseAbilityParam('"cone"')).toBe('cone')
    expect(parseAbilityParam('[1, "fire"]')).toEqual([1, 'fire'])
  })

  it('treats non-JSON text as a plain string', () => {
    expect(parseAbilityParam('cone')).toBe('cone')
  })

  it('rejects empty and non-param JSON shapes', () => {
    expect(parseAbilityParam('')).toBeNull()
    expect(parseAbilityParam('{"nested": true}')).toBeNull()
    expect(parseAbilityParam('[[1]]')).toBeNull()
  })

  it('formats strings raw and everything else as JSON', () => {
    expect(formatAbilityParam('cone')).toBe('cone')
    expect(formatAbilityParam(3)).toBe('3')
    expect(formatAbilityParam(true)).toBe('true')
    expect(formatAbilityParam([1, 'fire'])).toBe('[1,"fire"]')
  })
})
