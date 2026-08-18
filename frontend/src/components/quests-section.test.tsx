// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, expect, test, vi } from 'vitest'

import { QuestsSection } from '@/components/quests-section'
import { api, ApiRequestError } from '@/lib/api'
import { projectStore } from '@/store/project-store'
import { makeDocument, makeForgeState, makeProjectState } from '@/test/fixtures'
import type { ObjectiveSpec, OpBatchResult, ProjectState, QuestSpec, TriggerSpec } from '@/types'

vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }),
}))

vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
}))

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>()
  return {
    ...actual,
    api: {
      ...actual.api,
      postOps: vi.fn(),
      getEquipmentCatalog: vi.fn(),
      getMagicItemCatalog: vi.fn(),
      getMonsterCatalog: vi.fn(),
    },
  }
})

const postOps = vi.mocked(api.postOps)

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver ??= ResizeObserverStub as unknown as typeof ResizeObserver

function trigger(id: string, overrides: Partial<TriggerSpec> = {}): TriggerSpec {
  return {
    id,
    when: { pattern_type: 'town_entered' },
    conditions: [],
    repeatable: false,
    consequences: [],
    narrative: null,
    ...overrides,
  }
}

function projectWithTriggers(
  triggers: TriggerSpec[],
  overrides: Partial<ProjectState> = {},
): ProjectState {
  const document = makeDocument({ triggers })
  return makeProjectState({ document, ...overrides })
}

function renderSection(
  project: ProjectState,
  section: { triggerId?: string; questId?: string } = {},
) {
  projectStore.getState().setProject(project)
  return render(<QuestsSection project={project} section={section} focusToken={1} />)
}

beforeEach(() => {
  vi.clearAllMocks()
  projectStore.getState().clear()
  projectStore.getState().clearBlockedOp()
  vi.mocked(api.getEquipmentCatalog).mockResolvedValue({ items: [] })
  vi.mocked(api.getMagicItemCatalog).mockResolvedValue({ items: [] })
  vi.mocked(api.getMonsterCatalog).mockResolvedValue({ monsters: [] })
  postOps.mockResolvedValue({
    revision: 'r2',
    diagnostics: { validation: [], lint: [], forge: [] },
    delta: [],
    can_undo: true,
    can_redo: false,
  } satisfies OpBatchResult)
})

test('the list renders document order as the semantics it is — numbered, never sorted', () => {
  const project = projectWithTriggers([
    trigger('zeta', { repeatable: true }),
    trigger('alpha', { conditions: [{ condition_type: 'flag_equals', key: 'k', value: true }] }),
  ])
  renderSection(project)
  const rows = screen.getAllByTestId(/trigger-row-/)
  expect(rows.map((row) => row.getAttribute('data-testid'))).toEqual([
    'trigger-row-zeta',
    'trigger-row-alpha',
  ])
  expect(rows[0]).toHaveTextContent('1.')
  expect(rows[0]).toHaveTextContent('repeatable')
  expect(rows[1]).toHaveTextContent('2.')
  expect(rows[1]).toHaveTextContent('1 condition · 0 consequences')
  expect(screen.getByText('Triggers fire in this order', { exact: false })).toBeInTheDocument()
})

test('the create flow prefills the next-free id and posts add_trigger with an empty body', async () => {
  renderSection(projectWithTriggers([trigger('trigger-1')]))
  fireEvent.click(screen.getByRole('button', { name: 'New trigger' }))
  const dialog = within(screen.getByRole('dialog'))
  expect(dialog.getByLabelText('Id')).toHaveValue('trigger-2')
  // The pattern builder commits complete values only: Create stays disabled
  // until a pattern lands.
  expect(dialog.getByRole('button', { name: 'Create' })).toBeDisabled()
  fireEvent.change(dialog.getByLabelText('Fires'), { target: { value: 'town_entered' } })
  fireEvent.click(dialog.getByRole('button', { name: 'Create' }))
  await waitFor(() => expect(postOps).toHaveBeenCalledTimes(1))
  const [, , ops] = postOps.mock.calls[0]
  expect(ops).toEqual([
    {
      op: 'add_trigger',
      trigger: {
        id: 'trigger-2',
        when: { pattern_type: 'town_entered' },
        conditions: [],
        repeatable: false,
        consequences: [],
        narrative: null,
      },
    },
  ])
})

