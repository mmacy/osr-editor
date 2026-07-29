/// <reference lib="dom" />
// The phase 11 milestone, deterministic half: stock a fresh OPD-imported level
// entirely from a converted module opened as a content-library source — by
// click-to-place, the path that must work even where drag cannot — copy a
// wandering table from a second native source, then swap another OPD map into
// the level with the stash offer accepted and re-place its displaced content
// from the stash pack, publishing the result. Zero network throughout; the
// forge source is a temp copy of the fixture workdir because assembly writes
// forge's own artifacts (the standing rule conftest.py and forge.spec.ts
// follow).
import {
  copyFileSync,
  cpSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, test, type Page } from '@playwright/test'

import { cellCenter, createProject, openMap, resetView } from './helpers'

async function clickCell(page: Page, x: number, y: number): Promise<void> {
  const point = await cellCenter(page, x, y)
  await page.mouse.click(point.x, point.y)
}

const FORGE_FIXTURE = join(__dirname, '..', 'fixtures', 'forge_workdir')
const SMALL_MODULE = join(__dirname, '..', 'fixtures', 'small_module.json')
const OPD = join(__dirname, '..', 'assets', 'opd')

interface StampedDocument {
  kind: string
  payload: {
    monsters: Array<{ id: string }>
    dungeons: Array<{
      id: string
      levels: Array<{
        number: number
        wandering: { chance_in_six: number; table: { rows: unknown[] } | null }
        areas: Array<{
          id: string
          name: string
          encounter: { monsters: Array<{ template_id: string }> } | null
          trap: unknown
          treasure: unknown
          features: Array<{ id: string }>
        }>
      }>
    }>
  }
}

async function importOpd(page: Page, source: string, mode: 'new' | 'replace') {
  await page.getByRole('button', { name: 'Import geometry' }).click()
  await page.getByLabel('Source path').fill(source)
  await page.getByRole('button', { name: 'Sniff' }).click()
  await expect(page.getByLabel('Importer')).toHaveValue('watabou-opd')
  await page.getByRole('button', { name: 'Load' }).click()
  await expect(page.getByLabel('Source level')).toBeVisible()
  if (mode === 'replace') {
    await page.getByRole('radio', { name: /Replace the geometry/ }).click()
    await page.getByLabel('Replace level').selectOption('2')
  }
  await page.getByRole('dialog').getByRole('button', { name: 'Import' }).click()
}

