// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { expect, test } from 'vitest'

import { MapEditor } from '@/components/map-editor'
import { makeDocument } from '@/test/fixtures'
import type { AreaSpec, Diagnostics } from '@/types'

const CLEAN: Diagnostics = { validation: [], lint: [], forge: [] }

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

function makeArea(overrides: Partial<AreaSpec> = {}): AreaSpec {
  return {
    id: 'a1',
    name: '',
    description: '',
    cells: [[0, 0]],
    encounter: null,
    features: [],
    trap: null,
    treasure: null,
    ...overrides,
  }
}

// A document whose level 1 carries the given areas.
function documentWithAreas(areas: AreaSpec[]) {
  const document = makeDocument()
  document.dungeons[0].levels[0].areas = areas
  return document
}

test('the surface renders the chrome: switcher, tabs, toolbar, canvas, inspector', () => {
  renderEditor()
  expect(screen.getByLabelText('Dungeon')).toHaveValue('dungeon-1')
  expect(screen.getByRole('button', { name: 'Level 1' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Add level' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Import geometry' })).toBeInTheDocument()
  for (const label of [
    'Select tool',
    'Pan tool',
    'Room tool',
    'Corridor tool',
    'Wall and door tool',
    'Area tool',
    'Entrance tool',
    'Transition tool',
    'Zoom in',
    'Zoom out',
    'Reset zoom',
    'Fit level',
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

test('the tool shortcuts select their tool, and the pan tool answers to H', () => {
  renderEditor()
  for (const [key, label] of [
    ['h', 'Pan tool'],
    ['r', 'Room tool'],
    ['v', 'Select tool'],
  ]) {
    // Dispatched on the body, as a real keypress is: the handler asks the
    // target what it is `closest` to, and `window` is not an element.
    fireEvent.keyDown(document.body, { key })
    expect(screen.getByRole('button', { name: label })).toHaveAttribute('aria-pressed', 'true')
  }
})

test('a properties focus opens the level properties dialog', () => {
  renderEditor({ focus: { type: 'properties' }, focusToken: 1 })
  expect(screen.getByRole('heading', { name: 'Level properties' })).toBeInTheDocument()
  expect(screen.getByLabelText('Chance-in-six')).toHaveValue(1)
})

// Every dimmed control's reason sits on a wrapper, never the button: `disabled`
// plus the variants' `disabled:pointer-events-none` makes the button neither a
// hover target nor focusable, so a title on it is unreachable at exactly the
// moment it has something to say. `getByTitle` fails if it ever moves back.
test('a disabled control carries its reason where a pointer can reach it', () => {
  renderEditor()
  for (const [label, reason] of [
    ['Remove level', 'A dungeon needs at least one level.'],
    ['Clear content…', 'This level has no keyed areas and no content — there is nothing to clear.'],
    ['Remove dungeon', 'An adventure needs at least one dungeon.'],
  ]) {
    const button = screen.getByRole('button', { name: label })
    expect(button).toBeDisabled()
    expect(button).not.toHaveAttribute('title')
    expect(screen.getByTitle(reason)).toContainElement(button)
  }
})

test('an enabled control carries no reason at all', () => {
  renderEditor({ document: documentWithAreas([makeArea({ name: 'Guard post' })]) })
  expect(screen.getByRole('button', { name: 'Clear content…' })).toBeEnabled()
  expect(
    screen.queryByTitle(
      'This level has no keyed areas and no content — there is nothing to clear.',
    ),
  ).toBeNull()
})

// Blank rooms carry no content, but they are still keyed areas the dialog can
// offer to remove — so the control has something to do and must not be dimmed.
test('a level of blank rooms can still be cleared', () => {
  renderEditor({ document: documentWithAreas([makeArea({ id: 'a1' }), makeArea({ id: 'a2' })]) })
  expect(screen.getByRole('button', { name: 'Clear content…' })).toBeEnabled()
})

test('the clear-content dialog counts what it will remove and keeps geometry', () => {
  const document = documentWithAreas([
    makeArea({ id: 'a1', name: 'Guard post', description: 'Two goblins bicker over dice.' }),
    makeArea({ id: 'a2', description: 'A dry well.', cells: [[2, 0]] }),
  ])
  renderEditor({ document })
  fireEvent.click(screen.getByRole('button', { name: 'Clear content…' }))
  expect(screen.getByRole('heading', { name: 'Clear content' })).toBeInTheDocument()
  const listed = screen.getByLabelText('Content to clear')
  expect(listed).toHaveTextContent('1 area name')
  expect(listed).toHaveTextContent('2 area descriptions')
  expect(listed).not.toHaveTextContent('encounter')
})

test('a vanished level renders the honest message', () => {
  renderEditor({ levelNumber: 9 })
  expect(screen.getByText('This level no longer exists.')).toBeInTheDocument()
})
