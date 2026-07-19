// The import dialog's pure mapping: (ImportedLevel + choices) → one ordinary
// op batch. The backend contributes no special apply path — the batch goes
// through POST /projects/{id}/ops like any gesture: undoable,
// revision-guarded, immediately linted.
import type { Adventure, AnyEditOp, Edge, ImportedLevel, TransitionSpec } from '@/types'

export interface ImportChoices {
  dungeonId: string
  levelNumber: number
  mode: 'new' | 'replace'
  // Indices into the imported level's transitions to keep even though their
  // targets do not resolve; everything unresolved and unlisted here drops.
  keepUnresolved: readonly number[]
}

// A transition target resolves when the destination document will contain the
// target level and the landing cell fits its grid. A target naming the
// destination level itself is judged against the *imported* dimensions — that
// level is being created or resized by this very batch.
export function transitionResolves(
  transition: TransitionSpec,
  document: Adventure,
  imported: ImportedLevel,
  choices: Pick<ImportChoices, 'dungeonId' | 'levelNumber'>,
): boolean {
  const [x, y] = transition.to_position
  if (
    transition.to_dungeon_id === choices.dungeonId &&
    transition.to_level_number === choices.levelNumber
  ) {
    return x >= 0 && x < imported.width && y >= 0 && y < imported.height
  }
  const target = document.dungeons
    .find((dungeon) => dungeon.id === transition.to_dungeon_id)
    ?.levels.find((level) => level.number === transition.to_level_number)
  if (!target) return false
  return x >= 0 && x < target.width && y >= 0 && y < target.height
}

export function unresolvedTransitionIndices(
  imported: ImportedLevel,
  document: Adventure,
  choices: Pick<ImportChoices, 'dungeonId' | 'levelNumber'>,
): number[] {
  return imported.transitions
    .map((transition, index) => ({ transition, index }))
    .filter(({ transition }) => !transitionResolves(transition, document, imported, choices))
    .map(({ index }) => index)
}

// The batch, one atomic undo step, in the pinned order that keeps every op
// valid against the document state it sees. For a new level: AddLevel,
// SetEdges, CreateArea per area, AddTransition per kept transition,
// SetEntrance. For replace: clear the existing level first — SetEntrance(null),
// RemoveTransition per existing entry, RemoveArea per existing area, SetEdges
// deleting every existing key — then ResizeLevel to the imported dimensions,
// then the new-level sequence minus AddLevel. A ResizeLevel rejection
// (stranded features in a foreign document) rejects the whole import with the
// offender list.
export function importOps(
  imported: ImportedLevel,
  document: Adventure,
  choices: ImportChoices,
): AnyEditOp[] {
  const { dungeonId, levelNumber, mode } = choices
  const ops: AnyEditOp[] = []
  if (mode === 'new') {
    ops.push({
      op: 'add_level',
      dungeon_id: dungeonId,
      number: levelNumber,
      width: imported.width,
      height: imported.height,
    })
  } else {
    const existing = document.dungeons
      .find((dungeon) => dungeon.id === dungeonId)
      ?.levels.find((level) => level.number === levelNumber)
    if (!existing) return []
    if (existing.entrance) {
      ops.push({
        op: 'set_entrance',
        dungeon_id: dungeonId,
        level_number: levelNumber,
        entrance: null,
      })
    }
    for (const transition of existing.transitions) {
      // One removal per existing entry: first-match removal keeps a foreign
      // stacked pair correct by construction.
      ops.push({
        op: 'remove_transition',
        dungeon_id: dungeonId,
        level_number: levelNumber,
        position: transition.position,
      })
    }
    for (const area of existing.areas) {
      ops.push({
        op: 'remove_area',
        dungeon_id: dungeonId,
        level_number: levelNumber,
        area_id: area.id,
      })
    }
    const deletions: Record<string, Edge | null> = {}
    for (const key of Object.keys(existing.edges)) deletions[key] = null
    if (Object.keys(deletions).length > 0) {
      ops.push({
        op: 'set_edges',
        dungeon_id: dungeonId,
        level_number: levelNumber,
        edges: deletions,
      })
    }
    ops.push({
      op: 'resize_level',
      dungeon_id: dungeonId,
      level_number: levelNumber,
      width: imported.width,
      height: imported.height,
    })
  }
  if (Object.keys(imported.edges).length > 0) {
    ops.push({
      op: 'set_edges',
      dungeon_id: dungeonId,
      level_number: levelNumber,
      edges: { ...imported.edges },
    })
  }
  for (const area of imported.areas) {
    ops.push({
      op: 'create_area',
      dungeon_id: dungeonId,
      level_number: levelNumber,
      area_id: area.id,
      cells: area.cells,
      name: area.name,
      description: area.description,
    })
  }
  const keep = new Set(choices.keepUnresolved)
  imported.transitions.forEach((transition, index) => {
    const resolves = transitionResolves(transition, document, imported, choices)
    if (!resolves && !keep.has(index)) return
    ops.push({
      op: 'add_transition',
      dungeon_id: dungeonId,
      level_number: levelNumber,
      transition,
    })
  })
  if (imported.entrance) {
    ops.push({
      op: 'set_entrance',
      dungeon_id: dungeonId,
      level_number: levelNumber,
      entrance: imported.entrance,
    })
  }
  return ops
}
