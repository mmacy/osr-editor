import { describe, expect, test } from 'vitest'

import {
  canRegeneratePreviews,
  defaultWorkdirPath,
  estimateRows,
  firstIncompleteStage,
  formatUsd,
  isActive,
  modelStagesFrom,
  parseKnobEntry,
} from '@/lib/conversion'
import { makeCostEstimate, makeStageRows } from '@/test/fixtures'

describe('defaultWorkdirPath', () => {
  test('is the CLI default: <pdf-dir>/<pdf-stem>.forge', () => {
    expect(defaultWorkdirPath('/modules/B2 Keep.pdf')).toBe('/modules/B2 Keep.forge')
    expect(defaultWorkdirPath('/modules/module.PDF')).toBe('/modules/module.forge')
    expect(defaultWorkdirPath('C:\\modules\\keep.pdf')).toBe('C:\\modules\\keep.forge')
  })

  test('a file with no .pdf suffix keeps its whole name', () => {
    expect(defaultWorkdirPath('/modules/scan')).toBe('/modules/scan.forge')
  })

  test('empty input answers empty', () => {
    expect(defaultWorkdirPath('')).toBe('')
    expect(defaultWorkdirPath('   ')).toBe('')
  })
})

describe('the lifecycle predicates', () => {
  test('only the two worker-held states are active', () => {
    expect(isActive('estimating')).toBe(true)
    expect(isActive('running')).toBe(true)
    for (const state of ['estimated', 'ready', 'completed', 'failed', 'cancelled'] as const) {
      expect(isActive(state)).toBe(false)
    }
  })

  test('the resume starts at the first incomplete runnable stage', () => {
    expect(firstIncompleteStage(makeStageRows())).toBe('survey')
    expect(firstIncompleteStage(makeStageRows({ survey: 'completed' }))).toBe('content')
    // A failed stage is incomplete: the resume redoes it.
    expect(firstIncompleteStage(makeStageRows({ survey: 'failed' }))).toBe('survey')
  })

  test('a fully complete chain falls back to assemble', () => {
    const done = makeStageRows({
      survey: 'completed',
      content: 'completed',
      monsters: 'completed',
      geometry: 'completed',
      assemble: 'completed',
    })
    expect(firstIncompleteStage(done)).toBe('assemble')
  })

  test('the model stages a resume runs are what the confirm copy names', () => {
    expect(modelStagesFrom('preprocess')).toEqual(['survey', 'content', 'monsters'])
    expect(modelStagesFrom('monsters')).toEqual(['monsters'])
    expect(modelStagesFrom('assemble')).toEqual([])
  })

  test('previews need the survey and content caches they are rendered from', () => {
    expect(canRegeneratePreviews(makeStageRows())).toBe(false)
    expect(canRegeneratePreviews(makeStageRows({ survey: 'completed' }))).toBe(false)
    expect(
      canRegeneratePreviews(makeStageRows({ survey: 'completed', content: 'completed' })),
    ).toBe(true)
  })
})

describe('the estimate formatting', () => {
  test('the cost reads as money, and a sub-cent figure never reads as free', () => {
    expect(formatUsd(0.11)).toBe('$0.11')
    expect(formatUsd(12.5)).toBe('$12.50')
    expect(formatUsd(0.001)).toBe('under $0.01')
    expect(formatUsd(0)).toBe('$0.00')
  })

  test('the per-stage rows are the three model stages, in chain order', () => {
    expect(estimateRows(makeCostEstimate()).map((row) => row.label)).toEqual([
      'survey',
      'content',
      'monsters',
    ])
  })
})

describe('parseKnobEntry', () => {
  test('splits knob=value, numbers as numbers, strings as strings', () => {
    expect(parseKnobEntry('unresolved_fallback=omit')).toEqual({ unresolved_fallback: 'omit' })
    expect(parseKnobEntry('render_dpi=300')).toEqual({ render_dpi: 300 })
  })

  test('malformed input answers null', () => {
    expect(parseKnobEntry('')).toBeNull()
    expect(parseKnobEntry('no-equals')).toBeNull()
    expect(parseKnobEntry('=value')).toBeNull()
    expect(parseKnobEntry('knob=')).toBeNull()
  })
})
