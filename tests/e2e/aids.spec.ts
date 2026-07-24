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
import { fileURLToPath } from 'node:url'

import { expect, test, type Page } from '@playwright/test'

import { CELL_SIZE, RESET_MARGIN } from '../../frontend/src/map/view'

const PROSE_DIR = fileURLToPath(new URL('../assets/prose', import.meta.url))

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

async function cellCenter(page: Page, x: number, y: number): Promise<{ x: number; y: number }> {
  const box = await page.getByTestId('map-canvas').boundingBox()
  if (!box) throw new Error('the map canvas has no bounding box')
  return {
    x: box.x + RESET_MARGIN + (x + 0.5) * CELL_SIZE,
    y: box.y + RESET_MARGIN + (y + 0.5) * CELL_SIZE,
  }
}

async function drag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move(to.x, to.y, { steps: 8 })
  await page.mouse.up()
}

async function drawRoom(page: Page, a: [number, number], b: [number, number]) {
  await page.getByRole('button', { name: 'Room tool' }).click()
  await drag(page, await cellCenter(page, ...a), await cellCenter(page, ...b))
  await page.getByRole('button', { name: 'Select tool' }).click()
}

test('draft prose on a blank room, sweep the level, and publish', async ({ page }) => {
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
    data: { kind: 'fixtures', fixtures_dir: PROSE_DIR },
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

  // Two more blank rooms, then seed the stocking RNG and sweep the level.
  await drawRoom(page, [3, 0], [4, 1])
  await drawRoom(page, [3, 3], [4, 4])
  const seeded = await page.request.post(`/api/projects/${projectId}/sidecar`, {
    data: { patches: [{ action: 'set_stocking_seed', master_seed: '1234567' }] },
  })
  expect(seeded.ok()).toBeTruthy()

  await page.getByRole('button', { name: 'Roll stocking' }).click()
  // The report lists the two swept rooms; the described room 1 is skipped.
  const report = page.getByTestId('stocking-report')
  await expect(report).toBeVisible()
  await expect(report.getByText(/Undo restores the rooms/)).toHaveCount(0) // the note is in the header
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
