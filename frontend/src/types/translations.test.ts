// Type-level assertions pinning the load-bearing schema translations. A
// generator regression on a future version bump fails here loudly — at tsc
// time and under vitest — instead of silently loosening types.
import { expectTypeOf, test } from 'vitest'

import type { components } from '@/types/generated/api'
import type { AnyEditOp, Edge, LevelSpec, SetWandering, SubtreeChange, WanderingSpec } from '@/types'

type EncounterEntry = components['schemas']['EncounterTableRow']['entry']

test('the pinned schema translations hold', () => {
  // Position is a two-tuple, not number[].
  expectTypeOf<NonNullable<LevelSpec['entrance']>>().toEqualTypeOf<[number, number]>()
  expectTypeOf<NonNullable<LevelSpec['entrance']>>().not.toEqualTypeOf<number[]>()

  // edges is a Record keyed by the canonical edge key.
  expectTypeOf<LevelSpec['edges']>().toEqualTypeOf<Record<string, Edge>>()

  // StrEnums translate to string-literal unions with osrlib's exact wire values.
  expectTypeOf<Edge['kind']>().toEqualTypeOf<'open' | 'wall' | 'door'>()

  // The encounter entry union discriminates on kind.
  expectTypeOf<EncounterEntry['kind']>().toEqualTypeOf<'monster' | 'npc_party'>()
  expectTypeOf<Extract<EncounterEntry, { kind: 'monster' }>>().toHaveProperty('monster_ids')
  expectTypeOf<Extract<EncounterEntry, { kind: 'npc_party' }>>().toHaveProperty('party_kind')
})

test('the op vocabulary translations hold', () => {
  // The edit-op union discriminates on op.
  expectTypeOf<AnyEditOp['op']>().toEqualTypeOf<
    'set_adventure_field' | 'set_town_field' | 'set_wandering'
  >()
  expectTypeOf<Extract<AnyEditOp, { op: 'set_adventure_field' }>>().toHaveProperty('field')
  expectTypeOf<Extract<AnyEditOp, { op: 'set_wandering' }>>().toHaveProperty('dungeon_id')

  // SetWandering carries the full WanderingSpec, inline table included.
  expectTypeOf<SetWandering['wandering']>().toEqualTypeOf<WanderingSpec>()

  // SubtreeChange.value is loose JSON by design.
  expectTypeOf<SubtreeChange['value']>().toEqualTypeOf<unknown>()
})
