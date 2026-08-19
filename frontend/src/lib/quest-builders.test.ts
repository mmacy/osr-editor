import { expect, test } from 'vitest'

import {
  activationSummary,
  addQuestOps,
  findQuest,
  moveQuestOps,
  nextObjectiveId,
  nextQuestId,
  questPatchOps,
  questUpdateOps,
  removeQuestOps,
  seedObjective,
  seedQuest,
} from '@/lib/quest-builders'
import { makeDocument } from '@/test/fixtures'
import type { QuestSpec, TriggerClause } from '@/types'

const TOWN_CLAUSE: TriggerClause = { pattern: { pattern_type: 'town_entered' }, conditions: [] }

function quest(id: string, overrides: Partial<QuestSpec> = {}): QuestSpec {
  return { ...seedQuest(id, 'The quest', seedObjective('o-1', TOWN_CLAUSE)), ...overrides }
}

function documentWithQuests(...quests: QuestSpec[]) {
  return makeDocument({ quests })
}

test("seedQuest is the create dialog's exact shape — a standing charge around one objective", () => {
  const objective = seedObjective('objective-1', TOWN_CLAUSE)
  expect(seedQuest('quest-1', 'The idol', objective)).toEqual({
    id: 'quest-1',
    name: 'The idol',
    activation: null,
    objectives: [objective],
    rewards: [],
    completion: 'all',
    concludes_adventure: false,
    narrative: null,
  })
})

test('seedObjective is born visible with the unauthored name', () => {
  expect(seedObjective('find', TOWN_CLAUSE)).toEqual({
    id: 'find',
    name: '',
    when: TOWN_CLAUSE,
    hidden: false,
    reveal_when: null,
    narrative: null,
  })
})

test('nextQuestId mints over the quest namespace alone', () => {
  expect(nextQuestId(documentWithQuests())).toBe('quest-1')
  expect(nextQuestId(documentWithQuests(quest('quest-1'), quest('quest-3')))).toBe('quest-2')
  // Trigger ids are a separate namespace and impose nothing.
  const document = documentWithQuests()
  document.triggers = [
    {
      id: 'quest-1',
      when: { pattern_type: 'town_entered' },
      conditions: [],
      repeatable: false,
      consequences: [],
      narrative: null,
    },
  ]
  expect(nextQuestId(document)).toBe('quest-1')
})

test('nextObjectiveId mints quest-scoped', () => {
  expect(nextObjectiveId(quest('qa'))).toBe('objective-1')
  const taken = quest('qa', {
    objectives: [
      seedObjective('objective-1', TOWN_CLAUSE),
      seedObjective('objective-2', TOWN_CLAUSE),
    ],
  })
  expect(nextObjectiveId(taken)).toBe('objective-3')
})

test('findQuest answers the first match in authored order', () => {
  const first = quest('shared', { completion: 'any' })
  const second = quest('shared')
  expect(findQuest(documentWithQuests(first, second), 'shared')).toBe(first)
  expect(findQuest(documentWithQuests(), 'ghost')).toBeNull()
})

test('the op builders emit the quartet', () => {
  const spec = quest('qa')
  expect(addQuestOps(spec)).toEqual([{ op: 'add_quest', quest: spec }])
  expect(moveQuestOps('qa', 2)).toEqual([{ op: 'move_quest', quest_id: 'qa', index: 2 }])
  expect(removeQuestOps('qa')).toEqual([{ op: 'remove_quest', quest_id: 'qa' }])
})

test('questUpdateOps computes from the committed document and skips a vanished quest', () => {
  const document = documentWithQuests(quest('qa'))
  const ops = questUpdateOps(document, 'qa', (committed) => ({ ...committed, completion: 'any' }))
  expect(ops).toEqual([
    { op: 'set_quest', quest_id: 'qa', quest: { ...quest('qa'), completion: 'any' } },
  ])
  // The quest vanished under a queued gesture: skip, never a stale payload.
  expect(questUpdateOps(document, 'ghost', (committed) => committed)).toEqual([])
  // The update declined: skip.
  expect(questUpdateOps(document, 'qa', () => null)).toEqual([])
})

test('questPatchOps is the state-independent form', () => {
  const document = documentWithQuests(quest('qa'))
  expect(questPatchOps(document, 'qa', { concludes_adventure: true })).toEqual([
    { op: 'set_quest', quest_id: 'qa', quest: { ...quest('qa'), concludes_adventure: true } },
  ])
})

test('activationSummary states the standing charge and rides patternSummary otherwise', () => {
  expect(activationSummary(null)).toBe('standing charge')
  expect(
    activationSummary({
      pattern: { pattern_type: 'dungeon_entered', dungeon_id: 'crypt' },
      conditions: [],
    }),
  ).toBe("on entering 'crypt'")
  expect(
    activationSummary(
      { pattern: { pattern_type: 'item_acquired', item_id: 'idol' }, conditions: [] },
      { itemName: () => 'The idol' },
    ),
  ).toBe('on acquiring The idol')
})
