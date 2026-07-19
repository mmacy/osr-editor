// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, expect, test, vi } from 'vitest'

import { CorrectionsPanel, ReviewQueue } from '@/components/forge-panels'
import { projectStore } from '@/store/project-store'
import { makeProjectState } from '@/test/fixtures'
import type { ForgeState, ProjectState } from '@/types'

vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }) }))

function forgeState(overrides: Partial<ForgeState> = {}): ForgeState {
  return {
    report: {
      schema_version: 1,
      osrforge_version: '0.1.0',
      module: { title: 'M', pages: 2 },
      validation: { passed: true, errors: [] },
      monsters: { resolved: 1, unresolved: ['drowned one'], custom: [] },
      usage: { input_tokens: 0, output_tokens: 0 },
      areas: [
        {
          id: 'sunken-vault/1/3',
          source_pages: [2],
          confidence: 0.34,
          flags: ['low_confidence:count'],
          overridden: [],
        },
      ],
      flags: [],
      findings: [],
    },
    run: {
      schema_version: 1,
      osrforge_version: '0.1.0',
      source_sha256: '',
      source_bytes: 0,
      page_count: 2,
      settings: {} as ForgeState['run']['settings'],
      provider: null,
      model_id: null,
      stages: {},
    },
    overrides: {
      monsters: {},
      monster_templates: {},
      areas: {},
      geometry: {},
      town: null,
      module: null,
    },
    ...overrides,
  }
}

function forgeProject(over: Partial<ProjectState> = {}): ProjectState {
  return makeProjectState({ type: 'forge', forge: forgeState(), ...over })
}

beforeEach(() => {
  vi.restoreAllMocks()
  projectStore.getState().clear()
})

test('the review queue renders flag rows and dismisses per flag', () => {
  const patch = vi.spyOn(projectStore.getState(), 'patchSidecar').mockResolvedValue(undefined)
  const project = forgeProject()
  projectStore.getState().setProject(project)
  render(<ReviewQueue project={project} onNavigate={vi.fn()} />)
  // One undismissed flag on one area row.
  expect(screen.getByTestId('review-count')).toHaveTextContent('1')
  expect(screen.getByText('Low confidence')).toBeInTheDocument()
  fireEvent.click(screen.getByLabelText('Dismiss low_confidence:count'))
  expect(patch).toHaveBeenCalledWith([
    {
      patch: 'dismiss_flag',
      address: 'dungeon:sunken-vault/level:1/area:3',
      flag: 'low_confidence:count',
    },
  ])
})

test('the corrections panel edits a reason through a forge edit', () => {
  const edit = vi.spyOn(projectStore.getState(), 'forgeEdit').mockResolvedValue(true)
  const project = forgeProject({
    forge: forgeState({
      overrides: {
        monsters: { 'drowned one': { template_id: 'hobgoblin', reason: 'remapped to hobgoblin' } },
        monster_templates: {},
        areas: {},
        geometry: {},
        town: null,
        module: null,
      },
    }),
  })
  projectStore.getState().setProject(project)
  render(<CorrectionsPanel project={project} onNavigate={vi.fn()} />)
  expect(screen.getByText('→ hobgoblin')).toBeInTheDocument()
  const field = screen.getByLabelText('Reason')
  fireEvent.change(field, { target: { value: 'A deliberate pick.' } })
  fireEvent.blur(field)
  expect(edit).toHaveBeenCalledWith([
    { edit: 'set_reason', kind: 'monsters', key: 'drowned one', reason: 'A deliberate pick.' },
  ])
})
