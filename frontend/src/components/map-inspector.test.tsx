// @vitest-environment jsdom
// The door inspector's gate composition: a gate composes with the door's
// flags rather than replacing them, because the whole DoorSpec rides every
// set_edges value — flag commits preserve the gate, gate commits preserve
// the flags.
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, expect, test, vi } from 'vitest'

import { MapInspector } from '@/components/map-inspector'
import { projectStore, type CommitOptions, type OpsInput } from '@/store/project-store'
import { makeDocument, makeProjectState } from '@/test/fixtures'
import type { Adventure, GateSpec } from '@/types'

vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }),
}))

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver ??= ResizeObserverStub as unknown as typeof ResizeObserver

type CommitAction = (ops: OpsInput, options?: CommitOptions) => Promise<boolean>

let commit: ReturnType<typeof vi.fn<CommitAction>>

const KEY_GATE: GateSpec = {
  condition: { condition_type: 'has_item', item_id: 'brass-key', consumes: false },
  narrative: null,
}

function documentWithGatedDoor(): Adventure {
  const document = makeDocument()
  document.dungeons[0].levels[0].edges = {
    '1,1:north': {
      kind: 'door',
      door: { kind: 'secret', stuck: false, locked: false, starts_open: false, requires: KEY_GATE },
    },
  }
  return document
}

beforeEach(() => {
  vi.clearAllMocks()
  commit = vi.fn<CommitAction>().mockResolvedValue(true)
  projectStore.setState({ project: makeProjectState(), commit })
})

function renderEdge(document: Adventure) {
  render(
    <MapInspector
      document={document}
      dungeonId="dungeon-1"
      levelNumber={1}
      selection={{ kind: 'edge', key: '1,1:north' }}
      onSelectionChange={() => undefined}
    />,
  )
}

function resolveOps(input: OpsInput, document: Adventure) {
  return typeof input === 'function' ? input(document) : input
}

test('a door-flag commit preserves the gate — the whole DoorSpec rides the value', async () => {
  const document = documentWithGatedDoor()
  renderEdge(document)
  fireEvent.click(screen.getByRole('checkbox', { name: 'Locked' }))
  await waitFor(() => expect(commit).toHaveBeenCalledTimes(1))
  const ops = resolveOps(commit.mock.calls[0][0], document)
  expect(ops).toEqual([
    {
      op: 'set_edges',
      dungeon_id: 'dungeon-1',
      level_number: 1,
      edges: {
        '1,1:north': {
          kind: 'door',
          door: {
            kind: 'secret',
            stuck: false,
            locked: true,
            starts_open: false,
            requires: KEY_GATE,
          },
        },
      },
    },
  ])
})

test('a gate commit preserves the flags and the door kind', async () => {
  const document = documentWithGatedDoor()
  renderEdge(document)
  fireEvent.click(screen.getByRole('button', { name: 'Remove gate' }))
  await waitFor(() => expect(commit).toHaveBeenCalledTimes(1))
  const ops = resolveOps(commit.mock.calls[0][0], document)
  expect(ops).toEqual([
    {
      op: 'set_edges',
      dungeon_id: 'dungeon-1',
      level_number: 1,
      edges: {
        '1,1:north': {
          kind: 'door',
          door: { kind: 'secret', stuck: false, locked: false, starts_open: false, requires: null },
        },
      },
    },
  ])
})

test('the door branch says the gate composes with locked and stuck', () => {
  renderEdge(documentWithGatedDoor())
  expect(
    screen.getByText(
      'A gate composes with locked and stuck — a locked and gated door requires both.',
    ),
  ).toBeInTheDocument()
})
