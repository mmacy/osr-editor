// Shared gestures for the e2e and screenshot suites.
//
// Canvas interaction invokes the zoom-reset control first, then drives pointer
// events at coordinates computed from the exported cell-size constant — that is
// what makes the math deterministic. Every helper that returns page coordinates
// is only valid after `resetView`.
import { expect, type Page } from '@playwright/test'

import { CELL_SIZE, RESET_MARGIN } from '../../frontend/src/map/view'

export interface Point {
  x: number
  y: number
}

/** Create a native project from the home screen, returning its server-minted id. */
export async function createProject(page: Page, projectDir: string, name: string): Promise<string> {
  await page.goto('/')
  await page.getByRole('button', { name: 'New adventure' }).click()
  await page.getByLabel('Adventure name').fill(name)
  await page.getByLabel('Destination directory').fill(projectDir)
  const created = page.waitForResponse(
    (response) => response.url().endsWith('/api/projects') && response.request().method() === 'POST',
  )
  await page.getByRole('button', { name: 'Create' }).click()
  const projectId = ((await (await created).json()) as { id: string }).id
  await expect(page.getByTestId('revision')).toHaveText('r1')
  return projectId
}

/** Pin the map view transform. Cell coordinates are meaningless without it. */
export async function resetView(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Reset zoom' }).click()
}

/** Open level 1 on the map and pin its view. */
export async function openMap(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Level 1' }).click()
  await expect(page.getByTestId('map-canvas')).toBeVisible()
  await resetView(page)
}

/** The center of a cell in page coordinates, valid after `resetView`. */
export async function cellCenter(page: Page, x: number, y: number): Promise<Point> {
  const box = await page.getByTestId('map-canvas').boundingBox()
  if (!box) throw new Error('the map canvas has no bounding box')
  return {
    x: box.x + RESET_MARGIN + (x + 0.5) * CELL_SIZE,
    y: box.y + RESET_MARGIN + (y + 0.5) * CELL_SIZE,
  }
}

/** A point on the edge between two orthogonally adjacent cells. */
export async function edgePoint(
  page: Page,
  a: [number, number],
  b: [number, number],
): Promise<Point> {
  const first = await cellCenter(page, a[0], a[1])
  const second = await cellCenter(page, b[0], b[1])
  return { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 }
}

export async function drag(page: Page, from: Point, to: Point): Promise<void> {
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move(to.x, to.y, { steps: 8 })
  await page.mouse.up()
}

/**
 * Drag a room rectangle between two cells, leaving the select tool active.
 *
 * Returns only once the room's op has committed, which the revision badge
 * reports. Hit tests and the stocking context menu read committed state, so a
 * gesture arriving before the round-trip lands finds no area under the cell —
 * and a right-click that finds none is swallowed outright rather than retried.
 */
export async function drawRoom(page: Page, a: [number, number], b: [number, number]): Promise<void> {
  await page.getByRole('button', { name: 'Room tool' }).click()
  const revision = page.getByTestId('revision')
  const before = (await revision.textContent()) ?? ''
  await drag(page, await cellCenter(page, ...a), await cellCenter(page, ...b))
  await expect(revision).not.toHaveText(before)
  await page.getByRole('button', { name: 'Select tool' }).click()
}
