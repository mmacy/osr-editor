// The phase 16 milestone loop, deterministic half, end to end against the
// real CLI and built frontend: create a native project; draw the lever room
// and cut the portcullis door; gate the door flag_equals on the portcullis
// key through the door inspector; add the trigger from the area context menu
// (one gesture on the map, deep editing in the panel); complete it in the
// Quests panel — the SetFlag consequence, fired and journal text; add a
// second trigger and reorder to prove MoveTrigger end to end; validation
// clean; publish; and assert the published payload carries the triggers in
// authored order with the gate beside them. The milestone's played half —
// the portcullis refusing in osr-web until the lever room is entered and
// opening after — runs manually against the sibling checkout and is recorded
// in the PR, the established pattern.
import { cpSync, lstatSync, mkdirSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, test } from '@playwright/test'

import { cellCenter, createProject, drawRoom, edgePoint, openMap } from './helpers'

const FORGE_FIXTURE = join(__dirname, '..', 'fixtures', 'forge_workdir')

interface StampedDocument {
  kind: string
  payload: {
    dungeons: {
      id: string
      levels: {
        number: number
        edges: Record<
          string,
          {
            kind: string
            door: {
              requires: {
                condition: { condition_type: string; key?: string; value?: unknown }
                narrative: { refusal: string; success: string } | null
              } | null
            } | null
          }
        >
      }[]
    }[]
    triggers: {
      id: string
      when: { pattern_type: string; dungeon_id?: string; level_number?: number; area_id?: string }
      conditions: unknown[]
      repeatable: boolean
      consequences: {
        command_type: string
        key?: string
        value?: unknown
        source: string | null
      }[]
      narrative: { fired: string; journal: string } | null
    }[]
  }
}

