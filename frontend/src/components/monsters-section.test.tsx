// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, expect, test, vi } from 'vitest'

import { MonstersSection } from '@/components/monsters-section'
import { api, ApiRequestError } from '@/lib/api'
import { clearRecentMonsters } from '@/lib/catalogs'
import { BUNDLED_TEMPLATE_BLOCKED_MESSAGE, seedMonsterTemplate } from '@/lib/monster-builders'
import { projectStore } from '@/store/project-store'
import { makeDocument, makeForgeState, makeProjectState } from '@/test/fixtures'
import type { CatalogMonster, MonsterTemplate, OpBatchResult, ProjectState } from '@/types'

vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }),
}))

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>()
  return {
    ...actual,
    api: {
      ...actual.api,
      postOps: vi.fn(),
      getMonsterCatalog: vi.fn(),
      getCatalogMonster: vi.fn(),
    },
  }
})

const postOps = vi.mocked(api.postOps)
const getMonsterCatalog = vi.mocked(api.getMonsterCatalog)
const getCatalogMonster = vi.mocked(api.getCatalogMonster)

// cmdk's command list observes its own size; jsdom has no ResizeObserver.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver ??= ResizeObserverStub as unknown as typeof ResizeObserver

const ORC_SUMMARY: CatalogMonster = {
  id: 'orc',
  name: 'Orc',
  page: 'orc',
  categories: [],
  alignment_options: ['chaotic'],
  usual_alignment: 'chaotic',
  hit_dice: { count: 1, die: 8, modifier: 0, asterisks: 0, average_hp: null, fixed_hp: null },
}

function projectWithMonsters(
  monsters: MonsterTemplate[],
  overrides: Partial<ProjectState> = {},
): ProjectState {
  const document = makeDocument({ monsters })
  return makeProjectState({ document, ...overrides })
}

function renderSection(
  project: ProjectState,
  section: { templateId?: string; create?: boolean } = {},
) {
  projectStore.getState().setProject(project)
  return render(<MonstersSection project={project} section={section} focusToken={1} />)
}

beforeEach(() => {
  vi.clearAllMocks()
  clearRecentMonsters()
  projectStore.getState().clear()
  projectStore.getState().clearBlockedOp()
  getMonsterCatalog.mockResolvedValue({ monsters: [ORC_SUMMARY] })
  postOps.mockResolvedValue({
    revision: 'r2',
    diagnostics: { validation: [], lint: [], forge: [] },
    delta: [],
    can_undo: true,
    can_redo: false,
  } satisfies OpBatchResult)
})

test('the list shows name, id, HD, XP, and the referenced-by count', () => {
  const template = seedMonsterTemplate('bespoke-1', 'Bespoke horror')
  const project = projectWithMonsters([template])
  project.document.dungeons[0].levels[0].areas = [
    {
      id: '1',
      name: '',
      description: '',
      cells: [[0, 0]],
      encounter: {
        monsters: [{ template_id: 'bespoke-1', count_dice: null, count_fixed: 2 }],
        alignment: null,
        aware: false,
        stance: null,
      },
      features: [],
      trap: null,
      treasure: null,
    },
  ]
  renderSection(project)
  const row = screen.getByTestId('monster-row-bespoke-1')
  expect(row).toHaveTextContent('Bespoke horror')
  expect(row).toHaveTextContent('bespoke-1 · HD 1 · 10 XP')
  expect(row).toHaveTextContent('referenced by 1 entry')
})

test('the create dialog commits the seed block and selects the new template', async () => {
  renderSection(projectWithMonsters([]))
  fireEvent.click(screen.getByRole('button', { name: 'New monster' }))
  fireEvent.change(screen.getByLabelText('Id'), { target: { value: 'gloom-stalker' } })
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Gloom stalker' } })
  fireEvent.click(screen.getByRole('button', { name: 'Create' }))
  await waitFor(() => expect(postOps).toHaveBeenCalledTimes(1))
  const [, , ops] = postOps.mock.calls[0]
  expect(ops).toEqual([
    {
      op: 'add_monster_template',
      template: seedMonsterTemplate('gloom-stalker', 'Gloom stalker'),
    },
  ])
})

