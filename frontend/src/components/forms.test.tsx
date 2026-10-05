// @vitest-environment jsdom
// The adventure form's party controls (chunk: adventure-party). Every test is
// skipped until that chunk merges; the merge removes each `.skip`.
//
// The contract: a document with no party offers an "Add party" button that
// commits a level-1 party. A document with a party shows four number fields
// (Lowest level, Highest level, Fewest characters, Most characters) and a
// "Remove party" button. Each field commits the whole party on blur, an empty
// size field commits that size as null, and Remove party commits null. In a
// forge-backed project every party control routes to the blocked-op dialog
// with the server's message and commits nothing.
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, expect, test, vi } from 'vitest'

import { AdventureForm } from '@/components/forms'
import { projectStore, type CommitOptions, type OpsInput } from '@/store/project-store'
import { makeDocument, makeForgeState, makeProjectState } from '@/test/fixtures'
import type { Adventure, AnyEditOp } from '@/types'

vi.mock('@/components/prose-assistant', () => ({ ProseAssistant: () => null }))

type CommitAction = (ops: OpsInput, options?: CommitOptions) => Promise<boolean>

let commit: ReturnType<typeof vi.fn<CommitAction>>

type Party = NonNullable<Adventure['party']>

const PARTY: Party = { min_level: 1, max_level: 3, min_size: 6, max_size: 8 }
const BLOCKED = {
  op: 'set_adventure_field',
  address: 'adventure',
  message: 'the adventure party has no override kind',
}

beforeEach(() => {
  vi.clearAllMocks()
  commit = vi.fn<CommitAction>().mockResolvedValue(true)
  projectStore.setState({ project: makeProjectState(), commit, blockedOp: null })
})

function useForgeProject() {
  projectStore.setState({
    project: makeProjectState({ type: 'forge', forge: makeForgeState() }),
    commit,
    blockedOp: null,
  })
}

// The ops of the one commit the gesture made, resolving a builder against the
// document the way the store's queue does.
function committedOps(document: Adventure): AnyEditOp[] {
  expect(commit).toHaveBeenCalledTimes(1)
  const input = commit.mock.calls[0][0]
  return typeof input === 'function' ? input(document) : input
}

function partyOp(value: Party | null): AnyEditOp[] {
  return [{ op: 'set_adventure_field', field: 'party', value }]
}

test.skip('a document with no party offers to add a level-1 party', () => {
  const document = makeDocument({ party: null })
  render(<AdventureForm document={document} />)
  expect(screen.queryByLabelText('Lowest level')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Add party' }))
  expect(committedOps(document)).toEqual(
    partyOp({ min_level: 1, max_level: 1, min_size: null, max_size: null }),
  )
})

test.skip('the party fields show the document party', () => {
  render(<AdventureForm document={makeDocument({ party: PARTY })} />)
  expect(screen.getByLabelText('Lowest level')).toHaveProperty('value', '1')
  expect(screen.getByLabelText('Highest level')).toHaveProperty('value', '3')
  expect(screen.getByLabelText('Fewest characters')).toHaveProperty('value', '6')
  expect(screen.getByLabelText('Most characters')).toHaveProperty('value', '8')
  expect(screen.queryByRole('button', { name: 'Add party' })).toBeNull()
})

test.skip('editing a level commits the whole party', () => {
  const document = makeDocument({ party: PARTY })
  render(<AdventureForm document={document} />)
  const field = screen.getByLabelText('Highest level')
  fireEvent.change(field, { target: { value: '4' } })
  fireEvent.blur(field)
  expect(committedOps(document)).toEqual(partyOp({ ...PARTY, max_level: 4 }))
})

test.skip('emptying a size field commits that size as unstated', () => {
  const document = makeDocument({ party: PARTY })
  render(<AdventureForm document={document} />)
  const field = screen.getByLabelText('Most characters')
  fireEvent.change(field, { target: { value: '' } })
  fireEvent.blur(field)
  expect(committedOps(document)).toEqual(partyOp({ ...PARTY, max_size: null }))
})

test.skip('remove party clears it', () => {
  const document = makeDocument({ party: PARTY })
  render(<AdventureForm document={document} />)
  fireEvent.click(screen.getByRole('button', { name: 'Remove party' }))
  expect(committedOps(document)).toEqual(partyOp(null))
})

test.skip('in forge mode, add party routes to the blocked-op dialog', () => {
  useForgeProject()
  render(<AdventureForm document={makeDocument({ party: null })} />)
  fireEvent.click(screen.getByRole('button', { name: 'Add party' }))
  expect(projectStore.getState().blockedOp).toEqual(BLOCKED)
  expect(commit).not.toHaveBeenCalled()
})

test.skip('in forge mode, a party field routes to the blocked-op dialog on entry', () => {
  useForgeProject()
  render(<AdventureForm document={makeDocument({ party: PARTY })} />)
  fireEvent.focus(screen.getByLabelText('Lowest level'))
  expect(projectStore.getState().blockedOp).toEqual(BLOCKED)
  fireEvent.click(screen.getByRole('button', { name: 'Remove party' }))
  expect(commit).not.toHaveBeenCalled()
})
