// The Quests section's quest op builders, mirroring trigger-builders: pure
// functions from the committed document to op batches, so every commit
// computes its whole next spec against what is actually committed and the
// section logic stays vitest-testable. A builder answering [] skips the
// batch — the quest vanished under a queued gesture.
//
// No blocked-message constant mirrors the server's here, by decision: quests
// have no flow entry outside the panel, and in forge mode the section renders
// the explanation body with no quest control — nothing routes client-side,
// so the server's 422 is the whole story. No reference-count builder either —
// nothing in the document references a quest id.
import { patternSummary, type SummaryNames } from '@/lib/trigger-builders'
import type { Adventure, AnyEditOp, ObjectiveSpec, QuestSpec, TriggerClause } from '@/types'

export function findQuest(document: Adventure, questId: string): QuestSpec | null {
  return document.quests.find((quest) => quest.id === questId) ?? null
}

// The create dialog's prefill: the next free `quest-<n>` over the quest
// namespace alone (trigger ids are a separate namespace and impose nothing).
export function nextQuestId(document: Adventure): string {
  const taken = new Set(document.quests.map((quest) => quest.id))
  let n = 1
  while (taken.has(`quest-${n}`)) n += 1
  return `quest-${n}`
}

// The draft objective row's prefill: the next free `objective-<n>`,
// quest-scoped — osrlib scopes objective-id uniqueness per quest, so another
// quest's ids impose nothing.
export function nextObjectiveId(quest: QuestSpec): string {
  const taken = new Set(quest.objectives.map((objective) => objective.id))
  let n = 1
  while (taken.has(`objective-${n}`)) n += 1
  return `objective-${n}`
}

// A complete, minimal objective around a completion clause — the draft row's
// shape: the name defaults empty (unauthored, the id fallback everywhere a
// label shows), born visible, no reveal clause, no narrative.
export function seedObjective(id: string, when: TriggerClause): ObjectiveSpec {
  return { id, name: '', when, hidden: false, reveal_when: null, narrative: null }
}

// A complete, minimal quest around a name and one objective — the create
// dialog's shape: a QuestSpec parses only with a name and at least one
// complete objective, and no fake references are ever seeded. Everything
// else is detail-editor work: no activation (a standing charge), empty
// rewards, completion "all", concludes_adventure false, no narratives.
export function seedQuest(id: string, name: string, firstObjective: ObjectiveSpec): QuestSpec {
  return {
    id,
    name,
    activation: null,
    objectives: [firstObjective],
    rewards: [],
    completion: 'all',
    concludes_adventure: false,
    narrative: null,
  }
}

// --- the ops ---

export function addQuestOps(quest: QuestSpec): AnyEditOp[] {
  return [{ op: 'add_quest', quest }]
}

export function questSetOps(questId: string, quest: QuestSpec): AnyEditOp[] {
  return [{ op: 'set_quest', quest_id: questId, quest }]
}

export function moveQuestOps(questId: string, index: number): AnyEditOp[] {
  return [{ op: 'move_quest', quest_id: questId, index }]
}

export function removeQuestOps(questId: string): AnyEditOp[] {
  return [{ op: 'remove_quest', quest_id: questId }]
}

// Whole-value replacement with the next spec computed from the committed one
// inside the queue — the triggerUpdateOps discipline, load-bearing here
// because the objective and reward lists edit sub-parts of a whole-value
// spec. `null` skips the batch.
export function questUpdateOps(
  document: Adventure,
  questId: string,
  update: (committed: QuestSpec) => QuestSpec | null,
): AnyEditOp[] {
  const current = findQuest(document, questId)
  if (!current) return []
  const next = update(current)
  if (next === null) return []
  return questSetOps(questId, next)
}

// The state-independent form: a patch whose values don't derive from the
// current spec (the concludes toggle, a rename, the completion rule).
export function questPatchOps(
  document: Adventure,
  questId: string,
  patch: Partial<QuestSpec>,
): AnyEditOp[] {
  return questUpdateOps(document, questId, (committed) => ({ ...committed, ...patch }))
}

// --- the summaries ---

// The activation summary: `null` is the standing charge — active from the
// session's first moment — and a clause rides patternSummary's module
// notation. The objective and reward summaries ride patternSummary and
// consequenceSummary directly.
export function activationSummary(
  activation: TriggerClause | null,
  names: SummaryNames = {},
): string {
  if (activation === null) return 'standing charge'
  return patternSummary(activation.pattern, names)
}
