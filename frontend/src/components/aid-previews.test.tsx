// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, expect, test, vi } from 'vitest'

import { TreasurePreviewPanel } from '@/components/aid-previews'
import { api } from '@/lib/api'
import { projectStore } from '@/store/project-store'
import { makeProjectState } from '@/test/fixtures'
import type { AreaTreasureSpec, Coins, MagicItemView, TreasureSample } from '@/types'

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>()
  return { ...actual, api: { ...actual.api, postAidsPreview: vi.fn() } }
})

const postAidsPreview = vi.mocked(api.postAidsPreview)

const NO_COINS: Coins = { pp: 0, gp: 0, ep: 0, sp: 0, cp: 0 }

// Real catalog ids and names (osrlib's magic_items.json) — the API resolves the
// name from that catalog, so a fixture inventing one would not reflect what the
// panel ever renders. Catalog names are Title Case; the house sentence-case rule
// governs the editor's own strings, not data osrlib owns.
function magicItem(overrides: Partial<MagicItemView>): MagicItemView {
  return {
    template_id: 'potion_of_healing',
    name: 'Potion of Healing',
    quantity: 1,
    charges_remaining: null,
    ...overrides,
  }
}

function sample(overrides: Partial<TreasureSample> = {}): TreasureSample {
  return { coins: NO_COINS, valuables: [], magic_items: [], total_gp: 0, ...overrides }
}

const TREASURE: AreaTreasureSpec = { letters: ['C'], unguarded: false }

function renderPanel(samples: TreasureSample[]) {
  postAidsPreview.mockResolvedValue({ kind: 'treasure', samples })
  projectStore.getState().setProject(makeProjectState())
  render(<TreasurePreviewPanel treasure={TREASURE} levelNumber={1} />)
  fireEvent.click(screen.getByRole('button', { name: 'Preview sample hoards' }))
}

beforeEach(() => {
  vi.clearAllMocks()
  projectStore.getState().clear()
})

test('a sampled magic item is named under the line, with its charges', async () => {
  renderPanel([
    sample({
      coins: { ...NO_COINS, gp: 400 },
      magic_items: [
        magicItem({
          template_id: 'wand_of_fire_balls',
          name: 'Wand of Fire Balls',
          charges_remaining: 7,
        }),
      ],
      total_gp: 400,
    }),
  ])
  const panel = screen.getByTestId('treasure-preview')
  await waitFor(() => expect(panel).toHaveTextContent('Wand of Fire Balls (7 charges)'))
  // The summary line stays the summary — the names are the detail beneath it,
  // nested inside the line's own list item rather than sitting beside it.
  expect(panel).toHaveTextContent('400 gp · 0 valuable(s) · 1 magic · 400 gp')
  const line = panel.querySelectorAll('li')[0]
  expect(line.querySelector('ul')).not.toBeNull()
})

test('a quantity above one takes the multiplication form; a quantity of one is silent', async () => {
  renderPanel([
    sample({
      magic_items: [
        magicItem({ quantity: 3 }),
        magicItem({ template_id: 'ring_of_protection', name: 'Ring of Protection', quantity: 1 }),
      ],
    }),
  ])
  const panel = screen.getByTestId('treasure-preview')
  await waitFor(() => expect(panel).toHaveTextContent('3 × Potion of Healing'))
  expect(panel).toHaveTextContent('Ring of Protection')
  expect(panel).not.toHaveTextContent('1 × Ring of Protection')
})

test('a hoard with no magic items renders nothing extra', async () => {
  renderPanel([sample({ coins: { ...NO_COINS, sp: 200 }, total_gp: 20 })])
  const panel = screen.getByTestId('treasure-preview')
  await waitFor(() => expect(panel).toHaveTextContent('200 sp'))
  // One line, and no detail list under it at all — not an empty list, not a
  // "none" line. The outer samples list is the only list on the panel.
  expect(panel.querySelectorAll('li')).toHaveLength(1)
  expect(panel.querySelectorAll('ul')).toHaveLength(1)
})

test('a single charge reads singular', async () => {
  renderPanel([
    sample({
      magic_items: [
        magicItem({ template_id: 'wand_of_fear', name: 'Wand of Fear', charges_remaining: 1 }),
      ],
    }),
  ])
  await waitFor(() =>
    expect(screen.getByTestId('treasure-preview')).toHaveTextContent('Wand of Fear (1 charge)'),
  )
})
