// The phase 17 milestone loop, deterministic half, end to end against the
// real CLI and built frontend: create a native project; author the idol as a
// bundled item (clone a catalog gear item to a free id); cache it in a drawn
// room; create the concluding fetch quest through the dialog — the objective
// completing on acquiring the idol; add the dungeon-entered activation, the
// grant-and-award rewards, concludes_adventure, and the offer and completion
// beats; add a second quest and reorder to prove MoveQuest end to end;
// validation clean; publish; and assert the published payload carries the
// quests in authored order with the milestone's whole shape and source: null
// intact. The milestone's played half — the offer journaling on entering the
// dungeon, the idol taken, the victory screen reached in osr-web — runs
// manually against the sibling checkout and is recorded in the PR, the
// established pattern.
import { lstatSync, mkdirSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, test } from '@playwright/test'

import { cellCenter, createProject, drawRoom, openMap } from './helpers'

interface Clause {
  pattern: { pattern_type: string; dungeon_id?: string; item_id?: string }
  conditions: unknown[]
}

interface StampedDocument {
  kind: string
  payload: {
    items: { item_type: string; id: string; name: string }[]
    dungeons: {
      id: string
      levels: { areas: { features: { kind: string; item_ids: string[] }[] }[] }[]
    }[]
    quests: {
      id: string
      name: string
      activation: Clause | null
      objectives: {
        id: string
        name: string
        when: Clause
        hidden: boolean
        reveal_when: Clause | null
        narrative: { progress: string } | null
      }[]
      rewards: {
        command_type: string
        character_id?: string
        coins?: Record<string, number>
        amount?: number
        source: string | null
      }[]
      completion: string
      concludes_adventure: boolean
      narrative: { offer: string; completion: string; speaker: string } | null
    }[]
  }
}

