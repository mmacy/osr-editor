// The phase 3 milestone loop, end to end against the real CLI and built
// frontend: draw two rooms with the phase 2 tools, one reachable only through
// a secret door; stock from the map — right-click for an encounter through
// the picker, an area treasure, a trapped treasure-cache feature; set
// wandering; watch validation stay clean with the expected secret_only_access
// warning standing; publish symlink-mode into a temporary osr-web-shaped
// checkout, driving through the lint-warnings confirm — the secret door
// thereby proves the spec's "warnings prompt but don't block" rule end to
// end; assert the symlink resolves and the published document parses.
import { lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, test, type Page } from '@playwright/test'

import { CELL_SIZE, RESET_MARGIN } from '../../frontend/src/map/view'

interface StampedDocument {
  kind: string
  payload: {
    dungeons: {
      levels: {
        wandering: { chance_in_six: number }
        areas: {
          id: string
          encounter: { monsters: { template_id: string; count_dice: string | null }[] } | null
          treasure: { letters: string[]; unguarded: boolean } | null
          features: { kind: string; trap: { kind: string; trigger: string } | null }[]
        }[]
      }[]
    }[]
  }
}

async function createProject(page: Page, projectDir: string, name: string): Promise<void> {
  await page.goto('/')
  await page.getByRole('button', { name: 'New adventure' }).click()
  await page.getByLabel('Adventure name').fill(name)
  await page.getByLabel('Destination directory').fill(projectDir)
  await page.getByRole('button', { name: 'Create' }).click()
  await expect(page.getByTestId('revision')).toHaveText('r1')
}

async function openMap(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Level 1' }).click()
  await expect(page.getByTestId('map-canvas')).toBeVisible()
  await page.getByRole('button', { name: 'Reset zoom' }).click()
}

async function cellCenter(page: Page, x: number, y: number): Promise<{ x: number; y: number }> {
  const box = await page.getByTestId('map-canvas').boundingBox()
  if (!box) throw new Error('the map canvas has no bounding box')
  return {
    x: box.x + RESET_MARGIN + (x + 0.5) * CELL_SIZE,
    y: box.y + RESET_MARGIN + (y + 0.5) * CELL_SIZE,
  }
}

async function edgePoint(
  page: Page,
  a: [number, number],
  b: [number, number],
): Promise<{ x: number; y: number }> {
  const first = await cellCenter(page, a[0], a[1])
  const second = await cellCenter(page, b[0], b[1])
  return { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 }
}

async function drag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move(to.x, to.y, { steps: 8 })
  await page.mouse.up()
}