test('a duplicate-id rejection renders inline in the create dialog — the rename prompt', async () => {
  postOps.mockRejectedValueOnce(
    new ApiRequestError(422, {
      code: 'op_invariant',
      message: "the document already has a trigger 'trigger-1'",
      remedy: null,
      details: null,
    }),
  )
  renderSection(projectWithTriggers([trigger('trigger-1')]))
  fireEvent.click(screen.getByRole('button', { name: 'New trigger' }))
  const dialog = within(screen.getByRole('dialog'))
  fireEvent.change(dialog.getByLabelText('Id'), { target: { value: 'trigger-1' } })
  fireEvent.change(dialog.getByLabelText('Fires'), { target: { value: 'town_entered' } })
  fireEvent.click(dialog.getByRole('button', { name: 'Create' }))
  await waitFor(() =>
    expect(dialog.getByText("the document already has a trigger 'trigger-1'")).toBeInTheDocument(),
  )
  expect(dialog.getByRole('button', { name: 'Create' })).toBeInTheDocument()
})

test('the reorder buttons post move_trigger and disable at the ends', async () => {
  renderSection(projectWithTriggers([trigger('a'), trigger('b'), trigger('c')]))
  expect(screen.getByRole('button', { name: 'Move a up' })).toBeDisabled()
  expect(screen.getByRole('button', { name: 'Move c down' })).toBeDisabled()
  fireEvent.click(screen.getByRole('button', { name: 'Move b up' }))
  await waitFor(() => expect(postOps).toHaveBeenCalledTimes(1))
  const [, , ops] = postOps.mock.calls[0]
  expect(ops).toEqual([{ op: 'move_trigger', trigger_id: 'b', index: 0 }])
})

test('remove is a two-step confirm posting remove_trigger', async () => {
  renderSection(projectWithTriggers([trigger('a')]))
  const row = screen.getByTestId('trigger-row-a')
  fireEvent.click(within(row).getByRole('button', { name: 'Remove' }))
  expect(row).toHaveTextContent('removal dangles nothing')
  fireEvent.click(within(row).getByRole('button', { name: 'Confirm remove' }))
  await waitFor(() => expect(postOps).toHaveBeenCalledTimes(1))
  const [, , ops] = postOps.mock.calls[0]
  expect(ops).toEqual([{ op: 'remove_trigger', trigger_id: 'a' }])
})

test('the inline rename prompt — an op_invariant on the id field stays in place', async () => {
  postOps.mockRejectedValueOnce(
    new ApiRequestError(422, {
      code: 'op_invariant',
      message: "the document already has a trigger 'taken'",
      remedy: null,
      details: null,
    }),
  )
  renderSection(projectWithTriggers([trigger('editable'), trigger('taken')]))
  const id = screen.getByLabelText('Id')
  fireEvent.change(id, { target: { value: 'taken' } })
  fireEvent.blur(id)
  await waitFor(() =>
    expect(screen.getByText("the document already has a trigger 'taken'")).toBeInTheDocument(),
  )
})

test('the repeatable toggle patches through the committed document', async () => {
  renderSection(projectWithTriggers([trigger('a')]))
  fireEvent.click(screen.getByRole('checkbox', { name: 'Repeatable' }))
  await waitFor(() => expect(postOps).toHaveBeenCalledTimes(1))
  const [, , ops] = postOps.mock.calls[0]
  expect(ops).toEqual([
    { op: 'set_trigger', trigger_id: 'a', trigger: { ...trigger('a'), repeatable: true } },
  ])
})

test('adding a condition renders the builder with consumes suppressed', () => {
  renderSection(projectWithTriggers([trigger('a')]))
  fireEvent.click(screen.getByRole('button', { name: 'Add condition' }))
  expect(screen.getByLabelText('Condition kind')).toBeInTheDocument()
  // The consumes control never renders on a trigger condition — osrlib
  // rejects a consuming trigger condition at parse.
  expect(screen.queryByText('Consumes the item — a toll')).not.toBeInTheDocument()
})

