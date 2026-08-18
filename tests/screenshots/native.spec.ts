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
import { copyFileSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { expect, test, type Page, type TestInfo } from '@playwright/test'

import { cellCenter, createProject, drag, edgePoint, openMap } from '../e2e/helpers'
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

test('the path picker', async ({ page }, testInfo) => {
  // A staged directory of its own, under the capture server's HOME: the shot's
  // whole subject is a listing, and every name in it has to be one this
  // repository chose. The two project shapes are here because the badges that
  // tell them apart are what the picker adds over typing a path.
  const browsable = join(SHOTS_HOME, testInfo.project.name, 'modules')
  rmSync(browsable, { recursive: true, force: true })
  for (const name of ['sketches', 'the-mill-on-the-moor.osr', 'the-keep.forge']) {
    mkdirSync(join(browsable, name), { recursive: true })
  }
  writeFileSync(join(browsable, 'the-mill-on-the-moor.osr', 'adventure.json'), '{}', 'utf-8')
  writeFileSync(join(browsable, 'the-keep.forge', 'run.json'), '{}', 'utf-8')

  await page.goto('/')
  await page.getByRole('button', { name: 'Open project' }).click()
  const openDialog = page.getByRole('dialog', { name: 'Open project' })
  // Seeded in the tilde form the picker itself hands back, so the shot shows the
  // path both ways a reader can write one.
  await openDialog.getByLabel('Project directory').fill(`~/${testInfo.project.name}/modules`)
  await openDialog.getByRole('button', { name: 'Browse' }).click()

  const picker = page.getByRole('dialog', { name: 'Choose a project directory' })
  // The location renders home-shortened, which under the capture server's
  // redirected HOME is also why this shot carries no machine path at all.
  await expect(picker.getByTestId('picker-location')).toHaveText(
    `~/${testInfo.project.name}/modules`,
  )
  await expect(picker.getByRole('button', { name: 'the-mill-on-the-moor.osr native' })).toBeVisible()
  await expect(picker.getByRole('button', { name: 'the-keep.forge forge' })).toBeVisible()
  await shoot(picker, 'path-picker', testInfo)
})

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
  await expect(page.getByRole('button', { name: 'Quests', exact: true })).toBeVisible()
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
  // The view controls share the row and the caption names them, so the shot
  // asserts on them too — a rename or a removal must fail here.
  await expect(toolbar.getByRole('button', { name: 'Reset zoom' })).toBeVisible()
  await expect(toolbar.getByRole('button', { name: 'Fit level' })).toBeVisible()
  await shoot(toolbar, 'map-toolbar', testInfo)

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
  await expect(menu.getByRole('menuitem', { name: 'Add trigger' })).toBeVisible()
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
  // Collapse the encounter card to its module-notation summary so both cards fit
  // the inspector's height. Expanded, it alone fills the frame and the treasure
  // card sits below the fold — which `toBeVisible()` does not catch, since it only
  // requires a non-empty box, not presence in the scroll viewport.
  const encounterCard = inspector.getByTestId('card-encounter')
  await encounterCard.getByRole('button', { expanded: true }).first().click()
  await encounterCard.scrollIntoViewIfNeeded()
  await expect(encounterCard).toContainText('Skeleton')

  // Assert both cards are genuinely in frame, which is the check that would have
  // caught the first version of this shot.
  const frame = await inspector.boundingBox()
  for (const card of [encounterCard, inspector.getByTestId('card-treasure')]) {
    const box = await card.boundingBox()
    if (!frame || !box || box.y < frame.y || box.y + box.height > frame.y + frame.height) {
      throw new Error('a content card the caption names is outside the captured frame')
    }
  }
  await shoot(inspector, 'area-content-cards', testInfo)

  // The hover card: rest the pointer on the stocked room and its contents
  // raise beside it — no click needed. The pointer then parks on the toolbar
  // so the card is down again before the next shot frames the canvas.
  await page.mouse.move(guardCell.x, guardCell.y)
  const hoverCard = page.getByTestId('area-hover-card')
  await expect(hoverCard).toBeVisible()
  await expect(hoverCard).toContainText('Skeleton')
  await shoot(page.getByTestId('map-canvas'), 'area-hover-card', testInfo)
  await page.getByRole('button', { name: 'Unstocked filter' }).hover()
  await expect(hoverCard).toBeHidden()

  // A trigger on the stocked room, so the key-glyphs shot shows the grown
  // glyph vocabulary — the add gesture lands in the Quests panel, so the map
  // is reopened before the shutter. The nav-scoped locator matters: the
  // trigger row's own summary contains "level 1", so a bare Level 1 lookup
  // would be ambiguous.
  await page.mouse.click(guardCell.x, guardCell.y, { button: 'right' })
  await page.getByRole('menuitem', { name: 'Add trigger' }).click()
  await expect(page.getByTestId('trigger-detail-trigger-1')).toBeVisible()
  await page
    .getByRole('navigation', { name: 'Sections' })
    .getByRole('button', { name: 'Level 1' })
    .click()
  await expect(page.getByTestId('map-canvas')).toBeVisible()
  await page.getByRole('button', { name: 'Reset zoom' }).click()

  // The map's own reading: a stocked key number beside a hollow one, with the
  // unstocked filter dimming what is done.
  await page.getByRole('button', { name: 'Unstocked filter' }).click()
  await expect(page.getByRole('button', { name: 'Unstocked filter' })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await shoot(page.getByTestId('map-canvas'), 'map-key-glyphs', testInfo)
  await page.getByRole('button', { name: 'Unstocked filter' }).click()

  // The level and dungeon chrome sits in the row above the tools. Captured
  // here rather than beside the toolbar because both destructive controls
  // qualify themselves: remove level disables on a dungeon's last level and
  // clear content on a level carrying none, so the earlier one-blank-level
  // state would publish a row of greyed-out buttons under a caption naming
  // them. A second level and a stocked one make the row say what it does.
  const mapEditor = page.getByTestId('map-editor')
  await page.getByRole('button', { name: 'Add level' }).click()
  await expect(page.getByLabel('Level number')).toHaveValue('2')
  await page.getByRole('dialog').getByRole('button', { name: 'Add level' }).click()
  await expect(mapEditor.getByRole('button', { name: 'Level 2' })).toBeVisible()
  await mapEditor.getByRole('button', { name: 'Level 1', exact: true }).click()

  const levelChrome = page.getByRole('button', { name: 'Add level' }).locator('xpath=..')
  await expect(levelChrome.getByRole('button', { name: 'Level properties' })).toBeVisible()
  await expect(levelChrome.getByRole('button', { name: 'Remove level' })).toBeEnabled()
  await expect(levelChrome.getByRole('button', { name: /^Clear content/ })).toBeEnabled()
  await shoot(levelChrome, 'level-chrome', testInfo)

  // Put the scripted project back to one level: the hero shot below is of this
  // same project, and a stray blank level 2 would ride into it.
  page.on('dialog', (confirm) => void confirm.accept())
  await mapEditor.getByRole('button', { name: 'Level 2' }).click()
  await page.getByRole('button', { name: 'Remove level' }).click()
  await expect(mapEditor.getByRole('button', { name: 'Level 2' })).toBeHidden()
  // Cell coordinates are meaningless until the view is pinned again, and the
  // level round trip left it wherever the fit landed.
  await page.getByRole('button', { name: 'Reset zoom' }).click()

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
  // Deliberately left at reset zoom. Zooming in was tried and is worse: `zoomAt`
  // scales about the viewport centre, not the geometry, so two steps pushed the
  // module off the top-left corner and left one room in frame. Issue 26 added a
  // **Fit level** control since, and it was tried here too — but it fits the
  // level, not the drawn geometry, so on a small module in the corner of a 30x30
  // grid it only scales the rooms down to make room for more empty paper. Reset
  // zoom, which frames the northwest corner at 100%, is still the better shot.
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

test('the quests section and the trigger surfaces', async ({ page }, testInfo) => {
  test.setTimeout(120_000)
  const projectDir = adventureDir(testInfo, 'trigger-demo.osr')

  await freshProject(page, projectDir, 'The wheel room')

  // A room drawn around the view centre — the gate-badges arrangement, so the
  // glyph shot can magnify the lightning bolt without a pan gesture.
  await openMap(page)
  await page.getByRole('button', { name: 'Room tool' }).click()
  await drag(page, await cellCenter(page, 10, 6), await cellCenter(page, 13, 8))
  // The entrance sits in the far corner so its triangle never crowds the key
  // number the glyph shot is about.
  await page.getByRole('button', { name: 'Entrance tool' }).click()
  const entranceCell = await cellCenter(page, 13, 8)
  await page.mouse.click(entranceCell.x, entranceCell.y)
  await page.getByRole('button', { name: 'Select tool' }).click()

  // Stock the room so the glyph row has company: an encounter beside the bolt.
  const leverCell = await cellCenter(page, 11, 7)
  await page.mouse.click(leverCell.x, leverCell.y, { button: 'right' })
  await page.getByRole('menuitem', { name: 'Add encounter' }).click()
  const inspector = page.getByLabel('Inspector')
  await inspector.getByRole('button', { name: 'Add monster' }).click()
  await page.getByPlaceholder('Search monsters…').fill('orc')
  await page
    .getByRole('option', { name: /^Orc/ })
    .first()
    .click()
  await expect(inspector.getByLabel('Monster lines')).toContainText('Orc')

  // The trigger, from the area context menu — the one-gesture placement that
  // lands in the Quests panel with the pattern already bound.
  await page.mouse.click(leverCell.x, leverCell.y, { button: 'right' })
  await page.getByRole('menuitem', { name: 'Add trigger' }).click()
  await expect(page.getByTestId('trigger-detail-trigger-1')).toBeVisible()

  // Complete it: a condition, the flag-writing consequence, and both voices —
  // the builders the detail shot is a picture of. The condition is a carried
  // shipped item, so the shot's document stays lint-clean.
  await page.getByRole('button', { name: 'Add condition' }).click()
  await page.getByRole('button', { name: 'Pick item' }).click()
  await page.getByPlaceholder('Search items…').fill('torch')
  await page
    .getByRole('option', { name: /^Torch/ })
    .first()
    .click()
  await expect(page.getByTestId('condition-item')).toContainText('torch')
  await page.getByRole('button', { name: 'Add consequence' }).click()
  await expect(page.getByLabel('Command')).toHaveValue('set_flag')
  const consequenceKey = page.getByLabel('Flag key')
  await consequenceKey.fill('wheel.lever')
  await consequenceKey.press('Tab')
  const fired = page.getByLabel('Fired')
  await fired.fill('The counterweight drops; iron rises somewhere east.')
  await fired.press('Tab')
  const journal = page.getByLabel('Journal')
  await journal.fill('A worn lever moved under our hands, and a portcullis answered.')
  await journal.press('Tab')
  await expect(journal).toHaveValue(
    'A worn lever moved under our hands, and a portcullis answered.',
  )

  // A second trigger, so the list reads as the ordered surface it is.
  await page.getByRole('button', { name: 'New trigger' }).click()
  const createDialog = page.getByRole('dialog')
  await createDialog.getByLabel('Fires').selectOption('town_entered')
  await createDialog.getByRole('button', { name: 'Create' }).click()
  await expect(page.getByTestId('trigger-detail-trigger-2')).toBeVisible()

  // The section list: the numbered rows in firing order. The list pane alone
  // is the subject — the whole section's box is its scroll extent, which
  // stitches the diagnostics bar into the frame.
  await page.getByTestId('trigger-row-trigger-1').getByRole('button').first().click()
  await expect(page.getByTestId('trigger-detail-trigger-1')).toBeVisible()
  await expect(page.getByTestId('diagnostics-count')).toHaveText('0')
  await shoot(page.getByTestId('quests-triggers-pane'), 'quests-triggers', testInfo)

  // The detail editor alone, tall enough to hold the three builders in frame.
  await page.setViewportSize({ width: 1280, height: 1700 })
  await shoot(page.getByTestId('trigger-detail-trigger-1'), 'trigger-detail', testInfo)
  await page.setViewportSize({ width: 1280, height: 800 })

  // The glyph: back on the map (the nav-scoped locator, because the trigger
  // row's summary contains "level 1"), zoomed about the centre the room was
  // drawn around, the selection parked off-frame so nothing renders highlighted.
  await page
    .getByRole('navigation', { name: 'Sections' })
    .getByRole('button', { name: 'Level 1' })
    .click()
  await expect(page.getByTestId('map-canvas')).toBeVisible()
  await page.getByRole('button', { name: 'Reset zoom' }).click()
  const parkCell = await cellCenter(page, 27, 14)
  await page.mouse.click(parkCell.x, parkCell.y)
  await page.getByRole('button', { name: 'Reset zoom' }).click()
  for (let step = 0; step < 4; step += 1) {
    await page.getByRole('button', { name: 'Zoom in' }).click()
  }
  await shoot(page.getByTestId('map-canvas'), 'trigger-glyph', testInfo)
})

test('the item editor and the gates', async ({ page }, testInfo) => {
  test.setTimeout(120_000)
  const projectDir = adventureDir(testInfo, 'item-demo.osr')

  await freshProject(page, projectDir, 'The mill key')

  // Clone a catalog gear item into the bundled key — "like a torch, but…",
  // the item editor's own framing of clone-and-modify.
  await page.getByRole('button', { name: 'Items', exact: true }).click()
  await page.getByRole('button', { name: 'Clone catalog item' }).click()
  await page.getByPlaceholder('Search items…').fill('torch')
  await page
    .getByRole('option', { name: /^Torch/ })
    .first()
    .click()
  await page.getByLabel('Name').fill('The miller’s brass key')
  await page.getByRole('button', { name: 'Add to the adventure' }).click()
  await expect(page.getByTestId('item-detail-torch-1')).toBeVisible()
  const idField = page.getByLabel('Id')
  await idField.fill('millers-key')
  await idField.press('Enter')
  await expect(page.getByTestId('item-detail-millers-key')).toBeVisible()

  // The section: the bundled list beside the per-kind detail form.
  const items = page.getByRole('region', { name: 'Items' })
  await expect(items.getByRole('list', { name: 'Bundled items' })).toBeVisible()
  await shoot(items, 'items-section', testInfo)

  // The detail form alone: the always-saved per-kind editor.
  await shoot(page.getByTestId('item-detail-millers-key'), 'item-detail', testInfo)

  // A room with a gated door and a gated transition. Drawn around the view
  // centre, because the zoom buttons scale about it — which is what lets the
  // badge shot magnify the diamonds without a pan gesture.
  await openMap(page)
  await page.getByRole('button', { name: 'Room tool' }).click()
  await drag(page, await cellCenter(page, 10, 6), await cellCenter(page, 13, 8))
  await drag(page, await cellCenter(page, 14, 6), await cellCenter(page, 16, 8))
  await page.getByRole('button', { name: 'Wall and door tool' }).click()
  const doorEdge = await edgePoint(page, [13, 7], [14, 7])
  await page.mouse.click(doorEdge.x, doorEdge.y)
  await page.mouse.click(doorEdge.x, doorEdge.y)
  // The entrance moves into the first room so the pair is reachable and the
  // badge shot carries no lint markers over its subject.
  await page.getByRole('button', { name: 'Entrance tool' }).click()
  const entranceCell = await cellCenter(page, 10, 8)
  await page.mouse.click(entranceCell.x, entranceCell.y)

  // The stairs need somewhere to go before their threshold can charge a toll.
  await page.getByRole('button', { name: 'Add level' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Add level' }).click()
  await page.getByTestId('map-editor').getByRole('button', { name: 'Level 1' }).click()
  await page.getByRole('button', { name: 'Reset zoom' }).click()
  await page.getByRole('button', { name: 'Transition tool' }).click()
  const stairs = await cellCenter(page, 11, 7)
  await page.mouse.click(stairs.x, stairs.y)
  const transitionDialog = page.getByRole('dialog')
  const picker = await page.getByTestId('mini-level-picker').boundingBox()
  if (!picker) throw new Error('the mini level picker has no bounding box')
  const pickerCell = picker.width / 30
  await page.mouse.click(picker.x + pickerCell * 0.5, picker.y + pickerCell * 0.5)
  await transitionDialog.getByRole('button', { name: 'Add gate' }).click()
  await transitionDialog.getByRole('button', { name: 'Pick item' }).click()
  await page.getByPlaceholder('Search items…').fill('torch')
  await page
    .getByRole('option', { name: /^Torch/ })
    .first()
    .click()
  await transitionDialog.getByRole('checkbox', { name: 'Consumes the item' }).click()
  await transitionDialog.getByRole('button', { name: 'Add transition' }).click()

  // The gate card on the door inspector, condition and narrative authored.
  // The card is tall, so the viewport grows to hold it in the inspector's
  // scrollport — the content-card shots' own arrangement.
  await page.setViewportSize({ width: 1280, height: 1500 })
  await page.getByRole('button', { name: 'Select tool' }).click()
  await page.mouse.click(doorEdge.x, doorEdge.y)
  const inspector = page.getByLabel('Inspector')
  await expect(inspector.getByLabel('Kind', { exact: true })).toHaveValue('door')
  await inspector.getByRole('button', { name: 'Add gate' }).click()
  await inspector.getByRole('button', { name: 'Pick item' }).click()
  await page
    .getByRole('option', { name: /brass key/ })
    .first()
    .click()
  const refusal = inspector.getByLabel('Refusal')
  await refusal.fill('The false wall holds. Behind it, something counts on its fingers and waits.')
  await refusal.press('Tab')
  const success = inspector.getByLabel('Success')
  await success.fill('The brass key turns twice, and the counting stops.')
  await success.press('Tab')
  await expect(inspector.getByLabel('Refusal')).toHaveValue(/false wall/)
  const gateCard = inspector.getByLabel('Gate')
  await gateCard.evaluate((element) => {
    element.scrollIntoView({ block: 'start' })
  })
  await page.mouse.move(0, 0)
  const frame = await inspector.boundingBox()
  const cardBox = await gateCard.boundingBox()
  if (!frame || !cardBox || cardBox.y < frame.y || cardBox.y + cardBox.height > frame.y + frame.height) {
    throw new Error('the gate card is not inside the captured frame')
  }
  await shoot(gateCard, 'door-gate-card', testInfo)
  await page.setViewportSize({ width: 1280, height: 800 })

  // The badges: the gate diamond beside the door leaf and beside the stairs
  // glyph — one mark, both carriers. Zoomed about the centre the rooms were
  // drawn around, with the selection parked on a cell outside the frame so
  // nothing renders highlighted.
  const parkCell = await cellCenter(page, 27, 14)
  await page.mouse.click(parkCell.x, parkCell.y)
  await page.getByRole('button', { name: 'Reset zoom' }).click()
  for (let step = 0; step < 4; step += 1) {
    await page.getByRole('button', { name: 'Zoom in' }).click()
  }
  await shoot(page.getByTestId('map-canvas'), 'gate-badges', testInfo)
})
