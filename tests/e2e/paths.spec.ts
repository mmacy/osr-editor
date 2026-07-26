// Path entry, end to end against the real CLI and built frontend: browsing to a
// project instead of typing its path, and naming one with a tilde.
//
// The temp workspace lives under the OS temp directory rather than home, so the
// browse walks the same absolute path the rest of the suite uses; the tilde half
// runs against the server's real home, where a scratch subdirectory is the only
// thing either half writes.
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, test } from '@playwright/test'

import { createProject } from './helpers'

test('browse to a project and open it without typing a path', async ({ page }) => {
  const workspace = mkdtempSync(join(tmpdir(), 'osr-editor-e2e-paths-'))
  await createProject(page, join(workspace, 'brambledeep.osr'), 'Brambledeep')

  await page.goto('/')
  await page.getByRole('button', { name: 'Open project' }).click()
  const dialog = page.getByRole('dialog', { name: 'Open project' })
  // Seed the field with the workspace so the picker opens there rather than in
  // whatever home the runner has; from there it is all clicking.
  await dialog.getByLabel('Project directory').fill(workspace)
  await dialog.getByRole('button', { name: 'Browse' }).click()

  const picker = page.getByRole('dialog', { name: 'Choose a project directory' })
  await expect(picker.getByTestId('picker-location')).toHaveText(workspace)
  // The listing says which directories are projects before one is opened.
  await expect(picker.getByText('native')).toBeVisible()
  await picker.getByRole('button', { name: 'brambledeep.osr' }).click()
  await expect(picker.getByLabel('Path')).toHaveValue(join(workspace, 'brambledeep.osr'))
  await picker.getByRole('button', { name: 'Choose' }).click()

  await expect(dialog.getByLabel('Project directory')).toHaveValue(
    join(workspace, 'brambledeep.osr'),
  )
  await page.getByRole('button', { name: 'Open', exact: true }).click()
  await expect(page.getByTestId('revision')).toHaveText('r1')
  await expect(page.getByLabel('Name')).toHaveValue('Brambledeep')
})

test('a picker reopens where it last chose, across a reload', async ({ page }) => {
  // The workspace holds the directory the picker will be sent back to; the whole
  // point is that nothing but the config carries it there — the field is empty on
  // the second visit, and the page has been reloaded in between.
  const workspace = mkdtempSync(join(tmpdir(), 'osr-editor-e2e-sticky-'))
  mkdirSync(join(workspace, 'brambledeep.osr'), { recursive: true })

  await page.goto('/')
  await page.getByRole('button', { name: 'Open project' }).click()
  const dialog = page.getByRole('dialog', { name: 'Open project' })
  await dialog.getByLabel('Project directory').fill(workspace)
  await dialog.getByRole('button', { name: 'Browse' }).click()
  const picker = page.getByRole('dialog', { name: 'Choose a project directory' })
  await expect(picker.getByTestId('picker-location')).toHaveText(workspace)
  const remembered = page.waitForResponse(
    (response) => response.url().endsWith('/api/fs/location') && response.ok(),
  )
  await picker.getByRole('button', { name: 'Choose' }).click()
  await remembered
  await page.keyboard.press('Escape')

  await page.reload()
  await page.getByRole('button', { name: 'Open project' }).click()
  await expect(dialog.getByLabel('Project directory')).toHaveValue('')
  await dialog.getByRole('button', { name: 'Browse' }).click()
  await expect(picker.getByTestId('picker-location')).toHaveText(workspace)
  await expect(picker.getByRole('button', { name: 'brambledeep.osr' })).toBeVisible()
})

test('a tilde path names a new project, and the picker shortens home back to one', async ({
  page,
}) => {
  // The one test that writes under the server's real home; it takes its own
  // directory there and removes it afterwards.
  const scratch = join(homedir(), '.osr-editor-e2e-tilde')
  rmSync(scratch, { recursive: true, force: true })
  mkdirSync(scratch)
  try {
    await page.goto('/')
    await page.getByRole('button', { name: 'New adventure' }).click()
    await page.getByLabel('Adventure name').fill('The tilde vaults')
    await page.getByLabel('Destination directory').fill('~/.osr-editor-e2e-tilde/vaults.osr')
    await page.getByRole('button', { name: 'Create' }).click()
    await expect(page.getByTestId('revision')).toHaveText('r1')

    // And the round trip: the picker renders that project under home as `~/…`,
    // which is a path the backend takes verbatim.
    await page.goto('/')
    await page.getByRole('button', { name: 'Open project' }).click()
    const dialog = page.getByRole('dialog', { name: 'Open project' })
    await dialog.getByLabel('Project directory').fill('~/.osr-editor-e2e-tilde')
    await dialog.getByRole('button', { name: 'Browse' }).click()
    const picker = page.getByRole('dialog', { name: 'Choose a project directory' })
    await expect(picker.getByTestId('picker-location')).toHaveText('~/.osr-editor-e2e-tilde')
    await picker.getByRole('button', { name: 'vaults.osr' }).click()
    await expect(picker.getByLabel('Path')).toHaveValue('~/.osr-editor-e2e-tilde/vaults.osr')
    await picker.getByRole('button', { name: 'Choose' }).click()
    await page.getByRole('button', { name: 'Open', exact: true }).click()
    await expect(page.getByLabel('Name')).toHaveValue('The tilde vaults')
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }
})
