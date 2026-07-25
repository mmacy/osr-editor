// The conversion shots, over the same zero-network fixtures the e2e suite uses:
// the cost gate before anything is spent, the per-stage table, and a flagged area
// beside its printed page.
//
// The source PDF is copied under the capture server's own scratch root first, so
// the dialog's path fields render a generic location rather than this checkout.
//
// `source-pages` comes from here rather than from the forge workdir fixture on
// purpose: that fixture's pages are 480x400 rectangles of default-font text, while
// minimod ships the real pdfium renders its own fixtures were recorded against.
import { copyFileSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'

import { expect, test } from '@playwright/test'

import { fabricateWarmWorkdir, MINIMOD } from '../e2e/warm-workdir'
import { shoot } from './capture'
import { SHOTS_HOME } from './paths'

test('the cost gate', async ({ page }, testInfo) => {
  test.setTimeout(120_000)
  const modules = join(SHOTS_HOME, testInfo.project.name, 'modules')
  const pdf = join(modules, 'root-cellar.pdf')
  const destination = join(modules, 'root-cellar.forge')
  rmSync(destination, { recursive: true, force: true })
  mkdirSync(modules, { recursive: true })
  copyFileSync(join(MINIMOD, 'minimod.pdf'), pdf)

  await page.goto('/')
  await page.getByRole('button', { name: 'Convert a PDF' }).click()
  await page.getByLabel('Module PDF').fill(pdf)
  await page.getByLabel('Destination workdir').fill(destination)

  // The server really preprocesses — every page is rendered into the workdir,
  // because module text is never persisted outside the user's own project.
  await page.getByRole('button', { name: 'Estimate' }).click()
  await expect(page.getByTestId('estimate-card')).toBeVisible({ timeout: 60_000 })
  await expect(page.getByTestId('estimate-card')).toContainText(
    'Converting this 5-page module will cost roughly',
  )
  await expect(page.getByTestId('estimate-usd')).toContainText('$')
  await expect(page.getByTestId('estimate-card')).toContainText('A rough estimate, not a quote')
  await shoot(page.getByTestId('estimate-card'), 'estimate-card', testInfo)
})

test('the pipeline and the printed page', async ({ page, request }, testInfo) => {
  test.setTimeout(180_000)
  const workdir = join(SHOTS_HOME, testInfo.project.name, 'workdirs', 'cellar.forge')
  rmSync(workdir, { recursive: true, force: true })
  mkdirSync(join(workdir, '..'), { recursive: true })
  fabricateWarmWorkdir(workdir)

  // The recorded fixtures, through the same typed route the settings dialog uses.
  const configured = await request.post('/api/provider', {
    data: { kind: 'fixtures', fixtures_dir: join(MINIMOD, 'fixtures') },
  })
  expect(configured.ok()).toBe(true)

  await page.goto('/')
  await page.getByRole('button', { name: 'Open project' }).click()
  await page.getByLabel('Project directory').fill(workdir)
  await page.getByRole('dialog').getByRole('button', { name: 'Open' }).click()
  await expect(page.getByRole('heading', { name: 'Conversion' })).toBeVisible()
  await expect(page.getByTestId('stage-row-preprocess')).toContainText('completed')

  // The stage table of a workdir whose conversion never completed — one stage done,
  // the rest pending — which is the state the guide's paragraph is about. Captured
  // before the run, not after: a table of six completed stages would illustrate the
  // opposite of the sentence beside it. Clipped to the rows, because the provider
  // strip reads "FixtureProvider", a harness no reader can configure.
  await expect(page.getByTestId('stage-row-survey')).toContainText('pending')
  await shoot(
    page.getByTestId('stage-row-preprocess').locator('xpath=..'),
    'pipeline-stages',
    testInfo,
  )

  await page.getByRole('button', { name: 'Run' }).click()
  await expect(page.getByRole('heading', { name: 'The Root Cellar of Old Wenna' })).toBeVisible({
    timeout: 120_000,
  })

  // A flagged area with its printed page alongside — correction happens against
  // the page, which is the whole argument of the review guide.
  await page.getByRole('button', { name: /^Review/ }).click()
  await expect(page.getByTestId('review-count')).toContainText('flags to review')
  await page
    .getByRole('button', { name: /^Area / })
    .first()
    .click()
  await expect(page.getByTestId('source-pages')).toBeVisible()
  await shoot(page, 'source-pages', testInfo)
})