test('a collision rejection renders inline in the create dialog', async () => {
  postOps.mockRejectedValueOnce(
    new ApiRequestError(422, {
      code: 'op_invariant',
      message: "monster template id 'orc' collides with the shipped catalog",
      remedy: null,
      details: null,
    }),
  )
  renderSection(projectWithMonsters([]))
  fireEvent.click(screen.getByRole('button', { name: 'New monster' }))
  fireEvent.change(screen.getByLabelText('Id'), { target: { value: 'orc' } })
  fireEvent.click(screen.getByRole('button', { name: 'Create' }))
  await waitFor(() =>
    expect(
      screen.getByText("monster template id 'orc' collides with the shipped catalog"),
    ).toBeInTheDocument(),
  )
  // The dialog stays open for the rename — the inline claim, never a toast.
  expect(screen.getByRole('button', { name: 'Create' })).toBeInTheDocument()
})

test('the clone flow prefills the next-free id and copies the stat block', async () => {
  const source: MonsterTemplate = {
    ...seedMonsterTemplate('orc', 'Orc'),
    page: 'orc',
    morale: 8,
    overrides_applied: ['note'],
  }
  getCatalogMonster.mockResolvedValue(source)
  renderSection(projectWithMonsters([]))
  fireEvent.click(screen.getByRole('button', { name: 'Clone catalog monster' }))
  const option = await screen.findByText('Orc')
  fireEvent.click(option)
  const idInput = await screen.findByLabelText('Id')
  expect(idInput).toHaveValue('orc-1')
  expect(screen.getByLabelText('Name')).toHaveValue('Orc')
  fireEvent.click(screen.getByRole('button', { name: 'Add to the adventure' }))
  await waitFor(() => expect(postOps).toHaveBeenCalledTimes(1))
  const [, , ops] = postOps.mock.calls[0]
  // The editor-authored conventions: page "" and no compiler provenance; the
  // rest of the stat block rides verbatim.
  expect(ops).toEqual([
    {
      op: 'add_monster_template',
      template: { ...source, id: 'orc-1', page: '', overrides_applied: [] },
    },
  ])
})

