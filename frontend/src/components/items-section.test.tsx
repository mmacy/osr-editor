// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, expect, test, vi } from 'vitest'

import { ItemsSection } from '@/components/items-section'
import { api, ApiRequestError } from '@/lib/api'
import { seedItemTemplate } from '@/lib/item-builders'
import { projectStore } from '@/store/project-store'
import { makeDocument, makeForgeState, makeProjectState } from '@/test/fixtures'
import type { CatalogItem, ItemTemplate, OpBatchResult, ProjectState } from '@/types'

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
      getCatalogItem: vi.fn(),
    },
  }
})

const postOps = vi.mocked(api.postOps)
const getEquipmentCatalog = vi.mocked(api.getEquipmentCatalog)
const getMagicItemCatalog = vi.mocked(api.getMagicItemCatalog)
const getCatalogItem = vi.mocked(api.getCatalogItem)

// cmdk's command list observes its own size; jsdom has no ResizeObserver.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver ??= ResizeObserverStub as unknown as typeof ResizeObserver

const TORCH_SUMMARY: CatalogItem = { id: 'torch', name: 'Torch', item_type: 'gear', cost_gp: 1 }

const SHIPPED_TORCH: ItemTemplate = {
  item_type: 'gear',
  id: 'torch',
  name: 'Torch',
  cost_gp: 1,
  lot_size: 6,
  capacity_coins: null,
  combat: null,
  params: { burn_turns: 6 },
  overrides_applied: ['note'],
}

function projectWithItems(
  items: ItemTemplate[],
  overrides: Partial<ProjectState> = {},
): ProjectState {
  const document = makeDocument({ items })
  return makeProjectState({ document, ...overrides })
}

function renderSection(project: ProjectState, section: { itemId?: string; create?: boolean } = {}) {
  projectStore.getState().setProject(project)
  return render(<ItemsSection project={project} section={section} focusToken={1} />)
}

beforeEach(() => {
  vi.clearAllMocks()
  projectStore.getState().clear()
  projectStore.getState().clearBlockedOp()
  getEquipmentCatalog.mockResolvedValue({ items: [TORCH_SUMMARY] })
  getMagicItemCatalog.mockResolvedValue({ items: [] })
  postOps.mockResolvedValue({
    revision: 'r2',
    diagnostics: { validation: [], lint: [], forge: [] },
    delta: [],
    can_undo: true,
    can_redo: false,
  } satisfies OpBatchResult)
})

test('the list shows name, id, kind, cost, and the referenced-by count', () => {
  const project = projectWithItems([seedItemTemplate('gear', 'brass-key', 'Brass key')])
  project.document.dungeons[0].levels[0].features = [
    {
      id: 'cache-1',
      kind: 'treasure_cache',
      description: '',
      cell: [0, 0],
      item_ids: ['brass-key'],
      magic_item_ids: [],
      coins: { pp: 0, gp: 0, ep: 0, sp: 0, cp: 0 },
      valuables: [],
      trap: null,
    },
  ]
  renderSection(project)
  const row = screen.getByTestId('item-row-brass-key')
  expect(row).toHaveTextContent('Brass key')
  expect(row).toHaveTextContent('brass-key · gear · 0 gp')
  expect(row).toHaveTextContent('referenced by 1 entry')
})

test('the create flow posts the chosen kind’s seed', async () => {
  renderSection(projectWithItems([]))
  fireEvent.click(screen.getByRole('button', { name: 'New item' }))
  fireEvent.change(screen.getByLabelText('Kind'), { target: { value: 'weapon' } })
  fireEvent.change(screen.getByLabelText('Id'), { target: { value: 'dull-blade' } })
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Dull blade' } })
  fireEvent.click(screen.getByRole('button', { name: 'Create' }))
  await waitFor(() => expect(postOps).toHaveBeenCalledTimes(1))
  const [, , ops] = postOps.mock.calls[0]
  expect(ops).toEqual([
    { op: 'add_item_template', template: seedItemTemplate('weapon', 'dull-blade', 'Dull blade') },
  ])
})

test('a collision rejection renders inline in the create dialog — the rename prompt', async () => {
  postOps.mockRejectedValueOnce(
    new ApiRequestError(422, {
      code: 'op_invariant',
      message: "item template id 'torch' collides with the shipped catalog",
      remedy: null,
      details: null,
    }),
  )
  renderSection(projectWithItems([]))
  fireEvent.click(screen.getByRole('button', { name: 'New item' }))
  fireEvent.change(screen.getByLabelText('Id'), { target: { value: 'torch' } })
  fireEvent.click(screen.getByRole('button', { name: 'Create' }))
  await waitFor(() =>
    expect(
      screen.getByText("item template id 'torch' collides with the shipped catalog"),
    ).toBeInTheDocument(),
  )
  // The dialog stays open for the rename — the inline claim, never a toast.
  expect(screen.getByRole('button', { name: 'Create' })).toBeInTheDocument()
})

