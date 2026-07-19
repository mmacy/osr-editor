// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { expect, test } from 'vitest'

import { MapEditor } from '@/components/map-editor'
import { makeDocument } from '@/test/fixtures'
import type { Diagnostics } from '@/types'

const CLEAN: Diagnostics = { validation: [], lint: [] }

function renderEditor(overrides: Partial<Parameters<typeof MapEditor>[0]> = {}) {
  return render(
    <MapEditor
      document={makeDocument()}
      diagnostics={CLEAN}
      dungeonId="dungeon-1"
      levelNumber={1}
      focusToken={0}
      onNavigate={() => {}}
      {...overrides}
    />,
  )
}

test('the surface renders the chrome: switcher, tabs, toolbar, canvas, inspector', () => {
  renderEditor()
  expect(screen.getByLabelText('Dungeon')).toHaveValue('dungeon-1')
  expect(screen.getByRole('button', { name: 'Level 1' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Add level' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Import geometry' })).toBeInTheDocument()
  for (const label of [
    'Select tool',
    'Room tool',
    'Corridor tool',
    'Wall and door tool',
    'Area tool',
    'Entrance tool',
    'Transition tool',
    'Zoom in',
    'Zoom out',
    'Reset zoom',
  ]) {
    expect(screen.getByRole('button', { name: label })).toBeInTheDocument()
  }
  expect(screen.getByTestId('map-canvas')).toBeInTheDocument()
  expect(screen.getByText('Select something on the map to inspect it.')).toBeInTheDocument()
})

test('tool buttons toggle the active tool', () => {
  renderEditor()
  const room = screen.getByRole('button', { name: 'Room tool' })
  expect(room).toHaveAttribute('aria-pressed', 'false')
  fireEvent.click(room)
  expect(room).toHaveAttribute('aria-pressed', 'true')
  expect(screen.getByRole('button', { name: 'Select tool' })).toHaveAttribute(
    'aria-pressed',
    'false',
  )
})

test('a properties focus opens the level properties dialog', () => {
  renderEditor({ focus: { type: 'properties' }, focusToken: 1 })
  expect(screen.getByRole('heading', { name: 'Level properties' })).toBeInTheDocument()
  expect(screen.getByLabelText('Chance-in-six')).toHaveValue(1)
})

test('removing the last dungeon is disabled with the reason shown', () => {
  renderEditor()
  const button = screen.getByRole('button', { name: 'Remove dungeon' })
  expect(button).toBeDisabled()
  expect(button).toHaveAttribute('title', 'An adventure needs at least one dungeon.')
})

test('removing the last level is disabled with the reason shown', () => {
  renderEditor({ focus: { type: 'properties' }, focusToken: 1 })
  expect(screen.getByRole('button', { name: 'Remove level' })).toBeDisabled()
  expect(screen.getByText('A dungeon needs at least one level.')).toBeInTheDocument()
})

test('a vanished level renders the honest message', () => {
  renderEditor({ levelNumber: 9 })
  expect(screen.getByText('This level no longer exists.')).toBeInTheDocument()
})