test('a committed condition edit and a consequence reorder ride SetTrigger whole', async () => {
  const conditions: TriggerSpec['conditions'] = [
    { condition_type: 'flag_equals', key: 'k', value: true },
  ]
  const consequences: TriggerSpec['consequences'] = [
    { command_type: 'set_flag', key: 'first', value: true },
    { command_type: 'set_flag', key: 'second', value: true },
  ]
  const spec = trigger('a', { conditions, consequences })
  renderSection(projectWithTriggers([spec]))
  fireEvent.click(screen.getByRole('button', { name: 'Move consequence 2 up' }))
  await waitFor(() => expect(postOps).toHaveBeenCalledTimes(1))
  const [, , ops] = postOps.mock.calls[0]
  expect(ops).toEqual([
    {
      op: 'set_trigger',
      trigger_id: 'a',
      trigger: { ...spec, consequences: [consequences[1], consequences[0]] },
    },
  ])
})

test('the narrative editor reads the fired and journal beats', () => {
  renderSection(projectWithTriggers([trigger('a')]))
  expect(screen.getByLabelText('Fired')).toBeInTheDocument()
  expect(screen.getByLabelText('Journal')).toBeInTheDocument()
  expect(screen.queryByLabelText('Refusal')).not.toBeInTheDocument()
})

// --- the quest half ----------------------------------------------------------

function objective(id: string, overrides: Partial<ObjectiveSpec> = {}): ObjectiveSpec {
  return {
    id,
    name: '',
    when: { pattern: { pattern_type: 'town_entered' }, conditions: [] },
    hidden: false,
    reveal_when: null,
    narrative: null,
    ...overrides,
  }
}

function quest(id: string, overrides: Partial<QuestSpec> = {}): QuestSpec {
  return {
    id,
    name: 'The quest',
    activation: null,
    objectives: [objective('o-1')],
    rewards: [],
    completion: 'all',
    concludes_adventure: false,
    narrative: null,
    ...overrides,
  }
}

function projectWithQuests(
  quests: QuestSpec[],
  overrides: Partial<ProjectState> = {},
): ProjectState {
  const document = makeDocument({ quests })
  return makeProjectState({ document, ...overrides })
}

test('the quest list renders document order — numbered, never sorted, with the concludes badge', () => {
  const project = projectWithQuests([
    quest('zeta', {
      name: 'The last errand',
      concludes_adventure: true,
      activation: {
        pattern: { pattern_type: 'dungeon_entered', dungeon_id: 'crypt' },
        conditions: [],
      },
    }),
    quest('alpha', {
      name: 'The first errand',
      rewards: [{ command_type: 'set_flag', key: 'k', value: true }],
    }),
  ])
  renderSection(project)
  const rows = screen.getAllByTestId(/quest-row-/)
  expect(rows.map((row) => row.getAttribute('data-testid'))).toEqual([
    'quest-row-zeta',
    'quest-row-alpha',
  ])
  expect(rows[0]).toHaveTextContent('1.')
  expect(rows[0]).toHaveTextContent('The last errand')
  expect(rows[0]).toHaveTextContent('concludes')
  expect(rows[0]).toHaveTextContent("on entering 'crypt'")
  expect(rows[1]).toHaveTextContent('2.')
  expect(rows[1]).toHaveTextContent('standing charge')
  expect(rows[1]).toHaveTextContent('1 objective · 1 reward')
  expect(
    screen.getByText('The interpreter seeds and walks quests in this order', { exact: false }),
  ).toBeInTheDocument()
})

test('the quest create flow requires a name and an objective pattern, then posts add_quest', async () => {
  renderSection(projectWithQuests([quest('quest-1')]))
  fireEvent.click(screen.getByRole('button', { name: 'New quest' }))
  const dialog = within(screen.getByRole('dialog'))
  expect(dialog.getByLabelText('Id')).toHaveValue('quest-2')
  // A QuestSpec parses only with a name and one complete objective: Create
  // stays disabled until both land.
  expect(dialog.getByRole('button', { name: 'Create' })).toBeDisabled()
  fireEvent.change(dialog.getByLabelText('Fires'), { target: { value: 'town_entered' } })
  expect(dialog.getByRole('button', { name: 'Create' })).toBeDisabled()
  fireEvent.change(dialog.getByLabelText('Name'), { target: { value: 'The idol' } })
  fireEvent.click(dialog.getByRole('button', { name: 'Create' }))
  await waitFor(() => expect(postOps).toHaveBeenCalledTimes(1))
  const [, , ops] = postOps.mock.calls[0]
  expect(ops).toEqual([
    {
      op: 'add_quest',
      quest: {
        id: 'quest-2',
        name: 'The idol',
        activation: null,
        objectives: [objective('objective-1')],
        rewards: [],
        completion: 'all',
        concludes_adventure: false,
        narrative: null,
      },
    },
  ])
})

