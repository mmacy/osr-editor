// The authoring-aid shots: the prose assistant's draft beside the current text,
// and the SRD stocking sweep's report.
//
// The prose fixtures are fingerprinted against a "Stocking demo" project with a
// blank area 1, so the project name and the first room's geometry are load-bearing
// here, not decorative — a different name would miss every recording.
import { mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'

import { expect, test } from '@playwright/test'

import { cellCenter, createProject, drag, drawRoom } from '../e2e/helpers'
import { repoRoot, shoot } from './capture'
import { SHOTS_HOME } from './paths'

test('the prose assistant and the stocking report', async ({ page }, testInfo) => {
  test.setTimeout(120_000)
  const root = repoRoot(testInfo)
  const projectDir = join(SHOTS_HOME, testInfo.project.name, 'adventures', 'stocking-demo.osr')
  rmSync(projectDir, { recursive: true, force: true })
  mkdirSync(join(projectDir, '..'), { recursive: true })

  const projectId = await createProject(page, projectDir, 'Stocking demo')

  // The assistant renders only when a provider is configured; these are the
  // recorded exchanges, replayed, so the capture makes no network call.
  const provider = await page.request.post('/api/provider', {
    data: { kind: 'fixtures', fixtures_dir: join(root, 'tests', 'assets', 'prose') },
  })
  expect(provider.ok()).toBeTruthy()

  await page.getByRole('button', { name: 'Level 1' }).click()
  await expect(page.getByTestId('map-canvas')).toBeVisible()
  await page.getByRole('button', { name: 'Reset zoom' }).click()
  await drawRoom(page, [0, 0], [1, 1])
  const roomOne = await cellCenter(page, 0, 0)
  await page.mouse.click(roomOne.x, roomOne.y)

  // The draft renders beside the current text, with its token usage, and nothing
  // changes until it is accepted.
  const inspector = page.getByLabel('Area 1')
  await expect(inspector).toBeVisible()
  await inspector.getByRole('button', { name: 'Draft with assistant' }).click()
  const suggestion = page.getByTestId('prose-suggestion')
  await expect(suggestion).toContainText('A low, close room')
  await shoot(page.getByTestId('prose-assistant'), 'prose-assistant', testInfo)
  await suggestion.getByRole('button', { name: 'Accept' }).click()
  await expect(inspector.getByLabel('Description')).toHaveValue(/A low, close room/)

  // Two more blank rooms for the sweep to fill, joined so the level stays clean.
  await drawRoom(page, [3, 0], [4, 1])
  await drawRoom(page, [3, 3], [4, 4])
  await page.getByRole('button', { name: 'Corridor tool' }).click()
  await drag(page, await cellCenter(page, 1, 0), await cellCenter(page, 3, 0))
  await drag(page, await cellCenter(page, 3, 1), await cellCenter(page, 3, 3))
  await page.getByRole('button', { name: 'Select tool' }).click()
  await expect(page.getByTestId('diagnostics-count')).toHaveText('0')

  // A pinned seed, so the rolled contents are the same in both themes and in
  // every future capture — the report is a screenshot, not a lottery.
  const seeded = await page.request.post(`/api/projects/${projectId}/sidecar`, {
    data: { patches: [{ action: 'set_stocking_seed', master_seed: '1234567' }] },
  })
  expect(seeded.ok()).toBeTruthy()

  await page.getByRole('button', { name: 'Roll stocking' }).click()
  const report = page.getByTestId('stocking-report')
  await expect(report).toBeVisible()
  await expect(report.locator('li')).toHaveCount(2)
  await expect(page.getByText(/the dice stay advanced/i)).toBeVisible()
  await shoot(report, 'stocking-report', testInfo)
})
