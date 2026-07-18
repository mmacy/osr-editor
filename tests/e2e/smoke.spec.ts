import { expect, test } from '@playwright/test'

import type { StatusResponse } from '../../frontend/src/types'

test('the served page renders the backend-reported status', async ({ page, request }) => {
  const response = await request.get('/api/status')
  expect(response.ok()).toBe(true)
  const status = (await response.json()) as StatusResponse

  await page.goto('/')
  await expect(page).toHaveTitle('osr-editor')
  await expect(page.getByTestId('editor-version')).toHaveText(status.editor_version)
  await expect(page.getByTestId('engine-version')).toHaveText(status.engine_version)
  await expect(page.getByTestId('schema-version')).toHaveText(String(status.schema_version))
})