test('a duplicate quest id rejection renders inline in the create dialog — the rename prompt', async () => {
  postOps.mockRejectedValueOnce(
    new ApiRequestError(422, {
      code: 'op_invariant',
      message: "the document already has a quest 'quest-1'",
      remedy: null,
      details: null,
    }),
  )
  renderSection(projectWithQuests([quest('quest-1')]))
  fireEvent.click(screen.getByRole('button', { name: 'New quest' }))
  const dialog = within(screen.getByRole('dialog'))
  fireEvent.change(dialog.getByLabelText('Id'), { target: { value: 'quest-1' } })
  fireEvent.change(dialog.getByLabelText('Name'), { target: { value: 'The idol' } })
  fireEvent.change(dialog.getByLabelText('Fires'), { target: { value: 'town_entered' } })
  fireEvent.click(dialog.getByRole('button', { name: 'Create' }))
  await waitFor(() =>
    expect(dialog.getByText("the document already has a quest 'quest-1'")).toBeInTheDocument(),
  )
})

test('the quest reorder buttons post move_quest and disable at the ends', async () => {
  renderSection(projectWithQuests([quest('qa'), quest('qb'), quest('qc')]))
  expect(screen.getByRole('button', { name: 'Move qa up' })).toBeDisabled()
  expect(screen.getByRole('button', { name: 'Move qc down' })).toBeDisabled()
  fireEvent.click(screen.getByRole('button', { name: 'Move qb up' }))
  await waitFor(() => expect(postOps).toHaveBeenCalledTimes(1))
  const [, , ops] = postOps.mock.calls[0]
  expect(ops).toEqual([{ op: 'move_quest', quest_id: 'qb', index: 0 }])
})

test('quest remove is a two-step confirm posting remove_quest', async () => {
  renderSection(projectWithQuests([quest('qa')]))
  const row = screen.getByTestId('quest-row-qa')
  fireEvent.click(within(row).getByRole('button', { name: 'Remove' }))
  expect(row).toHaveTextContent('removal dangles nothing')
  expect(row).toHaveTextContent('holds its lifecycle state keeps it, orphaned')
  fireEvent.click(within(row).getByRole('button', { name: 'Confirm remove' }))
  await waitFor(() => expect(postOps).toHaveBeenCalledTimes(1))
  const [, , ops] = postOps.mock.calls[0]
  expect(ops).toEqual([{ op: 'remove_quest', quest_id: 'qa' }])
})

test('the quest name field refuses an empty commit client-side', () => {
  renderSection(projectWithQuests([quest('qa', { name: 'Keep me' })]))
  const name = screen.getByLabelText('Name', { selector: '#quest-name' })
  fireEvent.change(name, { target: { value: '   ' } })
  fireEvent.blur(name)
  expect(postOps).not.toHaveBeenCalled()
  expect(name).toHaveValue('Keep me')
})

test('the standing charge states itself and Add activation opens a clause builder', async () => {
  renderSection(projectWithQuests([quest('qa')]))
  const activation = screen.getByLabelText('Activation')
  expect(activation).toHaveTextContent('Standing charge')
  expect(activation).toHaveTextContent('the engine never journals the offer text')
  fireEvent.click(within(activation).getByRole('button', { name: 'Add activation' }))
  fireEvent.change(within(activation).getByLabelText('Fires'), {
    target: { value: 'town_entered' },
  })
  await waitFor(() => expect(postOps).toHaveBeenCalledTimes(1))
  const [, , ops] = postOps.mock.calls[0]
  expect(ops).toEqual([
    {
      op: 'set_quest',
      quest_id: 'qa',
      quest: {
        ...quest('qa'),
        activation: { pattern: { pattern_type: 'town_entered' }, conditions: [] },
      },
    },
  ])
})

test('removing the activation returns to the standing charge', async () => {
  const spec = quest('qa', {
    activation: { pattern: { pattern_type: 'town_entered' }, conditions: [] },
  })
  renderSection(projectWithQuests([spec]))
  fireEvent.click(screen.getByRole('button', { name: 'Remove activation' }))
  await waitFor(() => expect(postOps).toHaveBeenCalledTimes(1))
  const [, , ops] = postOps.mock.calls[0]
  expect(ops).toEqual([{ op: 'set_quest', quest_id: 'qa', quest: { ...spec, activation: null } }])
})

