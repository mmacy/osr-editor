// Type-level assertions pinning the load-bearing schema translations. A
// generator regression on a future version bump fails here loudly — at tsc
// time and under vitest — instead of silently loosening types.
import { expectTypeOf, test } from 'vitest'

import {
  ALIGNMENTS,
  CONDITIONS,
  FEATURE_KINDS,
  REACTION_RESULTS,
  SAVE_CATEGORIES,
  TIME_UNITS,
} from '@/lib/content-builders'
import type {
  AddTransition,
  Alignment,
  AnyEditOp,
  AreaTreasureSpec,
  CatalogMonster,
  Condition,
  Edge,
  EncounterEntry,
  FeatureSpec,
  ImportedArea,
  ImportedGeometry,
  ImportedLevel,
  KeyedEncounter,
  LevelSpec,
  PublishResult,
  ReactionResult,
  SaveCategory,
  SetEdges,
  SetEncounter,
  SetFeature,
  SetTrap,
  SetTreasure,
  SetWandering,
  SubtreeChange,
  TimeUnit,
  TransitionSpec,
  TrapSpec,
  WanderingSpec,
} from '@/types'

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
  // The edit-op union discriminates over the full grown vocabulary.
  expectTypeOf<AnyEditOp['op']>().toEqualTypeOf<
    | 'set_adventure_field'
    | 'set_town_field'
    | 'set_wandering'
    | 'set_edges'
    | 'set_entrance'
    | 'create_area'
    | 'set_area_cells'
    | 'set_area_field'
    | 'remove_area'
    | 'set_encounter'
    | 'set_trap'
    | 'set_treasure'
    | 'add_feature'
    | 'set_feature'
    | 'remove_feature'
    | 'add_transition'
    | 'remove_transition'
    | 'add_dungeon'
    | 'set_dungeon_field'
    | 'rename_dungeon'
    | 'remove_dungeon'
    | 'add_level'
    | 'renumber_level'
    | 'resize_level'
    | 'remove_level'
  >()
  expectTypeOf<Extract<AnyEditOp, { op: 'set_adventure_field' }>>().toHaveProperty('field')
  expectTypeOf<Extract<AnyEditOp, { op: 'set_wandering' }>>().toHaveProperty('dungeon_id')

  // SetWandering carries the full WanderingSpec, inline table included.
  expectTypeOf<SetWandering['wandering']>().toEqualTypeOf<WanderingSpec>()

  // SetEdges values admit null — the delete-means-wall assignment.
  expectTypeOf<SetEdges['edges']>().toEqualTypeOf<Record<string, Edge | null>>()

  // AddTransition carries the full TransitionSpec; the target facing keeps
  // osrlib's exact wire values.
  expectTypeOf<AddTransition['transition']>().toEqualTypeOf<TransitionSpec>()
  expectTypeOf<TransitionSpec['to_facing']>().toEqualTypeOf<'north' | 'east' | 'south' | 'west'>()

  // SubtreeChange.value is loose JSON by design.
  expectTypeOf<SubtreeChange['value']>().toEqualTypeOf<unknown>()
})

test('the content op translations hold', () => {
  // SetEncounter admits null — the card's remove action.
  expectTypeOf<SetEncounter['encounter']>().toEqualTypeOf<KeyedEncounter | null>()
  expectTypeOf<SetTrap['trap']>().toEqualTypeOf<TrapSpec | null>()
  expectTypeOf<SetTreasure['treasure']>().toEqualTypeOf<AreaTreasureSpec | null>()

  // Feature ops address a container: area_id null means the level itself.
  expectTypeOf<SetFeature['area_id']>().toEqualTypeOf<string | null>()
  expectTypeOf<SetFeature['feature']>().toEqualTypeOf<FeatureSpec>()

  // FeatureSpec.cell is nullable (bind to the whole area) and a two-tuple.
  expectTypeOf<NonNullable<FeatureSpec['cell']>>().toEqualTypeOf<[number, number]>()
  expectTypeOf<null extends FeatureSpec['cell'] ? true : false>().toEqualTypeOf<true>()

  // The trap split and effect enums keep osrlib's exact wire values.
  expectTypeOf<TrapSpec['kind']>().toEqualTypeOf<'room' | 'treasure'>()
  expectTypeOf<TrapSpec['trigger']>().toEqualTypeOf<'enter' | 'open'>()
})

test('the catalog and publish translations hold', () => {
  // Alignment options are string-literal arrays, not plain strings.
  expectTypeOf<CatalogMonster['alignment_options']>().toEqualTypeOf<
    ('lawful' | 'neutral' | 'chaotic')[]
  >()

  // The encounter entry union discriminates on kind (rides the catalog's
  // verbatim EncounterTable rows).
  expectTypeOf<EncounterEntry['kind']>().toEqualTypeOf<'monster' | 'npc_party'>()
  expectTypeOf<Extract<EncounterEntry, { kind: 'monster' }>>().toHaveProperty('monster_ids')
  expectTypeOf<Extract<EncounterEntry, { kind: 'npc_party' }>>().toHaveProperty('party_kind')

  expectTypeOf<PublishResult['mode']>().toEqualTypeOf<'symlink' | 'copy'>()
})

test('the enum option lists stay exhaustive', () => {
  // A value osrlib adds to an enum must join its option list — Exclude
  // collapsing to never proves nothing is missing; `satisfies` in the list
  // definitions proves nothing extra crept in.
  expectTypeOf<Exclude<Condition, (typeof CONDITIONS)[number]>>().toEqualTypeOf<never>()
  expectTypeOf<Exclude<SaveCategory, (typeof SAVE_CATEGORIES)[number]>>().toEqualTypeOf<never>()
  expectTypeOf<Exclude<TimeUnit, (typeof TIME_UNITS)[number]>>().toEqualTypeOf<never>()
  expectTypeOf<Exclude<ReactionResult, (typeof REACTION_RESULTS)[number]>>().toEqualTypeOf<never>()
  expectTypeOf<Exclude<Alignment, (typeof ALIGNMENTS)[number]>>().toEqualTypeOf<never>()
  expectTypeOf<
    Exclude<FeatureSpec['kind'], (typeof FEATURE_KINDS)[number]>
  >().toEqualTypeOf<never>()
})

test('the importer payload translations hold', () => {
  // ImportedLevel.edges is a Record of canonical keys to Edge — no nulls; the
  // importer owns normalization.
  expectTypeOf<ImportedLevel['edges']>().toEqualTypeOf<Record<string, Edge>>()
  expectTypeOf<NonNullable<ImportedLevel['entrance']>>().toEqualTypeOf<[number, number]>()
  expectTypeOf<ImportedLevel['notes']>().toEqualTypeOf<string[]>()
  expectTypeOf<ImportedGeometry['levels']>().toEqualTypeOf<ImportedLevel[]>()
  expectTypeOf<ImportedArea['cells']>().toEqualTypeOf<[number, number][]>()
})
