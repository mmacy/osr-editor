import { homedir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { defineConfig, devices } from '@playwright/test'

// Port 8631 avoids colliding with a developer's live instance on 8630. The
// capture harness takes 8632 and 8633 for the same reason.
// The capture servers' scratch homes, owned here and published onto the
// environment so the specs and the global setup read them back rather than
// duplicating the literals. They sit outside the checkout deliberately: the
// backend does no tilde expansion, so a dialog renders a path exactly as typed,
// and a scratch root inside the tree would put this machine's username into every
// shot of the import and convert dialogs.
const SHOTS_HOME = '/tmp/osr-editor-shots'
const PRISTINE_HOME = '/tmp/osr-editor-pristine'
process.env.OSR_SHOTS_HOME = SHOTS_HOME
process.env.OSR_PRISTINE_HOME = PRISTINE_HOME

const E2E_URL = 'http://127.0.0.1:8631'
const SHOTS_URL = 'http://127.0.0.1:8632'
const PRISTINE_URL = 'http://127.0.0.1:8633'

// A capture server runs under a redirected HOME so `platformdirs` resolves its
// recents into scratch space on macOS as well as Linux — the home screen renders
// each recent's full path, and no committed screenshot may carry a real one.
// `globalSetup` recreates both homes empty on every run.
//
// uv reads its cache and its managed interpreters from HOME too, so both are
// pinned back to the real locations or every server boot would re-download. The
// real home is captured with `homedir()` rather than written as `~`: a Node env
// block performs no tilde expansion and would create a directory named `~`.
function captureEnv(home: string): Record<string, string> {
  return {
    ...(process.env as Record<string, string>),
    HOME: home,
    XDG_CONFIG_HOME: join(home, '.config'),
    UV_CACHE_DIR: join(homedir(), '.cache', 'uv'),
    UV_PYTHON_INSTALL_DIR: join(homedir(), '.local', 'share', 'uv', 'python'),
  }
}

// Playwright starts every `webServer` entry regardless of which projects run, so
// the capture servers are opt-in: without this flag an `--project=e2e` run — and
// the release gate, which is one — boots exactly the server it did before, and a
// mistake in the capture environment can never break the shipped artifact's gate.
const capturing = !!process.env.PLAYWRIGHT_SHOTS

const captureUse = {
  ...devices['Desktop Chrome'],
  baseURL: SHOTS_URL,
  viewport: { width: 1280, height: 800 },
  deviceScaleFactor: 2,
  reducedMotion: 'reduce' as const,
}

export default defineConfig({
  forbidOnly: !!process.env.CI,
  // Resets the capture scratch state so a run always describes itself. Declared
  // only when capturing: an unconditional globalSetup would put the capture
  // modules on the release gate's load path, where a syntax error in one of them
  // could fail a tag build that never takes a screenshot.
  globalSetup: capturing ? '../tests/screenshots/global-setup.ts' : undefined,
  // The capture suite shares one server per port and the backend holds provider
  // configuration and recents process-globally, so the two theme projects must
  // not race each other. The runs also pass --workers=1.
  fullyParallel: false,
  use: { baseURL: E2E_URL },
  projects: [
    { name: 'e2e', testDir: '../tests/e2e', use: { ...devices['Desktop Chrome'] } },
    {
      name: 'shots-light',
      testDir: '../tests/screenshots',
      use: { ...captureUse, colorScheme: 'light' },
    },
    {
      name: 'shots-dark',
      testDir: '../tests/screenshots',
      use: { ...captureUse, colorScheme: 'dark' },
    },
  ],
  webServer: [
    {
      // The real console script against the built static directory, so the suite
      // exercises the CLI, the static mount, and the API in production shape.
      command: 'uv run osr-editor --no-browser --port 8631',
      cwd: '..',
      url: `${E2E_URL}/api/status`,
      reuseExistingServer: !process.env.CI,
      env: {
        ...process.env,
        // Keep e2e recents out of the runner's real config on platforms that
        // honor XDG (CI's Linux); macOS platformdirs ignores this, where a few
        // temp-path recents in a developer's local config are harmless.
        XDG_CONFIG_HOME: fileURLToPath(new URL('./test-results/xdg-config', import.meta.url)),
      },
    },
    ...(capturing
      ? [
          {
            // The capture server: every shot that creates, opens, or converts a
            // project runs here, and its recents accumulate freely.
            command: 'uv run osr-editor --no-browser --port 8632',
            cwd: '..',
            url: `${SHOTS_URL}/api/status`,
            reuseExistingServer: !process.env.CI,
            env: captureEnv(SHOTS_HOME),
          },
          {
            // The pristine server, reached by absolute URL from the home-screen
            // shot alone. Nothing pointed here ever creates, opens, or converts
            // anything, so its recents list stays genuinely empty — which is also
            // what a reader who just installed the editor actually sees.
            command: 'uv run osr-editor --no-browser --port 8633',
            cwd: '..',
            url: `${PRISTINE_URL}/api/status`,
            reuseExistingServer: !process.env.CI,
            env: captureEnv(PRISTINE_HOME),
          },
        ]
      : []),
  ],
})
