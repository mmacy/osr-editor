/// <reference lib="dom" />
// The one spec whose body runs inside the browser. The e2e tsconfig is
// deliberately Node-only (`"lib": ["ESNext"]`, `"types": ["node"]`) because
// every other spec is Node-side and a stray `document` there should be a type
// error; the reference is file-scoped so it stays one here.
//
// The map's navigation contract, driven as gestures rather than as unit inputs:
// wheel and pinch zoom about the pointer, a two-finger drag pans, a left-drag
// pans under the select and pan tools, a middle-click-and-hold drag pans, and a
// press that does not travel still selects.
//
// Every assertion reads the view through the hover readout — the cell under a
// fixed page point is the transform, observed the way a user observes it. The
// view is pinned by `openMap` first (scale 1, northwest corner at the reset
// margin), so the arithmetic below is exact rather than approximate.
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, test, type Page } from '@playwright/test'

import { CELL_SIZE, RESET_MARGIN, fitView } from '../../frontend/src/map/view'
import { cellCenter, createProject, openMap, type Point } from './helpers'

// A synthetic wheel frame on the canvas. Synthesized rather than driven through
// `mouse.wheel` because the shape of the delta is the whole subject: only a
// constructed event can carry a fractional delta, a line-mode unit, or the
// `ctrlKey` a trackpad pinch arrives with.
async function wheel(
  page: Page,
  at: Point,
  frames: Array<{
    deltaX?: number
    deltaY?: number
    deltaMode?: number
    ctrlKey?: boolean
  }>,
): Promise<void> {
  // Every frame dispatches inside one evaluate — one JS task, so React batches
  // them exactly as a real trackpad burst is batched. A handler that recomputed
  // from the last rendered view would drop all but the final frame here.
  await page.evaluate(
    ({ at, frames }) => {
      const canvas = document.querySelector('[data-testid="map-canvas"]')
      if (!canvas) throw new Error('no map canvas')
      for (const frame of frames) {
        canvas.dispatchEvent(
          new WheelEvent('wheel', {
            clientX: at.x,
            clientY: at.y,
            deltaX: frame.deltaX ?? 0,
            deltaY: frame.deltaY ?? 0,
            deltaMode: frame.deltaMode ?? 0,
            ctrlKey: frame.ctrlKey ?? false,
            bubbles: true,
            cancelable: true,
          }),
        )
      }
    },
    { at, frames },
  )
}

/**
 * The cell the hover readout names under a page point — the transform, observed.
 *
 * The readout is React state a pointer event drives, so it settles a frame or
 * more after `mouse.move` resolves. Reading it straight through races that
 * render and returns the previous pointer's cell, so wait for a painted frame.
 * Prefer `expectCellUnder`, which polls; this is for the rare read whose
 * expected value is not known up front.
 */
async function cellUnder(page: Page, at: Point): Promise<string> {
  await page.mouse.move(at.x, at.y)
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  )
  return (await page.getByTestId('hover-ref').textContent()) ?? ''
}

/**
 * Assert the cell the hover readout names under a page point.
 *
 * Polls rather than reading once, which is what keeps the assertion honest
 * without a sleep: the pan or zoom under test lands asynchronously, and a
 * one-shot read can catch the readout a frame before it updates.
 */
async function expectCellUnder(page: Page, at: Point, expected: string): Promise<void> {
  await page.mouse.move(at.x, at.y)
  await expect(page.getByTestId('hover-ref')).toHaveText(expected)
}

async function freshMap(page: Page, name: string): Promise<void> {
  const workspace = mkdtempSync(join(tmpdir(), 'osr-editor-e2e-nav-'))
  await createProject(page, join(workspace, `${name}.osr`), name)
  await openMap(page)
}

/** A page point offset from the reset view's origin by whole cells. */
async function gridPoint(page: Page, x: number, y: number): Promise<Point> {
  return cellCenter(page, x, y)
}

test('a two-finger drag pans, and every frame of the burst lands', async ({ page }) => {
  await freshMap(page, 'pad-pan')
  const probe = await gridPoint(page, 4, 4)
  await expectCellUnder(page, probe, '(4, 4)')

  // A pad frame: whole but far under a notch, no horizontal component. Ten of
  // them at 24 px is CELL_SIZE * 10, so the probe must land exactly ten cells
  // further down the grid — the assertion that fails if frames are dropped.
  await wheel(
    page,
    probe,
    Array.from({ length: 10 }, () => ({ deltaY: CELL_SIZE })),
  )
  await expectCellUnder(page, probe, '(4, 14)')

  // Horizontal too, and back: a pad drag carries both axes.
  await wheel(page, probe, [{ deltaX: -2 * CELL_SIZE, deltaY: -10 * CELL_SIZE }])
  await expectCellUnder(page, probe, '(2, 4)')
})

