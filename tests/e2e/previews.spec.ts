// The two content previews (#51, #52): the library panel's expandable entry
// preview and the map's area hover card. One scripted project serves both —
// a drawn room stocked by the one-click trap add, then opened back into the
// panel as its own palette.
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, test } from '@playwright/test'

import { cellCenter, createProject, drawRoom, openMap } from './helpers'

test('the entry preview and the area hover card show contents before any click', async ({
  page,
}) => {
  test.setTimeout(120_000)
  const workspace = mkdtempSync(join(tmpdir(), 'osr-editor-e2e-previews-'))
  await createProject(page, join(workspace, 'previews.osr'), 'Preview demo')
  await openMap(page)
  await drawRoom(page, [0, 0], [2, 2])
  await expect(page.getByTestId('revision')).toHaveText('r2')

  // Stock the room with the one-click trap add.
  const cell = await cellCenter(page, 1, 1)
  await page.mouse.click(cell.x, cell.y, { button: 'right' })
  await page.getByRole('menuitem', { name: 'Add trap' }).click()
  await expect(page.getByTestId('revision')).toHaveText('r3')

  // Rest on the area: the card raises beside it with the contents, while the
  // toolbar's ref readout keeps its contract with the coordinate checks.
  await page.mouse.move(cell.x, cell.y)
  const card = page.getByTestId('area-hover-card')
  await expect(card).toBeVisible()
  await expect(card).toContainText('Area 1')
  await expect(card).toContainText('Trap')
  await expect(card).toContainText('enter')
  await expect(page.getByTestId('hover-ref')).toContainText('(1, 1)')

  // Leaving the canvas for the toolbar drops the card.
  await page.getByRole('button', { name: 'Library', exact: true }).click()
  await expect(card).toBeHidden()

  // The same room previews in the panel: this project as its own palette.
  const panel = page.getByTestId('library-panel')
  await panel.getByRole('button', { name: 'This project' }).click()
  await expect(panel).toContainText('Preview demo')
  await panel.getByRole('button', { name: /Expand all previews/ }).click()
  const preview = panel.getByTestId('entry-preview-dungeon:dungeon-1/level:1/area:1')
  await expect(preview).toBeVisible()
  await expect(preview).toContainText('Trap')
  await expect(preview).toContainText('enter')
  // The per-entry chevron closes what expand-all opened.
  await panel.getByRole('button', { name: 'Preview Area 1' }).click()
  await expect(preview).toBeHidden()
})
