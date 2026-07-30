// The content library's pure drop mapping: (entry + pack + committed document
// + choices) → one ordinary op batch, the import-mapping discipline exactly.
// The backend contributes no special apply path — the batch goes through
// POST /projects/{id}/ops like any gesture: undoable, revision-guarded,
// immediately linted, and (template closure aside) translatable to overrides.
import { nextFreeFeatureKeyIn } from '@/lib/content-builders'
import { cloneId } from '@/lib/monster-builders'
import type {
  AnyEditOp,
  AreaSpec,
  Adventure,
  ContentPack,
  ContentPackEntry,
  KeyedEncounter,
  LevelSpec,
  MonsterTemplate,
  PackSection,
  WanderingSpec,
} from '@/types'

// The single-slot kinds a drop can collide on. Features never appear here —
// the plural kind always appends.
export type CollisionKind = 'name' | 'description' | 'encounter' | 'trap' | 'treasure'

export const COLLISION_KINDS: readonly CollisionKind[] = [
  'name',
  'description',
  'encounter',
  'trap',
  'treasure',
]

export type CollisionChoices = Partial<Record<CollisionKind, 'replace' | 'keep'>>

export interface DropTarget {
  dungeonId: string
  levelNumber: number
  areaId: string
}

// What the closure resolution needs to know about the shipped catalog. `ids`
// is the whole shipped id set (the summary list the editor already loads);
// `byId` carries full definitions for exactly the pack-carried ids that shadow
// a shipped id — the caller fetches those before committing, because deciding
// "identical shadow, the id stands" versus "differing shadow, twin or re-mint"
// takes the shipped definition itself.
export interface ShippedMonsters {
  ids: ReadonlySet<string>
  byId: Readonly<Record<string, MonsterTemplate>>
}

// Deep structural equality over server-serialized JSON. Both sides arrive as
// the backend dumped them (pydantic's stable field order and materialized
// defaults), but the comparison is structural, never a string compare.
export function structurallyEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((value, index) => structurallyEqual(value, b[index]))
  }
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const left = a as Record<string, unknown>
    const right = b as Record<string, unknown>
    const keys = Object.keys(left)
    return (
      keys.length === Object.keys(right).length &&
      keys.every((key) => key in right && structurallyEqual(left[key], right[key]))
    )
  }
  return false
}

// The twin test's currency: the definition with identity taken out.
function sansId(template: MonsterTemplate): Record<string, unknown> {
  const definition: Record<string, unknown> = { ...template }
  delete definition.id
  return definition
}

// A single-slot kind is carried when the entry actually has something in it:
// non-empty for prose (projection preserves source strings, so empty means the
// source had none), non-null for the model slots.
function carried(entry: ContentPackEntry, kind: CollisionKind): boolean {
  if (kind === 'name') return entry.name !== ''
  if (kind === 'description') return entry.description !== ''
  return entry[kind] != null
}

function occupied(area: AreaSpec, kind: CollisionKind): boolean {
  if (kind === 'name') return area.name !== ''
  if (kind === 'description') return area.description !== ''
  return area[kind] != null
}

/** The pure collision predicate: kinds the entry carries that the target already has. */
export function dropCollisions(entry: ContentPackEntry, area: AreaSpec): CollisionKind[] {
  return COLLISION_KINDS.filter((kind) => carried(entry, kind) && occupied(area, kind))
}

export interface ClosureResolution {
  // AddMonsterTemplate ops, in first-reference order.
  ops: AnyEditOp[]
  // Referenced id → the id the dropped reference must carry in the target.
  rename: Record<string, string>
}

/**
 * Resolve the pack templates a set of monster references needs in the target.
 *
 * The order per referenced pack template is pinned because the repeat-drop
 * case would otherwise mint a clone per drop: (1) a shipped id the pack does
 * not shadow with a differing definition stands everywhere — no op; (2) a
 * target bundled template with the same id and an identical definition is
 * reused — no op; (3) a target bundled template structurally identical apart
 * from id is the twin — the reference rewrites to it, no op, which is what
 * keeps thirty drops of one shadowed template at one clone total; (4) a free
 * id with no twin adds the template as carried; (5) a taken id with a
 * differing definition and no twin re-mints through the `<id>-<n>` clone
 * convention and rewrites the reference. References the pack does not carry
 * resolve against the shipped catalog or stay dangling — either way no op.
 */
