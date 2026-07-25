// The home screen, captured against the pristine server in its genuine first-run
// empty state — which is both what a reader who just ran `uv tool install` sees and
// the only version of this screen that carries no filesystem path at all.
//
// Nothing in this file creates, opens, or converts a project. That is what keeps
// 8633's recents list empty for every future run.
import { expect, test } from '@playwright/test'

import { PRISTINE_URL, shoot } from './capture'

test('the home screen', async ({ page }, testInfo) => {
  // The home screen's `main` is `min-h-screen`, so clipping to it still yields a
  // full viewport of mostly empty paper. Framing the viewport to the content is
  // the honest fix: the whole screen is still in shot, without 60% dead space.
  await page.setViewportSize({ width: 1280, height: 300 })
  await page.goto(PRISTINE_URL)

  await expect(page.getByRole('heading', { name: 'osr-editor' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'New adventure' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Open project' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Convert a PDF' })).toBeVisible()
  // The empty state is the assertion that matters: a recents list with entries
  // would mean this server has been written to, and the shot would leak paths.
  await expect(page.getByText('Nothing here yet')).toBeVisible()

  await shoot(page, 'home-screen', testInfo)
})
