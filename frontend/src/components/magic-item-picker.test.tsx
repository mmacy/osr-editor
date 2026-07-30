// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, expect, test, vi } from 'vitest'

import { MagicItemPicker } from '@/components/magic-item-picker'
import { api } from '@/lib/api'

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>()
  return {
    ...actual,
    api: {
      ...actual.api,
      getMagicItemCatalog: vi.fn(() =>
        Promise.resolve({
          items: [
            { id: 'sword_plus_1', name: 'Sword + 1', category: 'sword' as const, cursed: false },
            {
              id: 'sword_minus_1_cursed',
              name: 'Sword – 1',
              category: 'sword' as const,
              cursed: true,
            },
            { id: 'wand_of_fear', name: 'Wand of Fear', category: 'wand' as const, cursed: false },
          ],
        }),
      ),
    },
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
})

test('picking an item reports its id and closes the palette', async () => {
  const onPick = vi.fn()
  render(<MagicItemPicker onPick={onPick} />)
  fireEvent.click(screen.getByRole('button', { name: 'Add magic item' }))
  fireEvent.click(await screen.findByText('Wand of Fear'))
  expect(onPick).toHaveBeenCalledWith('wand_of_fear')
  expect(screen.queryByPlaceholderText('Search magic items…')).not.toBeInTheDocument()
})

test('items group by category and cursed forms are marked', async () => {
  render(<MagicItemPicker onPick={() => undefined} />)
  fireEvent.click(screen.getByRole('button', { name: 'Add magic item' }))
  await screen.findByText('Sword + 1')
  expect(screen.getByText('sword')).toBeInTheDocument()
  expect(screen.getByText('wand')).toBeInTheDocument()
  expect(screen.getAllByText('cursed')).toHaveLength(1)
})
