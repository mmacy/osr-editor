// The phase 2 milestone loop, end to end against the real CLI and built
// frontend: author a two-level dungeon's geometry from the blank grid — a
// room, a corridor, a door, the entrance, a reciprocal stairs pair — watch
// lint react live, export, and assert the document parses. Plus one import
// scenario against a fixture source project.
//
// Canvas interaction invokes the zoom-reset control first, then drives
// pointer events at coordinates computed from the exported cell-size
// constant — that is what makes the math deterministic.
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, test } from '@playwright/test'

import { cellCenter, createProject, drag, edgePoint, openMap } from './helpers'

// Playwright transpiles specs to CJS, so __dirname is the reliable anchor.
const FIXTURES = join(__dirname, '..', 'fixtures')
const ASSETS = join(__dirname, '..', 'assets')

interface StampedLevel {
  number: number
  edges: Record<string, { kind: string }>
  areas: { id: string }[]
  transitions: { kind: string; to_facing: string }[]
  entrance: [number, number] | null
}

interface StampedDocument {
  kind: string
  payload: { dungeons: { levels: StampedLevel[] }[] }
}

test('author a two-level dungeon from the blank grid, lint clean, export', async ({ page }) => {
  const workspace = mkdtempSync(join(tmpdir(), 'osr-editor-e2e-map-'))
  const projectDir = join(workspace, 'vaults.osr')
  const exportPath = join(workspace, 'exports', 'vaults-adventure.json')

  await createProject(page, projectDir, 'The vaults')
  await openMap(page)
  await expect(page.getByTestId('diagnostics-count')).toHaveText('0')

  // Draw a room away from the entrance — it raises area_unreachable.
  await page.getByRole('button', { name: 'Room tool' }).click()
  await drag(page, await cellCenter(page, 2, 1), await cellCenter(page, 4, 3))
  await expect(page.getByTestId('diagnostics-count')).toHaveText('1')
  await expect(page.getByText('no path from any entrance reaches this area')).toBeVisible()
  // The room is immediately keyed and selected for editing.
  await expect(page.getByLabel('Inspector').getByLabel('Key')).toHaveValue('1')

  // A corridor from the entrance toward the room; the room stays sealed.
  await page.getByRole('button', { name: 'Corridor tool' }).click()
  await drag(page, await cellCenter(page, 0, 0), await cellCenter(page, 2, 0))
  await expect(page.getByTestId('diagnostics-count')).toHaveText('1')

  // The wall tool cycles the sealed edge: open, then door — connected either
  // way, and the finding clears.
  await page.getByRole('button', { name: 'Wall and door tool' }).click()
  const doorway = await edgePoint(page, [2, 0], [2, 1])
  await page.mouse.click(doorway.x, doorway.y)
  await expect(page.getByTestId('diagnostics-count')).toHaveText('0')
  await page.mouse.click(doorway.x, doorway.y)
  await expect(page.getByTestId('diagnostics-count')).toHaveText('0')

  // The door edge inspects as a normal door.
  await page.getByRole('button', { name: 'Select tool' }).click()
  await page.mouse.click(doorway.x, doorway.y)
  const inspector = page.getByLabel('Inspector')
  await expect(inspector.getByLabel('Kind', { exact: true })).toHaveValue('door')
  await expect(inspector.getByLabel('Door kind')).toHaveValue('normal')

  // Move the entrance into the room.
  await page.getByRole('button', { name: 'Entrance tool' }).click()
  const entrance = await cellCenter(page, 3, 2)
  await page.mouse.click(entrance.x, entrance.y)
  await expect(page.getByTestId('diagnostics-count')).toHaveText('0')

  // Add level 2 and draw a room on it — unreachable until the stairs land.
  await page.getByRole('button', { name: 'Add level' }).click()
  await expect(page.getByLabel('Level number')).toHaveValue('2')
  await page.getByRole('dialog').getByRole('button', { name: 'Add level' }).click()
  await expect(page.getByTestId('map-canvas')).toBeVisible()
  await page.getByRole('button', { name: 'Reset zoom' }).click()
  await page.getByRole('button', { name: 'Room tool' }).click()
  await drag(page, await cellCenter(page, 0, 0), await cellCenter(page, 2, 2))
  await expect(page.getByTestId('diagnostics-count')).toHaveText('1')

  // Back on level 1, cut stairs down with auto-reciprocal: one batch, both
  // flights, and the whole document lints clean.
  await page.getByTestId('map-editor').getByRole('button', { name: 'Level 1' }).click()
  await page.getByRole('button', { name: 'Reset zoom' }).click()
  await page.getByRole('button', { name: 'Transition tool' }).click()
  const stairs = await cellCenter(page, 1, 0)
  await page.mouse.click(stairs.x, stairs.y)
  await expect(page.getByRole('heading', { name: 'Add transition' })).toBeVisible()
  await expect(page.getByLabel('Kind', { exact: true })).toHaveValue('stairs_down')
  await expect(page.getByLabel('Target level', { exact: true })).toHaveValue('2')
  const picker = await page.getByTestId('mini-level-picker').boundingBox()
  if (!picker) throw new Error('the mini level picker has no bounding box')
  // Level 2 is 30x30; the click maps through the rendered rectangle, so the
  // cell math derives from the box rather than assuming a cell size.
  const pickerCell = picker.width / 30
  await page.mouse.click(picker.x + pickerCell * 1.5, picker.y + pickerCell * 1.5)
  await expect(page.getByLabel('X', { exact: true })).toHaveValue('1')
  await expect(page.getByLabel('Y', { exact: true })).toHaveValue('1')
  await page.getByRole('dialog').getByRole('button', { name: 'Add transition' }).click()
  await expect(page.getByTestId('diagnostics-count')).toHaveText('0')

  // Edit the flight in place: the inspector's edit path reopens the dialog
  // prefilled, and changing the arrival facing replaces the transition in one
  // undo step without disturbing the pairing.
  await page.getByRole('button', { name: 'Select tool' }).click()
  await page.mouse.click(stairs.x, stairs.y)
  await inspector.getByRole('button', { name: 'Edit transition…' }).click()
  await expect(page.getByRole('heading', { name: 'Edit transition' })).toBeVisible()
  await expect(page.getByLabel('X', { exact: true })).toHaveValue('1')
  await expect(page.getByLabel('Y', { exact: true })).toHaveValue('1')
  await page.getByLabel('Arrival facing').selectOption('east')
  await page.getByRole('dialog').getByRole('button', { name: 'Save transition' }).click()
  await expect(page.getByTestId('diagnostics-count')).toHaveText('0')

  // Export and assert the stamped document holds everything just drawn.
  await page.getByRole('button', { name: 'Export' }).click()
  await page.getByLabel('Destination file').fill(exportPath)
  await page.getByRole('dialog').getByRole('button', { name: 'Export' }).click()
  await expect(page.getByText(`Exported to ${exportPath}`)).toBeVisible()

  const document = JSON.parse(readFileSync(exportPath, 'utf-8')) as StampedDocument
  expect(document.kind).toBe('adventure')
  const levels = document.payload.dungeons[0].levels
  expect(levels.map((level) => level.number)).toEqual([1, 2])
  expect(levels[0].edges['2,1:north'].kind).toBe('door')
  expect(levels[0].entrance).toEqual([3, 2])
  expect(levels[0].transitions.map((transition) => transition.kind)).toEqual(['stairs_down'])
  expect(levels[0].transitions[0].to_facing).toBe('east')
  expect(levels[1].transitions.map((transition) => transition.kind)).toEqual(['stairs_up'])
  expect(levels[0].areas.map((area) => area.id)).toEqual(['1'])
})

