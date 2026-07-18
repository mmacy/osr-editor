import { beforeEach, expect, test, vi } from 'vitest'

import { ApiRequestError, type ApiClient } from '@/lib/api'
import { createProjectStore } from '@/store/project-store'
import { makeProjectState } from '@/test/fixtures'
import type { AnyEditOp, OpBatchResult } from '@/types'

vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }),
}))

const RENAME: AnyEditOp = { op: 'set_adventure_field', field: 'name', value: 'Renamed' }

function result(revision: string, overrides: Partial<OpBatchResult> = {}): OpBatchResult {
  return {
    revision,
    diagnostics: { validation: [], lint: [] },
    delta: [{ path: '/name', value: `name at ${revision}` }],
    can_undo: true,
    can_redo: false,
    ...overrides,
  }
}

function makeClient(overrides: Partial<ApiClient>): ApiClient {
  const unexpected = () => Promise.reject(new Error('unexpected call'))
  return {
    status: unexpected,
    listProjects: unexpected,
    createProject: unexpected,
    openProject: unexpected,
    getProject: unexpected,
    postOps: unexpected,
    undo: unexpected,
    redo: unexpected,
    exportProject: unexpected,
    ...overrides,
  } as ApiClient
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

beforeEach(() => {
  vi.clearAllMocks()
})

test('commits post strictly sequentially, each carrying the previous revision', async () => {
  const pending: { revision: string; resolve: (value: OpBatchResult) => void }[] = []
  const client = makeClient({
    postOps: (_id, revision) =>
      new Promise<OpBatchResult>((resolve) => pending.push({ revision, resolve })),
  })
  const store = createProjectStore(client)
  store.getState().setProject(makeProjectState())

  const first = store.getState().commit([RENAME])
  const second = store.getState().commit([RENAME])
  await flush()
  // The second batch waits — it must not post against a revision in flight.
  expect(pending).toHaveLength(1)
  expect(pending[0].revision).toBe('r1')

  pending[0].resolve(result('r2'))
  await first
  await flush()
  expect(pending).toHaveLength(2)
  expect(pending[1].revision).toBe('r2')

  pending[1].resolve(result('r3'))
  await second
  expect(store.getState().project?.revision).toBe('r3')
})

test('a queued ops builder sees the document the previous commit produced', async () => {
  // Whole-value payloads (a hooks tuple) must be built at dequeue time: a
  // payload built at gesture time would silently revert the in-flight commit,
  // and the fresh revision would make the server accept it.
  const bodies: AnyEditOp[][] = []
  const pending: ((value: OpBatchResult) => void)[] = []
  const client = makeClient({
    postOps: (_id, _revision, ops) => {
      bodies.push(ops)
      return new Promise<OpBatchResult>((resolve) => pending.push(resolve))
    },
  })
  const store = createProjectStore(client)
  store.getState().setProject(makeProjectState())
  const baseHooks = makeProjectState().document.hooks

  const first = store
    .getState()
    .commit((document) => [
      { op: 'set_adventure_field', field: 'hooks', value: [...document.hooks, 'first'] },
    ])
  const second = store
    .getState()
    .commit((document) => [
      { op: 'set_adventure_field', field: 'hooks', value: [...document.hooks, 'second'] },
    ])
  await flush()
  expect(bodies).toHaveLength(1)
  expect(bodies[0][0]).toMatchObject({ value: [...baseHooks, 'first'] })

  pending[0](result('r2', { delta: [{ path: '/hooks', value: [...baseHooks, 'first'] }] }))
  await first
  await flush()
  expect(bodies).toHaveLength(2)
  expect(bodies[1][0]).toMatchObject({ value: [...baseHooks, 'first', 'second'] })
  pending[1](result('r3'))
  await second
})

test('a builder returning no ops skips the batch', async () => {
  const client = makeClient({
    postOps: () => Promise.reject(new Error('must not post')),
  })
  const store = createProjectStore(client)
  store.getState().setProject(makeProjectState())
  expect(await store.getState().commit(() => [])).toBe(false)
  expect(store.getState().project?.revision).toBe('r1')
})

test('a committed result applies the delta and the stack flags', async () => {
  const client = makeClient({
    postOps: () => Promise.resolve(result('r2', { delta: [{ path: '/name', value: 'Renamed' }] })),
  })
  const store = createProjectStore(client)
  store.getState().setProject(makeProjectState())

  expect(await store.getState().commit([RENAME])).toBe(true)
  const project = store.getState().project
  expect(project?.document.name).toBe('Renamed')
  expect(project?.revision).toBe('r2')
  expect(project?.can_undo).toBe(true)
})

test('a stale revision refetches wholesale and reports the loss quietly', async () => {
  const fresh = makeProjectState({ revision: 'r7' })
  const client = makeClient({
    postOps: () =>
      Promise.reject(
        new ApiRequestError(409, {
          code: 'stale_revision',
          message: 'stale',
          remedy: null,
          details: { current_revision: 'r7' },
        }),
      ),
    getProject: () => Promise.resolve(fresh),
  })
  const store = createProjectStore(client)
  store.getState().setProject(makeProjectState())

  expect(await store.getState().commit([RENAME])).toBe(false)
  await flush()
  expect(store.getState().project?.revision).toBe('r7')
  const { toast } = await import('sonner')
  expect(vi.mocked(toast)).toHaveBeenCalledWith('Updated from another tab')
})

test('an unknown project id marks the store gone', async () => {
  const client = makeClient({
    postOps: () =>
      Promise.reject(
        new ApiRequestError(404, {
          code: 'unknown_project',
          message: 'no open project',
          remedy: 'Reopen it.',
          details: null,
        }),
      ),
  })
  const store = createProjectStore(client)
  store.getState().setProject(makeProjectState())

  await store.getState().commit([RENAME])
  expect(store.getState().gone).toBe(true)
})

test('other envelope errors surface as toasts and the queue continues', async () => {
  const responses = [
    Promise.reject(
      new ApiRequestError(422, {
        code: 'op_target_not_found',
        message: 'no dungeon',
        remedy: null,
        details: null,
      }),
    ),
    Promise.resolve(result('r2')),
  ]
  const client = makeClient({ postOps: () => responses.shift()! })
  const store = createProjectStore(client)
  store.getState().setProject(makeProjectState())

  expect(await store.getState().commit([RENAME])).toBe(false)
  expect(await store.getState().commit([RENAME])).toBe(true)
  const { toast } = await import('sonner')
  expect(vi.mocked(toast.error)).toHaveBeenCalledWith('no dungeon', { description: undefined })
})

test('undo applies its result through the same path', async () => {
  const client = makeClient({
    undo: () =>
      Promise.resolve(
        result('r3', {
          delta: [{ path: '', value: makeProjectState().document }],
          can_undo: false,
          can_redo: true,
        }),
      ),
  })
  const store = createProjectStore(client)
  store.getState().setProject(makeProjectState({ revision: 'r2', can_undo: true }))

  await store.getState().undo()
  const project = store.getState().project
  expect(project?.revision).toBe('r3')
  expect(project?.can_redo).toBe(true)
})
