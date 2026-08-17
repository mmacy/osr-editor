// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { expect, test, vi } from 'vitest'

import { NarrativeBlockEditor } from '@/components/narrative-block-editor'
import { emptyNarrativeBlock, normalizeBlock } from '@/lib/narrative'
import type { NarrativeBlock } from '@/types'

const GATE_BEATS = ['refusal', 'success'] as const

function block(overrides: Partial<NarrativeBlock>): NarrativeBlock {
  return { ...emptyNarrativeBlock(), ...overrides }
}

function renderEditor(value: NarrativeBlock | null, onCommit = vi.fn()) {
  render(
    <NarrativeBlockEditor block={value} beats={GATE_BEATS} idPrefix="test" onCommit={onCommit} />,
  )
  return onCommit
}

test('the carrier declares its read beats; speaker and guidance render for every carrier', () => {
  renderEditor(null)
  expect(screen.getByLabelText('Refusal')).toBeInTheDocument()
  expect(screen.getByLabelText('Success')).toBeInTheDocument()
  expect(screen.getByLabelText('Speaker')).toBeInTheDocument()
  expect(screen.getByLabelText('Guidance')).toBeInTheDocument()
  // Beats outside the carrier's read set get no editor of their own.
  expect(screen.queryByLabelText('Fired')).not.toBeInTheDocument()
  expect(screen.queryByLabelText('Journal')).not.toBeInTheDocument()
})

test('a beat commit carries the whole block', () => {
  const onCommit = renderEditor(block({ success: 'The key turns.' }))
  const refusal = screen.getByLabelText('Refusal')
  fireEvent.change(refusal, { target: { value: 'The lock refuses.' } })
  fireEvent.blur(refusal)
  expect(onCommit).toHaveBeenCalledWith(
    block({ refusal: 'The lock refuses.', success: 'The key turns.' }),
  )
})

test('clearing the last non-empty field commits null, keeping unauthored gates canonical', () => {
  const onCommit = renderEditor(block({ refusal: 'The lock refuses.' }))
  const refusal = screen.getByLabelText('Refusal')
  fireEvent.change(refusal, { target: { value: '' } })
  fireEvent.blur(refusal)
  expect(onCommit).toHaveBeenCalledWith(null)
})

test('a non-empty beat outside the read set warns by name with a one-patch clear', () => {
  const onCommit = renderEditor(
    block({ refusal: 'The lock refuses.', fired: 'A voice a gate never speaks.' }),
  )
  const warning = screen.getByLabelText('Unread beat')
  expect(warning).toHaveTextContent('fired')
  expect(warning).toHaveTextContent('A voice a gate never speaks.')
  fireEvent.click(screen.getByRole('button', { name: 'Clear the fired text' }))
  expect(onCommit).toHaveBeenCalledWith(block({ refusal: 'The lock refuses.' }))
})

test('an authored block never warns about its own read beats', () => {
  renderEditor(block({ refusal: 'The lock refuses.', success: 'The key turns.' }))
  expect(screen.queryByLabelText('Unread beat')).not.toBeInTheDocument()
})

test('normalizeBlock is the one shaping rule: all-empty is null, anything else the whole block', () => {
  expect(normalizeBlock(emptyNarrativeBlock())).toBeNull()
  const authored = block({ speaker: 'The drowned miller' })
  expect(normalizeBlock(authored)).toEqual(authored)
})
