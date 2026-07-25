// The forge-backed review shots, from the committed workdir fixture: the flag
// queue, the reasoned correction record, and the monster resolution panel.
//
// The workdir is copied per theme because the editor writes overrides.yaml into it
// and the backend caches an open project by path — two runs over one directory
// would have the second inherit the first's corrections.
import { cpSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'

import { expect, test } from '@playwright/test'

import { repoRoot, shoot } from './capture'
import { SHOTS_HOME } from './paths'

test('the forge review chrome', async ({ page }, testInfo) => {
  test.setTimeout(120_000)
  const fixture = join(repoRoot(testInfo), 'tests', 'fixtures', 'forge_workdir')
  const workdir = join(SHOTS_HOME, testInfo.project.name, 'workdirs', 'millstone.forge')
  rmSync(workdir, { recursive: true, force: true })
  mkdirSync(join(workdir, '..'), { recursive: true })
  cpSync(fixture, workdir, { recursive: true })

  await page.goto('/')
  await page.getByRole('button', { name: 'Open project' }).click()
  await page.getByLabel('Project directory').fill(workdir)
  await page.getByRole('dialog').getByRole('button', { name: 'Open' }).click()
  await expect(page.getByRole('heading', { name: 'The Millstone Warrens' })).toBeVisible()

  // The review queue: the fixture raises twelve flags across five areas, which is
  // the work list the guide describes.
  await page.getByRole('button', { name: 'Review (12)' }).click()
  await expect(page.getByTestId('review-count')).toHaveText('12 flags to review')
  await expect(page.getByTestId('review-row-millstone-warrens/1/2')).toContainText(
    'treasure_unparsed',
  )
  await shoot(page.getByTestId('review-count').locator('xpath=../..'), 'review-queue', testInfo)

  // A correction, so the record has something in it to show. Selecting the row
  // navigates to the flagged area; the description edit commits an override with
  // an auto-drafted, page-anchored reason.
  await page
    .getByTestId('review-row-millstone-warrens/1/2')
    .getByRole('button', { name: 'Area 1/2' })
    .click()
  const inspector = page.getByLabel('Inspector')
  await inspector
    .getByLabel('Description')
    .fill('Sacks of flour line the walls; goblins have gnawed clean through the lot.')
  await inspector.getByLabel('Description').blur()
  await expect(page.getByTestId('revision')).toHaveText('r2')

  // The corrections panel: every overrides.yaml entry with its reason inline.
  await page.getByRole('button', { name: 'Corrections' }).click()
  const areaEntry = page.getByTestId('correction-areas-millstone-warrens/1/2')
  await expect(areaEntry).toContainText('description replaced')
  await expect(areaEntry).toContainText('machine draft')
  await shoot(areaEntry.locator('xpath=../..'), 'corrections-panel', testInfo)

  // Monster resolution: the either/or the forge contract defines, per name.
  await page.getByRole('button', { name: 'Monster resolution' }).click()
  await expect(page.getByText('2 resolved · 1 unresolved')).toBeVisible()
  await expect(page.getByTestId('monster-rat king')).toBeVisible()
  await shoot(page.getByTestId('monster-rat king').locator('xpath=../..'), 'monster-resolution', testInfo)
})
