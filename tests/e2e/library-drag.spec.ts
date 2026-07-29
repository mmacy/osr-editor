// The drag gesture itself: HTML5 drag from a library entry row onto the map
// canvas, resolving the area under the pointer. Click-to-place carries the
// milestone spec — it is the path that must work even where drag cannot — so
// this spec proves exactly the gesture: dragstart from the entry, drop over an
// area, the collision dialog, and the landed content.
import { cpSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, test } from '@playwright/test'

import { CELL_SIZE, RESET_MARGIN } from '../../frontend/src/map/view'
import { createProject, openMap, resetView } from './helpers'

const FORGE_FIXTURE = join(__dirname, '..', 'fixtures', 'forge_workdir')
const OPD_TORTURE = join(__dirname, '..', 'assets', 'opd', 'torture.json')

test('an entry drags from the panel onto an area', async ({ page }) => {
  test.setTimeout(120_000)
  const workspace = mkdtempSync(join(tmpdir(), 'osr-editor-e2e-drag-'))
  const projectDir = join(workspace, 'drag.osr')
  const forgeSource = join(workspace, 'millstone.forge')
  cpSync(FORGE_FIXTURE, forgeSource, { recursive: true })

  await createProject(page, projectDir, 'Drag target')
  await openMap(page)

  await page.getByRole('button', { name: 'Import geometry' }).click()
  await page.getByLabel('Source path').fill(OPD_TORTURE)
  await page.getByRole('button', { name: 'Sniff' }).click()
  await page.getByRole('button', { name: 'Load' }).click()
  await expect(page.getByLabel('Source level')).toBeVisible()
  await page.getByRole('dialog').getByRole('button', { name: 'Import' }).click()
  await expect(page.getByTestId('revision')).toHaveText('r2')
  await resetView(page)

  await page.getByRole('button', { name: 'Library', exact: true }).click()
  const panel = page.getByTestId('library-panel')
  await panel.getByLabel('Open a source').fill(forgeSource)
  await panel.getByRole('button', { name: 'Open', exact: true }).click()
  await expect(panel).toContainText('The Millstone Warrens')

  // Drag the Grinding Hall entry onto torture area 1 (cells (0,9)–(2,11)):
  // the drop resolves the area under the pointer through the same hit test
  // the context menu uses. The target position is canvas-relative, from the
  // deterministic reset-zoom transform.
  await page.dragAndDrop(
    '[data-testid="entry-dungeon:millstone-warrens/level:1/area:1"]',
    '[data-testid="map-canvas"]',
    {
      targetPosition: {
        x: RESET_MARGIN + 1.5 * CELL_SIZE,
        y: RESET_MARGIN + 10.5 * CELL_SIZE,
      },
    },
  )

  // The Watabou note text collides with the entry's description; replace is
  // preselected and the drop lands as one ordinary batch.
  const collision = page.getByRole('dialog', { name: 'The room already has some of this' })
  await expect(collision).toBeVisible()
  await collision.getByRole('button', { name: 'Place' }).click()
  await expect(page.getByTestId('revision')).toHaveText('r3')
  await expect(
    panel
      .getByTestId('entry-dungeon:millstone-warrens/level:1/area:1')
      .getByTitle('Placed at least once'),
  ).toBeVisible()
})
