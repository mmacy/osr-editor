// The content-library shots: the panel with an open source and used badges,
// the collision dialog, and the clear-content dialog carrying the stash offer.
// One scripted pass: an OPD level as the canvas, the forge fixture workdir as
// the palette (copied under the capture server's HOME — assembly writes
// forge's own artifacts, and the source path is in the panel's field, so the
// copy also keeps machine paths out of frame).
import { cpSync, rmSync } from 'node:fs'
import { join } from 'node:path'

import { expect, test, type TestInfo } from '@playwright/test'

import { cellCenter, createProject, openMap, resetView } from '../e2e/helpers'
import { repoRoot, shoot } from './capture'
import { SHOTS_HOME } from './paths'

function themeDir(testInfo: TestInfo, name: string): string {
  return join(SHOTS_HOME, testInfo.project.name, name)
}

test('the content library', async ({ page }, testInfo) => {
  test.setTimeout(120_000)
  const root = repoRoot(testInfo)
  const projectDir = themeDir(testInfo, join('adventures', 'quarry.osr'))
  rmSync(projectDir, { recursive: true, force: true })
  const forgeSource = themeDir(testInfo, 'millstone.forge')
  rmSync(forgeSource, { recursive: true, force: true })
  cpSync(join(root, 'tests', 'fixtures', 'forge_workdir'), forgeSource, { recursive: true })

  await createProject(page, projectDir, 'Coppergrave quarry')
  await openMap(page)

  // The OPD canvas: every area arrives carrying Watabou's note text, which is
  // what makes the first drop collide.
  await page.getByRole('button', { name: 'Import geometry' }).click()
  await page.getByLabel('Source path').fill(join(root, 'tests', 'assets', 'opd', 'torture.json'))
  await page.getByRole('button', { name: 'Sniff' }).click()
  await page.getByRole('button', { name: 'Load' }).click()
  await expect(page.getByLabel('Source level')).toBeVisible()
  await page.getByRole('dialog').getByRole('button', { name: 'Import' }).click()
  await expect(page.getByTestId('revision')).toHaveText('r2')
  await resetView(page)

  // The palette: the converted module opens read-only, in the tilde form the
  // capture server's redirected HOME makes machine-neutral.
  await page.getByRole('button', { name: 'Library', exact: true }).click()
  const panel = page.getByTestId('library-panel')
  await panel.getByLabel('Open a source').fill(`~/${testInfo.project.name}/millstone.forge`)
  await panel.getByRole('button', { name: 'Open', exact: true }).click()
  await expect(panel).toContainText('The Millstone Warrens')

  // The first drop collides on the Watabou description — the dialog is the
  // shot, replace preselected.
  await panel.getByRole('button', { name: 'Place Flour Cellar' }).click()
  const target = await cellCenter(page, 7, 10)
  await page.mouse.click(target.x, target.y)
  const collision = page.getByRole('dialog', { name: 'The room already has some of this' })
  await expect(collision).toContainText('Description')
  await expect(collision.getByRole('radio', { name: 'Replace' })).toBeChecked()
  await shoot(collision, 'collision-dialog', testInfo)
  await collision.getByRole('button', { name: 'Place' }).click()
  await expect(page.getByTestId('revision')).toHaveText('r3')

  // The second drop reuses the remembered choice — no prompt — and the panel
  // now shows used badges on both placed entries.
  await panel.getByRole('button', { name: 'Place Grinding Hall' }).click()
  const second = await cellCenter(page, 1, 10)
  await page.mouse.click(second.x, second.y)
  await expect(page.getByTestId('revision')).toHaveText('r4')
  await expect(panel.getByTitle('Placed at least once')).toHaveCount(2)
  await shoot(panel, 'library-panel', testInfo)

  // The stash offer, photographed in the clear-content dialog: the tally, the
  // default-on offer, and undo named as the way back for what it cannot hold.
  await page.getByRole('button', { name: 'Clear content…' }).click()
  const clearDialog = page.getByRole('dialog', { name: 'Clear content' })
  await expect(clearDialog).toContainText('This clears:')
  await expect(
    clearDialog.getByRole('checkbox', { name: "Stash this level's content in the library first" }),
  ).toBeChecked()
  await shoot(clearDialog, 'clear-content-dialog', testInfo)
  await page.keyboard.press('Escape')
})
