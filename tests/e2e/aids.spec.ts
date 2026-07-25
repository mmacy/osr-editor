// The phase 7 milestone loop, end to end against the real CLI and built
// frontend, deterministic and zero-network: create a native project, draft and
// accept a read-aloud description on a known blank room through the prose
// assistant (recorded fixtures replayed via the typed provider route), seed the
// stocking RNG through the typed sidecar patch route, sweep the level's blank
// rooms from the map toolbar and watch content land, then publish a document
// that carries both the drafted prose and the stocked content.
//
// The prose fixtures target a "Stocking demo" project with a blank area 1, so the
// running editor's request fingerprints match tests/assets/prose/ byte for byte.
import { mkdirSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, test, type Page, type TestInfo } from '@playwright/test'

import { cellCenter, drag, drawRoom } from './helpers'

// The committed prose fixtures, resolved through Playwright's own testDir so the
// path holds however the suite is invoked (spec files load as CJS here, so
// `import.meta` is unavailable — it breaks discovery for the whole suite).
function proseDir(testInfo: TestInfo): string {
  return join(testInfo.project.testDir, '..', 'assets', 'prose')
}

interface StampedDocument {
  kind: string
  payload: {
    dungeons: {
      levels: {
        areas: {
          id: string
          description: string
          encounter: unknown
          treasure: unknown
          trap: unknown
        }[]
      }[]
    }[]
  }
}

test('draft prose on a blank room, sweep the level, and publish', async ({ page }, testInfo) => {
  const workspace = mkdtempSync(join(tmpdir(), 'osr-editor-e2e-aids-'))
  const projectDir = join(workspace, 'stocking-demo.osr')
  const checkout = join(workspace, 'osr-web')
  mkdirSync(join(checkout, 'adventures'), { recursive: true })

  // Create the project, capturing its server-minted id from the response.
  await page.goto('/')
  await page.getByRole('button', { name: 'New adventure' }).click()
  await page.getByLabel('Adventure name').fill('Stocking demo')
  await page.getByLabel('Destination directory').fill(projectDir)
  const created = page.waitForResponse(
    (response) => response.url().endsWith('/api/projects') && response.request().method() === 'POST',
  )
  await page.getByRole('button', { name: 'Create' }).click()
  const projectId = ((await (await created).json()) as { id: string }).id
  await expect(page.getByTestId('revision')).toHaveText('r1')

  // Configure the fixtures provider through the typed route — the prose assistant
  // renders only when a provider is configured.
  const provider = await page.request.post('/api/provider', {
    data: { kind: 'fixtures', fixtures_dir: proseDir(testInfo) },
  })
  expect(provider.ok()).toBeTruthy()

  // Draw a blank room (area 1) and draft a read-aloud description for it.
  await page.getByRole('button', { name: 'Level 1' }).click()
  await expect(page.getByTestId('map-canvas')).toBeVisible()
  await page.getByRole('button', { name: 'Reset zoom' }).click()
  await drawRoom(page, [0, 0], [1, 1])
  const roomOne = await cellCenter(page, 0, 0)
  await page.mouse.click(roomOne.x, roomOne.y)

  const inspector = page.getByLabel('Area 1')
  await expect(inspector).toBeVisible()
  await inspector.getByRole('button', { name: 'Draft with assistant' }).click()
  const suggestion = page.getByTestId('prose-suggestion')
  await expect(suggestion).toContainText('A low, close room')
  await suggestion.getByRole('button', { name: 'Accept' }).click()
  await expect(inspector.getByLabel('Description')).toHaveValue(/A low, close room/)

  // Two more blank rooms, joined by corridors so every room is reachable and the
  // level publishes lint-clean (the warning-confirm path is phase 3's milestone).
  await drawRoom(page, [3, 0], [4, 1])
  await drawRoom(page, [3, 3], [4, 4])
  await page.getByRole('button', { name: 'Corridor tool' }).click()
  await drag(page, await cellCenter(page, 1, 0), await cellCenter(page, 3, 0))
  await drag(page, await cellCenter(page, 3, 1), await cellCenter(page, 3, 3))
  await page.getByRole('button', { name: 'Select tool' }).click()
  await expect(page.getByTestId('diagnostics-count')).toHaveText('0')
  const seeded = await page.request.post(`/api/projects/${projectId}/sidecar`, {
    data: { patches: [{ action: 'set_stocking_seed', master_seed: '1234567' }] },
  })
  expect(seeded.ok()).toBeTruthy()

  await page.getByRole('button', { name: 'Roll stocking' }).click()
  // The report lists exactly the two blank rooms — the described room 1 is
  // already stocked, so the sweep skips it — and carries the honest undo note.
  const report = page.getByTestId('stocking-report')
  await expect(report).toBeVisible()
  await expect(report.locator('li')).toHaveCount(2)
  await expect(report).toContainText('2')
  await expect(report).toContainText('3')
  await expect(page.getByText(/the dice stay advanced/i)).toBeVisible()
  await page.keyboard.press('Escape')

  // Publish into the osr-web-shaped checkout.
  await page.getByRole('button', { name: 'Publish' }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('osr-web checkout').fill(checkout)
  await dialog.getByRole('button', { name: 'Publish', exact: true }).click()
  const published = join(checkout, 'adventures', 'stocking-demo')
  await expect(page.getByText(`Published to ${published}`)).toBeVisible()

  // The published document carries the drafted prose and the swept content.
  const document = JSON.parse(readFileSync(join(published, 'adventure.json'), 'utf-8')) as StampedDocument
  expect(document.kind).toBe('adventure')
  const areas = document.payload.dungeons[0].levels[0].areas
  const described = areas.find((area) => area.id === '1')
  expect(described?.description).toMatch(/A low, close room/)
  const stocked = areas.filter((area) => area.id !== '1')
  expect(stocked.length).toBe(2)
  expect(
    stocked.some((area) => area.encounter !== null || area.treasure !== null || area.trap !== null),
  ).toBe(true)
})
