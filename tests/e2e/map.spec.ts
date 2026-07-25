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
  transitions: { kind: string }[]
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
  // Level 2 is 30x30, so the picker draws 6 px cells; land on cell (1, 1).
  await page.mouse.click(picker.x + 9, picker.y + 9)
  await expect(page.getByText('(1, 1)')).toBeVisible()
  await page.getByRole('dialog').getByRole('button', { name: 'Add transition' }).click()
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
