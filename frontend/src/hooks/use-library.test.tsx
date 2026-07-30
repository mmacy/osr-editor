// @vitest-environment jsdom
// The collision-memory reducer's contract: prompt once per pack and kind,
// remember each choice as it is made, die when the pack closes.
import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, expect, test, vi } from 'vitest'

import { useLibrary } from '@/hooks/use-library'
import { api } from '@/lib/api'
import { projectStore, type CommitOptions, type OpsInput } from '@/store/project-store'
import { makeProjectState } from '@/test/fixtures'
import type { LevelSpec, SourceState } from '@/types'

type CommitAction = (ops: OpsInput, options?: CommitOptions) => Promise<boolean>

vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }),
}))

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>()
  return {
    ...actual,
    api: { ...actual.api, openSource: vi.fn(), openStashPack: vi.fn(), getCatalogMonster: vi.fn() },
  }
})

vi.mock('@/lib/catalogs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/catalogs')>()
  return { ...actual, loadMonsterCatalog: vi.fn().mockResolvedValue([]) }
})

const openSource = vi.mocked(api.openSource)

const ENTRY_ID = 'dungeon:mill/level:1/area:1'

function makeSource(): SourceState {
  return {
    identity: '/adventures/mill.osr',
    label: 'Mill',
    habitat: 'project',
    findings: [],
    pack: {
      id: '',
      name: 'Mill',
      description: '',
      author: '',
      monsters: [],
      sections: [
        {
          id: 'dungeon:mill/level:1',
          label: 'Mill level 1',
          wandering: null,
          entries: [
            {
              id: ENTRY_ID,
              name: 'The guard post',
              description: '',
              encounter: null,
              trap: null,
              treasure: null,
              features: [],
            },
          ],
        },
      ],
    },
  }
}

const LEVEL: LevelSpec = {
  number: 1,
  width: 8,
  height: 6,
  edges: {},
  areas: [
    {
      id: '7',
      name: 'Watabou note',
      description: '',
      cells: [[0, 0]],
      encounter: null,
      features: [],
      trap: null,
      treasure: null,
    },
  ],
  features: [],
  transitions: [],
  wandering: { chance_in_six: 1, interval_turns: 2, table: null },
  entrance: null,
}

let commit: ReturnType<typeof vi.fn<CommitAction>>

beforeEach(() => {
  vi.clearAllMocks()
  commit = vi.fn<CommitAction>().mockResolvedValue(true)
  const patchSidecar = vi.fn().mockResolvedValue(undefined)
  projectStore.setState({ project: makeProjectState(), commit, patchSidecar })
  openSource.mockResolvedValue(makeSource())
})

async function hookWithOpenPack() {
  const hook = renderHook(() => useLibrary('dungeon-1', 1, LEVEL))
  act(() => hook.result.current.openSource('/adventures/mill.osr'))
  await waitFor(() => expect(hook.result.current.sources).toHaveLength(1))
  return hook
}

test('a colliding drop prompts once, remembers per kind, and stops prompting', async () => {
  const hook = await hookWithOpenPack()
  // First drop: the entry's name collides with the area's Watabou note.
  act(() => hook.result.current.placeDropped('/adventures/mill.osr', ENTRY_ID, '7'))
  expect(hook.result.current.prompt?.kinds).toEqual(['name'])
  expect(commit).not.toHaveBeenCalled()
  // Answering commits and records the choice into the pack's memory.
  act(() => hook.result.current.submitPrompt({ name: 'replace' }))
  await waitFor(() => expect(commit).toHaveBeenCalledTimes(1))
  expect(hook.result.current.prompt).toBeNull()
  // The next colliding drop reuses the remembered choice — no second prompt.
  act(() => hook.result.current.placeDropped('/adventures/mill.osr', ENTRY_ID, '7'))
  await waitFor(() => expect(commit).toHaveBeenCalledTimes(2))
  expect(hook.result.current.prompt).toBeNull()
})

test('the memory dies when its pack closes', async () => {
  const hook = await hookWithOpenPack()
  act(() => hook.result.current.placeDropped('/adventures/mill.osr', ENTRY_ID, '7'))
  act(() => hook.result.current.submitPrompt({ name: 'keep' }))
  await waitFor(() => expect(commit).toHaveBeenCalledTimes(1))
  act(() => hook.result.current.closePack('/adventures/mill.osr'))
  expect(hook.result.current.sources).toHaveLength(0)
  // Re-open: the pack is fresh, so a colliding drop prompts again.
  act(() => hook.result.current.openSource('/adventures/mill.osr'))
  await waitFor(() => expect(hook.result.current.sources).toHaveLength(1))
  act(() => hook.result.current.placeDropped('/adventures/mill.osr', ENTRY_ID, '7'))
  expect(hook.result.current.prompt?.kinds).toEqual(['name'])
})

