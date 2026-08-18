// The phase 15 milestone loop, deterministic half, end to end against the
// real CLI and built frontend: create a native project; author the key as a
// bundled item (clone a catalog gear item, rename through a shipped-id
// collision to a free id); cache it in room 1; gate a door on carrying it
// with authored refusal and success text; gate a transition on a toll that
// consumes a shipped torch (the reciprocal stairs born ungated); set level
// guidance; validation clean; publish. The milestone's played half — the
// door refusing in osr-web until the key is found, the toll consumed at the
// threshold — runs manually against the sibling checkout and is recorded in
// the PR, the established pattern.
import { lstatSync, mkdirSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, test } from '@playwright/test'

import { cellCenter, createProject, drawRoom, edgePoint, openMap } from './helpers'

interface Gate {
  condition: { condition_type: string; item_id?: string; consumes?: boolean }
  narrative: { refusal: string; success: string } | null
}

interface StampedDocument {
  kind: string
  payload: {
    items: { item_type: string; id: string; name: string; overrides_applied: string[] }[]
    dungeons: {
      levels: {
        number: number
        guidance: string
        edges: Record<string, { kind: string; door: { requires: Gate | null } | null }>
        transitions: { kind: string; requires: Gate | null }[]
        areas: { features: { kind: string; item_ids: string[] }[] }[]
      }[]
    }[]
  }
}