test('the content-library milestone: stock an OPD level from sources, swap the map, re-place from the stash', async ({
  page,
}) => {
  test.setTimeout(180_000)
  const workspace = mkdtempSync(join(tmpdir(), 'osr-editor-e2e-library-'))
  const projectDir = join(workspace, 'quarry.osr')
  const forgeSource = join(workspace, 'millstone.forge')
  cpSync(FORGE_FIXTURE, forgeSource, { recursive: true })
  const millSource = join(workspace, 'mill.osr')
  mkdirSync(millSource)
  copyFileSync(SMALL_MODULE, join(millSource, 'adventure.json'))
  const checkout = join(workspace, 'osr-web')
  mkdirSync(join(checkout, 'adventures'), { recursive: true })
  // Source identities are resolved paths; /tmp is a symlink on macOS, so the
  // panel testids carry the real paths.
  const forgeIdentity = realpathSync(forgeSource)
  const millIdentity = realpathSync(millSource)

  await createProject(page, projectDir, 'Coppergrave quarry')
  await openMap(page)

  // The OPD canvas: the torture payload lands as level 2, every area carrying
  // Watabou's note text as its description.
  await importOpd(page, join(OPD, 'torture.json'), 'new')
  await expect(
    page.getByTestId('map-editor').getByRole('button', { name: 'Level 2' }),
  ).toBeVisible()
  await expect(page.getByTestId('revision')).toHaveText('r2')
  await resetView(page)

  // The converted module as the palette: a forge workdir opens read-only as a
  // content-library source, assembled current-first from a temp copy.
  await page.getByRole('button', { name: 'Library', exact: true }).click()
  const panel = page.getByTestId('library-panel')
  await panel.getByLabel('Open a source').fill(forgeSource)
  await panel.getByRole('button', { name: 'Open', exact: true }).click()
  const forgePack = page.getByTestId(`pack-${forgeIdentity}`)
  await expect(forgePack).toContainText('The Millstone Warrens')
  await expect(forgePack).toContainText('The Millstone Warrens level 1')

  // First drop, by click-to-place: the Flour Cellar (prose, encounter, trap,
  // treasure) onto area 2. Its description collides with the Watabou note and
  // the collision dialog fires — once for this pack, replace preselected.
  await forgePack.getByRole('button', { name: 'Place Flour Cellar' }).click()
  await clickCell(page, 7, 10)
  const collision = page.getByRole('dialog', {
    name: 'The room already has some of this',
  })
  await expect(collision).toBeVisible()
  await expect(collision).toContainText('Description')
  await collision.getByRole('button', { name: 'Place' }).click()
  await expect(page.getByTestId('revision')).toHaveText('r3')
  await expect(
    forgePack
      .getByTestId(`entry-dungeon:millstone-warrens/level:1/area:2`)
      .getByTitle('Placed at least once'),
  ).toBeVisible()

  // Second drop: the remembered choice applies — no second prompt, content
  // lands, and the entry's feature re-mints under the level's convention.
  await forgePack.getByRole('button', { name: 'Place Grinding Hall' }).click()
  await clickCell(page, 1, 10)
  await expect(page.getByTestId('revision')).toHaveText('r4')
  await expect(
    page.getByRole('dialog', { name: 'The room already has some of this' }),
  ).not.toBeVisible()

  // Third drop carries the closure: the Undermill Pool's encounter references
  // the module's bundled mill_wisp, which AddMonsterTemplate brings along.
  await forgePack.getByRole('button', { name: 'Place Undermill Pool' }).click()
  await clickCell(page, 1, 6)
  await expect(page.getByTestId('revision')).toHaveText('r5')

  // Undoing a drop does not unearn the badge: a copy record is a record of
  // the copy act, and used means at least once.
  await page.getByRole('button', { name: 'Undo' }).click()
  await expect(page.getByTestId('revision')).toHaveText('r6')
  await expect(
    forgePack
      .getByTestId(`entry-dungeon:millstone-warrens/level:2/area:1`)
      .getByTitle('Placed at least once'),
  ).toBeVisible()
  await page.getByRole('button', { name: 'Redo' }).click()
  await expect(page.getByTestId('revision')).toHaveText('r7')

  // The wandering copy comes from a second source — a native project opened
  // through the store seam; its authored level 2 table lands on this level.
  await panel.getByLabel('Open a source').fill(millSource)
  await panel.getByRole('button', { name: 'Open', exact: true }).click()
  const millPack = page.getByTestId(`pack-${millIdentity}`)
  await expect(millPack).toContainText('The Mill on the Moor')

  // The panel auto-fits its width: labels truncate and the glyphs, badges,
  // and buttons stay in frame. Radix's scroll viewport wraps content in a
  // display:table div whose width is set by the widest max-content row, so
  // without a pinned content width the panel clips silently — scrollWidth
  // measures what overflow: hidden hides (the import dialog's own trap).
  const widths = await panel.evaluate((node) => {
    const viewport = node.querySelector('[data-radix-scroll-area-viewport]')
    return viewport ? [viewport.clientWidth, viewport.scrollWidth] : null
  })
  expect(widths).not.toBeNull()
  expect(widths?.[1]).toBe(widths?.[0])
  await millPack.getByRole('button', { name: 'Copy wandering' }).click()
  await expect(page.getByTestId('revision')).toHaveText('r8')
  await expect(millPack.getByTestId(`entry-dungeon:mill-caves/level:2/area:4`)).toBeVisible()

  // Loaded libraries are remembered per project — the open-source list rides
  // the sidecar's view state like the cameras. Leave for home, come back, and
  // both packs restore with ordinary fresh opens: placement resumes without
  // re-opening anything.
  await page.getByRole('button', { name: 'Home' }).click()
  await page.getByText('Coppergrave quarry').click()
  await expect(page.getByTestId('map-canvas')).toBeVisible()
  await page.getByRole('button', { name: 'Library', exact: true }).click()
  await expect(forgePack).toContainText('The Millstone Warrens')
  await expect(millPack).toContainText('The Mill on the Moor')

  // The swap-in: a second OPD map replaces the stocked level, with the stash
  // offer accepted — the level's rooms and wandering table bank as a pack.
  await importOpd(page, join(OPD, 'nominal.json'), 'replace')
  const offer = page.getByRole('dialog', { name: 'Replace level 2' })
  await expect(offer).toContainText('This removes:')
  await expect(
    offer.getByRole('checkbox', {
      name: "Stash this level's content in the library first",
    }),
  ).toBeChecked()
  // The capture is sidecar-only — no revision bump; the batch bumps once.
  await offer.getByRole('button', { name: 'Replace level' }).click()
  await expect(page.getByTestId('revision')).toHaveText('r9')
  await resetView(page)
  const stashRow = page.getByTestId('stash-stash-1')
  await expect(stashRow).toContainText(/dungeon-1 level 2 — \d{4}-\d{2}-\d{2}/)

  // Open the stash pack and re-place a displaced room on the new map. A stash
  // pack is a fresh identity, so its first colliding drop prompts once.
  await stashRow.getByRole('button', { name: /^Open dungeon-1 level 2/ }).click()
  const stashPack = page.getByTestId('pack-stash-1')
  await expect(stashPack).toContainText('stash')
  await stashPack.getByRole('button', { name: 'Place Flour Cellar' }).click()
  await clickCell(page, 2, 1)
  const stashCollision = page.getByRole('dialog', {
    name: 'The room already has some of this',
  })
  await expect(stashCollision).toBeVisible()
  await stashCollision.getByRole('button', { name: 'Place' }).click()
  await expect(page.getByTestId('revision')).toHaveText('r10')
  await expect(
    stashPack
      .getByTestId(`entry-dungeon:dungeon-1/level:2/area:2`)
      .getByTitle('Placed at least once'),
  ).toBeVisible()

  // Publish through the lint warnings (the OPD levels carry unreachable-area
  // and orphan-door warnings by design; validation is clean).
  await page.getByRole('button', { name: 'Publish' }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('osr-web checkout').fill(checkout)
  await dialog.getByRole('button', { name: 'Publish', exact: true }).click()
  await dialog.getByRole('button', { name: 'Publish anyway' }).click()
  const published = join(checkout, 'adventures', 'quarry')
  await expect(page.getByText(`Published to ${published}`)).toBeVisible()
  expect(lstatSync(published).isSymbolicLink()).toBe(true)

  // The published document is the milestone's proof: the swapped level carries
  // the re-placed room, the copied wandering table survived the swap, and the
  // closure's bundled template rides the adventure.
  const document = JSON.parse(
    readFileSync(join(published, 'adventure.json'), 'utf-8'),
  ) as StampedDocument
  expect(document.kind).toBe('adventure')
  expect(document.payload.monsters.map((monster) => monster.id)).toContain('mill_wisp')
  const level2 = document.payload.dungeons[0].levels.find((level) => level.number === 2)
  if (!level2) throw new Error('level 2 vanished')
  expect(level2.wandering.chance_in_six).toBe(2)
  expect(level2.wandering.table).not.toBeNull()
  const landed = level2.areas.find((area) => area.id === '1')
  if (!landed) throw new Error('area 1 vanished')
  expect(landed.name).toBe('Flour Cellar')
  expect(landed.encounter?.monsters.map((line) => line.template_id)).toEqual(['goblin'])
  expect(landed.trap).not.toBeNull()
  expect(landed.treasure).not.toBeNull()

  // The sidecar holds the stash pack and the copy records — the library's
  // provenance, never a link.
  const sidecar = JSON.parse(readFileSync(join(projectDir, 'editor.json'), 'utf-8')) as {
    stash: Array<{ pack_id: string }>
    copies: Record<string, unknown[]>
  }
  expect(sidecar.stash.map((pack) => pack.pack_id)).toEqual(['stash-1'])
  expect(Object.keys(sidecar.copies).length).toBeGreaterThanOrEqual(4)
})
