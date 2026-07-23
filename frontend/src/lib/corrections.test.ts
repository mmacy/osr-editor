import { describe, expect, test } from 'vitest'

import { correctionTarget, listCorrections } from '@/lib/corrections'
import { makeDocument, makeForgeState, makeProjectState } from '@/test/fixtures'
import type { Overrides } from '@/types'

const OVERRIDES: Overrides = {
  monsters: {
    'rat king': { template_id: 'giant_rat', reason: 'remapped to giant_rat' },
  },
  monster_templates: {
    'mill wisp': {
      ac: null,
      ac_notation: null,
      thac0: null,
      hit_dice: null,
      class_level: null,
      hp: null,
      attacks: null,
      movement: null,
      saves: null,
      morale: 9,
      alignment: null,
      xp: 35,
      number_appearing: null,
      special: null,
      reason: 'printed stat block corrected',
    },
  },
  areas: {
    'dungeon-1/1/2': {
      name: null,
      description: 'Corrected against the page.',
      encounter: null,
      trap: null,
      treasure: null,
      features: null,
      remove: false,
      reason: 'area 2 description corrected against p. 1',
    },
    'dungeon-1/1/3': {
      name: null,
      description: null,
      encounter: null,
      trap: null,
      treasure: null,
      features: null,
      remove: true,
      reason: 'area 3 removed',
    },
  },
  geometry: {
    'dungeon-1/1': {
      areas: { '2': { cells: [[0, 0]] } },
      edges: { '1,0:west': { kind: 'wall', door: null } },
      entrance: null,
      transitions: null,
      reason: 'level 1 edges redrawn',
    },
  },
  town: null,
  module: {
    name: 'Renamed module',
    description: null,
    hooks: null,
    reason: 'module name corrected',
  },
}

function sidecarWithDrafts(drafts: string[]) {
  return { ...makeProjectState().sidecar, auto_reasons: drafts }
}

describe('listCorrections', () => {
  test('flattens every entry, kinds in Overrides field order, entries in file order', () => {
    const entries = listCorrections(OVERRIDES, sidecarWithDrafts([]))
    expect(entries.map((entry) => `${entry.kind}:${entry.key}`)).toEqual([
      'monsters:rat king',
      'monster_templates:mill wisp',
      'areas:dungeon-1/1/2',
      'areas:dungeon-1/1/3',
      'geometry:dungeon-1/1',
      'module:',
    ])
  })

  test('summaries name what each entry does', () => {
    const entries = listCorrections(OVERRIDES, sidecarWithDrafts([]))
    const byKey = new Map(entries.map((entry) => [`${entry.kind}:${entry.key}`, entry]))
    expect(byKey.get('monsters:rat king')?.summary).toBe('remapped to giant_rat')
    expect(byKey.get('monster_templates:mill wisp')?.summary).toBe('printed morale, xp')
    expect(byKey.get('areas:dungeon-1/1/2')?.summary).toBe('description replaced')
    expect(byKey.get('areas:dungeon-1/1/3')?.summary).toBe('removed')
    expect(byKey.get('geometry:dungeon-1/1')?.summary).toContain('cells for 2')
    expect(byKey.get('geometry:dungeon-1/1')?.summary).toContain('1 edge entry')
    expect(byKey.get('module:')?.summary).toBe('name replaced')
  })

  test('the machine-draft badge follows the auto_reasons ledger', () => {
    const entries = listCorrections(
      OVERRIDES,
      sidecarWithDrafts(['monsters:rat king', 'geometry:dungeon-1/1', 'module']),
    )
    const byKey = new Map(entries.map((entry) => [`${entry.kind}:${entry.key}`, entry]))
    expect(byKey.get('monsters:rat king')?.machineDraft).toBe(true)
    expect(byKey.get('monster_templates:mill wisp')?.machineDraft).toBe(false)
    expect(byKey.get('module:')?.machineDraft).toBe(true)
  })

  test('an empty overrides value lists nothing', () => {
    expect(listCorrections(makeForgeState().overrides, sidecarWithDrafts([]))).toEqual([])
  })
})

describe('correctionTarget', () => {
  const document = makeDocument()
  document.dungeons[0].levels[0].areas.push({
    id: '2',
    name: '',
    description: '',
    cells: [[0, 0]],
    encounter: null,
    features: [],
    trap: null,
    treasure: null,
  })
  const entries = listCorrections(OVERRIDES, sidecarWithDrafts([]))
  const byKey = new Map(entries.map((entry) => [`${entry.kind}:${entry.key}`, entry]))

  test('area entries navigate to their area', () => {
    expect(correctionTarget(byKey.get('areas:dungeon-1/1/2')!, document)).toEqual({
      kind: 'level',
      dungeonId: 'dungeon-1',
      levelNumber: 1,
      focus: { type: 'area', areaId: '2' },
    })
  })

  test('a removed area entry navigates to the level without a selection', () => {
    expect(correctionTarget(byKey.get('areas:dungeon-1/1/3')!, document)).toEqual({
      kind: 'level',
      dungeonId: 'dungeon-1',
      levelNumber: 1,
      focus: undefined,
    })
  })

  test('geometry entries navigate to their level; metadata to their forms; names nowhere', () => {
    expect(correctionTarget(byKey.get('geometry:dungeon-1/1')!, document)).toEqual({
      kind: 'level',
      dungeonId: 'dungeon-1',
      levelNumber: 1,
    })
    expect(correctionTarget(byKey.get('module:')!, document)).toEqual({ kind: 'adventure' })
    expect(correctionTarget(byKey.get('monsters:rat king')!, document)).toBeNull()
  })
})