test('import a fixture project level as a new level', async ({ page }) => {
  const workspace = mkdtempSync(join(tmpdir(), 'osr-editor-e2e-import-'))
  const projectDir = join(workspace, 'fresh.osr')
  const sourceDir = join(workspace, 'torture.osr')
  mkdirSync(sourceDir)
  writeFileSync(
    join(sourceDir, 'adventure.json'),
    readFileSync(join(FIXTURES, 'torture_geometry.json')),
  )

  await createProject(page, projectDir, 'Import target')
  await openMap(page)

  await page.getByRole('button', { name: 'Import geometry' }).click()
  await page.getByLabel('Source path').fill(sourceDir)
  await page.getByRole('button', { name: 'Sniff' }).click()
  await expect(page.getByLabel('Importer')).toHaveValue('project')
  await page.getByRole('button', { name: 'Load' }).click()
  await expect(page.getByLabel('Source level')).toBeVisible()
  // The torture fixture's transitions target a dungeon the destination does
  // not have — listed with drop checkboxes, default dropped.
  await expect(page.getByLabel('Unresolved transitions')).toBeVisible()
  await page.getByRole('dialog').getByRole('button', { name: 'Import' }).click()

  // The import landed as one batch: level 2 exists and is selected, and the
  // whole imported level is honestly unreachable from level 1's entrance —
  // six unreachable areas, eleven orphan corridor cells, and the overlapping
  // pair.
  await expect(page.getByTestId('map-editor').getByRole('button', { name: 'Level 2' })).toBeVisible()
  await expect(page.getByTestId('diagnostics-count')).toHaveText('18')

  // One undo removes the whole import.
  await page.getByRole('button', { name: 'Undo' }).click()
  await expect(
    page.getByTestId('map-editor').getByRole('button', { name: 'Level 2' }),
  ).not.toBeVisible()
  await expect(page.getByTestId('diagnostics-count')).toHaveText('0')
})