test('a clause condition on the activation commits with consumes suppressed', () => {
  const spec = quest('qa', {
    activation: { pattern: { pattern_type: 'town_entered' }, conditions: [] },
  })
  renderSection(projectWithQuests([spec]))
  const activation = screen.getByLabelText('Activation')
  fireEvent.click(within(activation).getByRole('button', { name: 'Add condition' }))
  expect(within(activation).getByLabelText('Condition kind')).toBeInTheDocument()
  expect(activation).toHaveTextContent('A quest observes, it does not take')
  // The consumes control never renders on a clause condition — osrlib
  // rejects a consuming clause condition at parse.
  expect(screen.queryByText('Consumes the item — a toll')).not.toBeInTheDocument()
})

test('unchecking hidden clears the reveal clause in the same gesture', async () => {
  const hidden = objective('o-1', {
    hidden: true,
    reveal_when: { pattern: { pattern_type: 'town_entered' }, conditions: [] },
  })
  const spec = quest('qa', { objectives: [hidden] })
  renderSection(projectWithQuests([spec]))
  fireEvent.click(screen.getByRole('checkbox', { name: 'Hidden objective o-1' }))
  await waitFor(() => expect(postOps).toHaveBeenCalledTimes(1))
  const [, , ops] = postOps.mock.calls[0]
  expect(ops).toEqual([
    {
      op: 'set_quest',
      quest_id: 'qa',
      quest: { ...spec, objectives: [objective('o-1', { hidden: false, reveal_when: null })] },
    },
  ])
})

test('a hidden objective without a reveal clause names the surfaces-by-completing shape', () => {
  const spec = quest('qa', { objectives: [objective('o-1', { hidden: true })] })
  renderSection(projectWithQuests([spec]))
  const reveal = screen.getByLabelText('Reveal o-1')
  expect(reveal).toHaveTextContent('the objective surfaces by completing')
  expect(within(reveal).getByRole('button', { name: 'Add reveal clause' })).toBeInTheDocument()
})

test('the editor never removes the last objective, with the reason named', () => {
  renderSection(projectWithQuests([quest('qa')]))
  expect(screen.getByRole('button', { name: 'Remove objective o-1' })).toBeDisabled()
  expect(screen.getByText(/objective-less quest would be born complete/)).toBeInTheDocument()
})

test('objective reorder rides SetQuest whole', async () => {
  const spec = quest('qa', { objectives: [objective('first'), objective('second')] })
  renderSection(projectWithQuests([spec]))
  fireEvent.click(screen.getByRole('button', { name: 'Move objective second up' }))
  await waitFor(() => expect(postOps).toHaveBeenCalledTimes(1))
  const [, , ops] = postOps.mock.calls[0]
  expect(ops).toEqual([
    {
      op: 'set_quest',
      quest_id: 'qa',
      quest: { ...spec, objectives: [objective('second'), objective('first')] },
    },
  ])
})

test('the draft objective row refuses a quest-scoped duplicate id inline', () => {
  renderSection(projectWithQuests([quest('qa', { objectives: [objective('objective-1')] })]))
  fireEvent.click(screen.getByRole('button', { name: 'New objective' }))
  // The prefill is the next free objective-<n>, scoped to this quest alone.
  expect(screen.getByLabelText('Id', { selector: '#objective-new-id' })).toHaveValue('objective-2')
  fireEvent.change(screen.getByLabelText('Id', { selector: '#objective-new-id' }), {
    target: { value: 'objective-1' },
  })
  expect(screen.getByText(/already has an objective 'objective-1'/)).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Add' })).toBeDisabled()
})