export function resolveClosure(
  referencedIds: readonly string[],
  pack: ContentPack,
  document: Adventure,
  shipped: ShippedMonsters,
): ClosureResolution {
  const ops: AnyEditOp[] = []
  const rename: Record<string, string> = {}
  const taken = new Set([...shipped.ids, ...document.monsters.map((template) => template.id)])
  const seen = new Set<string>()
  for (const referenced of referencedIds) {
    if (seen.has(referenced)) continue
    seen.add(referenced)
    const packed = pack.monsters.find((template) => template.id === referenced)
    if (!packed) continue
    if (shipped.ids.has(referenced)) {
      const shippedDefinition = shipped.byId[referenced]
      if (shippedDefinition && structurallyEqual(packed, shippedDefinition)) continue
      // A differing shadow can never keep its id (the shipped entry would
      // shadow the bundled one) — fall through to the twin test and re-mint.
    } else {
      const bundled = document.monsters.find((template) => template.id === referenced)
      if (!bundled) {
        const twin = document.monsters.find((template) =>
          structurallyEqual(sansId(template), sansId(packed)),
        )
        if (twin) {
          rename[referenced] = twin.id
          continue
        }
        ops.push({ op: 'add_monster_template', template: packed })
        taken.add(referenced)
        continue
      }
      if (structurallyEqual(bundled, packed)) continue
    }
    const twin = document.monsters.find((template) =>
      structurallyEqual(sansId(template), sansId(packed)),
    )
    if (twin) {
      rename[referenced] = twin.id
      continue
    }
    const minted = cloneId(referenced, taken)
    taken.add(minted)
    rename[referenced] = minted
    ops.push({ op: 'add_monster_template', template: { ...packed, id: minted } })
  }
  return { ops, rename }
}

function rewriteEncounter(
  encounter: KeyedEncounter,
  rename: Record<string, string>,
): KeyedEncounter {
  if (Object.keys(rename).length === 0) return encounter
  return {
    ...encounter,
    monsters: encounter.monsters.map((keyed) =>
      rename[keyed.template_id] ? { ...keyed, template_id: rename[keyed.template_id] } : keyed,
    ),
  }
}

function rewriteWandering(wandering: WanderingSpec, rename: Record<string, string>): WanderingSpec {
  if (!wandering.table || Object.keys(rename).length === 0) return wandering
  return {
    ...wandering,
    table: {
      ...wandering.table,
      rows: wandering.table.rows.map((row) =>
        row.entry.kind === 'monster' && row.entry.monster_ids.some((id) => rename[id])
          ? {
              ...row,
              entry: {
                ...row.entry,
                monster_ids: row.entry.monster_ids.map((id) => rename[id] ?? id),
              },
            }
          : row,
      ),
    },
  }
}

function wanderingReferences(wandering: WanderingSpec): string[] {
  return (wandering.table?.rows ?? []).flatMap((row) =>
    row.entry.kind === 'monster' ? [...row.entry.monster_ids] : [],
  )
}

/**
 * The drop batch: closure first, then the carried kinds only, honoring
 * per-kind replace-or-keep. Merge is the default posture, not a mode — a kept
 * or uncarried kind emits nothing, so a trap-only entry dropped on a stocked
 * room touches only the trap slot. Features always append, re-minted through
 * the level's next-free convention (each mint joins the taken set before the
 * next, so one batch never collides with itself). An empty answer means the
 * target vanished — the builder-form contract.
 */