test('the wheel zooms about the pointer, and ctrl-scroll forces it', async ({ page }) => {
  await freshMap(page, 'wheel-zoom')
  // Probed under the pan tool, which hit-tests cells. Select prefers edges, and
  // a scaled probe no longer sits at a cell's centre — cell (10, 10)'s centre is
  // 5 cells from the anchor's centre, which at 115% is 4.85 cells, close enough
  // to the next boundary that the readout would name the edge instead.
  await page.getByRole('button', { name: 'Pan tool' }).click()
  const anchor = await gridPoint(page, 5, 5)
  const probe = await gridPoint(page, 10, 10)
  await expectCellUnder(page, anchor, '(5, 5)')
  await expectCellUnder(page, probe, '(10, 10)')

  // One notch in, anchored on (5, 5). The cell under the anchor is unchanged —
  // that is what "about the pointer" means — while the probe, 5 cells of page
  // distance away, now spans 5 / 1.15 = 4.35 cells from the anchor's centre at
  // 5.5, landing at grid 9.85: cell (9, 9).
  await wheel(page, anchor, [{ deltaY: -100 }])
  await expectCellUnder(page, anchor, '(5, 5)')
  await expectCellUnder(page, probe, '(9, 9)')

  // Resetting the view does not reset the gain ramp — it is a property of the
  // gesture stream, not of the camera — so each independent measurement below
  // waits the ramp out first. Six half-lives leaves under 2% of the travel,
  // which is the difference between a base-rate frame and a gained one.
  const settle = () => page.waitForTimeout(750)
  await page.getByRole('button', { name: 'Reset zoom' }).click()
  await settle()
  await expectCellUnder(page, probe, '(10, 10)')

  // The escape hatch: a fractional delta is pad-shaped and would pan, but zooms
  // under the modifier. This frame is the first of its burst, so it is ungained —
  // 29.5 px on the pinch rate is e^0.221 = 1.248, putting the probe at grid 9.51.
  await wheel(page, anchor, [{ deltaY: -29.5, ctrlKey: true }])
  await expectCellUnder(page, anchor, '(5, 5)')
  await expectCellUnder(page, probe, '(9, 9)')

  await page.getByRole('button', { name: 'Reset zoom' }).click()
  await settle()
  await expectCellUnder(page, probe, '(10, 10)')

  // The gain ramp, wired end to end: twenty pad-shaped frames under the modifier
  // in one burst reach scale 4.55 and put the probe at grid 6.60. The same twenty
  // frames at the base rate would only reach 2.46, landing on cell 7 — so cell 6
  // is the assertion that fails if the ramp stops reaching the canvas.
  await wheel(
    page,
    anchor,
    Array.from({ length: 20 }, () => ({ deltaY: -6, ctrlKey: true })),
  )
  await expectCellUnder(page, anchor, '(5, 5)')
  await expectCellUnder(page, probe, '(6, 6)')
})

test('a left-drag pans under select — including from empty paper', async ({ page }) => {
  await freshMap(page, 'drag-pan')
  const probe = await gridPoint(page, 4, 4)
  await expectCellUnder(page, probe, '(4, 4)')

  // Empty paper is off the grid entirely, where hit testing answers nothing —
  // and it is where a hand reaches to move a map, so it must still pan. The
  // blank readout is asserted rather than assumed: the canvas width depends on
  // how wide the inspector is, which depends on the selection, so a future test
  // could put this corner back on the grid and leave the coverage hollow while
  // the drag kept passing.
  const canvas = await page.getByTestId('map-canvas').boundingBox()
  if (!canvas) throw new Error('the map canvas has no bounding box')
  const outside = {
    x: canvas.x + canvas.width - 20,
    y: canvas.y + canvas.height - 20,
  }
  await expectCellUnder(page, outside, '')
  await page.mouse.move(outside.x, outside.y)
  await page.mouse.down()
  await page.mouse.move(outside.x, outside.y - 2 * CELL_SIZE, { steps: 6 })
  await page.mouse.up()
  await expectCellUnder(page, probe, '(4, 6)')

  // And over the grid, where the same press would otherwise be a selection.
  await page.mouse.move(probe.x, probe.y)
  await page.mouse.down()
  await page.mouse.move(probe.x, probe.y + 2 * CELL_SIZE, { steps: 6 })
  await page.mouse.up()
  await expectCellUnder(page, probe, '(4, 4)')
  // The drag panned instead of selecting, so the inspector stayed empty.
  await expect(page.getByLabel('Inspector')).toContainText('Select something on the map')
})

