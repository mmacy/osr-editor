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

import { cellCenter, createProject, drawRoom, openMap } from './helpers'

const INSPECTOR_DEFAULT = 256
const INSPECTOR_AREA_DEFAULT = 384
const INSPECTOR_MIN = 224
const CANVAS_MIN = 320

async function paneWidth(page: Page, pane: string): Promise<number> {
  const box = await page.getByTestId(pane).boundingBox()
  expect(box).not.toBeNull()
  return box!.width
}

/**
 * Drag the splitter that sizes `pane` by `dx` page pixels.
 *
 * The target is clamped into the window, because a pointer event dispatched
 * outside it is dropped rather than clamped — a drag "past the edge" to prove a
 * limit would otherwise silently not happen at all.
 */
async function dragSplitter(page: Page, pane: string, dx: number): Promise<void> {
  const splitter = page.locator(`[data-separator][aria-controls="${pane}"]`)
  const width = page.viewportSize()?.width ?? 0
  // A box measured before a window resize has been laid out puts the press
  // outside the new window, where the event is dropped and the drag silently
  // does not happen. Wait for the splitter to be somewhere it can be pressed.
  await expect
    .poll(async () => (await splitter.boundingBox())?.x ?? Number.POSITIVE_INFINITY)
    .toBeLessThan(width)
  const box = await splitter.boundingBox()
  expect(box).not.toBeNull()
  const y = box!.y + box!.height / 2
  const x = box!.x + box!.width / 2
  const target = Math.max(1, Math.min(width - 1, x + dx))
  await page.mouse.move(x, y)
  await page.mouse.down()
  // Two steps, so the gesture reads as a drag rather than a teleport.
  await page.mouse.move((x + target) / 2, y)
  await page.mouse.move(target, y)
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

test('the inspector widens for an area until the author sizes it, then holds', async ({ page }) => {
  const projectDir = join(mkdtempSync(join(tmpdir(), 'osr-editor-panes-')), 'inspector.osr')
  await createProject(page, projectDir, 'Inspector width')
  await openMap(page)
  await drawRoom(page, [1, 1], [2, 2])
  const inspector = page.getByLabel('Inspector')

  // Unsized, the pane follows the selection: an area's content forms expand in
  // place and need the room. The panel library re-applies a default size when
  // the prop changes, which is what makes this a default rather than a one-shot
  // at mount — the pane never remounts across a selection change.
  await expect(inspector.getByLabel('Key')).toHaveValue('1')
  expect(await paneWidth(page, 'pane-inspector')).toBe(INSPECTOR_AREA_DEFAULT)
  const empty = await cellCenter(page, 8, 8)
  await page.mouse.click(empty.x, empty.y)
  await expect(inspector).toContainText('Cell(8, 8)')
  expect(await paneWidth(page, 'pane-inspector')).toBe(INSPECTOR_DEFAULT)

  // One drag ends that: from here the author's width holds whatever is
  // selected, because a pane that keeps jumping after it was sized reads as
  // broken.
  await dragSplitter(page, 'pane-canvas', -60)
  const sized = await paneWidth(page, 'pane-inspector')
  expect(sized).toBeCloseTo(INSPECTOR_DEFAULT + 60, 0)
  const room = await cellCenter(page, 1, 1)
  await page.mouse.click(room.x, room.y)
  await expect(inspector.getByLabel('Key')).toHaveValue('1')
  expect(await paneWidth(page, 'pane-inspector')).toBe(sized)
})
