// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, expect, test } from 'vitest'

import { ProjectScreen } from '@/components/project-screen'
import { projectStore } from '@/store/project-store'
import { makeProjectState } from '@/test/fixtures'

function renderScreen() {
  return render(
    <MemoryRouter initialEntries={['/projects/abc123']}>
      <Routes>
        <Route path="/projects/:id" element={<ProjectScreen />} />
        <Route path="/" element={<p>home</p>} />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  projectStore.getState().clear()
})

test('the project screen renders the header, sidebar, and adventure form', () => {
  projectStore.getState().setProject(makeProjectState())
  renderScreen()
  expect(screen.getByRole('heading', { name: 'The mill on the moor' })).toBeInTheDocument()
  expect(screen.getByTestId('revision')).toHaveTextContent('r1')
  expect(screen.getByRole('button', { name: 'Undo' })).toBeDisabled()
  expect(screen.getByRole('button', { name: 'Redo' })).toBeDisabled()
  expect(screen.getByRole('button', { name: 'Town' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Level 1' })).toBeInTheDocument()
  expect(screen.getByLabelText('Name')).toHaveValue('The mill on the moor')
  expect(screen.getByTestId('diagnostics-count')).toHaveTextContent('0')
})

test('a diagnostics finding navigates by its address', () => {
  projectStore.getState().setProject(
    makeProjectState({
      diagnostics: {
        validation: [
          {
            source: 'validation',
            code: 'travel_unknown_dungeon',
            message: "town travel names unknown dungeon 'nowhere'",
            address: 'town',
          },
        ],
        lint: [],
      },
    }),
  )
  renderScreen()
  expect(screen.getByTestId('diagnostics-count')).toHaveTextContent('1')
  fireEvent.click(screen.getByRole('button', { name: /town travel names unknown dungeon/ }))
  expect(screen.getByRole('heading', { name: 'Town' })).toBeInTheDocument()
  expect(screen.getByLabelText('Name')).toHaveValue('Dusthollow')
})

test('an unnavigable address renders as plain text', () => {
  projectStore.getState().setProject(
    makeProjectState({
      diagnostics: {
        validation: [
          {
            source: 'validation',
            code: 'entrance_out_of_bounds',
            message: 'somewhere: entrance (9, 9) is out of bounds',
            address: null,
          },
        ],
        lint: [],
      },
    }),
  )
  renderScreen()
  expect(
    screen.queryByRole('button', { name: /entrance \(9, 9\) is out of bounds/ }),
  ).not.toBeInTheDocument()
  expect(screen.getByText(/entrance \(9, 9\) is out of bounds/)).toBeInTheDocument()
})

test('the fidelity dialog blocks until acknowledged', () => {
  projectStore.getState().setProject(makeProjectState({ dropped_fields: ['/town/mood'] }))
  renderScreen()
  expect(screen.getByText('This document carries fields a newer osrlib wrote')).toBeInTheDocument()
  expect(screen.getByText('/town/mood')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Edit anyway' }))
  expect(
    screen.queryByText('This document carries fields a newer osrlib wrote'),
  ).not.toBeInTheDocument()
})