test('stock a secret-door module from the map and publish it', async ({ page }) => {
  const workspace = mkdtempSync(join(tmpdir(), 'osr-editor-e2e-stock-'))
  const projectDir = join(workspace, 'mill.osr')
  const checkout = join(workspace, 'osr-web')
  // The shape gate's own bar: a directory containing adventures/.
  mkdirSync(join(checkout, 'adventures'), { recursive: true })

  await createProject(page, projectDir, 'The mill on the moor')
  await openMap(page)
  await expect(page.getByTestId('diagnostics-count')).toHaveText('0')

  // Two rooms: one over the entrance, one apart — unreachable until joined.
  await page.getByRole('button', { name: 'Room tool' }).click()
  await drag(page, await cellCenter(page, 0, 0), await cellCenter(page, 1, 1))
  await expect(page.getByTestId('diagnostics-count')).toHaveText('0')
  await drag(page, await cellCenter(page, 3, 0), await cellCenter(page, 4, 1))
  await expect(page.getByTestId('diagnostics-count')).toHaveText('1')

  // A corridor joins them (opening every edge along its path); one wall-tool
  // click cycles the junction open → door, then the edge inspector makes it
  // secret — the room is reachable, but secretly only.
  await page.getByRole('button', { name: 'Corridor tool' }).click()
  await drag(page, await cellCenter(page, 1, 0), await cellCenter(page, 3, 0))
  await expect(page.getByTestId('diagnostics-count')).toHaveText('0')
  await page.getByRole('button', { name: 'Wall and door tool' }).click()
  const junction = await edgePoint(page, [2, 0], [3, 0])
  await page.mouse.click(junction.x, junction.y)
  await page.getByRole('button', { name: 'Select tool' }).click()
  await page.mouse.click(junction.x, junction.y)
  const inspector = page.getByLabel('Inspector')
  await expect(inspector.getByLabel('Kind', { exact: true })).toHaveValue('door')
  await inspector.getByLabel('Door kind').selectOption('secret')
  await expect(page.getByTestId('diagnostics-count')).toHaveText('1')
  await expect(page.getByText('every path into this area passes through a secret door')).toBeVisible()

  // Stock the guard room from the map: right-click, the encounter card's
  // picker, a dice count in the same gesture.
  const guardCell = await cellCenter(page, 1, 1)
  await page.mouse.click(guardCell.x, guardCell.y, { button: 'right' })
  await page.getByRole('menuitem', { name: 'Add encounter' }).click()
  await inspector.getByRole('button', { name: 'Add monster' }).click()
  await page.getByLabel('Count', { exact: true }).fill('2d4')
  await page.getByPlaceholder('Search monsters…').fill('skeleton')
  await page.getByRole('option', { name: /Skeleton/ }).first().click()
  await expect(inspector.getByLabel('Monster lines')).toContainText('Skeleton')

  // The secret room takes an area treasure by letters…
  const treasureCell = await cellCenter(page, 4, 1)
  await page.mouse.click(treasureCell.x, treasureCell.y, { button: 'right' })
  await page.getByRole('menuitem', { name: 'Add treasure' }).click()
  await inspector.getByRole('button', { name: 'Pick types…' }).click()
  await page.getByRole('option', { name: 'C', exact: true }).click()
  await page.keyboard.press('Escape')
  // The expanded card shows the picker trigger carrying the committed letter.
  await expect(
    inspector.getByTestId('card-treasure').getByRole('button', { name: 'C', exact: true }),
  ).toBeVisible()
  await expect(inspector.getByRole('radio', { name: 'Treasure types' })).toBeChecked()

  // …and a trapped treasure-cache feature.
  await page.mouse.click(treasureCell.x, treasureCell.y, { button: 'right' })
  await page.getByRole('menuitem', { name: 'Add feature' }).click()
  await inspector.getByTestId('feature-feature-1').getByRole('button').first().click()
  await inspector.getByLabel('Kind', { exact: true }).selectOption('treasure_cache')
  await inspector.getByRole('button', { name: 'Trap this cache' }).click()
  await expect(inspector.getByTestId('feature-feature-1')).toContainText('trapped')

  // Set wandering in level properties.
  await page.getByRole('button', { name: 'Level properties' }).click()
  const chance = page.getByLabel('Chance-in-six')
  await chance.fill('2')
  await chance.press('Enter')
  await page.keyboard.press('Escape')

  // Validation clean; the declared warning stands.
  await expect(page.getByTestId('diagnostics-count')).toHaveText('1')

  // Publish symlink-mode, driving through the lint-warnings confirm.
  await page.getByRole('button', { name: 'Publish' }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('osr-web checkout').fill(checkout)
  await expect(dialog.getByLabel('Name', { exact: true })).toHaveValue('mill')
  await dialog.getByRole('button', { name: 'Publish', exact: true }).click()
  const publishAnyway = dialog.getByRole('button', { name: 'Publish anyway' })
  await expect(publishAnyway).toBeVisible()
  await expect(dialog.getByText('secret_only_access')).toBeVisible()
  await publishAnyway.click()
  const published = join(checkout, 'adventures', 'mill')
  await expect(page.getByText(`Published to ${published}`)).toBeVisible()

  // The symlink resolves to the project, and the published document parses
  // with everything the map stocked.
  expect(lstatSync(published).isSymbolicLink()).toBe(true)
  expect(realpathSync(published)).toBe(realpathSync(projectDir))
  const document = JSON.parse(
    readFileSync(join(published, 'adventure.json'), 'utf-8'),
  ) as StampedDocument
  expect(document.kind).toBe('adventure')
  const level = document.payload.dungeons[0].levels[0]
  expect(level.wandering.chance_in_six).toBe(2)
  const guardRoom = level.areas.find((area) => area.id === '1')
  expect(guardRoom?.encounter?.monsters[0]).toMatchObject({
    template_id: 'skeleton',
    count_dice: '2d4',
  })
  const secretRoom = level.areas.find((area) => area.id === '2')
  expect(secretRoom?.treasure).toMatchObject({ letters: ['C'], unguarded: false })
  expect(secretRoom?.features[0]).toMatchObject({ kind: 'treasure_cache' })
  expect(secretRoom?.features[0].trap).toMatchObject({ kind: 'treasure', trigger: 'open' })
})