test('a press that does not travel still selects', async ({ page }) => {
  await freshMap(page, 'press-selects')
  await page.getByRole('button', { name: 'Room tool' }).click()
  const { x, y } = await gridPoint(page, 1, 1)
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move((await gridPoint(page, 3, 3)).x, (await gridPoint(page, 3, 3)).y, {
    steps: 6,
  })
  await page.mouse.up()
  await page.getByRole('button', { name: 'Select tool' }).click()

  // A click, then a press that jitters by less than the drag threshold: both
  // select the room rather than panning.
  await page.mouse.click(x, y)
  await expect(page.getByLabel('Inspector').getByLabel('Key')).toHaveValue('1')
  await page.getByRole('button', { name: 'Reset zoom' }).click()

  const probe = await gridPoint(page, 4, 4)
  const before = await cellUnder(page, probe)
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(x + 2, y + 2)
  await page.mouse.up()
  await expect(page.getByLabel('Inspector').getByLabel('Key')).toHaveValue('1')
  await expectCellUnder(page, probe, before)
})

test('the pan tool and a middle-click-and-hold drag both pan', async ({ page }) => {
  await freshMap(page, 'chord-pan')
  const probe = await gridPoint(page, 4, 4)

  await page.getByRole('button', { name: 'Pan tool' }).click()
  await page.mouse.move(probe.x, probe.y)
  await page.mouse.down()
  await page.mouse.move(probe.x, probe.y - 3 * CELL_SIZE, { steps: 6 })
  await page.mouse.up()
  await expectCellUnder(page, probe, '(4, 7)')

  // Middle-click-and-hold pans under every tool, drawing ones included.
  await page.getByRole('button', { name: 'Room tool' }).click()
  await page.mouse.move(probe.x, probe.y)
  await page.mouse.down({ button: 'middle' })
  await page.mouse.move(probe.x, probe.y + 3 * CELL_SIZE, { steps: 6 })
  await page.mouse.up({ button: 'middle' })
  await expectCellUnder(page, probe, '(4, 4)')
  // The middle-drag drew nothing — the room tool never saw a gesture.
  await expect(page.getByTestId('revision')).toHaveText('r1')
})

// Issue 26's second half: fit-the-level used to be reachable exactly once, as
// the view a level opens with, and never again once the reader had panned or
// zoomed. The control puts it back on the toolbar — beside the zoom buttons and
// beside, not instead of, **Reset zoom**, whose 100%-at-the-margin transform
// every other map spec computes its cell coordinates from.
test('fit level reframes the whole level, and reset zoom still pins 100%', async ({ page }) => {
  await freshMap(page, 'fit-level')
  const canvas = await page.getByTestId('map-canvas').boundingBox()
  if (!canvas) throw new Error('the map canvas has no bounding box')

  // Zoom in about the viewport centre until the level's northwest corner is off
  // frame — the state the issue describes, where nothing short of fit gets the
  // whole level back.
  const northwest = await gridPoint(page, 0, 0)
  for (let step = 0; step < 3; step += 1) {
    await page.getByRole('button', { name: 'Zoom in' }).click()
  }
  await page.mouse.move(northwest.x, northwest.y)
  await expect(page.getByTestId('hover-ref')).not.toHaveText('(0, 0)')

  await page.getByRole('button', { name: 'Fit level' }).click()

  // The fitted transform, computed the way the unit test computes it and read
  // back through the hover readout: the default 30x30 level is centred, with
  // both far corners in frame.
  const fitted = fitView(30, 30, canvas.width, canvas.height)
  const at = (x: number, y: number): Point => ({
    x: canvas.x + fitted.offsetX + (x + 0.5) * CELL_SIZE * fitted.scale,
    y: canvas.y + fitted.offsetY + (y + 0.5) * CELL_SIZE * fitted.scale,
  })
  await expectCellUnder(page, at(0, 0), '(0, 0)')
  await expectCellUnder(page, at(15, 15), '(15, 15)')
  await expectCellUnder(page, at(29, 29), '(29, 29)')

  // And the control it sits beside is untouched: still a hard 100% at the
  // pinned margin, from a fitted view as from any other.
  await page.getByRole('button', { name: 'Reset zoom' }).click()
  await expectCellUnder(page, await gridPoint(page, 6, 6), '(6, 6)')
})

test('reset zoom pins the transform the coordinate helpers assume', async ({ page }) => {
  await freshMap(page, 'reset-pins')
  const probe = await gridPoint(page, 6, 6)
  await wheel(page, probe, [{ deltaY: -100 }, { deltaX: 40, deltaY: 40 }])
  await page.getByRole('button', { name: 'Reset zoom' }).click()

  // The contract every other map spec leans on: after reset, cell (x, y) sits
  // at the reset margin plus whole cells, at scale 1.
  const canvas = await page.getByTestId('map-canvas').boundingBox()
  if (!canvas) throw new Error('the map canvas has no bounding box')
  await expectCellUnder(page, probe, '(6, 6)')
  await expectCellUnder(
    page,
    {
      x: canvas.x + RESET_MARGIN + 0.5 * CELL_SIZE,
      y: canvas.y + RESET_MARGIN + 0.5 * CELL_SIZE,
    },
    '(0, 0)',
  )
})
