import { expect, test } from 'vitest'

import {
  dropCollisions,
  dropOps,
  entryReferences,
  resolveClosure,
  sectionReferences,
  shadowedShippedIds,
  structurallyEqual,
  wanderingCopyOps,
  type ShippedMonsters,
} from '@/lib/library-drop'
import { seedMonsterTemplate } from '@/lib/monster-builders'
import { makeDocument } from '@/test/fixtures'
import type {
  Adventure,
  AreaSpec,
  ContentPack,
  ContentPackEntry,
  MonsterTemplate,
  PackSection,
  WanderingSpec,
} from '@/types'

const NO_SHIPPED: ShippedMonsters = { ids: new Set(), byId: {} }

function makeArea(overrides: Partial<AreaSpec> = {}): AreaSpec {
  return {
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
}

function makeEntry(overrides: Partial<ContentPackEntry> = {}): ContentPackEntry {
  return {
    id: 'dungeon:mill/level:1/area:1',
    name: '',
    description: '',
    encounter: null,
    trap: null,
    treasure: null,
    features: [],
    ...overrides,
  }
}

function makePack(overrides: Partial<ContentPack> = {}): ContentPack {
  return {
    id: '',
    name: 'Mill',
    description: '',
    author: '',
    sections: [],
    monsters: [],
    ...overrides,
  }
}

function withArea(area: AreaSpec, monsters: MonsterTemplate[] = []): Adventure {
  const document = makeDocument()
  return {
    ...document,
    monsters,
    dungeons: [
      {
        ...document.dungeons[0],
        levels: [{ ...document.dungeons[0].levels[0], areas: [area] }],
      },
    ],
  }
}

const TARGET = { dungeonId: 'dungeon-1', levelNumber: 1, areaId: '1' }

const ORC_ENCOUNTER = {
  monsters: [{ template_id: 'orc', count_dice: null, count_fixed: 4 }],
  alignment: null,
  aware: false,
  stance: null,
  hoard: true,
}

const TRAP = {
  kind: 'room' as const,
  trigger: 'enter' as const,
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
  affects: 'triggerer' as const,
}

// --- collisions --------------------------------------------------------------

test('a kind collides only when carried and occupied', () => {
  const entry = makeEntry({ name: 'Guard post', encounter: ORC_ENCOUNTER })
  expect(dropCollisions(entry, makeArea())).toEqual([])
  expect(dropCollisions(entry, makeArea({ name: 'Watabou note' }))).toEqual(['name'])
  expect(dropCollisions(entry, makeArea({ name: 'x', encounter: ORC_ENCOUNTER }))).toEqual([
    'name',
    'encounter',
  ])
  // Empty prose is not carried: projection preserves source strings.
  expect(dropCollisions(makeEntry(), makeArea({ name: 'x', trap: TRAP }))).toEqual([])
})

test('features never collide', () => {
  const feature = {
    id: 'feature-1',
    kind: 'custom' as const,
    description: '',
    cell: null,
    item_ids: [],
    coins: { pp: 0, gp: 0, ep: 0, sp: 0, cp: 0 },
    valuables: [],
    trap: null,
  }
  const entry = makeEntry({ features: [feature] })
  expect(dropCollisions(entry, makeArea({ features: [feature] }))).toEqual([])
})

// --- the drop batch ----------------------------------------------------------

test('a drop writes exactly the carried kinds', () => {
  const entry = makeEntry({ name: 'Guard post', encounter: ORC_ENCOUNTER })
  const document = withArea(makeArea())
  const ops = dropOps(entry, makePack(), document, TARGET, {}, NO_SHIPPED)
  expect(ops.map((op) => op.op)).toEqual(['set_area_field', 'set_encounter'])
  expect(ops[0]).toMatchObject({ field: 'name', value: 'Guard post' })
})

test('a trap-only entry on a stocked room touches only the trap slot', () => {
  const entry = makeEntry({ trap: TRAP })
  const document = withArea(makeArea({ name: 'Kept', encounter: ORC_ENCOUNTER }))
  const ops = dropOps(entry, makePack(), document, TARGET, {}, NO_SHIPPED)
  expect(ops.map((op) => op.op)).toEqual(['set_trap'])
})

test('a kept kind emits nothing and a replace choice overwrites', () => {
  const entry = makeEntry({ name: 'New name', description: 'New prose' })
  const document = withArea(makeArea({ name: 'Old', description: 'Old' }))
  const kept = dropOps(
    entry,
    makePack(),
    document,
    TARGET,
    { name: 'keep', description: 'replace' },
    NO_SHIPPED,
  )
  expect(kept).toEqual([
    {
      op: 'set_area_field',
      dungeon_id: 'dungeon-1',
      level_number: 1,
      area_id: '1',
      field: 'description',
      value: 'New prose',
    },
  ])
})

test('an unanswered colliding kind defaults to replace', () => {
  const entry = makeEntry({ name: 'New name' })
  const document = withArea(makeArea({ name: 'Old' }))
  const ops = dropOps(entry, makePack(), document, TARGET, {}, NO_SHIPPED)
  expect(ops).toHaveLength(1)
})

test('features append with sequentially re-minted ids', () => {
  const feature = {
    id: 'dropped',
    kind: 'custom' as const,
    description: 'one',
    cell: null,
    item_ids: [],
    coins: { pp: 0, gp: 0, ep: 0, sp: 0, cp: 0 },
    valuables: [],
    trap: null,
  }
  const existing = { ...feature, id: 'feature-1', description: 'already here' }
  const entry = makeEntry({ features: [feature, { ...feature, description: 'two' }] })
  const document = withArea(makeArea({ features: [existing] }))
  const ops = dropOps(entry, makePack(), document, TARGET, {}, NO_SHIPPED)
  // feature-1 is taken on the level; the two dropped features mint 2 then 3 —
  // one batch never collides with itself.
  expect(ops.map((op) => (op.op === 'add_feature' ? op.feature.id : op.op))).toEqual([
    'feature-2',
    'feature-3',
  ])
})

test('a vanished target answers the empty batch', () => {
  const entry = makeEntry({ name: 'x' })
  expect(dropOps(entry, makePack(), makeDocument(), TARGET, {}, NO_SHIPPED)).toEqual([])
})

// --- closure -----------------------------------------------------------------

const BESPOKE = seedMonsterTemplate('bespoke', 'Bespoke horror')
const BESPOKE_VARIANT = { ...BESPOKE, morale: 12 }

test('case 1: an unshadowed or identically shadowed shipped id stands', () => {
  const shipped: ShippedMonsters = { ids: new Set(['orc']), byId: {} }
  // The pack does not carry 'orc' at all — nothing to add, nothing to rewrite.
  expect(resolveClosure(['orc'], makePack(), makeDocument(), shipped)).toEqual({
    ops: [],
    rename: {},
  })
  // The pack shadows 'orc' with the identical definition — the id stands.
  const orc = seedMonsterTemplate('orc', 'Orc')
  const shadowing = makePack({ monsters: [orc] })
  const identical: ShippedMonsters = { ids: new Set(['orc']), byId: { orc } }
  expect(resolveClosure(['orc'], shadowing, makeDocument(), identical)).toEqual({
    ops: [],
    rename: {},
  })
})

test('case 2: an identical target bundle is reused with no op', () => {
  const pack = makePack({ monsters: [BESPOKE] })
  const document = withArea(makeArea(), [BESPOKE])
  expect(resolveClosure(['bespoke'], pack, document, NO_SHIPPED)).toEqual({ ops: [], rename: {} })
})

test('case 3: a definition twin under another id is reused by rewrite', () => {
  const pack = makePack({ monsters: [BESPOKE] })
  const document = withArea(makeArea(), [{ ...BESPOKE, id: 'bespoke-1' }])
  expect(resolveClosure(['bespoke'], pack, document, NO_SHIPPED)).toEqual({
    ops: [],
    rename: { bespoke: 'bespoke-1' },
  })
})

test('case 4: a free id with no twin adds the template as carried', () => {
  const pack = makePack({ monsters: [BESPOKE] })
  expect(resolveClosure(['bespoke'], pack, makeDocument(), NO_SHIPPED)).toEqual({
    ops: [{ op: 'add_monster_template', template: BESPOKE }],
    rename: {},
  })
})

test('case 5: a taken id with a differing definition re-mints and rewrites', () => {
  const pack = makePack({ monsters: [BESPOKE] })
  const document = withArea(makeArea(), [BESPOKE_VARIANT])
  expect(resolveClosure(['bespoke'], pack, document, NO_SHIPPED)).toEqual({
    ops: [{ op: 'add_monster_template', template: { ...BESPOKE, id: 'bespoke-1' } }],
    rename: { bespoke: 'bespoke-1' },
  })
})

test('a differing shipped shadow re-mints too', () => {
  const orcVariant = { ...seedMonsterTemplate('orc', 'Orc'), morale: 12 }
  const pack = makePack({ monsters: [orcVariant] })
  const shipped: ShippedMonsters = {
    ids: new Set(['orc']),
    byId: { orc: seedMonsterTemplate('orc', 'Orc') },
  }
  const resolution = resolveClosure(['orc'], pack, makeDocument(), shipped)
  expect(resolution.rename).toEqual({ orc: 'orc-1' })
  expect(resolution.ops).toEqual([
    { op: 'add_monster_template', template: { ...orcVariant, id: 'orc-1' } },
  ])
})

test('the second drop of one shadowed template reuses the first drops clone', () => {
  const pack = makePack({ monsters: [BESPOKE_VARIANT] })
  const afterFirstDrop = withArea(makeArea(), [BESPOKE, { ...BESPOKE_VARIANT, id: 'bespoke-1' }])
  // 'bespoke' is taken by a differing definition, but the first drop's clone
  // is the twin — thirty drops mint one clone total.
  expect(resolveClosure(['bespoke'], pack, afterFirstDrop, NO_SHIPPED)).toEqual({
    ops: [],
    rename: { bespoke: 'bespoke-1' },
  })
})

test('the dropped encounter carries rewritten references', () => {
  const pack = makePack({ monsters: [BESPOKE] })
  const document = withArea(makeArea(), [BESPOKE_VARIANT])
  const encounter = {
    ...ORC_ENCOUNTER,
    monsters: [{ template_id: 'bespoke', count_dice: null, count_fixed: 1 }],
  }
  const ops = dropOps(makeEntry({ encounter }), pack, document, TARGET, {}, NO_SHIPPED)
  expect(ops.map((op) => op.op)).toEqual(['add_monster_template', 'set_encounter'])
  const setEncounter = ops[1]
  if (setEncounter.op !== 'set_encounter' || !setEncounter.encounter) throw new Error('shape')
  expect(setEncounter.encounter.monsters[0].template_id).toBe('bespoke-1')
})

test('a kept encounter computes no closure', () => {
  const pack = makePack({ monsters: [BESPOKE] })
  const encounter = {
    ...ORC_ENCOUNTER,
    monsters: [{ template_id: 'bespoke', count_dice: null, count_fixed: 1 }],
  }
  const document = withArea(makeArea({ encounter: ORC_ENCOUNTER }))
  const ops = dropOps(
    makeEntry({ encounter }),
    pack,
    document,
    TARGET,
    { encounter: 'keep' },
    NO_SHIPPED,
  )
  expect(ops).toEqual([])
})

// --- wandering copy ----------------------------------------------------------

function makeWandering(monsterId: string): WanderingSpec {
  return {
    chance_in_six: 2,
    interval_turns: 2,
    table: {
      id: 'custom',
      label: 'Custom',
      min_level: 1,
      max_level: null,
      overrides_applied: [],
      rows: [
        {
          roll: 1,
          name: 'Bespoke',
          entry: { kind: 'monster', monster_ids: [monsterId], variant_dice: null },
          count_dice: null,
          count_fixed: 1,
        },
      ],
    },
  }
}

function makeSection(overrides: Partial<PackSection> = {}): PackSection {
  return {
    id: 'dungeon:mill/level:1',
    label: 'Mill level 1',
    entries: [],
    wandering: null,
    ...overrides,
  }
}

test('a wandering copy targets the level with the same closure treatment', () => {
  const section = makeSection({ wandering: makeWandering('bespoke') })
  const pack = makePack({ monsters: [BESPOKE] })
  const document = withArea(makeArea(), [BESPOKE_VARIANT])
  const ops = wanderingCopyOps(
    section,
    pack,
    document,
    { dungeonId: 'dungeon-1', levelNumber: 1 },
    NO_SHIPPED,
  )
  expect(ops.map((op) => op.op)).toEqual(['add_monster_template', 'set_wandering'])
  const setWandering = ops[1]
  if (setWandering.op !== 'set_wandering' || !setWandering.wandering.table) throw new Error('shape')
  expect(setWandering.wandering.table.rows[0].entry).toMatchObject({ monster_ids: ['bespoke-1'] })
})

test('a section without a wandering entry copies nothing', () => {
  expect(
    wanderingCopyOps(
      makeSection(),
      makePack(),
      makeDocument(),
      { dungeonId: 'dungeon-1', levelNumber: 1 },
      NO_SHIPPED,
    ),
  ).toEqual([])
})

// --- helpers -----------------------------------------------------------------

test('shadowedShippedIds names exactly the pack-carried shipped ids', () => {
  const pack = makePack({ monsters: [seedMonsterTemplate('orc', 'Orc'), BESPOKE] })
  const shippedIds = new Set(['orc', 'skeleton'])
  expect(shadowedShippedIds(['orc', 'skeleton', 'bespoke', 'orc'], pack, shippedIds)).toEqual([
    'orc',
  ])
})

test('reference walks are in line and row order', () => {
  const entry = makeEntry({
    encounter: {
      ...ORC_ENCOUNTER,
      monsters: [
        { template_id: 'orc', count_dice: null, count_fixed: 1 },
        { template_id: 'skeleton', count_dice: null, count_fixed: 2 },
      ],
    },
  })
  expect(entryReferences(entry)).toEqual(['orc', 'skeleton'])
  expect(sectionReferences(makeSection({ wandering: makeWandering('orc') }))).toEqual(['orc'])
  expect(sectionReferences(makeSection())).toEqual([])
})

test('structural equality is deep and order-insensitive over keys', () => {
  expect(structurallyEqual({ a: 1, b: [1, 2] }, { b: [1, 2], a: 1 })).toBe(true)
  expect(structurallyEqual({ a: 1 }, { a: 2 })).toBe(false)
  expect(structurallyEqual([1, 2], [2, 1])).toBe(false)
})
