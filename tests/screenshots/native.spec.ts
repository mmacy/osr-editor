// The native-project shots: the map editor, the stocking surfaces, the project
// chrome, and the dialogs that cross the project boundary.
//
// One scripted project carries almost all of them. It is authored rather than
// loaded from a fixture, because the first image a reader sees must be a level
// with something in it — geometry, stocked areas, key glyphs — and no committed
// fixture is shaped for a screenshot.
//
// Every dialog that renders a filesystem path is captured in its empty state, and
// the one import fixture that must show its path is copied under the capture
// server's own HOME first, so no committed image carries a real path.
import { copyFileSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'

import { expect, test, type Page, type TestInfo } from '@playwright/test'

import { cellCenter, createProject, drag, openMap } from '../e2e/helpers'
import { repoRoot, shoot } from './capture'
import { SHOTS_HOME } from './paths'

// Each theme project gets its own project directories. The backend caches an open
// project by path, so the two runs sharing one directory would have the second
// reopen the first's document — at its revision, with its edits already applied.
function adventureDir(testInfo: TestInfo, name: string): string {
  return join(SHOTS_HOME, testInfo.project.name, 'adventures', name)
}

// A clean slate for a capture, then the suite's own create gesture. The prologue
// is all this adds — the create flow itself stays in one place.
async function freshProject(page: Page, projectDir: string, name: string): Promise<void> {
  rmSync(projectDir, { recursive: true, force: true })
  mkdirSync(join(projectDir, '..'), { recursive: true })
  await createProject(page, projectDir, name)
}

test('the project chrome, the map editor, and the stocking surfaces', async ({ page }, testInfo) => {
  test.setTimeout(120_000)
  const projectDir = adventureDir(testInfo, 'the-mill-on-the-moor.osr')

  // The new-adventure dialog, captured empty: its destination field would
  // otherwise carry this machine's path into the quickstart.
  await page.goto('/')
  await page.getByRole('button', { name: 'New adventure' }).click()
  const createDialog = page.getByRole('dialog')
  await expect(createDialog.getByLabel('Adventure name')).toBeVisible()
  await expect(createDialog.getByLabel('Destination directory')).toHaveValue('')
  await shoot(createDialog, 'new-adventure-dialog', testInfo)
  await page.keyboard.press('Escape')

  await freshProject(page, projectDir, 'The mill on the moor')

  // The project chrome: the sections beside the working document, the revision
  // token, undo and redo — the projects guide's actual subject.
  await expect(page.getByRole('navigation', { name: 'Sections' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Adventure', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Town' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Monsters', exact: true })).toBeVisible()
  await shoot(page, 'project-chrome', testInfo)

  await openMap(page)
  await expect(page.getByTestId('diagnostics-count')).toHaveText('0')

  // The room tool's first rectangle — the quickstart's "one gesture makes a room".
  await page.getByRole('button', { name: 'Room tool' }).click()
  await drag(page, await cellCenter(page, 0, 0), await cellCenter(page, 2, 2))
  // The revision, not the diagnostics count: the count reads 0 before and after the
  // drag, so only the commit proves a room actually landed.
  await expect(page.getByTestId('revision')).toHaveText('r2')
  await page.getByRole('button', { name: 'Select tool' }).click()
  await shoot(page.getByTestId('map-editor'), 'first-room', testInfo)

  // The tool palette. With `asChild`, the tooltip trigger *is* the button, so the
  // button's parent element is the toolbar row itself.
  const toolbar = page.getByRole('button', { name: 'Room tool' }).locator('xpath=..')
  await expect(toolbar.getByRole('button', { name: 'Select tool' })).toBeVisible()
  await expect(toolbar.getByRole('button', { name: 'Transition tool' })).toBeVisible()
  await shoot(toolbar, 'map-toolbar', testInfo)

  // The level and dungeon chrome sits in the row above the tools.
  const levelChrome = page.getByRole('button', { name: 'Add level' }).locator('xpath=..')
  await expect(levelChrome.getByRole('button', { name: 'Level 1', exact: true })).toBeVisible()
  await expect(levelChrome.getByRole('button', { name: 'Level properties' })).toBeVisible()
  await shoot(levelChrome, 'level-chrome', testInfo)

  // A second room, joined by a corridor, so the level has somewhere to go.
  await page.getByRole('button', { name: 'Room tool' }).click()
  await drag(page, await cellCenter(page, 5, 0), await cellCenter(page, 7, 2))
  await page.getByRole('button', { name: 'Corridor tool' }).click()
  await drag(page, await cellCenter(page, 2, 1), await cellCenter(page, 5, 1))
  await page.getByRole('button', { name: 'Select tool' }).click()
  await expect(page.getByTestId('diagnostics-count')).toHaveText('0')

  // The stocking context menu, on a blank room.
  const guardCell = await cellCenter(page, 1, 1)
  await page.mouse.click(guardCell.x, guardCell.y, { button: 'right' })
  const menu = page.getByRole('menu')
  await expect(menu.getByRole('menuitem', { name: 'Add encounter' })).toBeVisible()
  await expect(menu.getByRole('menuitem', { name: 'Add treasure' })).toBeVisible()
  await shoot(menu, 'stocking-context-menu', testInfo)

  // Stock it: an encounter, then treasure and a trap on the same area, so the
  // content cards shot shows the full vocabulary rather than one lonely card.
  const inspector = page.getByLabel('Inspector')
  await menu.getByRole('menuitem', { name: 'Add encounter' }).click()
  await inspector.getByRole('button', { name: 'Add monster' }).click()
  await page.getByLabel('Count', { exact: true }).fill('2d4')
  await page.getByPlaceholder('Search monsters…').fill('skeleton')
  await page
    .getByRole('option', { name: /Skeleton/ })
    .first()
    .click()
  await expect(inspector.getByLabel('Monster lines')).toContainText('Skeleton')

  await page.mouse.click(guardCell.x, guardCell.y, { button: 'right' })
  await page.getByRole('menuitem', { name: 'Add treasure' }).click()
  await inspector.getByRole('button', { name: 'Pick types…' }).click()
  await page.getByRole('option', { name: 'C', exact: true }).click()
  await page.keyboard.press('Escape')
  await expect(
    inspector.getByTestId('card-treasure').getByRole('button', { name: 'C', exact: true }),
  ).toBeVisible()
  // Scroll back to the top: committing the cards leaves the inspector at its
  // bottom, which would put the encounter's monster line — the thing the caption
  // is about — above the frame.
  await inspector.getByLabel('Monster lines').scrollIntoViewIfNeeded()
  await expect(inspector.getByLabel('Monster lines')).toContainText('Skeleton')
  await shoot(inspector, 'area-content-cards', testInfo)

  // The map's own reading: a stocked key number beside a hollow one, with the
  // unstocked filter dimming what is done.
  await page.getByRole('button', { name: 'Unstocked filter' }).click()
  await expect(page.getByRole('button', { name: 'Unstocked filter' })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await shoot(page.getByTestId('map-canvas'), 'map-key-glyphs', testInfo)
  await page.getByRole('button', { name: 'Unstocked filter' }).click()

  // The wandering table lives in level properties.
  await page.getByRole('button', { name: 'Level properties' }).click()
  const properties = page.getByRole('dialog')
  await expect(properties.getByLabel('Chance-in-six')).toBeVisible()
  // Seed the editable copy: without it the dialog shows only the chance and the
  // interval, and the shot would carry a caption promising a table it does not show.
  await properties.getByRole('button', { name: 'Override the compiled table' }).click()
  await expect(properties.getByLabel('Custom wandering table')).toBeVisible()
  await shoot(properties, 'wandering-table', testInfo)
  await page.keyboard.press('Escape')

  // A third room and a second stocked area, so the hero is a level with a module on
  // it rather than one keyed room in a field of empty grid.
  await page.getByRole('button', { name: 'Room tool' }).click()
  await drag(page, await cellCenter(page, 5, 4), await cellCenter(page, 7, 6))
  await page.getByRole('button', { name: 'Corridor tool' }).click()
  await drag(page, await cellCenter(page, 6, 2), await cellCenter(page, 6, 4))
  await page.getByRole('button', { name: 'Entrance tool' }).click()
  await page.mouse.click((await cellCenter(page, 0, 0)).x, (await cellCenter(page, 0, 0)).y)
  await page.getByRole('button', { name: 'Select tool' }).click()

  const vaultCell = await cellCenter(page, 6, 5)
  await page.mouse.click(vaultCell.x, vaultCell.y, { button: 'right' })
  await page.getByRole('menuitem', { name: 'Add treasure' }).click()
  await inspector.getByRole('button', { name: 'Pick types…' }).click()
  await page.getByRole('option', { name: 'A', exact: true }).click()
  await page.keyboard.press('Escape')

  // The hero: the whole editor over a level with content in it. The dialog must be
  // gone and the map back before the shutter — otherwise the first image a reader
  // sees could be of a half-dismissed dialog.
  await expect(page.getByRole('dialog')).toBeHidden()
  await expect(page.getByTestId('map-canvas')).toBeVisible()
  await shoot(page, 'map-editor-hero', testInfo)
})

test('the live lint and the diagnostics panel', async ({ page }, testInfo) => {
  test.setTimeout(120_000)
  const projectDir = adventureDir(testInfo, 'lint-demo.osr')

  await freshProject(page, projectDir, 'The sunken vault')
  await openMap(page)

  // Two rooms with no path between them: the far one is unreachable, which the
  // lint marks on the canvas and lists in the panel.
  await page.getByRole('button', { name: 'Room tool' }).click()
  await drag(page, await cellCenter(page, 0, 0), await cellCenter(page, 1, 1))
  await drag(page, await cellCenter(page, 4, 0), await cellCenter(page, 5, 1))
  await page.getByRole('button', { name: 'Select tool' }).click()
  await expect(page.getByTestId('diagnostics-count')).toHaveText('1')
  await expect(page.getByText('area_unreachable')).toBeVisible()

  await shoot(page, 'map-lint-markers', testInfo)
  await shoot(page.getByRole('region', { name: 'Diagnostics' }), 'diagnostics-panel', testInfo)
})

test('the monster editor', async ({ page }, testInfo) => {
  test.setTimeout(120_000)
  const projectDir = adventureDir(testInfo, 'monster-demo.osr')

  await freshProject(page, projectDir, 'The moor barrows')
  await page.getByRole('button', { name: 'Monsters', exact: true }).click()

  // Clone a catalog monster so the bundle has a template with a real stat block —
  // "like an orc, but…", the guide's own framing.
  await page.getByRole('button', { name: 'Monsters', exact: true }).click()
  await page.getByRole('button', { name: 'Clone catalog monster' }).click()
  await page.getByPlaceholder('Search monsters…').fill('orc')
  await page
    .getByRole('option', { name: /^Orc/ })
    .first()
    .click()
  await page.getByRole('button', { name: 'Add to the adventure' }).click()
  await expect(page.getByTestId('monster-detail-orc-1')).toBeVisible()

  const idField = page.getByLabel('Id')
  await idField.fill('moor-orc')
  await idField.press('Enter')
  await expect(page.getByTestId('monster-detail-moor-orc')).toBeVisible()

  // The section: the bundled list beside the detail editor.
  const monsters = page.getByRole('region', { name: 'Monsters' })
  await expect(monsters.getByRole('list', { name: 'Bundled monsters' })).toBeVisible()
  await shoot(monsters, 'monsters-section', testInfo)

  // The detail editor alone: the always-saved stat block.
  await shoot(page.getByTestId('monster-detail-moor-orc'), 'monster-detail', testInfo)
})

test('import, export, and publish', async ({ page }, testInfo) => {
  test.setTimeout(120_000)
  const root = repoRoot(testInfo)
  const projectDir = adventureDir(testInfo, 'coppergrave.osr')

  // The One Page Dungeon export is copied under the capture server's HOME before
  // the import dialog is captured: the source-path field and the notes list are in
  // the same dialog, so a shot of the notes necessarily has the path in frame.
  const exportsDir = join(SHOTS_HOME, 'exports')
  mkdirSync(exportsDir, { recursive: true })
  const opdSource = join(root, 'tests', 'assets', 'opd', 'torture.json')
  copyFileSync(opdSource, join(exportsDir, 'coppergrave.json'))

  await freshProject(page, projectDir, 'Coppergrave')
  await openMap(page)

  // The import dialog is the tallest surface in the editor — its notes list is the
  // point of the shot — so the viewport grows to fit it rather than clipping it.
  await page.setViewportSize({ width: 1500, height: 1250 })
  await page.getByRole('button', { name: 'Import geometry' }).click()
  const importDialog = page.getByRole('dialog')
  await importDialog.getByLabel('Source path').fill(join(exportsDir, 'coppergrave.json'))
  await importDialog.getByRole('button', { name: 'Sniff' }).click()
  await importDialog.getByRole('button', { name: 'Load' }).click()
  // The notes are the point: every judgment call the reader is being told about.
  await expect(importDialog.getByLabel('Importer notes')).toBeVisible()
  await shoot(importDialog, 'import-dialog', testInfo)
  await page.keyboard.press('Escape')
  await page.setViewportSize({ width: 1280, height: 800 })

  // Export and publish, both captured before their path fields are filled.
  await page.getByRole('button', { name: 'Export' }).click()
  const exportDialog = page.getByRole('dialog')
  await expect(exportDialog.getByRole('button', { name: 'Export' })).toBeVisible()
  await expect(exportDialog.getByLabel('Destination file')).toHaveValue('')
  await shoot(exportDialog, 'export-dialog', testInfo)
  await page.keyboard.press('Escape')

  await page.getByRole('button', { name: 'Publish' }).click()
  const publishDialog = page.getByRole('dialog')
  await expect(publishDialog.getByLabel('osr-web checkout')).toHaveValue('')
  await shoot(publishDialog, 'publish-dialog', testInfo)
})
