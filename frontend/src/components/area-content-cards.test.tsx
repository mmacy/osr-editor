// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react'
import { beforeEach, expect, test, vi } from 'vitest'

import { AreaContentCards, type CardIntent } from '@/components/area-content-cards'
import { api } from '@/lib/api'
import { projectStore } from '@/store/project-store'
import { makeDocument, makeProjectState } from '@/test/fixtures'
import type { AreaSpec, OpBatchResult } from '@/types'

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
      getMonsterCatalog: vi.fn(() => new Promise(() => undefined)),
    },
  }
})

const postOps = vi.mocked(api.postOps)

function area(id: string): AreaSpec {
  return {
    id,
    name: '',
    description: '',
    cells: [[0, 0]],
    encounter: null,
    features: [],
    trap: null,
    treasure: null,
  }
}

function renderCards(areaId: string, intent: CardIntent | null) {
  const target = { dungeonId: 'dungeon-1', levelNumber: 1, areaId }
  const spec = area(areaId)
  const document = makeDocument()
  document.dungeons[0].levels[0].areas = [spec]
  projectStore.getState().setProject(makeProjectState({ document }))
  return render(
    <AreaContentCards document={document} area={spec} target={target} intent={intent} />,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  projectStore.getState().clear()
  postOps.mockResolvedValue({
    revision: 'r2',
    diagnostics: { validation: [], lint: [] },
    delta: [],
    can_undo: true,
    can_redo: false,
  } satisfies OpBatchResult)
})

test('an add intent raised on this area expands its card and commits its flow', async () => {
  renderCards('1', { areaId: '1', card: 'trap', action: 'add', token: 1 })
  await waitFor(() => expect(postOps).toHaveBeenCalledTimes(1))
  const [, , ops] = postOps.mock.calls[0]
  expect(ops).toEqual([
    expect.objectContaining({
      op: 'set_trap',
      area_id: '1',
      trap: expect.objectContaining({ kind: 'room' }),
    }),
  ])
  expect(screen.getByRole('button', { name: 'Trap' })).toHaveAttribute('aria-expanded', 'true')
})

test('a stale intent from another area never replays — the inspector remounts per area, the pin holds', async () => {
  // The intent was raised on area 1; the panel now shows area 2. Without the
  // areaId pin the freshly mounted consumer would replay the add here.
  renderCards('2', { areaId: '1', card: 'trap', action: 'add', token: 1 })
  await new Promise((resolve) => setTimeout(resolve, 20))
  expect(postOps).not.toHaveBeenCalled()
  // The trap card stays the collapsed empty add row, unexpanded.
  expect(screen.queryByRole('button', { name: 'Trap', expanded: true })).not.toBeInTheDocument()
})
