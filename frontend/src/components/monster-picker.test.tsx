// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, expect, test, vi } from 'vitest'

import { MonsterPicker } from '@/components/monster-picker'
import { api } from '@/lib/api'
import { BUNDLED_TEMPLATE_BLOCKED_MESSAGE } from '@/lib/monster-builders'
import { projectStore } from '@/store/project-store'
import { makeForgeState, makeProjectState } from '@/test/fixtures'

vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }),
}))

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>()
  return {
    ...actual,
    api: { ...actual.api, getMonsterCatalog: vi.fn(() => new Promise(() => undefined)) },
  }
})

void api

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver ??= ResizeObserverStub as unknown as typeof ResizeObserver

beforeEach(() => {
  vi.clearAllMocks()
  projectStore.getState().clear()
  projectStore.getState().clearBlockedOp()
  projectStore.getState().clearNavigationIntent()
})

test('the create shortcut navigates into the Monsters section create flow', () => {
  projectStore.getState().setProject(makeProjectState())
  render(<MonsterPicker bundled={[]} onPick={() => undefined} />)
  fireEvent.click(screen.getByRole('button', { name: 'Add monster' }))
  fireEvent.click(screen.getByRole('button', { name: 'Create monster…' }))
  expect(projectStore.getState().navigationIntent).toEqual({ kind: 'monsters', create: true })
  expect(projectStore.getState().blockedOp).toBeNull()
})

test('in a forge project the shortcut routes to the blocked-op dialog instead', () => {
  projectStore.getState().setProject(makeProjectState({ type: 'forge', forge: makeForgeState() }))
  render(<MonsterPicker bundled={[]} onPick={() => undefined} />)
  fireEvent.click(screen.getByRole('button', { name: 'Add monster' }))
  fireEvent.click(screen.getByRole('button', { name: 'Create monster…' }))
  expect(projectStore.getState().blockedOp).toEqual({
    op: 'add_monster_template',
    address: 'monsters',
    message: BUNDLED_TEMPLATE_BLOCKED_MESSAGE,
  })
  expect(projectStore.getState().navigationIntent).toBeNull()
})
