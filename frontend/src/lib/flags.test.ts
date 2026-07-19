import { describe, expect, test } from 'vitest'

import { buildReviewRows, parseFlag, undismissedCount, visibleRows } from '@/lib/flags'
import type { ExtractionReport, ReviewMark } from '@/types'

test('parseFlag splits on the first colon only', () => {
  expect(parseFlag('geometry_synthesized')).toEqual({
    raw: 'geometry_synthesized',
    flag: 'geometry_synthesized',
    detail: null,
  })
  expect(parseFlag('monster_unresolved:drowned one')).toEqual({
    raw: 'monster_unresolved:drowned one',
    flag: 'monster_unresolved',
    detail: 'drowned one',
  })
  // A detail may itself contain colons.
  expect(parseFlag('transition_guessed:sunken-vault/2/1').detail).toBe('sunken-vault/2/1')
})

function report(overrides: Partial<ExtractionReport> = {}): ExtractionReport {
  return {
    schema_version: 1,
    osrforge_version: '0.1.0',
    module: { title: 'M', pages: 2 },
    validation: { passed: true, errors: [] },
    monsters: { resolved: 0, unresolved: [], custom: [] },
    usage: { input_tokens: 0, output_tokens: 0 },
    areas: [],
    flags: [],
    findings: [],
    ...overrides,
  }
}

describe('buildReviewRows', () => {
  test('the module row leads, then flag-bearing areas in report order; flagless areas get no row', () => {
    const rows = buildReviewRows(
      report({
        flags: ['low_confidence:town name unstated'],
        areas: [
          { id: 'd/1/1', source_pages: [1], confidence: 0.9, flags: [], overridden: [] },
          {
            id: 'd/1/2',
            source_pages: [1],
            confidence: 0.3,
            flags: ['low_confidence:count'],
            overridden: [],
          },
        ],
      }),
      [],
    )
    expect(rows.map((r) => r.address)).toEqual(['', 'dungeon:d/level:1/area:2'])
    expect(rows[0].areaKey).toBeNull()
    expect(rows[1].areaKey).toBe('2')
    expect(rows[1].confidence).toBe(0.3)
  })

  test('dismissal marks per flag, row dismissed when all flags are, and the count is undismissed flags', () => {
    const areas = [
      {
        id: 'd/1/2',
        source_pages: [1],
        confidence: 0.3,
        flags: ['low_confidence:a', 'treasure_unparsed:b'],
        overridden: [],
      },
    ]
    const marks: ReviewMark[] = [{ address: 'dungeon:d/level:1/area:2', flag: 'low_confidence:a' }]
    const rows = buildReviewRows(report({ areas }), marks)
    expect(rows[0].flags[0].dismissed).toBe(true)
    expect(rows[0].flags[1].dismissed).toBe(false)
    expect(rows[0].dismissed).toBe(false)
    expect(undismissedCount(rows)).toBe(1)

    const allMarked: ReviewMark[] = [
      { address: 'dungeon:d/level:1/area:2', flag: 'low_confidence:a' },
      { address: 'dungeon:d/level:1/area:2', flag: 'treasure_unparsed:b' },
    ]
    const dismissedRows = buildReviewRows(report({ areas }), allMarked)
    expect(dismissedRows[0].dismissed).toBe(true)
    expect(undismissedCount(dismissedRows)).toBe(0)
    // The filter hides a fully-dismissed row.
    expect(visibleRows(dismissedRows, false)).toHaveLength(0)
    expect(visibleRows(dismissedRows, true)).toHaveLength(1)
  })
})
