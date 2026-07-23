import { describe, expect, test } from 'vitest'

import {
  EMPTY_STAT_FORM,
  formFromOverride,
  patchFromForm,
  type StatBlockFormValues,
} from '@/lib/statblock-form'
import type { StatBlockOverride } from '@/types'

describe('patchFromForm', () => {
  test('only filled fields travel — absent means untouched', () => {
    const values: StatBlockFormValues = {
      ...EMPTY_STAT_FORM,
      ac: '7 [12]',
      hit_dice: '2*',
      morale: '10',
      attacks: '1 chill touch (1d4 + special)\n',
    }
    expect(patchFromForm(values)).toEqual({
      ac: '7 [12]',
      hit_dice: '2*',
      morale: 10,
      attacks: ['1 chill touch (1d4 + special)'],
    })
  })

  test('multiline fields split into one entry per printed line', () => {
    const values: StatBlockFormValues = {
      ...EMPTY_STAT_FORM,
      special: 'Harmed only by silver.\n\nRegenerates 1 hp per round.',
    }
    expect(patchFromForm(values)).toEqual({
      special: ['Harmed only by silver.', 'Regenerates 1 hp per round.'],
    })
  })

  test('out-of-band numerics are dropped, not sent to fail server-side', () => {
    const values: StatBlockFormValues = { ...EMPTY_STAT_FORM, morale: '13', hp: '0', xp: '-5' }
    expect(patchFromForm(values)).toBeNull()
  })

  test('an all-empty form answers null — forge rejects an entry that replaces nothing', () => {
    expect(patchFromForm(EMPTY_STAT_FORM)).toBeNull()
  })
})

describe('formFromOverride', () => {
  test('prefills from an existing entry, nulls rendering empty', () => {
    const entry: StatBlockOverride = {
      ac: '5 [14]',
      ac_notation: 'dual',
      thac0: null,
      hit_dice: null,
      class_level: null,
      hp: 9,
      attacks: ['1 bite (1d6)'],
      movement: null,
      saves: null,
      morale: 10,
      alignment: null,
      xp: null,
      number_appearing: null,
      special: null,
      reason: 'printed stat block corrected',
    }
    const values = formFromOverride(entry)
    expect(values.ac).toBe('5 [14]')
    expect(values.ac_notation).toBe('dual')
    expect(values.hp).toBe('9')
    expect(values.attacks).toBe('1 bite (1d6)')
    expect(values.thac0).toBe('')
  })

  test('no entry prefills the empty form', () => {
    expect(formFromOverride(undefined)).toEqual(EMPTY_STAT_FORM)
  })
})
