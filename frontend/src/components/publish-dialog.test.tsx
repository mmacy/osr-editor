// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, test, vi } from 'vitest'

import { PublishDialog, projectStem } from '@/components/publish-dialog'
import { ApiRequestError, api } from '@/lib/api'
import { projectStore } from '@/store/project-store'
import { makeProjectState } from '@/test/fixtures'
import type { Finding } from '@/types'

vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }),
}))

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>()
  return { ...actual, api: { ...actual.api, publishProject: vi.fn() } }
})

const publishProject = vi.mocked(api.publishProject)

const LINT_FINDING: Finding = {
  source: 'lint',
  code: 'secret_only_access',
  severity: 'warning',
  message: 'every path into this area passes through a secret door',
  address: 'dungeon:dungeon-1/level:1',
}

function rejection(status: number, code: string, details: Record<string, unknown> | null = null) {
  return new ApiRequestError(status, {
    code,
    message: `the ${code} message`,
    remedy: null,
    details,
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  projectStore.getState().clear()
})

function openDialog(
  diagnostics = { validation: [] as Finding[], lint: [] as Finding[], forge: [] as Finding[] },
) {
  const onNavigate = vi.fn()
  projectStore.getState().setProject(makeProjectState({ diagnostics }))
  render(<PublishDialog onNavigate={onNavigate} />)
  fireEvent.click(screen.getByRole('button', { name: 'Publish' }))
  return onNavigate
}

describe('projectStem', () => {
  test('drops the project extension, keeps plain names', () => {
    expect(projectStem('/adventures/my-module.osr')).toBe('my-module')
    expect(projectStem('/adventures/plain')).toBe('plain')
    expect(projectStem('/adventures/trailing.osr/')).toBe('trailing')
  })
})

describe('the publish dialog flow', () => {
  test('publishes with the defaulted stem name and symlink mode, toasting the path', async () => {
    publishProject.mockResolvedValueOnce({ path: '/osr-web/adventures/demo', mode: 'symlink' })
    openDialog()
    expect(screen.getByLabelText('Name', { exact: true })).toHaveValue('demo')
    fireEvent.change(screen.getByLabelText('osr-web checkout'), {
      target: { value: '/somewhere/osr-web' },
    })
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Publish' }))
    await waitFor(() =>
      expect(publishProject).toHaveBeenCalledWith('abc123', {
        mode: 'symlink',
        name: 'demo',
        overwrite: false,
        checkout_path: '/somewhere/osr-web',
      }),
    )
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  test('the lint confirm interposes, listing the warnings, and publishes on confirm', async () => {
    publishProject.mockResolvedValueOnce({ path: '/osr-web/adventures/demo', mode: 'symlink' })
    openDialog({ validation: [], lint: [LINT_FINDING], forge: [] })
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Publish' }))
    // No request yet — the confirm interposes with the warning listed.
    expect(publishProject).not.toHaveBeenCalled()
    expect(screen.getByText('secret_only_access')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Publish anyway' }))
    await waitFor(() => expect(publishProject).toHaveBeenCalledTimes(1))
  })

  test('publish_blocked renders its findings as click-to-navigate rows', async () => {
    const blocking: Finding = {
      source: 'validation',
      code: 'travel_unknown_dungeon',
      severity: 'error',
      message: "town travel names unknown dungeon 'nowhere'",
      address: 'town',
    }
    publishProject.mockRejectedValueOnce(
      rejection(409, 'publish_blocked', { findings: [blocking] }),
    )
    const onNavigate = openDialog()
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Publish' }))
    await waitFor(() => expect(screen.getByText('travel_unknown_dungeon')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: /town travel names unknown dungeon/ }))
    expect(onNavigate).toHaveBeenCalledWith({ kind: 'town' })
    // Navigating from a finding closes the dialog.
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  test('a refusal from the lint confirm comes back and shows its answer', async () => {
    // The bug the phase 6 milestone run surfaced: "Publish anyway" got a 409,
    // the outcome landed in state the lint view does not render, and the modal
    // sat there reading as a dead click.
    const blocking: Finding = {
      source: 'validation',
      code: 'entrance_missing',
      severity: 'error',
      message: "dungeon 'cave-of-the-unknown' has no entrance on any level",
      address: 'dungeon:cave-of-the-unknown',
    }
    publishProject.mockRejectedValueOnce(
      rejection(409, 'publish_blocked', { findings: [blocking] }),
    )
    openDialog({ validation: [], lint: [LINT_FINDING], forge: [] })
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Publish' }))
    fireEvent.click(screen.getByRole('button', { name: 'Publish anyway' }))
    await waitFor(() => expect(screen.getByText('entrance_missing')).toBeInTheDocument())
    // Back on the form, where the outcome is rendered — not stuck on the confirm.
    expect(screen.queryByRole('button', { name: 'Publish anyway' })).not.toBeInTheDocument()
    expect(
      screen.getByText('Validation findings block publish — fix them first:'),
    ).toBeInTheDocument()
  })

  test('a collision from the lint confirm reaches its overwrite offer too', async () => {
    publishProject
      .mockRejectedValueOnce(rejection(409, 'publish_destination_exists'))
      .mockResolvedValueOnce({ path: '/osr-web/adventures/demo', mode: 'symlink' })
    openDialog({ validation: [], lint: [LINT_FINDING], forge: [] })
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Publish' }))
    fireEvent.click(screen.getByRole('button', { name: 'Publish anyway' }))
    const overwrite = await screen.findByRole('button', { name: 'Publish with overwrite' })
    fireEvent.click(overwrite)
    await waitFor(() => expect(publishProject).toHaveBeenCalledTimes(2))
    expect(publishProject.mock.calls[1][1]).toMatchObject({ overwrite: true })
  })

  test('validation findings skip the lint confirm — the warning question cannot matter', async () => {
    const blocking: Finding = {
      source: 'validation',
      code: 'entrance_missing',
      severity: 'error',
      message: "dungeon 'caves-of-the-lizard-men' has no entrance on any level",
      address: 'dungeon:caves-of-the-lizard-men',
    }
    publishProject.mockRejectedValueOnce(
      rejection(409, 'publish_blocked', { findings: [blocking] }),
    )
    openDialog({ validation: [blocking], lint: [LINT_FINDING], forge: [] })
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Publish' }))
    // Straight to the attempt; the server stays the authority on validation.
    expect(screen.queryByRole('button', { name: 'Publish anyway' })).not.toBeInTheDocument()
    await waitFor(() => expect(screen.getByText('entrance_missing')).toBeInTheDocument())
  })

  test('publish_destination_exists offers the explicit overwrite and resubmits with it', async () => {
    publishProject
      .mockRejectedValueOnce(rejection(409, 'publish_destination_exists'))
      .mockResolvedValueOnce({ path: '/osr-web/adventures/demo', mode: 'symlink' })
    openDialog()
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Publish' }))
    const overwrite = await screen.findByRole('button', { name: 'Publish with overwrite' })
    expect(publishProject).toHaveBeenLastCalledWith(
      'abc123',
      expect.objectContaining({ overwrite: false }),
    )
    fireEvent.click(overwrite)
    await waitFor(() =>
      expect(publishProject).toHaveBeenLastCalledWith(
        'abc123',
        expect.objectContaining({ overwrite: true }),
      ),
    )
  })

  test('other rejections surface inline with the remedy', async () => {
    publishProject.mockRejectedValueOnce(
      new ApiRequestError(422, {
        code: 'osr_web_checkout_invalid',
        message: 'not a checkout',
        remedy: 'An osr-web checkout is a directory containing an adventures/ directory.',
        details: null,
      }),
    )
    openDialog()
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Publish' }))
    await waitFor(() =>
      expect(screen.getByText(/not a checkout — An osr-web checkout/)).toBeInTheDocument(),
    )
  })
})
