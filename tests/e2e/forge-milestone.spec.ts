// The phase 5 milestone loop, end to end against the real CLI and built
// frontend: open a flagged forge workdir, review its flags, correct a flagged
// area from the printed page, remap and patch its monsters, dismiss a reviewed
// flag, run check, and publish live in symlink mode — with overrides.yaml as the
// reviewable record.
import { cpSync, mkdirSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, test } from '@playwright/test'

// Playwright transpiles specs to CJS, so __dirname is the reliable anchor.
const FIXTURE = join(__dirname, '..', 'fixtures', 'forge_workdir')

test('open a flagged workdir, correct it, and publish live with overrides.yaml as the record', async ({ page }) => {
  const workspace = mkdtempSync(join(tmpdir(), 'osr-editor-forge-'))
  const workdir = join(workspace, 'vault.forge')
  cpSync(FIXTURE, workdir, { recursive: true })
  const checkout = join(workspace, 'osr-web')
  mkdirSync(join(checkout, 'adventures'), { recursive: true })

  await page.goto('/')

  // Open the forge workdir.
  await page.getByRole('button', { name: 'Open project' }).click()
  await page.getByLabel('Project directory').fill(workdir)
  await page.getByRole('dialog').getByRole('button', { name: 'Open' }).click()
  await expect(page.getByTestId('revision')).toHaveText('r1')

  // The forge review chrome appears, with flags to review.
  await page.getByRole('button', { name: 'Review', exact: true }).click()
  await expect(page.getByTestId('review-count')).not.toHaveText('0')
  await expect(page.getByText('Low confidence').first()).toBeVisible()

  // Correct the flagged silt-choked cell's description against the printed page.
  await page.getByRole('button', { name: /^Area 3/ }).click()
  await expect(page.getByLabel('Source pages')).toBeVisible()
  const description = page.getByLabel('Description')
  await expect(description).toBeVisible()
  await description.fill('A silt-choked cell where the drowned cult once caged its prisoners.')
  // The description is a textarea — it commits on blur, not Enter.
  await description.press('Tab')
  await expect(page.getByTestId('revision')).toHaveText('r2')

  // Resolve the monsters: remap the unresolved one, patch the custom one's block.
  await page.getByRole('button', { name: 'Monsters', exact: true }).click()
  await page.getByRole('button', { name: 'Remap' }).first().click()
  await page.getByPlaceholder('Search monsters…').fill('hobgoblin')
  await page.getByRole('option', { name: /Hobgoblin/i }).first().click()
  await expect(page.getByTestId('revision')).toHaveText('r3')

  await page.getByRole('button', { name: 'Printed block' }).first().click()
  await page.getByLabel('Armour class').fill('4')
  await page.getByLabel('Hit dice').fill('4+1')
  await page.getByRole('button', { name: 'Apply patch' }).click()
  await expect(page.getByTestId('revision')).toHaveText('r4')

  // Dismiss a reviewed flag — the header count falls.
  await page.getByRole('button', { name: 'Review', exact: true }).click()
  const before = Number(await page.getByTestId('review-count').textContent())
  // The dismissal is an async sidecar patch — click and let the count settle.
  await page.getByLabel(/^Dismiss /).first().click()
  await expect(page.getByTestId('review-count')).toHaveText(String(before - 1))

  // Run check — the delve findings surface.
  await page.getByRole('button', { name: 'Pipeline', exact: true }).click()
  await page.getByRole('button', { name: /^Check|^Re-check/ }).click()
  await expect(page.getByTestId('diagnostics-count')).not.toHaveText('0')

  // The corrections panel is the reviewable record.
  await page.getByRole('button', { name: 'Corrections', exact: true }).click()
  await expect(page.getByText('printed stat block corrected')).toBeVisible()

  // Publish live in symlink mode, through the warnings confirm.
  await page.getByRole('button', { name: 'Publish' }).click()
  await page.getByLabel('osr-web checkout').fill(checkout)
  const publish = page.getByRole('dialog').getByRole('button', { name: 'Publish', exact: true })
  await publish.click()
  const anyway = page.getByRole('button', { name: 'Publish anyway' })
  if (await anyway.isVisible().catch(() => false)) await anyway.click()
  await expect(page.getByText(/Published to/)).toBeVisible()

  // overrides.yaml holds exactly the session's entries with their reasons.
  const overrides = readFileSync(join(workdir, 'overrides.yaml'), 'utf-8')
  expect(overrides).toContain('sunken-vault/1/3')
  expect(overrides).toContain('drowned one')
  expect(overrides).toContain('vault warden')
  expect(overrides).toContain('reason:')

  // The symlink publish resolves to the workdir — osr-web reads its adventure.json.
  const linked = readFileSync(join(checkout, 'adventures', 'vault', 'adventure.json'), 'utf-8')
  expect(JSON.parse(linked).kind).toBe('adventure')
})