test('the draft objective row appends through SetQuest whole', async () => {
  const spec = quest('qa')
  renderSection(projectWithQuests([spec]))
  fireEvent.click(screen.getByRole('button', { name: 'New objective' }))
  fireEvent.change(screen.getByLabelText('Id', { selector: '#objective-new-id' }), {
    target: { value: 'return-home' },
  })
  fireEvent.change(screen.getByLabelText('Fires', { selector: '#objective-new-pattern-kind' }), {
    target: { value: 'town_entered' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Add' }))
  await waitFor(() => expect(postOps).toHaveBeenCalledTimes(1))
  const [, , ops] = postOps.mock.calls[0]
  expect(ops).toEqual([
    {
      op: 'set_quest',
      quest_id: 'qa',
      quest: { ...spec, objectives: [objective('o-1'), objective('return-home')] },
    },
  ])
})

test('a reward reorder rides SetQuest whole under the Rewards title', async () => {
  const rewards: QuestSpec['rewards'] = [
    { command_type: 'set_flag', key: 'first', value: true },
    { command_type: 'set_flag', key: 'second', value: true },
  ]
  const spec = quest('qa', { rewards })
  renderSection(projectWithQuests([spec]))
  expect(screen.getByLabelText('Rewards')).toHaveTextContent('spawns and placements drop')
  fireEvent.click(screen.getByRole('button', { name: 'Move reward 2 up' }))
  await waitFor(() => expect(postOps).toHaveBeenCalledTimes(1))
  const [, , ops] = postOps.mock.calls[0]
  expect(ops).toEqual([
    { op: 'set_quest', quest_id: 'qa', quest: { ...spec, rewards: [rewards[1], rewards[0]] } },
  ])
})

test('the completion rule and the concludes toggle patch through the committed document', async () => {
  renderSection(projectWithQuests([quest('qa')]))
  fireEvent.change(screen.getByLabelText('Completion', { selector: 'select' }), {
    target: { value: 'any' },
  })
  await waitFor(() => expect(postOps).toHaveBeenCalledTimes(1))
  expect(postOps.mock.calls[0][2]).toEqual([
    { op: 'set_quest', quest_id: 'qa', quest: { ...quest('qa'), completion: 'any' } },
  ])
  fireEvent.click(screen.getByRole('checkbox', { name: 'Concludes the adventure' }))
  await waitFor(() => expect(postOps).toHaveBeenCalledTimes(2))
  expect(postOps.mock.calls[1][2]).toEqual([
    { op: 'set_quest', quest_id: 'qa', quest: { ...quest('qa'), concludes_adventure: true } },
  ])
})

test('the quest and objective narrative editors carry their own beat sets and no journal voice', () => {
  renderSection(projectWithQuests([quest('qa')]))
  // The quest's beats are offer and completion; the objective's offer and
  // progress — two Offer fields, one Completion, one Progress, and neither
  // fired nor journal anywhere.
  expect(screen.getAllByLabelText('Offer')).toHaveLength(2)
  expect(screen.getByLabelText('Completion', { selector: 'textarea' })).toBeInTheDocument()
  expect(screen.getByLabelText('Progress')).toBeInTheDocument()
  expect(screen.queryByLabelText('Journal')).not.toBeInTheDocument()
  expect(screen.queryByLabelText('Fired')).not.toBeInTheDocument()
})

test('a foreign journal beat on a quest block warns by name with the one-patch clear', () => {
  const spec = quest('qa', {
    narrative: {
      refusal: '',
      success: '',
      fired: '',
      offer: '',
      progress: '',
      completion: '',
      journal: 'A line nothing reads.',
      guidance: '',
      speaker: '',
    },
  })
  renderSection(projectWithQuests([spec]))
  const warning = screen.getAllByLabelText('Unread beat')[0]
  expect(warning).toHaveTextContent('journal')
  expect(
    within(warning).getByRole('button', { name: 'Clear the journal text' }),
  ).toBeInTheDocument()
})

test('a diagnostics navigation selects its quest', () => {
  renderSection(projectWithQuests([quest('qa'), quest('qb')]), { questId: 'qb' })
  expect(screen.getByTestId('quest-detail-qb')).toBeInTheDocument()
})

test('forge mode renders the explanation body with detach in place — no list, no controls', () => {
  const project = projectWithTriggers([], makeForgeState ? { forge: makeForgeState() } : {})
  renderSection(project)
  expect(screen.getByText(/no authored-layer surface/, { exact: false })).toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'osr-forge#39' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Detach to a native project…' })).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'New trigger' })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'New quest' })).not.toBeInTheDocument()
})

test('a diagnostics navigation selects its trigger', () => {
  renderSection(projectWithTriggers([trigger('a'), trigger('b')]), { triggerId: 'b' })
  expect(screen.getByTestId('trigger-detail-b')).toBeInTheDocument()
})