test('the idol, the concluding fetch quest, reorder, publish', async ({ page }) => {
  test.setTimeout(120_000)
  const workspace = mkdtempSync(join(tmpdir(), 'osr-editor-e2e-quests-'))
  const projectDir = join(workspace, 'mill.osr')
  const checkout = join(workspace, 'osr-web')
  mkdirSync(join(checkout, 'adventures'), { recursive: true })

  await createProject(page, projectDir, 'The millstone idol')

  // Author the idol: clone a catalog gear item to a free id.
  await page.getByRole('button', { name: 'Items', exact: true }).click()
  await page.getByRole('button', { name: 'Clone catalog item' }).click()
  await page.getByPlaceholder('Search items…').fill('torch')
  await page
    .getByRole('option', { name: /^Torch/ })
    .first()
    .click()
  await page.getByLabel('Name').fill('The millstone idol')
  await page.getByRole('button', { name: 'Add to the adventure' }).click()
  await expect(page.getByTestId('item-detail-torch-1')).toBeVisible()
  const idField = page.getByLabel('Id')
  await idField.fill('millstone-idol')
  await idField.press('Enter')
  await expect(page.getByTestId('item-detail-millstone-idol')).toBeVisible()

  // The room, with the idol cached in it — the objective's target placed.
  await openMap(page)
  await drawRoom(page, [0, 0], [1, 1])
  const cacheCell = await cellCenter(page, 1, 1)
  await page.mouse.click(cacheCell.x, cacheCell.y, { button: 'right' })
  await page.getByRole('menuitem', { name: 'Add feature' }).click()
  const inspector = page.getByLabel('Inspector')
  await inspector.getByTestId('feature-feature-1').getByRole('button').first().click()
  await inspector.getByLabel('Kind', { exact: true }).selectOption({ label: 'Treasure cache' })
  await inspector.getByRole('button', { name: 'Add item' }).click()
  const bundledOption = page.getByRole('option', { name: /The millstone idol/ })
  await expect(bundledOption).toContainText('bundled')
  await bundledOption.click()
  await expect(inspector.getByLabel('Cache items')).toContainText('The millstone idol')

  // The quest, through the create dialog: a name and one objective whose
  // completion matches the idol's id — a QuestSpec parses only with both.
  await page.getByRole('button', { name: 'Quests', exact: true }).click()
  await page.getByRole('button', { name: 'New quest' }).click()
  const createDialog = page.getByRole('dialog')
  await expect(createDialog.getByLabel('Id')).toHaveValue('quest-1')
  await createDialog.getByLabel('Name').fill("The miller's idol")
  await createDialog.getByLabel('Fires').selectOption('item_acquired')
  await createDialog.getByRole('button', { name: 'Pick item' }).click()
  await page
    .getByRole('option', { name: /The millstone idol/ })
    .first()
    .click()
  await createDialog.getByRole('button', { name: 'Create' }).click()
  await expect(page.getByTestId('quest-detail-quest-1')).toBeVisible()

  // The objective's display name — the quest log's label.
  const objectiveName = page.locator('#objective-0-name')
  await objectiveName.fill('Recover the millstone idol')
  await objectiveName.press('Tab')
  await expect(page.locator('#objective-0-name')).toHaveValue('Recover the millstone idol')

  // The activation: entering the dungeon replaces the standing charge, and
  // the offer beat journals at that moment.
  await expect(page.getByLabel('Activation')).toContainText('Standing charge')
  await page.getByRole('button', { name: 'Add activation' }).click()
  await page.locator('#quest-activation-pattern-kind').selectOption('dungeon_entered')
  await page.locator('#quest-activation-pattern-dungeon').selectOption({ index: 1 })

  // The rewards: coins granted and XP awarded — the award prices the quest
  // where granted treasure never does, silencing quest_reward_unpriced.
  await page.getByRole('button', { name: 'Add reward' }).click()
  await page.locator('#quest-reward-new-command-kind').selectOption('grant_coins')
  const gp = page.locator('#quest-reward-0-coins-gp')
  await gp.fill('200')
  await gp.press('Tab')
  await expect(page.locator('#quest-reward-0-coins-gp')).toHaveValue('200')
  await page.getByRole('button', { name: 'Add reward' }).click()
  await page.locator('#quest-reward-new-command-kind').selectOption('award_xp')
  const xp = page.locator('#quest-reward-1-xp-amount')
  await xp.fill('400')
  await xp.press('Tab')
  await expect(page.locator('#quest-reward-1-xp-amount')).toHaveValue('400')

  // The one authored field behind victory.
  await page.getByRole('checkbox', { name: 'Concludes the adventure' }).click()
  await expect(page.getByTestId('quest-row-quest-1')).toContainText('concludes')

  // The quest's beats, journaling as themselves, with a speaker.
  const offer = page.locator('#quest-narrative-offer')
  await offer.fill('Bring back the idol and the estate settles every debt.')
  await offer.press('Tab')
  const completion = page.locator('#quest-narrative-completion')
  await completion.fill('The idol changes hands and the ledgers close.')
  await completion.press('Tab')
  const speaker = page.locator('#quest-narrative-speaker')
  await speaker.fill("The creditors' clerk")
  await speaker.press('Tab')
  const progress = page.locator('#objective-0-narrative-progress')
  await progress.fill('The idol is cold in your pack.')
  await progress.press('Tab')
  await expect(page.locator('#quest-narrative-speaker')).toHaveValue("The creditors' clerk")

  // A second quest through the dialog, then reorder — MoveQuest end to end,
  // order rendered as the semantics it is.
  await page.getByRole('button', { name: 'New quest' }).click()
  const secondDialog = page.getByRole('dialog')
  await expect(secondDialog.getByLabel('Id')).toHaveValue('quest-2')
  await secondDialog.getByLabel('Name').fill('Errands in Dusthollow')
  await secondDialog.getByLabel('Fires').selectOption('town_entered')
  await secondDialog.getByRole('button', { name: 'Create' }).click()
  await expect(page.getByTestId('quest-detail-quest-2')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Move quest-1 up' })).toBeDisabled()
  await page.getByRole('button', { name: 'Move quest-2 up' }).click()
  const rows = page.locator('[data-testid^="quest-row-"]')
  await expect(rows.first()).toHaveAttribute('data-testid', 'quest-row-quest-2')
  await expect(page.getByRole('button', { name: 'Move quest-2 up' })).toBeDisabled()

  // Validation clean; publish symlink-mode; the payload carries the quests in
  // authored order with the milestone's whole shape, source null intact.
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
  expect(document.payload.items).toEqual([
    expect.objectContaining({ item_type: 'gear', id: 'millstone-idol', name: 'The millstone idol' }),
  ])
  expect(document.payload.dungeons[0].levels[0].areas[0].features[0]).toMatchObject({
    kind: 'treasure_cache',
    item_ids: ['millstone-idol'],
  })
  expect(document.payload.quests.map((quest) => quest.id)).toEqual(['quest-2', 'quest-1'])
  expect(document.payload.quests[0].activation).toBeNull()
  const fetchQuest = document.payload.quests[1]
  expect(fetchQuest.name).toBe("The miller's idol")
  expect(fetchQuest.activation).toEqual({
    pattern: { pattern_type: 'dungeon_entered', dungeon_id: dungeonId },
    conditions: [],
  })
  expect(fetchQuest.objectives).toEqual([
    expect.objectContaining({
      id: 'objective-1',
      name: 'Recover the millstone idol',
      when: {
        pattern: { pattern_type: 'item_acquired', item_id: 'millstone-idol' },
        conditions: [],
      },
      hidden: false,
      reveal_when: null,
      narrative: expect.objectContaining({ progress: 'The idol is cold in your pack.' }),
    }),
  ])
  expect(fetchQuest.rewards).toEqual([
    expect.objectContaining({
      command_type: 'grant_coins',
      character_id: '@party',
      coins: expect.objectContaining({ gp: 200 }),
      source: null,
    }),
    expect.objectContaining({
      command_type: 'award_xp',
      character_id: '@party',
      amount: 400,
      source: null,
    }),
  ])
  expect(fetchQuest.completion).toBe('all')
  expect(fetchQuest.concludes_adventure).toBe(true)
  expect(fetchQuest.narrative).toMatchObject({
    offer: 'Bring back the idol and the estate settles every debt.',
    completion: 'The idol changes hands and the ledgers close.',
    speaker: "The creditors' clerk",
  })
})
