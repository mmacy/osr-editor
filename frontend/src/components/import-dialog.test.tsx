// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, expect, test, vi } from 'vitest'

import { ImportDialog } from '@/components/import-dialog'
import { api } from '@/lib/api'
import { projectStore } from '@/store/project-store'
import { makeDocument, makeForgeState, makeProjectState } from '@/test/fixtures'
import type { ImportedLevel } from '@/types'

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
})

async function renderForgeDialogWithGeometry() {
  const document = makeDocument()
  projectStore
    .getState()
    .setProject(makeProjectState({ type: 'forge', forge: makeForgeState(), document }))
  render(
    <ImportDialog
      open
      onOpenChange={() => undefined}
      document={document}
      dungeonId="dungeon-1"
      onNavigate={() => undefined}
      forge
    />,
  )
  fireEvent.change(screen.getByLabelText('Source path'), { target: { value: '/tmp/source' } })
  fireEvent.click(screen.getByRole('button', { name: 'Sniff' }))
  await waitFor(() => screen.getByRole('button', { name: 'Load' }))
  fireEvent.click(screen.getByRole('button', { name: 'Load' }))
  await waitFor(() => screen.getByLabelText('Source level'))
}

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
