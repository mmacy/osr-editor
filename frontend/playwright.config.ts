import { fileURLToPath } from 'node:url'

import { defineConfig, devices } from '@playwright/test'

// Port 8631 avoids colliding with a developer's live instance on 8630.
const BASE_URL = 'http://127.0.0.1:8631'

export default defineConfig({
  testDir: '../tests/e2e',
  forbidOnly: !!process.env.CI,
  use: { baseURL: BASE_URL },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    // The real console script against the built static directory, so the suite
    // exercises the CLI, the static mount, and the API in production shape.
    command: 'uv run osr-editor --no-browser --port 8631',
    cwd: '..',
    url: `${BASE_URL}/api/status`,
    reuseExistingServer: !process.env.CI,
    env: {
      ...process.env,
      // Keep e2e recents out of the runner's real config on platforms that
      // honor XDG (CI's Linux); macOS platformdirs ignores this, where a few
      // temp-path recents in a developer's local config are harmless.
      XDG_CONFIG_HOME: fileURLToPath(new URL('./test-results/xdg-config', import.meta.url)),
    },
  },
})