test('the lever, the portcullis gate, the panel, reorder, publish', async ({ page }) => {
  test.setTimeout(120_000)
  const workspace = mkdtempSync(join(tmpdir(), 'osr-editor-e2e-triggers-'))
  const projectDir = join(workspace, 'mill.osr')
  const checkout = join(workspace, 'osr-web')
  mkdirSync(join(checkout, 'adventures'), { recursive: true })

  await createProject(page, projectDir, 'The wheel room')

  // The lever room, and the portcullis door on its east wall.
  await openMap(page)
  await drawRoom(page, [0, 0], [1, 1])
  await expect(page.getByTestId('revision')).toHaveText('r2')
  await page.getByRole('button', { name: 'Wall and door tool' }).click()
  const doorway = await edgePoint(page, [1, 0], [2, 0])
  await page.mouse.click(doorway.x, doorway.y)
  await page.mouse.click(doorway.x, doorway.y)
  await expect(page.getByTestId('revision')).toHaveText('r4')

  // The flag gate on the portcullis: flag_equals on the key the lever writes,
  // with authored refusal and success text.
  await page.getByRole('button', { name: 'Select tool' }).click()
  await page.mouse.click(doorway.x, doorway.y)
  const inspector = page.getByLabel('Inspector')
  await expect(inspector.getByLabel('Kind', { exact: true })).toHaveValue('door')
  await inspector.getByRole('button', { name: 'Add gate' }).click()
  await inspector.getByLabel('Condition kind').selectOption('flag_equals')
  const gateKey = inspector.getByLabel('Flag key')
  await gateKey.fill('wheel.lever')
  await gateKey.press('Tab')
  const gateValue = inspector.getByLabel('Value')
  await gateValue.fill('pulled')
  await gateValue.press('Tab')
  const refusal = inspector.getByLabel('Refusal')
  await refusal.fill('The portcullis holds fast.')
  await refusal.press('Tab')
  const success = inspector.getByLabel('Success')
  await success.fill('The portcullis stands raised.')
  await success.press('Tab')
  await expect(inspector.getByLabel('Refusal')).toHaveValue('The portcullis holds fast.')

  // The trigger, from the area context menu: one gesture mints an
  // area_entered trigger bound to the room and lands in the Quests panel.
  const roomCell = await cellCenter(page, 0, 0)
  await page.mouse.click(roomCell.x, roomCell.y, { button: 'right' })
  await page.getByRole('menuitem', { name: 'Add trigger' }).click()
  await expect(page.getByTestId('trigger-detail-trigger-1')).toBeVisible()
  await expect(page.getByLabel('Area')).toHaveValue('1')

  // The lever's one consequence: SetFlag writing the key the gate reads —
  // typed text end to end, because osrlib's flag equality is strict.
  await page.getByRole('button', { name: 'Add consequence' }).click()
  await expect(page.getByLabel('Command')).toHaveValue('set_flag')
  await page.getByLabel('Type').selectOption('text')
  const flagKey = page.getByLabel('Flag key')
  await flagKey.fill('wheel.lever')
  await flagKey.press('Tab')
  const flagValue = page.getByLabel('Value')
  await flagValue.fill('pulled')
  await flagValue.press('Tab')
  await expect(page.getByLabel('Value')).toHaveValue('pulled')

  // The two narrative voices: fired is the referee's line, journal the players'.
  const fired = page.getByLabel('Fired')
  await fired.fill('The counterweight drops; iron rises somewhere east.')
  await fired.press('Tab')
  const journal = page.getByLabel('Journal')
  await journal.fill('A worn lever moved under our hands, and a portcullis answered.')
  await journal.press('Tab')
  await expect(page.getByLabel('Journal')).toHaveValue(
    'A worn lever moved under our hands, and a portcullis answered.',
  )

  // A second trigger through the create dialog, then reorder — MoveTrigger
  // end to end, order rendered as the semantics it is.
  await page.getByRole('button', { name: 'New trigger' }).click()
  const createDialog = page.getByRole('dialog')
  await expect(createDialog.getByLabel('Id')).toHaveValue('trigger-2')
  await createDialog.getByLabel('Fires').selectOption('town_entered')
  await createDialog.getByRole('button', { name: 'Create' }).click()
  await expect(page.getByTestId('trigger-detail-trigger-2')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Move trigger-1 up' })).toBeDisabled()
  await page.getByRole('button', { name: 'Move trigger-2 up' }).click()
  const rows = page.locator('[data-testid^="trigger-row-"]')
  await expect(rows.first()).toHaveAttribute('data-testid', 'trigger-row-trigger-2')
  await expect(page.getByRole('button', { name: 'Move trigger-2 up' })).toBeDisabled()

  // Validation clean; publish symlink-mode; the payload carries the triggers
  // in authored order with the gate beside them, source null round-tripped.
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
  const dungeonId = document.payload.dungeons[0].id
  expect(document.payload.triggers.map((trigger) => trigger.id)).toEqual([
    'trigger-2',
    'trigger-1',
  ])
  expect(document.payload.triggers[0].when).toEqual({ pattern_type: 'town_entered' })
  const lever = document.payload.triggers[1]
  expect(lever.when).toEqual({
    pattern_type: 'area_entered',
    dungeon_id: dungeonId,
    level_number: 1,
    area_id: '1',
  })
  expect(lever.repeatable).toBe(false)
  expect(lever.conditions).toEqual([])
  expect(lever.consequences).toEqual([
    expect.objectContaining({
      command_type: 'set_flag',
      key: 'wheel.lever',
      value: 'pulled',
      source: null,
    }),
  ])
  expect(lever.narrative).toMatchObject({
    fired: 'The counterweight drops; iron rises somewhere east.',
    journal: 'A worn lever moved under our hands, and a portcullis answered.',
  })
  const portcullis = document.payload.dungeons[0].levels[0].edges['2,0:west']
  expect(portcullis.kind).toBe('door')
  expect(portcullis.door?.requires).toMatchObject({
    condition: { condition_type: 'flag_equals', key: 'wheel.lever', value: 'pulled' },
    narrative: expect.objectContaining({
      refusal: 'The portcullis holds fast.',
      success: 'The portcullis stands raised.',
    }),
  })
})

test('the forge posture: the Quests explanation body, and a map add-trigger blocks', async ({
  page,
}) => {
  test.setTimeout(120_000)
  const workspace = mkdtempSync(join(tmpdir(), 'osr-editor-e2e-triggers-forge-'))
  const workdir = join(workspace, 'millstone.forge')
  cpSync(FORGE_FIXTURE, workdir, { recursive: true })

  await page.goto('/')
  await page.getByRole('button', { name: 'Open project' }).click()
  await page.getByLabel('Project directory').fill(workdir)
  await page.getByRole('dialog').getByRole('button', { name: 'Open' }).click()
  await expect(page.getByTestId('revision')).toHaveText('r1')

  // The Quests entry is present and navigates to the honest explanation body
  // — no list, since a forge-assembled document can never carry triggers; the
  // gap is forge's recorded decision, with detach in place.
  await page.getByRole('button', { name: 'Quests', exact: true }).click()
  await expect(page.getByText(/carries no triggers or quests/)).toBeVisible()
  await expect(page.getByRole('link', { name: 'osr-forge#39' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Detach to a native project…' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'New trigger' })).toHaveCount(0)

  // A map add-trigger lands in the blocked-op dialog client-side — nobody
  // builds a trigger just to be refused; the server's 422 stays the authority
  // for any batch that arrives.
  await page.getByRole('button', { name: 'Level 1', exact: true }).click()
  await expect(page.getByTestId('map-canvas')).toBeVisible()
  await page.getByRole('button', { name: 'Reset zoom' }).click()
  const areaCell = await cellCenter(page, 0, 0)
  await page.mouse.click(areaCell.x, areaCell.y, { button: 'right' })
  await page.getByRole('menuitem', { name: 'Add trigger' }).click()
  const blocked = page.getByRole('dialog')
  await expect(blocked.getByText('This edit needs a native project')).toBeVisible()
  await expect(blocked.getByText(/triggers have no override kind/)).toBeVisible()
  await expect(blocked.getByRole('button', { name: 'Detach…' })).toBeVisible()
  await blocked.getByRole('button', { name: 'Cancel' }).click()
  // Nothing committed: the revision never moved.
  await expect(page.getByTestId('revision')).toHaveText('r1')
})
