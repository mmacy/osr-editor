// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'

import { parseKnobEntry, PipelinePanel } from '@/components/pipeline-panel'
import { makeForgeState, makeProjectState } from '@/test/fixtures'

vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }),
}))

describe('parseKnobEntry', () => {
  test('splits knob=value, numbers as numbers, strings as strings', () => {
    expect(parseKnobEntry('unresolved_fallback=omit')).toEqual({ unresolved_fallback: 'omit' })
    expect(parseKnobEntry('render_dpi=300')).toEqual({ render_dpi: 300 })
  })

  test('malformed input answers null', () => {
    expect(parseKnobEntry('')).toBeNull()
    expect(parseKnobEntry('no-equals')).toBeNull()
    expect(parseKnobEntry('=value')).toBeNull()
    expect(parseKnobEntry('knob=')).toBeNull()
  })
})

describe('PipelinePanel', () => {
  test('renders per-stage status, usage, and provider identity from run.json', () => {
    render(<PipelinePanel project={makeProjectState({ type: 'forge', forge: makeForgeState() })} />)
    expect(screen.getByText('survey')).toBeInTheDocument()
    expect(screen.getByText('1,200 in / 300 out')).toBeInTheDocument()
    expect(screen.getByText('FixtureProvider')).toBeInTheDocument()
    expect(screen.getByText('fixture-model-1')).toBeInTheDocument()
  })

  test('the check control shows the stale hint until a check runs', () => {
    const { rerender } = render(
      <PipelinePanel
        project={makeProjectState({
          type: 'forge',
          forge: makeForgeState({ checked: false }),
        })}
      />,
    )
    expect(screen.getByTestId('check-state')).toHaveTextContent('not run since the last change')
    rerender(
      <PipelinePanel
        project={makeProjectState({ type: 'forge', forge: makeForgeState({ checked: true }) })}
      />,
    )
    expect(screen.getByTestId('check-state')).toHaveTextContent('findings current')
  })

  test('renders nothing for a native project', () => {
    const { container } = render(<PipelinePanel project={makeProjectState()} />)
    expect(container).toBeEmptyDOMElement()
  })
})
