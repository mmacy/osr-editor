// The phase 5 milestone loop, end to end against the real CLI and built
// frontend: open the fixture workdir, see the review queue's flags, correct a
// flagged area's description against the printed page, seal a synthesized
// opening, remap one unresolved monster and patch the other's printed block,
// run the playability check, dismiss a reviewed flag, publish symlink-mode
// through the warnings confirm — and prove overrides.yaml holds exactly the
// session's entries with their reasons.
import { cpSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, test, type Page } from '@playwright/test'

import { CELL_SIZE, RESET_MARGIN } from '../../frontend/src/map/view'

const FIXTURE = join(__dirname, '..', 'fixtures', 'forge_workdir')

const CORRECTED = 'Sacks of flour line the walls; goblins have gnawed clean through the lot.'

async function edgePoint(page: Page, x: number, y: number): Promise<{ x: number; y: number }> {
  // The point on the edge between cells (x-1, y) and (x, y), after Reset zoom.
  const box = await page.getByTestId('map-canvas').boundingBox()
  if (!box) throw new Error('the map canvas has no bounding box')
  return {
    x: box.x + RESET_MARGIN + x * CELL_SIZE,
    y: box.y + RESET_MARGIN + (y + 0.5) * CELL_SIZE,
  }
}

test('the forge review loop: flags to corrected, resolved, checked, published', async ({
  page,
}) => {
  test.setTimeout(120_000)
  const workspace = mkdtempSync(join(tmpdir(), 'osr-editor-forge-e2e-'))
  const workdir = join(workspace, 'millstone.forge')
  cpSync(FIXTURE, workdir, { recursive: true })
  const checkout = join(workspace, 'osr-web')
  mkdirSync(join(checkout, 'adventures'), { recursive: true })

  // Open the workdir — the forge-backed open assembles and lands in review chrome.
  await page.goto('/')
  await page.getByRole('button', { name: 'Open project' }).click()
  await page.getByLabel('Project directory').fill(workdir)
  await page.getByRole('dialog').getByRole('button', { name: 'Open' }).click()
  await expect(page.getByRole('heading', { name: 'The Millstone Warrens' })).toBeVisible()
  await expect(page.getByTestId('revision')).toHaveText('r1')

  // The review queue: the fixture raises twelve flags across five areas.
  await page.getByRole('button', { name: 'Review (12)' }).click()
  await expect(page.getByTestId('review-count')).toHaveText('12 flags to review')
  await expect(page.getByTestId('review-row-millstone-warrens/1/2')).toContainText(
    'treasure_unparsed',
  )

  // Selecting a row navigates to the area with its printed pages alongside.
  await page
    .getByTestId('review-row-millstone-warrens/1/2')
    .getByRole('button', { name: 'Area 1/2' })
    .click()
  await expect(page.getByTestId('map-canvas')).toBeVisible()
  await expect(page.getByTestId('source-pages')).toContainText('Source page 1')
  await expect(page.getByLabel('Description')).toHaveValue(
    'Sacks of flour line the walls; something has gnawed clean through the lot.',
  )

  // Correct the description against the printed page — one override entry.
  await page.getByLabel('Description').fill(CORRECTED)
  await page.getByLabel('Description').blur()
  await expect(page.getByTestId('revision')).toHaveText('r2')

  // The corrections panel lists the entry with its drafted, page-anchored reason.
  await page.getByRole('button', { name: 'Corrections' }).click()
  const areaEntry = page.getByTestId('correction-areas-millstone-warrens/1/2')
  await expect(areaEntry).toContainText('description replaced')
  await expect(areaEntry).toContainText('machine draft')
  await expect(areaEntry.getByRole('textbox')).toHaveValue(
    'area 2 description corrected against p. 1',
  )

  // Redraw a piece of geometry: seal the synthesized opening between (0,0)
  // and (1,0) — the wall tool cycles open → door → wall.
  await page.getByRole('button', { name: 'Level 1', exact: true }).click()
  await expect(page.getByTestId('map-canvas')).toBeVisible()
  await page.getByRole('button', { name: 'Reset zoom' }).click()
  await page.getByRole('button', { name: 'Wall and door tool' }).click()
  const seal = await edgePoint(page, 1, 0)
  await page.mouse.click(seal.x, seal.y)
  await expect(page.getByTestId('revision')).toHaveText('r3')
  await page.mouse.click(seal.x, seal.y)
  await expect(page.getByTestId('revision')).toHaveText('r4')

  // The explicit wall seal landed in the geometry entry.
  await page.getByRole('button', { name: 'Corrections' }).click()
  await expect(page.getByTestId('correction-geometry-millstone-warrens/1')).toContainText(
    '1 edge entry',
  )

  // Remap the unresolved rat king to a catalog monster.
  await page.getByRole('button', { name: 'Monster resolution' }).click()
  await expect(page.getByText('2 resolved · 1 unresolved')).toBeVisible()
  await page
    .getByTestId('monster-rat king')
    .getByRole('button', { name: 'Remap to catalog monster' })
    .click()
  await page.getByPlaceholder('Search monsters…').fill('giant rat')
  await page.getByRole('option', { name: /Giant Rat/ }).first().click()
  await expect(page.getByTestId('revision')).toHaveText('r5')
  await expect(page.getByText('3 resolved · 0 unresolved')).toBeVisible()

  // Patch the mill wisp's printed block — corrections land pre-mapping.
  await page
    .getByTestId('monster-mill wisp')
    .getByRole('button', { name: 'Correct printed stat block' })
    .click()
  await page.getByLabel('Morale').fill('9')
  await page.getByRole('button', { name: 'Commit correction' }).click()
  await expect(page.getByTestId('revision')).toHaveText('r6')

  // The always-present Monsters section renders the derived bundle as a
  // review view; authoring blocks in place with the detach offer.
  await page.getByRole('button', { name: 'Monsters', exact: true }).click()
  await page.getByRole('button', { name: 'New monster' }).click()
  await expect(page.getByText('This edit needs a native project')).toBeVisible()
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click()

  // Run the playability check; the forge tier joins the diagnostics drawer.
  await page.getByRole('button', { name: 'Pipeline' }).click()
  await expect(page.getByTestId('check-state')).toHaveText('not run since the last change')
  await page.getByRole('button', { name: 'Run check' }).click()
  await expect(page.getByTestId('check-state')).toHaveText('findings current')
  await expect(page.getByText('every path into this area passes through a secret door').first(),
  ).toBeVisible()

  // Dismiss a reviewed flag; the honest work-remaining count drops.
  await page.getByRole('button', { name: /^Review/ }).click()
  await expect(page.getByTestId('review-count')).toHaveText('11 flags to review')
  await page
    .getByTestId('review-row-millstone-warrens/1/1')
    .getByLabel('Dismiss connection_ambiguous:no target stated')
    .click()
  await expect(page.getByTestId('review-count')).toHaveText('10 flags to review')

  // Publish symlink-mode through the warnings confirm — validation is clean;
  // lint and forge findings prompt but never block.
  await page.getByRole('button', { name: 'Publish' }).click()
  await page.getByLabel('osr-web checkout').fill(checkout)
  await page.getByRole('dialog').getByRole('button', { name: 'Publish', exact: true }).click()
  await expect(page.getByText(/carries lint warnings/)).toBeVisible()
  await page.getByRole('button', { name: 'Publish anyway' }).click()
  await expect(page.getByText(/Published to /)).toBeVisible()

  // The symlink resolves to the workdir, and the always-fresh adventure.json
  // carries every correction — the live-publish loop composes.
  const link = join(checkout, 'adventures', 'millstone')
  expect(lstatSync(link).isSymbolicLink()).toBe(true)
  expect(realpathSync(link)).toBe(realpathSync(workdir))
  const published = readFileSync(join(link, 'adventure.json'), 'utf-8')
  expect(published).toContain(CORRECTED)
  expect(published).toContain('giant_rat')

  // The reviewable record, proven: overrides.yaml holds exactly the session's
  // entries with their reasons.
  expect(readFileSync(join(workdir, 'overrides.yaml'), 'utf-8')).toBe(
    'monsters:\n' +
      '  rat king:\n' +
      '    template_id: giant_rat\n' +
      '    reason: remapped to giant_rat\n' +
      'monster_templates:\n' +
      '  mill wisp:\n' +
      '    morale: 9\n' +
      '    reason: printed stat block corrected\n' +
      'areas:\n' +
      '  millstone-warrens/1/2:\n' +
      `    description: ${CORRECTED}\n` +
      '    reason: area 2 description corrected against p. 1\n' +
      'geometry:\n' +
      '  millstone-warrens/1:\n' +
      '    edges:\n' +
      "      1,0:west:\n" +
      '        kind: wall\n' +
      '    reason: level 1 edges redrawn\n',
  )
})
