// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, expect, test, vi } from 'vitest'

import { ImportDialog } from '@/components/import-dialog'
import { api } from '@/lib/api'
import { projectStore } from '@/store/project-store'
import { makeDocument, makeForgeState, makeProjectState } from '@/test/fixtures'
import type { Adventure, ImportedLevel, OpBatchResult } from '@/types'

vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }),
}))

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>()
  return {
    ...actual,
    api: {
      ...actual.api,
      listImporters: vi.fn(),
      sniffImporters: vi.fn(),
      loadGeometry: vi.fn(),
      postOps: vi.fn(),
    },
  }
})

const listImporters = vi.mocked(api.listImporters)
const sniffImporters = vi.mocked(api.sniffImporters)
const loadGeometry = vi.mocked(api.loadGeometry)
const postOps = vi.mocked(api.postOps)

function importedLevel(): ImportedLevel {
  return {
    label: 'src level 1',
    width: 4,
    height: 3,
    edges: {},
    areas: [{ id: '1', name: '', description: '', cells: [[0, 0]] }],
    entrance: [0, 0],
    transitions: [],
    notes: [],
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  projectStore.getState().clear()
  projectStore.getState().clearBlockedOp()
  listImporters.mockResolvedValue({ importers: [{ format_id: 'fmt', label: 'Format' }] })
  sniffImporters.mockResolvedValue({ format_ids: ['fmt'] })
  loadGeometry.mockResolvedValue({ levels: [importedLevel()] })
  postOps.mockResolvedValue({
    revision: 'r2',
    diagnostics: { validation: [], lint: [], forge: [] },
    delta: [],
    can_undo: true,
    can_redo: false,
  } satisfies OpBatchResult)
})

async function renderDialogWithGeometry(document: Adventure, forge = false) {
  projectStore
    .getState()
    .setProject(
      makeProjectState(forge ? { type: 'forge', forge: makeForgeState(), document } : { document }),
    )
  render(
    <ImportDialog
      open
      onOpenChange={() => undefined}
      document={document}
      dungeonId="dungeon-1"
      onNavigate={() => undefined}
      forge={forge}
    />,
  )
  fireEvent.change(screen.getByLabelText('Source path'), { target: { value: '/tmp/source' } })
  fireEvent.click(screen.getByRole('button', { name: 'Sniff' }))
  await waitFor(() => screen.getByRole('button', { name: 'Load' }))
  fireEvent.click(screen.getByRole('button', { name: 'Load' }))
  await waitFor(() => screen.getByLabelText('Source level'))
}

async function renderForgeDialogWithGeometry() {
  await renderDialogWithGeometry(makeDocument(), true)
}

test('the adoption controls appear only for fields the source carries and differs on', async () => {
  loadGeometry.mockResolvedValue({
    title: 'The Coppergrave Warrens',
    description: makeDocument().description,
    levels: [importedLevel()],
  })
  await renderDialogWithGeometry(makeDocument())
  // The title differs, so it is offered — off by default; the description
  // matches the project's own, so there is nothing to adopt.
  const adoptTitle = screen.getByRole('checkbox', { name: /Adopt the title/ })
  expect(adoptTitle).not.toBeChecked()
  expect(screen.queryByRole('checkbox', { name: /Adopt the description/ })).toBeNull()
})

test('a source carrying no metadata offers no adoption at all', async () => {
  await renderDialogWithGeometry(makeDocument())
  expect(screen.queryByLabelText('Adopt source metadata')).toBeNull()
})

test('adopted metadata rides the geometry batch, and only when checked', async () => {
  loadGeometry.mockResolvedValue({
    title: 'The Coppergrave Warrens',
    description: 'The smelters sank their spoil shaft the year the river turned green.',
    levels: [importedLevel()],
  })
  await renderDialogWithGeometry(makeDocument())

  fireEvent.click(screen.getByRole('button', { name: 'Import' }))
  await waitFor(() => expect(postOps).toHaveBeenCalled())
  expect(postOps.mock.calls[0][2].some((op) => op.op === 'set_adventure_field')).toBe(false)

  fireEvent.click(screen.getByRole('checkbox', { name: /Adopt the title/ }))
  fireEvent.click(screen.getByRole('checkbox', { name: /Adopt the description/ }))
  fireEvent.click(screen.getByRole('button', { name: 'Import' }))
  await waitFor(() => expect(postOps).toHaveBeenCalledTimes(2))
  expect(postOps.mock.calls[1][2].slice(0, 2)).toEqual([
    { op: 'set_adventure_field', field: 'name', value: 'The Coppergrave Warrens' },
    {
      op: 'set_adventure_field',
      field: 'description',
      value: 'The smelters sank their spoil shaft the year the river turned green.',
    },
  ])
})