test('a non-colliding drop commits straight through with provenance chained', async () => {
  const hook = await hookWithOpenPack()
  act(() => hook.result.current.placeDropped('/adventures/mill.osr', ENTRY_ID, '1'))
  // Area '1' does not exist on this level — target vanished, nothing commits.
  expect(commit).not.toHaveBeenCalled()
  const blankLevel = { ...LEVEL, areas: [{ ...LEVEL.areas[0], name: '' }] }
  const fresh = renderHook(() => useLibrary('dungeon-1', 1, blankLevel))
  act(() => fresh.result.current.openSource('/adventures/mill.osr'))
  await waitFor(() => expect(fresh.result.current.sources).toHaveLength(1))
  act(() => fresh.result.current.placeDropped('/adventures/mill.osr', ENTRY_ID, '7'))
  await waitFor(() => expect(commit).toHaveBeenCalledTimes(1))
  const { patchSidecar } = projectStore.getState()
  await waitFor(() =>
    expect(vi.mocked(patchSidecar)).toHaveBeenCalledWith([
      {
        action: 'record_copy',
        address: 'dungeon:dungeon-1/level:1/area:7',
        pack_identity: '/adventures/mill.osr',
        pack_entry_id: ENTRY_ID,
      },
    ]),
  )
})

test('a loaded source is remembered and restored on return', async () => {
  // Opening writes the identity into the sidecar's view state...
  const hook = await hookWithOpenPack()
  const { patchSidecar } = projectStore.getState()
  await waitFor(() =>
    expect(vi.mocked(patchSidecar)).toHaveBeenCalledWith([
      {
        action: 'set_view_state',
        view_state: expect.objectContaining({ library_sources: ['/adventures/mill.osr'] }),
      },
    ]),
  )
  hook.unmount()
  // ...and a fresh mount over a project remembering it re-opens it unasked.
  const project = makeProjectState()
  projectStore.setState({
    project: {
      ...project,
      sidecar: {
        ...project.sidecar,
        view_state: { ...project.sidecar.view_state, library_sources: ['/adventures/mill.osr'] },
      },
    },
  })
  openSource.mockClear()
  const returned = renderHook(() => useLibrary('dungeon-1', 1, LEVEL))
  await waitFor(() => expect(returned.result.current.sources).toHaveLength(1))
  expect(openSource).toHaveBeenCalledWith('/adventures/mill.osr')
})

test('a remembered source that no longer opens is forgotten once', async () => {
  const project = makeProjectState()
  projectStore.setState({
    project: {
      ...project,
      sidecar: {
        ...project.sidecar,
        view_state: { ...project.sidecar.view_state, library_sources: ['/gone.osr'] },
      },
    },
  })
  openSource.mockRejectedValue(new Error('no directory at /gone.osr'))
  const hook = renderHook(() => useLibrary('dungeon-1', 1, LEVEL))
  const { patchSidecar } = projectStore.getState()
  await waitFor(() =>
    expect(vi.mocked(patchSidecar)).toHaveBeenCalledWith([
      {
        action: 'set_view_state',
        view_state: expect.objectContaining({ library_sources: [] }),
      },
    ]),
  )
  expect(hook.result.current.sources).toHaveLength(0)
})

test('closing a pack forgets it', async () => {
  const hook = await hookWithOpenPack()
  const project = projectStore.getState().project
  if (!project) throw new Error('no project')
  projectStore.setState({
    project: {
      ...project,
      sidecar: {
        ...project.sidecar,
        view_state: { ...project.sidecar.view_state, library_sources: ['/adventures/mill.osr'] },
      },
    },
  })
  act(() => hook.result.current.closePack('/adventures/mill.osr'))
  const { patchSidecar } = projectStore.getState()
  await waitFor(() =>
    expect(vi.mocked(patchSidecar)).toHaveBeenCalledWith([
      {
        action: 'set_view_state',
        view_state: expect.objectContaining({ library_sources: [] }),
      },
    ]),
  )
})

test('arming survives a miss and dies with its pack', async () => {
  const hook = await hookWithOpenPack()
  act(() => hook.result.current.arm({ identity: '/adventures/mill.osr', entryId: ENTRY_ID }))
  expect(hook.result.current.armed).not.toBeNull()
  // One placement per arm: placing disarms.
  act(() => hook.result.current.placeArmed('7'))
  expect(hook.result.current.armed).toBeNull()
  // Arming an entry whose pack closes invalidates at render time.
  act(() => hook.result.current.arm({ identity: '/adventures/mill.osr', entryId: ENTRY_ID }))
  act(() => hook.result.current.closePack('/adventures/mill.osr'))
  expect(hook.result.current.armed).toBeNull()
})