test('the key, the cache, the gated door, the consuming toll, guidance, publish', async ({
  page,
}) => {
  test.setTimeout(120_000)
  const workspace = mkdtempSync(join(tmpdir(), 'osr-editor-e2e-items-'))
  const projectDir = join(workspace, 'mill.osr')
  const checkout = join(workspace, 'osr-web')
  mkdirSync(join(checkout, 'adventures'), { recursive: true })

  await createProject(page, projectDir, 'The mill key')

  // Author the key: clone a catalog gear item from the Items section.
  await page.getByRole('button', { name: 'Items', exact: true }).click()
  await expect(page.getByText('No bundled items yet', { exact: false })).toBeVisible()
  await page.getByRole('button', { name: 'Clone catalog item' }).click()
  await page.getByPlaceholder('Search items…').fill('torch')
  await page
    .getByRole('option', { name: /^Torch/ })
    .first()
    .click()
  await expect(page.getByLabel('Id')).toHaveValue('torch-1')
  await page.getByLabel('Name').fill('Brass key')
  await page.getByRole('button', { name: 'Add to the adventure' }).click()
  await expect(page.getByTestId('revision')).toHaveText('r2')
  await expect(page.getByTestId('item-detail-torch-1')).toBeVisible()

  // Rename into a shipped-id collision — the inline rejection — then free.
  const idField = page.getByLabel('Id')
  await idField.fill('torch')
  await idField.press('Enter')
  await expect(page.getByText(/collides with the shipped catalog/)).toBeVisible()
  await expect(page.getByTestId('revision')).toHaveText('r2')
  await idField.fill('brass-key')
  await idField.press('Enter')
  await expect(page.getByTestId('revision')).toHaveText('r3')
  await expect(page.getByTestId('item-detail-brass-key')).toBeVisible()

  // Room 1, with the key cached in its strongbox: the cache picker offers the
  // bundled key first, under "This adventure".
  await openMap(page)
  await drawRoom(page, [0, 0], [1, 1])
  await expect(page.getByTestId('revision')).toHaveText('r4')
  const cacheCell = await cellCenter(page, 1, 1)
  await page.mouse.click(cacheCell.x, cacheCell.y, { button: 'right' })
  await page.getByRole('menuitem', { name: 'Add feature' }).click()
  const inspector = page.getByLabel('Inspector')
  await inspector.getByTestId('feature-feature-1').getByRole('button').first().click()
  await inspector.getByLabel('Kind', { exact: true }).selectOption({ label: 'Treasure cache' })
  await inspector.getByRole('button', { name: 'Add item' }).click()
  const bundledOption = page.getByRole('option', { name: /Brass key/ })
  await expect(bundledOption).toContainText('bundled')
  await bundledOption.click()
  await expect(inspector.getByLabel('Cache items')).toContainText('Brass key')

  // The gated door: cut a door on the room's east wall and hang the gate on
  // it, refusal and success authored.
  await page.getByRole('button', { name: 'Wall and door tool' }).click()
  const doorway = await edgePoint(page, [1, 0], [2, 0])
  await page.mouse.click(doorway.x, doorway.y)
  await page.mouse.click(doorway.x, doorway.y)
  await page.getByRole('button', { name: 'Select tool' }).click()
  await page.mouse.click(doorway.x, doorway.y)
  await expect(inspector.getByLabel('Kind', { exact: true })).toHaveValue('door')
  await inspector.getByRole('button', { name: 'Add gate' }).click()
  await inspector.getByRole('button', { name: 'Pick item' }).click()
  await page
    .getByRole('option', { name: /Brass key/ })
    .first()
    .click()
  await expect(inspector.getByTestId('condition-item')).toContainText('brass-key')
  const refusal = inspector.getByLabel('Refusal')
  await refusal.fill('The lock refuses.')
  await refusal.press('Tab')
  const success = inspector.getByLabel('Success')
  await success.fill('The key turns.')
  await success.press('Tab')
  await expect(inspector.getByLabel('Refusal')).toHaveValue('The lock refuses.')

  // A second level for the stairs, then the consuming toll on the way down —
  // hung on a *shipped* torch, so the gate picker's other half is exercised.
  await page.getByRole('button', { name: 'Add level' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Add level' }).click()
  await page.getByTestId('map-editor').getByRole('button', { name: 'Level 1' }).click()
  await page.getByRole('button', { name: 'Reset zoom' }).click()
  await page.getByRole('button', { name: 'Transition tool' }).click()
  const stairs = await cellCenter(page, 0, 1)
  await page.mouse.click(stairs.x, stairs.y)
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByRole('heading', { name: 'Add transition' })).toBeVisible()
  const picker = await page.getByTestId('mini-level-picker').boundingBox()
  if (!picker) throw new Error('the mini level picker has no bounding box')
  const pickerCell = picker.width / 30
  await page.mouse.click(picker.x + pickerCell * 0.5, picker.y + pickerCell * 0.5)
  await dialog.getByRole('button', { name: 'Add gate' }).click()
  await dialog.getByRole('button', { name: 'Pick item' }).click()
  await page.getByPlaceholder('Search items…').fill('torch')
  await page
    .getByRole('option', { name: /^Torch/ })
    .first()
    .click()
  await dialog.getByRole('checkbox', { name: 'Consumes the item' }).click()
  await dialog.getByRole('button', { name: 'Add transition' }).click()

  // Level guidance — ambient narrator steering on the level form.
  await page.getByRole('button', { name: 'Level properties' }).click()
  const guidance = page.getByLabel('Guidance')
  await guidance.fill('Keep the miller a rumour up here.')
  await guidance.press('Tab')
  await page.keyboard.press('Escape')

  // Validation clean; publish symlink-mode.
  await expect(page.getByTestId('diagnostics-count')).toHaveText('0')
  await page.getByRole('button', { name: 'Publish' }).click()
  const publishDialog = page.getByRole('dialog')
  await publishDialog.getByLabel('osr-web checkout').fill(checkout)
  await publishDialog.getByRole('button', { name: 'Publish', exact: true }).click()
  const published = join(checkout, 'adventures', 'mill')
  await expect(page.getByText(`Published to ${published}`)).toBeVisible()
  expect(lstatSync(published).isSymbolicLink()).toBe(true)

  const document = JSON.parse(
    readFileSync(join(published, 'adventure.json'), 'utf-8'),
  ) as StampedDocument
  expect(document.kind).toBe('adventure')
  expect(document.payload.items).toEqual([
    expect.objectContaining({
      item_type: 'gear',
      id: 'brass-key',
      name: 'Brass key',
      overrides_applied: [],
    }),
  ])
  const levelOne = document.payload.dungeons[0].levels[0]
  expect(levelOne.guidance).toBe('Keep the miller a rumour up here.')
  expect(levelOne.areas[0].features[0]).toMatchObject({
    kind: 'treasure_cache',
    item_ids: ['brass-key'],
  })
  const gatedDoor = levelOne.edges['2,0:west']
  expect(gatedDoor.kind).toBe('door')
  expect(gatedDoor.door?.requires).toMatchObject({
    condition: { condition_type: 'has_item', item_id: 'brass-key', consumes: false },
    narrative: expect.objectContaining({
      refusal: 'The lock refuses.',
      success: 'The key turns.',
    }),
  })
  expect(levelOne.transitions[0].requires).toMatchObject({
    condition: { condition_type: 'has_item', item_id: 'torch', consumes: true },
  })
  // The auto-reciprocal stairs are born ungated — a gate guards one
  // threshold's attempt.
  const levelTwo = document.payload.dungeons[0].levels[1]
  expect(levelTwo.transitions[0].kind).toBe('stairs_up')
  expect(levelTwo.transitions[0].requires).toBeNull()
})