function documentWithStockedLevel(): Adventure {
  const document = makeDocument()
  return {
    ...document,
    dungeons: [
      {
        ...document.dungeons[0],
        levels: [
          {
            ...document.dungeons[0].levels[0],
            areas: [
              {
                id: '1',
                name: '',
                description: 'Watabou note text',
                cells: [[0, 0]],
                encounter: null,
                features: [],
                trap: null,
                treasure: null,
              },
            ],
          },
        ],
      },
    ],
  }
}

async function startReplace(document: Adventure) {
  await renderDialogWithGeometry(document)
  fireEvent.click(screen.getByRole('radio', { name: /Replace the geometry/ }))
  fireEvent.click(screen.getByRole('button', { name: 'Import' }))
}

test('a replace over content offers the stash first, and the capture precedes the batch', async () => {
  const stashLevel = vi.fn().mockResolvedValue(true)
  projectStore.setState({ stashLevel })
  await startReplace(documentWithStockedLevel())
  // The confirm step replaces the old window.confirm: an act-accurate tally
  // plus the stash offer, default on.
  expect(screen.getByText('This removes:')).toBeInTheDocument()
  expect(screen.getByText('1 area description')).toBeInTheDocument()
  const offer = screen.getByRole('checkbox', {
    name: "Stash this level's content in the library first",
  })
  expect(offer).toBeChecked()
  fireEvent.click(screen.getByRole('button', { name: 'Replace level' }))
  await waitFor(() => expect(postOps).toHaveBeenCalled())
  expect(stashLevel).toHaveBeenCalledWith('dungeon-1', 1)
  // Sequenced: the capture resolves before the destructive batch posts.
  expect(stashLevel.mock.invocationCallOrder[0]).toBeLessThan(postOps.mock.invocationCallOrder[0])
})

test('a declined offer proceeds with the plain destructive batch', async () => {
  const stashLevel = vi.fn().mockResolvedValue(true)
  projectStore.setState({ stashLevel })
  await startReplace(documentWithStockedLevel())
  fireEvent.click(
    screen.getByRole('checkbox', { name: "Stash this level's content in the library first" }),
  )
  fireEvent.click(screen.getByRole('button', { name: 'Replace level' }))
  await waitFor(() => expect(postOps).toHaveBeenCalled())
  expect(stashLevel).not.toHaveBeenCalled()
})

test('a failed capture stops the replacement with the level intact', async () => {
  const stashLevel = vi.fn().mockResolvedValue(false)
  projectStore.setState({ stashLevel })
  await startReplace(documentWithStockedLevel())
  fireEvent.click(screen.getByRole('button', { name: 'Replace level' }))
  await waitFor(() => expect(stashLevel).toHaveBeenCalled())
  expect(postOps).not.toHaveBeenCalled()
})

test('a replace over a content-free level needs no confirm step', async () => {
  const stashLevel = vi.fn().mockResolvedValue(true)
  projectStore.setState({ stashLevel })
  await startReplace(makeDocument())
  await waitFor(() => expect(postOps).toHaveBeenCalled())
  expect(stashLevel).not.toHaveBeenCalled()
  expect(screen.queryByText('This removes:')).toBeNull()
})

test('the forge new-level mode is visible and opens the blocked-op dialog', async () => {
  await renderForgeDialogWithGeometry()
  // The backported offer-in-place posture: the choice renders, is not
  // preemptively hidden, and choosing it lands in the blocked-op dialog.
  const newMode = screen.getByRole('radio', { name: /Add as a new level/ })
  fireEvent.click(newMode)
  expect(projectStore.getState().blockedOp).toEqual({
    op: 'add_level',
    address: 'dungeon:dungeon-1',
    message: 'level structure has no override kind',
  })
  // The mode itself never engages — replace stays selected.
  expect(screen.getByRole('radio', { name: /Replace the geometry/ })).toBeChecked()
  expect(newMode).not.toBeChecked()
})
