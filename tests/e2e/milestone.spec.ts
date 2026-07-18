// The phase 1 milestone loop, end to end against the real CLI and built
// frontend: create a native project, edit its metadata and town, watch
// content validation react live, undo/redo, export a stamped document that
// clears osr-web's listing gate.
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, test } from '@playwright/test'

interface StampedDocument {
  kind: string
  payload: { name: string }
}

test('create, edit, watch validation react, undo, redo, export', async ({ page }) => {
  const workspace = mkdtempSync(join(tmpdir(), 'osr-editor-e2e-'))
  const projectDir = join(workspace, 'mill.osr')
  const exportPath = join(workspace, 'exports', 'mill-adventure.json')

  await page.goto('/')

  // Create a native project.
  await page.getByRole('button', { name: 'New adventure' }).click()
  await page.getByLabel('Adventure name').fill('The mill on the moor')
  await page.getByLabel('Destination directory').fill(projectDir)
  await page.getByRole('button', { name: 'Create' }).click()
  await expect(page.getByTestId('revision')).toHaveText('r1')
  await expect(page.getByTestId('diagnostics-count')).toHaveText('0')

  // Rename the adventure; each committed field is one revision.
  await page.getByLabel('Name').fill('The mill under the moor')
  await page.getByLabel('Name').press('Enter')
  await expect(page.getByTestId('revision')).toHaveText('r2')
  await expect(page.getByRole('heading', { name: 'The mill under the moor' })).toBeVisible()

  // Add a hook.
  await page.getByLabel('Add hooks entry').fill('The miller vanished a fortnight ago.')
  await page.getByLabel('Add hooks entry').press('Enter')
  await expect(page.getByTestId('revision')).toHaveText('r3')

  // Edit the town.
  await page.getByRole('button', { name: 'Town' }).click()
  await page.getByLabel('Name').fill('Dusthollow')
  await page.getByLabel('Name').press('Enter')
  await expect(page.getByTestId('revision')).toHaveText('r4')

  // A travel row naming an unknown dungeon — validation reacts live.
  await page.getByLabel('Add travel dungeon id').fill('mill-caves')
  await page.getByLabel('Add travel turns').fill('2')
  await page.getByLabel('Add travel entry').click()
  await expect(page.getByTestId('diagnostics-count')).toHaveText('1')
  await expect(page.getByText(/town travel names unknown dungeon 'mill-caves'/)).toBeVisible()

  // Fix the id — the finding clears.
  await page.getByLabel('Travel dungeon id', { exact: true }).fill('dungeon-1')
  await page.getByLabel('Travel dungeon id', { exact: true }).press('Enter')
  await expect(page.getByTestId('diagnostics-count')).toHaveText('0')

  // Undo brings the finding back; redo clears it again.
  await page.getByRole('button', { name: 'Undo' }).click()
  await expect(page.getByTestId('diagnostics-count')).toHaveText('1')
  await page.getByRole('button', { name: 'Redo' }).click()
  await expect(page.getByTestId('diagnostics-count')).toHaveText('0')

  // Export, then assert the file clears osr-web's listing gate: valid JSON
  // with top-level kind == "adventure".
  await page.getByRole('button', { name: 'Export' }).click()
  await page.getByLabel('Destination file').fill(exportPath)
  await page.getByRole('dialog').getByRole('button', { name: 'Export' }).click()
  await expect(page.getByText(`Exported to ${exportPath}`)).toBeVisible()

  const document = JSON.parse(readFileSync(exportPath, 'utf-8')) as StampedDocument
  expect(document.kind).toBe('adventure')
  expect(document.payload.name).toBe('The mill under the moor')
})
