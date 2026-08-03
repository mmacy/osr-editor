// The pane splitters: an author trades canvas for panel, the layout survives
// the session, and neither side can be dragged into uselessness.
//
// The widths asserted here are `PANE_LIMITS` in frontend/src/lib/pane-widths —
// written out rather than imported, because that module reaches the project
// store and these specs run Node-side. A limit that moves fails here, which is
// the point.
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, test, type Page } from '@playwright/test'

import { createProject, openMap } from './helpers'

const INSPECTOR_DEFAULT = 256
const INSPECTOR_MIN = 224
const CANVAS_MIN = 320

async function paneWidth(page: Page, pane: string): Promise<number> {
  const box = await page.getByTestId(pane).boundingBox()
  expect(box).not.toBeNull()
  return box!.width
}

/** Drag the splitter that sizes `pane` by `dx` page pixels. */
async function dragSplitter(page: Page, pane: string, dx: number): Promise<void> {
  const box = await page.locator(`[data-separator][aria-controls="${pane}"]`).boundingBox()
  expect(box).not.toBeNull()
  const y = box!.y + box!.height / 2
  const x = box!.x + box!.width / 2
  await page.mouse.move(x, y)
  await page.mouse.down()
  // Two steps, so the gesture reads as a drag rather than a teleport.
  await page.mouse.move(x + dx / 2, y)
  await page.mouse.move(x + dx, y)
  await page.mouse.up()
}

test('a dragged pane keeps its width across a reopen, and the floors hold', async ({ page }) => {
  const projectDir = join(mkdtempSync(join(tmpdir(), 'osr-editor-panes-')), 'panes.osr')
  await createProject(page, projectDir, 'Pane widths')
  await openMap(page)
  expect(await paneWidth(page, 'pane-inspector')).toBe(INSPECTOR_DEFAULT)

  // Trade canvas for inspector: the splitter between them is the inspector's.
  const canvasBefore = await paneWidth(page, 'pane-canvas')
  await dragSplitter(page, 'pane-canvas', -120)
  expect(await paneWidth(page, 'pane-inspector')).toBeCloseTo(INSPECTOR_DEFAULT + 120, 0)
  expect(await paneWidth(page, 'pane-canvas')).toBeCloseTo(canvasBefore - 120, 0)

  // The width is the author's, not the session's: it rides the sidecar, so
  // closing the project and opening it again brings the layout back.
  await page.goto('/')
  await page
    .getByRole('region', { name: 'Recent projects' })
    .getByRole('button', { name: /Pane widths/ })
    .click()
  await expect(page.getByTestId('revision')).toHaveText('r1')
  await openMap(page)
  expect(await paneWidth(page, 'pane-inspector')).toBeCloseTo(INSPECTOR_DEFAULT + 120, 0)

  // Neither side can be dragged away: the pane stops at its own floor…
  await dragSplitter(page, 'pane-canvas', 400)
  expect(await paneWidth(page, 'pane-inspector')).toBe(INSPECTOR_MIN)

  // …and the canvas at its own, which is what stops a pane taking the window.
  // Narrow enough that the canvas floor binds before the inspector's ceiling
  // does, which is the case a wide window never reaches.
  await page.setViewportSize({ width: 900, height: 720 })
  await dragSplitter(page, 'pane-canvas', -2000)
  expect(await paneWidth(page, 'pane-canvas')).toBe(CANVAS_MIN)
})
