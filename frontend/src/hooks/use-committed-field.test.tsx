// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { expect, test, vi } from 'vitest'

import { integerInRange, useCommittedField } from '@/hooks/use-committed-field'

function Harness({
  onCommit,
  normalize,
}: {
  onCommit: (value: string) => void
  normalize?: (draft: string) => string | null
}) {
  const field = useCommittedField('initial', onCommit, normalize)
  return <input aria-label="field" {...field} />
}

test('blur commits a changed value', () => {
  const onCommit = vi.fn()
  render(<Harness onCommit={onCommit} />)
  const input = screen.getByLabelText('field')
  fireEvent.change(input, { target: { value: 'edited' } })
  fireEvent.blur(input)
  expect(onCommit).toHaveBeenCalledExactlyOnceWith('edited')
})

test('Enter commits via blur', () => {
  const onCommit = vi.fn()
  render(<Harness onCommit={onCommit} />)
  const input = screen.getByLabelText('field')
  input.focus()
  fireEvent.change(input, { target: { value: 'edited' } })
  fireEvent.keyDown(input, { key: 'Enter' })
  expect(onCommit).toHaveBeenCalledExactlyOnceWith('edited')
})

test('a focus-and-leave never posts a no-op commit', () => {
  const onCommit = vi.fn()
  render(<Harness onCommit={onCommit} />)
  const input = screen.getByLabelText('field')
  input.focus()
  fireEvent.blur(input)
  expect(onCommit).not.toHaveBeenCalled()
})

test('an unchanged retype does not commit', () => {
  const onCommit = vi.fn()
  render(<Harness onCommit={onCommit} />)
  const input = screen.getByLabelText('field')
  fireEvent.change(input, { target: { value: 'edited' } })
  fireEvent.change(input, { target: { value: 'initial' } })
  fireEvent.blur(input)
  expect(onCommit).not.toHaveBeenCalled()
})

test('a rejected draft reverts to the committed value', () => {
  const onCommit = vi.fn()
  render(<Harness onCommit={onCommit} normalize={() => null} />)
  const input = screen.getByLabelText('field')
  fireEvent.change(input, { target: { value: 'nonsense' } })
  fireEvent.blur(input)
  expect(onCommit).not.toHaveBeenCalled()
  expect((input as HTMLInputElement).value).toBe('initial')
})

test('integerInRange vets bounds', () => {
  const vet = integerInRange(0, 6)
  expect(vet('3')).toBe('3')
  expect(vet('0')).toBe('0')
  expect(vet('7')).toBeNull()
  expect(vet('-1')).toBeNull()
  expect(vet('2.5')).toBeNull()
  expect(vet('abc')).toBeNull()
})
