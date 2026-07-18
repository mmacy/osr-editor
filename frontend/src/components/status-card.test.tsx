// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'

import { StatusCard } from '@/components/status-card'

afterEach(() => {
  vi.unstubAllGlobals()
})

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

test('renders the backend-reported versions', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(() =>
      Promise.resolve(
        jsonResponse({ editor_version: '0.0.1', engine_version: '1.2.0', schema_version: 2 }),
      ),
    ),
  )
  render(<StatusCard />)
  await waitFor(() => expect(screen.getByTestId('editor-version')).toHaveTextContent('0.0.1'))
  expect(screen.getByTestId('engine-version')).toHaveTextContent('1.2.0')
  expect(screen.getByTestId('schema-version')).toHaveTextContent('2')
})

test('reports an unreachable backend', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve(new Response('unavailable', { status: 503 }))),
  )
  render(<StatusCard />)
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('503'))
})
