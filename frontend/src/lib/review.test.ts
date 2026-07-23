import { describe, expect, test } from 'vitest'

import {
  buildReviewRows,
  parseFlag,
  parseForgeAreaAddress,
  reviewRowTarget,
  rowFullyDismissed,
  undismissedFlagCount,
} from '@/lib/review'
import { makeDocument, makeForgeReport, makeProjectState } from '@/test/fixtures'
import type { AreaSpec } from '@/types'

describe('parseFlag', () => {
  test('splits the flag:detail grammar on the first colon only', () => {
    expect(parseFlag('monster_unresolved:rat king → grey_ooze')).toEqual({
      flag: 'monster_unresolved',
      detail: 'rat king → grey_ooze',
    })
    // The detail is free text and may itself contain colons.
    expect(parseFlag('low_confidence:count unstated: rat king')).toEqual({
      flag: 'low_confidence',
      detail: 'count unstated: rat king',
    })
  })

  test('a bare flag has no detail', () => {
    expect(parseFlag('geometry_synthesized')).toEqual({
      flag: 'geometry_synthesized',
      detail: null,
    })
  })

  test('an unknown prefix or empty detail answers null — render verbatim, never guess', () => {
    expect(parseFlag('not_a_flag:whatever')).toBeNull()
    expect(parseFlag('geometry_synthesized:')).toBeNull()
  })
})

describe('buildReviewRows', () => {
  const sidecarWith = (marks: { address: string; flag: string }[]) => {
    return { ...makeProjectState().sidecar, review: marks }
  }

  test('module flags lead, then flagged areas in report order; flagless areas get no row', () => {
    const rows = buildReviewRows(makeForgeReport(), sidecarWith([]))
    expect(rows.map((row) => row.address)).toEqual(['', 'dungeon-1/1/1', 'dungeon-1/1/2'])
    expect(rows[0].label).toBe('Module')
    expect(rows[1].confidence).toBe(0.9)
    expect(rows[2].overridden).toEqual(['description'])
  })

  test('dismissal is per flag at the {address, flag} mark grain', () => {
    const rows = buildReviewRows(
      makeForgeReport(),
      sidecarWith([{ address: 'dungeon-1/1/1', flag: 'geometry_synthesized' }]),
    )
    const row = rows.find((candidate) => candidate.address === 'dungeon-1/1/1')
    expect(row?.flags.map((flag) => flag.dismissed)).toEqual([true, false])
    expect(rowFullyDismissed(row!)).toBe(false)
    // The header counts undismissed flags — the honest work-remaining number.
    expect(undismissedFlagCount(rows)).toBe(3)
  })

  test('a row counts as dismissed when every flag it carries is marked', () => {
    const rows = buildReviewRows(
      makeForgeReport(),
      sidecarWith([
        { address: 'dungeon-1/1/1', flag: 'geometry_synthesized' },
        { address: 'dungeon-1/1/1', flag: 'connection_ambiguous:no target stated' },
      ]),
    )
    const row = rows.find((candidate) => candidate.address === 'dungeon-1/1/1')
    expect(rowFullyDismissed(row!)).toBe(true)
  })
})

describe('reviewRowTarget', () => {
  const area = (id: string): AreaSpec => ({
    id,
    name: '',
    description: '',
    cells: [[0, 0]],
    encounter: null,
    features: [],
    trap: null,
    treasure: null,
  })
  const document = makeDocument()
  document.dungeons[0].levels[0].areas.push(area('1'))

  test('the module row lands on the adventure form', () => {
    expect(reviewRowTarget('', document)).toEqual({ kind: 'adventure' })
  })

  test('an area row lands on its level with the area selected', () => {
    expect(reviewRowTarget('dungeon-1/1/1', document)).toEqual({
      kind: 'level',
      dungeonId: 'dungeon-1',
      levelNumber: 1,
      focus: { type: 'area', areaId: '1' },
    })
  })

  test('a tombstoned area still lands on its level, without a selection', () => {
    expect(reviewRowTarget('dungeon-1/1/999', document)).toEqual({
      kind: 'level',
      dungeonId: 'dungeon-1',
      levelNumber: 1,
    })
  })

  test('an unknown level is unnavigable, never a guessed landing', () => {
    expect(reviewRowTarget('nowhere/9/1', document)).toBeNull()
  })
})

describe('parseForgeAreaAddress', () => {
  test('parses the dungeon/level/area grammar', () => {
    expect(parseForgeAreaAddress('millstone-warrens/2/1')).toEqual({
      dungeonId: 'millstone-warrens',
      levelNumber: 2,
      areaKey: '1',
    })
  })

  test('rejects malformed addresses', () => {
    expect(parseForgeAreaAddress('only/two')).toBeNull()
    expect(parseForgeAreaAddress('a/x/1')).toBeNull()
    expect(parseForgeAreaAddress('a//1')).toBeNull()
  })
})
