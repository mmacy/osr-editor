// The phase 4 milestone loop, end to end against the real CLI and built
// frontend: create a native project; clone a catalog monster from the
// Monsters section; rename it into a shipped-id collision and see the inline
// rejection, then to a free id; edit stats (AC, an attack line, morale); key
// it into an area encounter through the picker (ranked first as bundled);
// validation clean; publish. The milestone's fought half — the bespoke
// monster encountered and fought in osr-web — runs manually against the
// sibling checkout and is recorded in the PR, the established pattern.
import { lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, test, type Page } from '@playwright/test'

import { CELL_SIZE, RESET_MARGIN } from '../../frontend/src/map/view'

interface StampedDocument {
  kind: string
  payload: {
    monsters: {
      id: string
      name: string
      page: string
      ac: number | null
      morale: number | null
      attacks: { attacks: { damage: string | null }[] }[]
      overrides_applied: string[]
    }[]
    dungeons: {
      levels: {
        areas: { id: string; encounter: { monsters: { template_id: string }[] } | null }[]
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

test('clone, rename through a collision, edit, key into an encounter, publish', async ({
  page,
}) => {
  const workspace = mkdtempSync(join(tmpdir(), 'osr-editor-e2e-monsters-'))
  const projectDir = join(workspace, 'moor.osr')
  const checkout = join(workspace, 'osr-web')
  mkdirSync(join(checkout, 'adventures'), { recursive: true })

  await page.goto('/')
  await page.getByRole('button', { name: 'New adventure' }).click()
  await page.getByLabel('Adventure name').fill('The moor watch')
  await page.getByLabel('Destination directory').fill(projectDir)
  await page.getByRole('button', { name: 'Create' }).click()
  await expect(page.getByTestId('revision')).toHaveText('r1')

  // Clone a catalog monster from the Monsters section.
  await page.getByRole('button', { name: 'Monsters', exact: true }).click()
  await expect(page.getByText('No bundled monsters yet', { exact: false })).toBeVisible()
  await page.getByRole('button', { name: 'Clone catalog monster' }).click()
  await page.getByPlaceholder('Search monsters…').fill('orc')
  await page.getByRole('option', { name: /^Orc/ }).first().click()
  await expect(page.getByLabel('Id')).toHaveValue('orc-1')
  await page.getByRole('button', { name: 'Add to the adventure' }).click()
  await expect(page.getByTestId('revision')).toHaveText('r2')
  await expect(page.getByTestId('monster-detail-orc-1')).toBeVisible()

  // Rename into a shipped-id collision — the inline rejection, then a free id.
  const idField = page.getByLabel('Id')
  await idField.fill('skeleton')
  await idField.press('Enter')
  await expect(page.getByText(/collides with the shipped catalog/)).toBeVisible()
  await expect(page.getByTestId('revision')).toHaveText('r2')
  await idField.fill('moor-orc')
  await idField.press('Enter')
  await expect(page.getByTestId('revision')).toHaveText('r3')
  await expect(page.getByTestId('monster-detail-moor-orc')).toBeVisible()

  // Edit stats: AC, an attack line's damage, morale.
  const ac = page.getByLabel('AC', { exact: true })
  await ac.fill('4')
  await ac.press('Enter')
  await expect(page.getByTestId('revision')).toHaveText('r4')
  const damage = page.getByLabel('Attack damage').first()
  await damage.fill('1d8')
  await damage.press('Enter')
  await expect(page.getByTestId('revision')).toHaveText('r5')
  const morale = page.getByLabel('Morale', { exact: true })
  await morale.fill('9')
  await morale.press('Enter')
  await expect(page.getByTestId('revision')).toHaveText('r6')

  // Draw a room over the entrance and key the bespoke monster into its
  // encounter through the picker — ranked first as bundled.
  await page.getByRole('button', { name: 'Level 1' }).click()
  await expect(page.getByTestId('map-canvas')).toBeVisible()
  await page.getByRole('button', { name: 'Reset zoom' }).click()
  await page.getByRole('button', { name: 'Room tool' }).click()
  const from = await cellCenter(page, 0, 0)
  const to = await cellCenter(page, 1, 1)
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move(to.x, to.y, { steps: 8 })
  await page.mouse.up()
  await expect(page.getByTestId('revision')).toHaveText('r7')

  const guardCell = await cellCenter(page, 1, 1)
  await page.mouse.click(guardCell.x, guardCell.y, { button: 'right' })
  await page.getByRole('menuitem', { name: 'Add encounter' }).click()
  const inspector = page.getByLabel('Inspector')
  await inspector.getByRole('button', { name: 'Add monster' }).click()
  const first = page.getByRole('listbox').getByRole('option').first()
  await expect(first).toContainText('Orc')
  await expect(first).toContainText('bundled')
  // The create shortcut is present where stocking happens.
  await expect(page.getByRole('button', { name: 'Create monster…' })).toBeVisible()
  await first.click()
  await expect(inspector.getByLabel('Monster lines')).toContainText('Orc')

  // Validation clean — the bundled template satisfies the reference the
  // moment it lands.
  await expect(page.getByTestId('diagnostics-count')).toHaveText('0')

  // Publish symlink-mode; the bundle rides into osr-web's discovery.
  await page.getByRole('button', { name: 'Publish' }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('osr-web checkout').fill(checkout)
  await dialog.getByRole('button', { name: 'Publish', exact: true }).click()
  const published = join(checkout, 'adventures', 'moor')
  await expect(page.getByText(`Published to ${published}`)).toBeVisible()

  expect(lstatSync(published).isSymbolicLink()).toBe(true)
  expect(realpathSync(published)).toBe(realpathSync(projectDir))
  const document = JSON.parse(
    readFileSync(join(published, 'adventure.json'), 'utf-8'),
  ) as StampedDocument
  expect(document.kind).toBe('adventure')
  const bundled = document.payload.monsters[0]
  expect(bundled).toMatchObject({ id: 'moor-orc', ac: 4, morale: 9, page: '', overrides_applied: [] })
  expect(bundled.attacks[0].attacks[0].damage).toBe('1d8')
  const area = document.payload.dungeons[0].levels[0].areas[0]
  expect(area.encounter?.monsters[0].template_id).toBe('moor-orc')
})
