import { expect, test } from '@playwright/test'

import type { StatusResponse } from '../../frontend/src/types'

test('the served page boots to the home screen and the API answers', async ({ page, request }) => {
  const response = await request.get('/api/status')
  expect(response.ok()).toBe(true)
  const status = (await response.json()) as StatusResponse
  expect(status.editor_version).toBeTruthy()

  await page.goto('/')
  await expect(page).toHaveTitle('osr-editor')
  await expect(page.getByRole('heading', { name: 'osr-editor' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'New adventure' })).toBeVisible()
})