// The phase 8 milestone, deterministic half: a One Page Dungeon export imports
// into a blank project through the same seam and the same op batch, with its
// title and story adopted in the one undo step.
test('import a One Page Dungeon export, adopting its title and story', async ({ page }) => {
  const workspace = mkdtempSync(join(tmpdir(), 'osr-editor-e2e-opd-'))
  const projectDir = join(workspace, 'coppergrave.osr')
  const source = join(ASSETS, 'opd', 'torture.json')

  await createProject(page, projectDir, 'Import target')
  await openMap(page)

  await page.getByRole('button', { name: 'Import geometry' }).click()
  await page.getByLabel('Source path').fill(source)
  await page.getByRole('button', { name: 'Sniff' }).click()
  // The path is a file, not a directory: only the OPD converter recognizes it.
  await expect(page.getByLabel('Importer')).toHaveValue('watabou-opd')
  await page.getByRole('button', { name: 'Load' }).click()
  await expect(page.getByLabel('Source level')).toBeVisible()

  // Every judgment call is on screen before anything commits.
  await expect(page.getByLabel('Importer notes')).toContainText(
    'carry a fabricated destination',
  )
  await expect(page.getByLabel('Importer notes')).toContainText('unrecognized type 12')

  await page.getByRole('checkbox', { name: /Adopt the title/ }).check()
  await page.getByRole('checkbox', { name: /Adopt the description/ }).check()
  // The stair's destination is fabricated, so it never resolves — the dialog
  // drops it by default and this keeps it, exactly as an author would.
  await page.getByLabel('Unresolved transitions').getByRole('checkbox').check()
  await page.getByRole('dialog').getByRole('button', { name: 'Import' }).click()

  // The map drew: level 2 exists, is selected, and its canvas is up.
  await expect(page.getByTestId('map-editor').getByRole('button', { name: 'Level 2' })).toBeVisible()
  await expect(page.getByTestId('map-canvas')).toBeVisible()

  // The complete finding list, asserted rather than counted: the fabricated
  // destination is a validation error (so publish refuses until the author
  // resolves or drops the stair — the to-do list has a deadline), the imported
  // level is honestly unreachable from level 1's entrance (reachability seeds
  // from the first entrance-bearing level only), its eight unkeyed door cells
  // are orphans, and the kept stair is unpaired until the author resolves it.
  await expect(page.getByRole('region', { name: 'Diagnostics' }).getByRole('listitem')).toHaveText([
    "transition_target_unknown dungeon-1 level 2: transition targets unknown '' level 2",
    'area_unreachable no path from any entrance reaches this area',
    'area_unreachable no path from any entrance reaches this area',
    'area_unreachable no path from any entrance reaches this area',
    'area_unreachable no path from any entrance reaches this area',
    'area_unreachable no path from any entrance reaches this area',
    'area_unreachable no path from any entrance reaches this area',
    'area_unreachable no path from any entrance reaches this area',
    'orphan_cell cell (3, 2) renders as corridor but no path reaches it',
    'orphan_cell cell (5, 2) renders as corridor but no path reaches it',
    'orphan_cell cell (3, 6) renders as corridor but no path reaches it',
    'orphan_cell cell (5, 6) renders as corridor but no path reaches it',
    'orphan_cell cell (3, 10) renders as corridor but no path reaches it',
    'orphan_cell cell (5, 10) renders as corridor but no path reaches it',
    'orphan_cell cell (9, 10) renders as corridor but no path reaches it',
    'orphan_cell cell (4, 12) renders as corridor but no path reaches it',
    'transition_unpaired stairs_down at (4, 0) has no transition back from /2 (0, 0)',
  ])

  // Adoption rode the geometry batch: the adventure took the source's name and
  // story, and one undo takes back the whole import — map and metadata.
  await page
    .getByRole('navigation', { name: 'Sections' })
    .getByRole('button', { name: 'Adventure', exact: true })
    .click()
  await expect(page.locator('#adventure-name')).toHaveValue('The Coppergrave Warrens')
  await expect(page.locator('#adventure-description')).toHaveValue(/spoil shaft/)

  await page.getByRole('button', { name: 'Undo' }).click()
  await expect(page.locator('#adventure-name')).toHaveValue('Import target')
  await expect(page.getByTestId('diagnostics-count')).toHaveText('0')
})

