// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { expect, test, vi } from 'vitest'

import { HomeScreen } from '@/components/home-screen'

vi.mock('@/lib/api', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/api')>()
  return {
    ...original,
    api: {
      ...original.api,
      listProjects: vi.fn().mockResolvedValue({
        recents: [
          {
            path: '/projects/live.osr',
            name: 'The mill on the moor',
            type: 'native',
            last_opened_at: '2026-07-18T00:00:00+00:00',
            missing: false,
          },
          {
            path: '/projects/vanished.osr',
            name: 'Gone away',
            type: 'native',
            last_opened_at: '2026-07-17T00:00:00+00:00',
            missing: true,
          },
        ],
        open_at_launch: null,
      }),
    },
  }
})

test('the home screen lists probed recents', async () => {
  render(
    <MemoryRouter>
      <HomeScreen />
    </MemoryRouter>,
  )
  expect(await screen.findByText('The mill on the moor')).toBeInTheDocument()
  expect(screen.getByText('Gone away')).toBeInTheDocument()
  expect(screen.getByText('The directory has moved or been deleted.')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: /new adventure/i })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: /open project/i })).toBeInTheDocument()
})