export function dropOps(
  entry: ContentPackEntry,
  pack: ContentPack,
  document: Adventure,
  target: DropTarget,
  choices: CollisionChoices,
  shipped: ShippedMonsters,
): AnyEditOp[] {
  const level = document.dungeons
    .find((dungeon) => dungeon.id === target.dungeonId)
    ?.levels.find((candidate) => candidate.number === target.levelNumber)
  const area = level?.areas.find((candidate) => candidate.id === target.areaId)
  if (!level || !area) return []
  const scope = {
    dungeon_id: target.dungeonId,
    level_number: target.levelNumber,
    area_id: target.areaId,
  }
  const colliding = new Set(dropCollisions(entry, area))
  const emits = (kind: CollisionKind): boolean =>
    carried(entry, kind) && (!colliding.has(kind) || (choices[kind] ?? 'replace') === 'replace')
  const closure =
    entry.encounter && emits('encounter')
      ? resolveClosure(
          entry.encounter.monsters.map((keyed) => keyed.template_id),
          pack,
          document,
          shipped,
        )
      : { ops: [], rename: {} }
  const ops: AnyEditOp[] = [...closure.ops]
  if (emits('name')) {
    ops.push({ op: 'set_area_field', ...scope, field: 'name', value: entry.name })
  }
  if (emits('description')) {
    ops.push({ op: 'set_area_field', ...scope, field: 'description', value: entry.description })
  }
  if (entry.encounter && emits('encounter')) {
    ops.push({
      op: 'set_encounter',
      ...scope,
      encounter: rewriteEncounter(entry.encounter, closure.rename),
    })
  }
  if (entry.trap && emits('trap')) {
    ops.push({ op: 'set_trap', ...scope, trap: entry.trap })
  }
  if (entry.treasure && emits('treasure')) {
    ops.push({ op: 'set_treasure', ...scope, treasure: entry.treasure })
  }
  const taken = levelFeatureIds(level)
  for (const feature of entry.features) {
    const minted = nextFreeFeatureKeyIn(taken)
    taken.add(minted)
    ops.push({ op: 'add_feature', ...scope, feature: { ...feature, id: minted } })
  }
  return ops
}

function levelFeatureIds(level: LevelSpec): Set<string> {
  return new Set([
    ...level.features.map((feature) => feature.id),
    ...level.areas.flatMap((area) => area.features.map((feature) => feature.id)),
  ])
}

/**
 * The wandering copy: a `SetWandering` batch with the same closure treatment,
 * target address the level. In a forge-backed target it blocks whole at the
 * server (`set_wandering` has no override kind) with the detach offer — the
 * mapper changes nothing.
 */
export function wanderingCopyOps(
  section: PackSection,
  pack: ContentPack,
  document: Adventure,
  target: { dungeonId: string; levelNumber: number },
  shipped: ShippedMonsters,
): AnyEditOp[] {
  const wandering = section.wandering
  if (!wandering) return []
  const level = document.dungeons
    .find((dungeon) => dungeon.id === target.dungeonId)
    ?.levels.find((candidate) => candidate.number === target.levelNumber)
  if (!level) return []
  const closure = resolveClosure(wanderingReferences(wandering), pack, document, shipped)
  return [
    ...closure.ops,
    {
      op: 'set_wandering',
      dungeon_id: target.dungeonId,
      level_number: target.levelNumber,
      wandering: rewriteWandering(wandering, closure.rename),
    },
  ]
}

// The pack-carried ids the caller must fetch shipped definitions for before a
// drop or copy commits — exactly the shadowed ids the resolution compares.
export function shadowedShippedIds(
  referencedIds: readonly string[],
  pack: ContentPack,
  shippedIds: ReadonlySet<string>,
): string[] {
  return [
    ...new Set(
      referencedIds.filter(
        (id) => shippedIds.has(id) && pack.monsters.some((template) => template.id === id),
      ),
    ),
  ]
}

/** Every monster id an entry's encounter references, in line order. */
export function entryReferences(entry: ContentPackEntry): string[] {
  return entry.encounter?.monsters.map((keyed) => keyed.template_id) ?? []
}

/** Every monster id a section's wandering table references, in row order. */
export function sectionReferences(section: PackSection): string[] {
  return section.wandering ? wanderingReferences(section.wandering) : []
}