test('remove is a two-step confirm stating the referenced-by consequence', async () => {
  const template = seedMonsterTemplate('bespoke-1', 'Bespoke horror')
  renderSection(projectWithMonsters([template]))
  fireEvent.click(screen.getByRole('button', { name: 'Remove' }))
  expect(screen.getByText('Nothing references this template.')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Confirm remove' }))
  await waitFor(() => expect(postOps).toHaveBeenCalledTimes(1))
  const [, , ops] = postOps.mock.calls[0]
  expect(ops).toEqual([{ op: 'remove_monster_template', template_id: 'bespoke-1' }])
})

test('the detail editor renders the whole stat block for the selected template', () => {
  const template = seedMonsterTemplate('bespoke-1', 'Bespoke horror')
  renderSection(projectWithMonsters([template]))
  expect(screen.getByTestId('monster-detail-bespoke-1')).toBeInTheDocument()
  expect(screen.getByLabelText('Id')).toHaveValue('bespoke-1')
  expect(screen.getByLabelText('THAC0')).toHaveValue('19')
  expect(screen.getByLabelText('Morale')).toHaveValue('7')
  expect(screen.getByTestId('author-notes')).toBeInTheDocument()
})

test('a detail field commits one whole-template batch', async () => {
  const template = seedMonsterTemplate('bespoke-1', 'Bespoke horror')
  renderSection(projectWithMonsters([template]))
  const morale = screen.getByLabelText('Morale')
  fireEvent.change(morale, { target: { value: '9' } })
  fireEvent.blur(morale)
  await waitFor(() => expect(postOps).toHaveBeenCalledTimes(1))
  const [, , ops] = postOps.mock.calls[0]
  expect(ops).toEqual([
    {
      op: 'set_monster_template',
      template_id: 'bespoke-1',
      template: { ...template, morale: 9 },
    },
  ])
})

test('the auto-hit toggle clears both ACs in one gesture', async () => {
  const template = seedMonsterTemplate('bespoke-1', 'Bespoke horror')
  renderSection(projectWithMonsters([template]))
  fireEvent.click(screen.getByLabelText('Requires an attack roll'))
  await waitFor(() => expect(postOps).toHaveBeenCalledTimes(1))
  const [, , ops] = postOps.mock.calls[0]
  expect(ops).toEqual([
    {
      op: 'set_monster_template',
      template_id: 'bespoke-1',
      template: { ...template, attack_roll_required: false, ac: null, ac_ascending: null },
    },
  ])
})

test('forge flow-entry actions open the blocked-op dialog client-side, never posting', () => {
  const template = seedMonsterTemplate('bespoke-1', 'Bespoke horror')
  const project = projectWithMonsters([template], { type: 'forge', forge: makeForgeState() })
  renderSection(project)

  fireEvent.click(screen.getByRole('button', { name: 'New monster' }))
  expect(projectStore.getState().blockedOp).toEqual({
    op: 'add_monster_template',
    address: 'monsters',
    message: BUNDLED_TEMPLATE_BLOCKED_MESSAGE,
  })
  projectStore.getState().clearBlockedOp()

  fireEvent.click(screen.getByRole('button', { name: 'Clone catalog monster' }))
  expect(projectStore.getState().blockedOp?.op).toBe('add_monster_template')
  projectStore.getState().clearBlockedOp()

  fireEvent.click(screen.getByRole('button', { name: 'Remove' }))
  expect(projectStore.getState().blockedOp).toEqual({
    op: 'remove_monster_template',
    address: 'monster:bespoke-1',
    message: BUNDLED_TEMPLATE_BLOCKED_MESSAGE,
  })
  expect(postOps).not.toHaveBeenCalled()
  // The section still renders the derived bundle as a review view.
  expect(screen.getByTestId('monster-detail-bespoke-1')).toBeInTheDocument()
})

test('a forge detail-field commit renders its 422 through the blocked-op dialog, never inline', async () => {
  // The id field is the one surface with an inline claim — the claim
  // discipline is op_invariant only, so op_unsupported_forge must fall
  // through to the store's handler and land as the detach offer.
  postOps.mockRejectedValueOnce(
    new ApiRequestError(422, {
      code: 'op_unsupported_forge',
      message: BUNDLED_TEMPLATE_BLOCKED_MESSAGE,
      remedy: 'This edit has no override kind. Detach to a native project to make it, or cancel.',
      details: { op: 'set_monster_template', address: 'monster:bespoke-1' },
    }),
  )
  const template = seedMonsterTemplate('bespoke-1', 'Bespoke horror')
  const project = projectWithMonsters([template], { type: 'forge', forge: makeForgeState() })
  renderSection(project)
  const id = screen.getByLabelText('Id')
  fireEvent.change(id, { target: { value: 'renamed' } })
  fireEvent.blur(id)
  await waitFor(() =>
    expect(projectStore.getState().blockedOp).toEqual({
      op: 'set_monster_template',
      address: 'monster:bespoke-1',
      message: BUNDLED_TEMPLATE_BLOCKED_MESSAGE,
    }),
  )
  // Never claimed inline — the detach offer is not swallowed.
  expect(screen.queryByText(BUNDLED_TEMPLATE_BLOCKED_MESSAGE)).not.toBeInTheDocument()
})

test('a create intent from the picker shortcut opens the create dialog', () => {
  renderSection(projectWithMonsters([]), { create: true })
  expect(screen.getByRole('button', { name: 'Create' })).toBeInTheDocument()
})

test('a navigation target selects its template', () => {
  const first = seedMonsterTemplate('first', 'First')
  const second = seedMonsterTemplate('second', 'Second')
  renderSection(projectWithMonsters([first, second]), { templateId: 'second' })
  expect(screen.getByTestId('monster-detail-second')).toBeInTheDocument()
})
