/// <reference lib="dom" />
// The four content-kind shots: one populated card per guide page — the encounter
// card, the treasure card, the trap builder, and a treasure-cache feature.
//
// Its own spec rather than more of `native.spec.ts`, for two reasons. The states
// are heavy — four cards filled to the point where every control the prose names
// is showing — and `native.spec.ts`'s long test is already a chain where each
// step depends on the last, ending in the hero shot of that same project.
// Second, these four shots want a taller viewport than the rest of the harness
// (the inspector is the frame, and at 800 the trap builder does not fit in it),
// and a viewport that size would ride into every shot the other test takes.
//
// One project, four rooms, one card per room: an area carrying all four expanded
// at once would put each shot's subject at a scroll offset that depends on how
// tall the cards above it happened to render.
import { mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'

import { expect, test, type Locator, type Page } from '@playwright/test'

import { cellCenter, createProject, drag, drawRoom, openMap } from '../e2e/helpers'
import { shoot } from './capture'
import { SHOTS_HOME } from './paths'

// The viewport these shots are framed against. The inspector is the scroll
// container every card lives in, and its height is the viewport's minus the
// chrome — at the harness's usual 800 the populated trap card is taller than the
// panel that holds it, and a card screenshot would capture page pixels from
// outside the panel where the scroll container had clipped it away.
const VIEWPORT = { width: 1280, height: 1400 }

// capture.ts's clip ratio, mirrored here so the framing check knows what `shoot`
// will actually take: past this ratio the shot is the subject's top rather than
// the whole element.
const MAX_ASPECT = 2.5

// The treasure preview rolls on server entropy, so the light and dark runs would
// otherwise photograph two different hoards and a reader toggling the theme
// would watch the hoard change. The preview request carries a `seed` field for
// exactly this — osrlib's own reproducible-test surface — so the capture pins it
// on the wire rather than the app growing a control no author wants. Chosen for
// what it teaches: 7000 cp worth 70 gp is the trailing-figure lesson in one line.
const TREASURE_SEED = '33'

/**
 * Assert the subject is genuinely inside the inspector's visible box.
 *
 * `toBeVisible()` only requires a non-empty box, so it passes on a card whose
 * bottom the scroll container has clipped away — and `shoot` would then capture
 * page pixels from below the panel. The height compared is the one `shoot` will
 * take, not the element's: past MAX_ASPECT it captures the top instead.
 */
async function framed(inspector: Locator, subject: Locator, what: string): Promise<void> {
  const frame = await inspector.boundingBox()
  const box = await subject.boundingBox()
  if (!frame || !box) throw new Error(`${what} has no bounding box`)
  const captured =
    box.height > box.width * MAX_ASPECT
      ? Math.min(box.width * MAX_ASPECT, VIEWPORT.height - Math.max(box.y, 0))
      : box.height
  if (box.y < frame.y || box.y + captured > frame.y + frame.height) {
    throw new Error(
      `${what} is not inside the captured frame: subject ${box.y}+${captured}, ` +
        `panel ${frame.y}+${frame.height}`,
    )
  }
}

/** Select an area by clicking one of its cells, and return the inspector. */
async function selectArea(page: Page, cell: [number, number], areaId: string): Promise<Locator> {
  const point = await cellCenter(page, cell[0], cell[1])
  await page.mouse.click(point.x, point.y)
  await expect(page.getByRole('region', { name: `Area ${areaId}` })).toBeVisible()
  return page.getByLabel('Inspector')
}

/**
 * Scroll a card to the top of the inspector and park the pointer off it.
 *
 * The pointer is left wherever the last gesture put it, and a control still
 * under it renders hovered — a shot of a button mid-hover reads as a state the
 * caption never claimed. (0, 0) is the window corner, outside every card here.
 */
async function settle(card: Locator): Promise<void> {
  await card.evaluate((element) => {
    element.scrollIntoView({ block: 'start' })
  })
  await card.page().mouse.move(0, 0)
}

test('the four content-kind cards', async ({ page }, testInfo) => {
  test.setTimeout(180_000)
  await page.setViewportSize(VIEWPORT)

  const projectDir = join(SHOTS_HOME, testInfo.project.name, 'adventures', 'content-cards.osr')
  rmSync(projectDir, { recursive: true, force: true })
  mkdirSync(join(projectDir, '..'), { recursive: true })
  await createProject(page, projectDir, 'The barrow of the pale king')

  await openMap(page)
  // Four rooms along one corridor, one per shot, joined so the level lints clean.
  await drawRoom(page, [0, 0], [1, 1])
  await drawRoom(page, [3, 0], [4, 1])
  await drawRoom(page, [6, 0], [7, 1])
  await drawRoom(page, [9, 0], [10, 1])
  await page.getByRole('button', { name: 'Corridor tool' }).click()
  for (const [from, to] of [
    [1, 3],
    [4, 6],
    [7, 9],
  ]) {
    await drag(page, await cellCenter(page, from, 0), await cellCenter(page, to, 0))
  }
  await page.getByRole('button', { name: 'Select tool' }).click()
  await expect(page.getByTestId('diagnostics-count')).toHaveText('0')

  // --- the encounter card: area 1 ---
  const inspector = await selectArea(page, [0, 0], '1')
  const encounterCard = inspector.getByTestId('card-encounter')
  await encounterCard.getByRole('button', { name: 'Encounter', exact: true }).click()

  // Two lines, because the alignment select is about what several monsters can
  // agree on: an acolyte takes any alignment, a skeleton only chaotic, so the
  // intersection the card offers is the one the guide describes.
  await encounterCard.getByRole('button', { name: 'Add monster' }).click()
  await page.getByLabel('Count', { exact: true }).fill('3')
  await page.getByPlaceholder('Search monsters…').fill('acolyte')
  await page
    .getByRole('option', { name: /Acolyte/ })
    .first()
    .click()
  await encounterCard.getByRole('button', { name: 'Add monster' }).click()
  await page.getByLabel('Count', { exact: true }).fill('2d4')
  await page.getByPlaceholder('Search monsters…').fill('skeleton')
  await page
    .getByRole('option', { name: /Skeleton/ })
    .first()
    .click()

  await inspector.getByLabel('Alignment').selectOption('chaotic')
  await inspector.getByLabel('Stance').selectOption('hostile')
  await inspector.getByRole('checkbox', { name: /Aware/ }).click()

  const lines = encounterCard.getByLabel('Monster lines').getByRole('listitem')
  await expect(lines).toHaveCount(2)
  await expect(encounterCard.getByLabel('Count for Acolyte')).toHaveValue('3')
  await expect(encounterCard.getByLabel('Count for Skeleton')).toHaveValue('2d4')
  await expect(inspector.getByLabel('Alignment')).toHaveValue('chaotic')
  await expect(inspector.getByLabel('Stance')).toHaveValue('hostile')
  await expect(inspector.getByRole('checkbox', { name: /Aware/ })).toBeChecked()
  await expect(inspector.getByRole('checkbox', { name: /Lair hoard/ })).toBeChecked()
  await settle(encounterCard)
  await framed(inspector, encounterCard, 'the encounter card')
  await shoot(encounterCard, 'encounter-card', testInfo)

  // --- the treasure card: area 2 ---
  await page.route('**/aids/preview', async (route) => {
    const body = route.request().postDataJSON() as Record<string, unknown>
    if (body.kind !== 'treasure') {
      await route.continue()
      return
    }
    await route.continue({
      postData: JSON.stringify({ ...body, seed: TREASURE_SEED }),
    })
  })
  const treasureInspector = await selectArea(page, [3, 0], '2')
  const treasureCard = treasureInspector.getByTestId('card-treasure')
  await treasureCard.getByRole('button', { name: 'Treasure', exact: true }).click()
  await treasureCard.getByRole('button', { name: 'Pick types…' }).click()
  await page.getByRole('option', { name: 'C', exact: true }).click()
  await page.keyboard.press('Escape')
  await expect(treasureCard.getByRole('button', { name: 'C', exact: true })).toBeVisible()
  await expect(treasureCard.getByRole('radio', { name: 'Treasure types' })).toBeChecked()

  await treasureCard.getByRole('button', { name: 'Preview sample hoards' }).click()
  const preview = treasureCard.getByTestId('treasure-preview')
  const samples = preview.locator(':scope > ul > li')
  await expect(samples).toHaveCount(3)
  // The named magic items are the point of the shot, so the shot proves one is
  // there — by shape, not by name, so a table change upstream reads as a table
  // change rather than as this test's business.
  await expect(preview.locator('ul ul li').first()).toBeVisible()
  await settle(treasureCard)
  await framed(treasureInspector, treasureCard, 'the treasure card')
  await shoot(treasureCard, 'treasure-card', testInfo)

  // --- the trap builder: area 3 ---
  const trapInspector = await selectArea(page, [6, 0], '3')
  const trapCard = trapInspector.getByTestId('card-trap')
  await trapCard.getByRole('button', { name: 'Trap', exact: true }).click()

  // A poisoned dart volley: damage unlocks the volley, the save unlocks its
  // modifier and its on-save, the condition unlocks the duration and the unit —
  // every dependent field the guide describes, showing enabled rather than grey.
  await trapCard.getByLabel('Damage').fill('1d4')
  await trapCard.getByLabel('Damage').blur()
  await trapCard.getByLabel('Volley').fill('1d3')
  await trapCard.getByLabel('Volley').blur()
  await trapCard.getByLabel('Save', { exact: true }).selectOption('death')
  await trapCard.getByLabel('Modifier').fill('2')
  await trapCard.getByLabel('Condition').selectOption('poisoned')
  await trapCard.getByLabel('Duration', { exact: true }).fill('2d6')
  await trapCard.getByLabel('Duration', { exact: true }).blur()
  await trapCard.getByLabel('Unit').selectOption('turn')
  await trapCard
    .getByLabel('Manual effect')
    .fill(
      'The dart holes are in the door frame, not the floor — a search of the flagstones finds nothing.',
    )
  await trapCard.getByLabel('Manual effect').blur()

  // The trigger is an authorable choice under osrlib 1.6 — both values live —
  // with the chosen value's springing action named beneath.
  await expect(trapCard.getByLabel('Trigger')).toHaveValue('enter')
  await expect(trapCard.getByText('Springs when the party steps onto a cell of the area.')).toBeVisible()
  await expect(trapCard.getByLabel('Volley')).toBeEnabled()
  await expect(trapCard.getByLabel('Volley')).toHaveValue('1d3')
  await expect(trapCard.getByLabel('On save')).toHaveValue('negates')
  await expect(trapCard.getByLabel('Modifier')).toHaveValue('2')
  await expect(trapCard.getByLabel('Duration', { exact: true })).toBeEnabled()
  await expect(trapCard.getByLabel('Duration', { exact: true })).toHaveValue('2d6')
  await expect(trapCard.getByLabel('Unit')).toBeEnabled()
  await settle(trapCard)
  await framed(trapInspector, trapCard, 'the trap card')
  await shoot(trapCard, 'trap-builder', testInfo)

  // --- the feature editor: area 4 ---
  const featureInspector = await selectArea(page, [9, 0], '4')
  const featuresCard = featureInspector.getByTestId('card-features')
  await featuresCard.getByRole('button', { name: 'Features', exact: true }).click()

  // The id is renamed first: the list keys on it, so a rename remounts the
  // editor and would close everything opened before it.
  await featuresCard.getByTestId('feature-feature-1').getByRole('button').first().click()
  const idField = featuresCard.getByLabel('Id', { exact: true })
  await idField.fill('strongbox')
  await idField.press('Enter')
  const feature = featuresCard.getByTestId('feature-strongbox')
  await expect(feature).toBeVisible()
  await feature.getByRole('button').first().click()

  // A cache, because the contents and the trap render on that kind alone.
  await feature.getByLabel('Kind', { exact: true }).selectOption('treasure_cache')
  await feature
    .getByLabel('Description')
    .fill('An iron-bound chest wedged under the fallen altar stone, its lid crusted shut.')
  await feature.getByLabel('Description').blur()

  // Bound to the cell the chest is on, which is what makes the party stand at it
  // to open it — the guide's advice for a trapped cache.
  await feature.getByRole('button', { name: 'Pick cell…' }).click()
  const picker = feature.getByTestId('mini-level-picker')
  const pickerBox = await picker.boundingBox()
  if (!pickerBox) throw new Error('the cell picker has no bounding box')
  const cellPx = pickerBox.width / 30
  await page.mouse.click(pickerBox.x + 9.5 * cellPx, pickerBox.y + 0.5 * cellPx)
  await expect(feature.getByText('(9, 0)')).toBeVisible()

  // Three items, which wraps the chips onto a second row. That row's 28 pixels
  // are also what moves the aspect-ratio clip from 2 pixels under **Save or die**
  // — complete, but flush against the edge and reading as a slice — into the
  // 14-pixel gap above it, 8 clear pixels below the save row.
  for (const [query, name] of [
    ['silver dagger', /Silver dagger/],
    ['holy water', /Holy water/],
    ['stakes', /Stakes/],
  ] as const) {
    await feature.getByRole('button', { name: 'Add item' }).click()
    await page.getByPlaceholder('Search items…').fill(query)
    await page.getByRole('option', { name }).first().click()
  }
  // A named magic item beside the mundane three — the strongbox's sword +1,
  // the placement the Magic items row exists for.
  await feature.getByRole('button', { name: 'Add magic item' }).click()
  await page.getByPlaceholder('Search magic items…').fill('sword +1')
  await page.getByRole('option', { name: 'Sword +1', exact: true }).click()

  await feature.getByLabel('gp', { exact: true }).fill('250')
  await feature.getByLabel('gp', { exact: true }).blur()
  await feature.getByLabel('sp', { exact: true }).fill('400')
  await feature.getByLabel('sp', { exact: true }).blur()

  // The third of the three things a cache holds. Worth a note: this row was left
  // out of the first capture because at 44 pixels its name field could not show a
  // name, which #45 fixed rather than this shot framing around.
  await feature.getByRole('button', { name: 'Add valuable' }).click()
  await feature.getByLabel('Valuable name').fill('Amber bead')
  await feature.getByLabel('Valuable name').blur()
  await feature.getByLabel('Value (gp)').fill('120')
  await feature.getByLabel('Value (gp)').blur()
  await feature.getByLabel('Weight (coins)').fill('1')
  await feature.getByLabel('Weight (coins)').blur()

  // A poisoned needle in the lock — every field it sets filled in, so nothing in
  // frame reads as an unfinished trap rather than an optional part left unset.
  await feature.getByRole('button', { name: 'Trap this cache' }).click()
  const cacheTrap = feature.getByLabel('Trap')
  await cacheTrap.getByLabel('Damage').fill('1d3')
  await cacheTrap.getByLabel('Damage').blur()
  await cacheTrap.getByLabel('Save', { exact: true }).selectOption('death')
  await cacheTrap.getByLabel('Condition').selectOption('poisoned')
  await cacheTrap.getByLabel('Duration', { exact: true }).fill('1d4')
  await cacheTrap.getByLabel('Duration', { exact: true }).blur()
  await cacheTrap.getByLabel('Unit').selectOption('turn')

  await expect(feature.getByLabel('Kind', { exact: true })).toHaveValue('treasure_cache')
  await expect(feature.getByLabel('Cache items').getByRole('listitem')).toHaveCount(3)
  await expect(feature.getByLabel('Cache magic items').getByRole('listitem')).toHaveCount(1)
  await expect(feature.getByLabel('gp', { exact: true })).toHaveValue('250')
  await expect(feature.getByLabel('sp', { exact: true })).toHaveValue('400')
  await expect(feature.getByLabel('Valuable name')).toHaveValue('Amber bead')
  await expect(feature.getByLabel('Value (gp)')).toHaveValue('120')
  await expect(cacheTrap.getByLabel('Damage')).toHaveValue('1d3')
  await expect(cacheTrap.getByLabel('Duration', { exact: true })).toHaveValue('1d4')
  // A cache's trap springs when the cache is opened, so it shows no trigger
  // field at all — asserted exactly, or `triggerer` in the Affects select
  // would answer for it.
  await expect(cacheTrap.getByText('Trigger', { exact: true })).toHaveCount(0)
  await expect(cacheTrap.getByLabel('On save')).toBeVisible()
  await settle(feature)
  await framed(featureInspector, feature, 'the feature editor')
  await shoot(feature, 'feature-editor', testInfo)
})