test('the clone flow fetches a shipped source, prefills the next-free id, and strips provenance', async () => {
  getCatalogItem.mockResolvedValue(SHIPPED_TORCH)
  renderSection(projectWithItems([]))
  fireEvent.click(screen.getByRole('button', { name: 'Clone catalog item' }))
  fireEvent.click(await screen.findByText('Torch'))
  await waitFor(() => expect(getCatalogItem).toHaveBeenCalledWith('torch'))
  const idField = await screen.findByLabelText('Id')
  expect(idField).toHaveValue('torch-1')
  fireEvent.click(screen.getByRole('button', { name: 'Add to the adventure' }))
  await waitFor(() => expect(postOps).toHaveBeenCalledTimes(1))
  const [, , ops] = postOps.mock.calls[0]
  expect(ops).toEqual([
    {
      op: 'add_item_template',
      template: { ...SHIPPED_TORCH, id: 'torch-1', overrides_applied: [] },
    },
  ])
})

test('removing a referenced template is a two-step confirm naming the count', async () => {
  const project = projectWithItems([seedItemTemplate('gear', 'brass-key', 'Brass key')])
  project.document.dungeons[0].levels[0].features = [
    {
      id: 'cache-1',
      kind: 'treasure_cache',
      description: '',
      cell: [0, 0],
      item_ids: ['brass-key', 'brass-key'],
      magic_item_ids: [],
      coins: { pp: 0, gp: 0, ep: 0, sp: 0, cp: 0 },
      valuables: [],
      trap: null,
    },
  ]
  renderSection(project)
  const row = screen.getByTestId('item-row-brass-key')
  fireEvent.click(within(row).getByRole('button', { name: 'Remove' }))
  expect(row).toHaveTextContent('2 references keep naming this id and become diagnostics.')
  fireEvent.click(within(row).getByRole('button', { name: 'Confirm remove' }))
  await waitFor(() => expect(postOps).toHaveBeenCalledTimes(1))
  const [, , ops] = postOps.mock.calls[0]
  expect(ops).toEqual([{ op: 'remove_item_template', item_id: 'brass-key' }])
})

test('the detail forms cover each kind — the weapon missile toggle travels with its ranges', async () => {
  const weapon = seedItemTemplate('weapon', 'dull-blade', 'Dull blade')
  renderSection(projectWithItems([weapon]))
  const missile = screen.getByRole('checkbox', { name: 'missile' })
  fireEvent.click(missile)
  await waitFor(() => expect(postOps).toHaveBeenCalledTimes(1))
  const [, , ops] = postOps.mock.calls[0]
  expect(ops).toEqual([
    {
      op: 'set_item_template',
      item_id: 'dull-blade',
      template: expect.objectContaining({
        qualities: ['melee', 'missile'],
        missile_ranges: {
          short: { min_feet: 5, max_feet: 50 },
          medium: { min_feet: 51, max_feet: 100 },
          long: { min_feet: 101, max_feet: 150 },
        },
      }),
    },
  ])
})

test('the armour radio swaps the body and shield field sets whole', async () => {
  const armour = seedItemTemplate('armour', 'hide-shirt', 'Hide shirt')
  renderSection(projectWithItems([armour]))
  fireEvent.click(screen.getByRole('radio', { name: 'Shield' }))
  await waitFor(() => expect(postOps).toHaveBeenCalledTimes(1))
  const [, , ops] = postOps.mock.calls[0]
  expect(ops).toEqual([
    {
      op: 'set_item_template',
      item_id: 'hide-shirt',
      template: expect.objectContaining({
        ac: null,
        ac_ascending: null,
        category: null,
        ac_bonus: 1,
      }),
    },
  ])
})

test('the forge body is the explanation, not a list: the recorded gap, with detach in place', () => {
  const project = projectWithItems([], { type: 'forge', forge: makeForgeState() })
  renderSection(project)
  expect(screen.getByText(/no authored-layer surface|carries no bundled items/)).toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'osr-forge#39' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Detach to a native project…' })).toBeInTheDocument()
  // No list, no create, no clone — a forge-assembled document can never
  // carry items, so the explanation is the honest section body.
  expect(screen.queryByRole('button', { name: 'New item' })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Clone catalog item' })).not.toBeInTheDocument()
})

test('a navigation target selects its template', () => {
  const first = seedItemTemplate('gear', 'first', 'First')
  const second = seedItemTemplate('gear', 'second', 'Second')
  renderSection(projectWithItems([first, second]), { itemId: 'second' })
  expect(screen.getByTestId('item-detail-second')).toBeInTheDocument()
})
