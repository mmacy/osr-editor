// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, expect, test, vi } from 'vitest'

import { AuthorNotesCard } from '@/components/author-notes-card'
import { projectStore } from '@/store/project-store'
import { makeProjectState } from '@/test/fixtures'

vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }),
}))

const ADDRESS = 'dungeon:dungeon-1/level:1/area:2'

beforeEach(() => {
  projectStore.setState({ project: makeProjectState() })
})

function withNote(text: string) {
  const project = makeProjectState()
  projectStore.setState({
    project: { ...project, sidecar: { ...project.sidecar, notes: { [ADDRESS]: text } } },
  })
}

test('renders the committed note and commits an edit on blur', () => {
  withNote('Check the sacks against p. 1')
  const patchSidecar = vi.fn().mockResolvedValue(undefined)
  projectStore.setState({ patchSidecar })
  render(<AuthorNotesCard address={ADDRESS} />)
  const field = screen.getByTestId('author-notes')
  expect(field).toHaveValue('Check the sacks against p. 1')
  fireEvent.change(field, { target: { value: 'Rewritten note' } })
  fireEvent.blur(field)
  expect(patchSidecar).toHaveBeenCalledWith([
    { action: 'set_note', address: ADDRESS, text: 'Rewritten note' },
  ])
})

test('clearing the field removes the note', () => {
  withNote('Old note')
  const patchSidecar = vi.fn().mockResolvedValue(undefined)
  projectStore.setState({ patchSidecar })
  render(<AuthorNotesCard address={ADDRESS} />)
  const field = screen.getByTestId('author-notes')
  fireEvent.change(field, { target: { value: '  ' } })
  fireEvent.blur(field)
  expect(patchSidecar).toHaveBeenCalledWith([{ action: 'remove_note', address: ADDRESS }])
})

test('an unchanged field never posts a no-op patch', () => {
  withNote('Stable')
  const patchSidecar = vi.fn().mockResolvedValue(undefined)
  projectStore.setState({ patchSidecar })
  render(<AuthorNotesCard address={ADDRESS} />)
  fireEvent.blur(screen.getByTestId('author-notes'))
  expect(patchSidecar).not.toHaveBeenCalled()
})