// The two level-row actions issue 31 asked for, against the surface that
// motivated the first: a One Page Dungeon export lands a description on every
// keyed room, and an author who wants the rooms and not the prose clears them
// in one step rather than one card at a time.
test('clear content strips an imported level to its geometry, and the row removes it', async ({
  page,
}) => {
  const workspace = mkdtempSync(join(tmpdir(), 'osr-editor-e2e-clear-'))
  const projectDir = join(workspace, 'stripped.osr')

  await createProject(page, projectDir, 'Clear target')
  await openMap(page)

  // The row control, named exactly: the dialog's confirm button is "Clear
  // content" without the ellipsis, so a prefix match would find both.
  const clear = page.getByRole('button', { name: 'Clear content…' })
  const confirm = page.getByRole('dialog').getByRole('button', { name: 'Clear content' })
  const alsoRemove = page.getByRole('checkbox', { name: 'Also remove the emptied areas' })
  // Level 1 is blank — no content and no keyed areas — so there is nothing to
  // clear and the control says so.
  await expect(clear).toBeDisabled()

  await page.getByRole('button', { name: 'Import geometry' }).click()
  await page.getByLabel('Source path').fill(join(ASSETS, 'opd', 'torture.json'))
  await page.getByRole('button', { name: 'Sniff' }).click()
  await page.getByRole('button', { name: 'Load' }).click()
  await expect(page.getByLabel('Source level')).toBeVisible()
  await page.getByRole('dialog').getByRole('button', { name: 'Import' }).click()
  await expect(page.getByTestId('map-editor').getByRole('button', { name: 'Level 2' })).toBeVisible()

  // The import's prose is what the control now offers to remove. Both the
  // tally and the whole finding list are captured: the findings encode the
  // geometry — one area_unreachable per keyed room, one orphan_cell per unkeyed
  // door cell, one per transition — so holding them identical across the clear
  // is the assertion that no cell, edge, entrance, or transition moved.
  await expect(clear).toBeEnabled()
  const findings = page.getByRole('region', { name: 'Diagnostics' }).getByRole('listitem')
  // Polled, not read once: a commit is in flight after every confirm and undo,
  // and `allInnerTexts` does not retry — it would catch the panel mid-render.
  const expectFindings = (expected: string[]) =>
    expect.poll(() => findings.allInnerTexts()).toEqual(expected)
  const imported = await findings.allInnerTexts()
  expect(imported.length).toBeGreaterThan(0)
  await clear.click()
  const tally = await page.getByLabel('Content to clear').innerText()
  expect(tally).toContain('area descriptions')
  // The rooms stay keyed by default, so the box starts clear.
  await expect(alsoRemove).not.toBeChecked()
  await confirm.click()
  await expectFindings(imported)

  // One undo step, whatever the batch's op count: a single undo restores the
  // whole tally, not merely enough of it to make the control offer something.
  await page.getByRole('button', { name: 'Undo' }).click()
  await expectFindings(imported)
  await clear.click()
  expect(await page.getByLabel('Content to clear').innerText()).toBe(tally)
  await confirm.click()

  // Emptied but still keyed, the level has no content left to clear — and the
  // dialog says so, with the confirm refusing until the box offers it the one
  // thing left to do.
  await expect(clear).toBeEnabled()
  await clear.click()
  await expect(page.getByText('This level carries no content')).toBeVisible()
  await expect(confirm).toBeDisabled()

  // The opt-in second half: unkey the emptied rooms. Their key numbers go, and
  // their cells stay floor — which the lint proves by reporting *more* orphan
  // cells than before, every unkeyed room cell now reading as corridor.
  const orphans = imported.filter((finding) => finding.startsWith('orphan_cell'))
  expect(orphans.length).toBeGreaterThan(0)
  await alsoRemove.check()
  await expect(page.getByLabel('Content to clear')).toContainText('keyed areas')
  await expect(confirm).toBeEnabled()
  await confirm.click()
  await expect(clear).toBeDisabled()
  const stripped = await findings.allInnerTexts()
  expect(stripped.filter((finding) => finding.startsWith('area_unreachable'))).toEqual([])
  expect(stripped.filter((finding) => finding.startsWith('orphan_cell')).length).toBeGreaterThan(
    orphans.length,
  )
  // Still one undo step, and the box is remembered for the next level.
  await page.getByRole('button', { name: 'Undo' }).click()
  await expectFindings(imported)
  await clear.click()
  await expect(alsoRemove).toBeChecked()
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'Redo' }).click()
  await page.getByRole('button', { name: 'Undo' }).click()

  // Remove the level from the row, without opening level properties.
  page.on('dialog', (confirm) => void confirm.accept())
  await page.getByRole('button', { name: 'Remove level' }).click()
  await expect(
    page.getByTestId('map-editor').getByRole('button', { name: 'Level 2' }),
  ).not.toBeVisible()
  await expect(page.getByTestId('diagnostics-count')).toHaveText('0')
  // Level 1 is the last one standing, so the control disables itself.
  await expect(page.getByRole('button', { name: 'Remove level' })).toBeDisabled()
})

test('view state resumes a session where it left off', async ({ page }) => {
  const workspace = mkdtempSync(join(tmpdir(), 'osr-editor-e2e-'))
  const projectDir = join(workspace, 'resume.osr')
  await createProject(page, projectDir, 'Resume test')
  await openMap(page)

  // Zoom in — a user-set camera the flush persists on leaving the map.
  await page.getByRole('button', { name: 'Zoom in' }).click()
  await page.getByRole('button', { name: 'Home' }).click()
  await expect(page.getByRole('button', { name: 'New adventure' })).toBeVisible()

  // Reopening lands straight on the level the session left off in.
  await page.getByRole('button', { name: 'Open project' }).click()
  await page.getByLabel('Project directory').fill(projectDir)
  await page.getByRole('dialog').getByRole('button', { name: 'Open' }).click()
  await expect(page.getByTestId('map-canvas')).toBeVisible()
})
