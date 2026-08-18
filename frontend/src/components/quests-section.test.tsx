// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, expect, test, vi } from 'vitest'

import { QuestsSection } from '@/components/quests-section'
import { api, ApiRequestError } from '@/lib/api'
import { projectStore } from '@/store/project-store'
import { makeDocument, makeForgeState, makeProjectState } from '@/test/fixtures'
import type { OpBatchResult, ProjectState, TriggerSpec } from '@/types'

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

function renderSection(project: ProjectState, section: { triggerId?: string } = {}) {
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

test('the quest presence line names the count and ids, read-only', () => {
  const project = projectWithTriggers([])
  project.document.quests = [
    {
      id: 'the-idol',
      name: 'The idol',
      activation: null,
      objectives: [
        {
          id: 'find',
          name: '',
          hidden: false,
          reveal_when: null,
          when: { pattern: { pattern_type: 'town_entered' }, conditions: [] },
          narrative: null,
        },
      ],
      completion: 'all',
      concludes_adventure: false,
      rewards: [],
      narrative: null,
    },
  ]
  renderSection(project)
  const line = screen.getByTestId('quest-presence')
  expect(line).toHaveTextContent('This document carries 1 quest')
  expect(line).toHaveTextContent('the-idol')
  expect(line).toHaveTextContent('the quest builder arrives in a later phase')
})

test('forge mode renders the explanation body with detach in place — no list, no controls', () => {
  const project = projectWithTriggers([], makeForgeState ? { forge: makeForgeState() } : {})
  renderSection(project)
  expect(screen.getByText(/no authored-layer surface/, { exact: false })).toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'osr-forge#39' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Detach to a native project…' })).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'New trigger' })).not.toBeInTheDocument()
})

test('a diagnostics navigation selects its trigger', () => {
  renderSection(projectWithTriggers([trigger('a'), trigger('b')]), { triggerId: 'b' })
  expect(screen.getByTestId('trigger-detail-b')).toBeInTheDocument()
})
