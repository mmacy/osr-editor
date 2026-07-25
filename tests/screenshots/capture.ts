// The capture primitive. Every shot goes through `shoot`, so the rules that keep
// the images reproducible live in one place rather than in twenty-six call sites:
// animations off, no blinking caret, and an output path resolved from the
// repository root rather than from the working directory (Playwright resolves a
// relative `path` against process.cwd(), which is `frontend/` under CI).
//
// The theme suffix comes from the project name, so a shot is written once per test
// and the light/dark pair falls out of the project matrix.
//
// `shoot` also appends its slug to the produced-shots manifest, which is what lets
// `scripts/check_screenshots.py --produced` detect a shot whose test was deleted,
// skipped, or renamed. Comparing the *directory* would be inert: the harness writes
// into `docs/assets/screenshots/`, which arrives from git already holding every
// committed PNG, so a deleted shot's images are still on disk and still referenced.
import { appendFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import type { Locator, Page, TestInfo } from '@playwright/test'

import { MANIFEST } from './paths'

/** The pristine server, reached by absolute URL from the home-screen shot alone. */
export const PRISTINE_URL = 'http://127.0.0.1:8633'

/** The repository root, derived from the project's own testDir. */
export function repoRoot(testInfo: TestInfo): string {
  // testDir is <repo>/tests/screenshots.
  return dirname(dirname(testInfo.project.testDir))
}

function themeOf(testInfo: TestInfo): string {
  const theme = testInfo.project.name.replace(/^shots-/, '')
  if (theme !== 'light' && theme !== 'dark') {
    throw new Error(`capture ran under an unexpected project: ${testInfo.project.name}`)
  }
  return theme
}

// A scrollable panel's `locator.screenshot()` captures its entire scroll extent,
// which for the monster editor is some 4,300 CSS pixels — a hairline ribbon in a
// docs column, and the heaviest file in the set. Past this ratio a shot is clipped
// to its top instead, which is the part a caption is ever talking about.
const MAX_ASPECT = 2.5

/**
 * Write one shot. Pass a `Locator` to clip to the subject, or a `Page` for the
 * four shots whose subject is the whole arrangement.
 */
export async function shoot(
  target: Page | Locator,
  slug: string,
  testInfo: TestInfo,
): Promise<void> {
  const root = repoRoot(testInfo)
  const name = `${slug}-${themeOf(testInfo)}`
  const path = join(root, 'docs', 'assets', 'screenshots', `${name}.png`)
  const options = { animations: 'disabled', caret: 'hide' } as const

  if ('boundingBox' in target) {
    const box = await target.boundingBox()
    if (box && box.height > box.width * MAX_ASPECT) {
      const viewport = target.page().viewportSize()
      const top = Math.max(box.y, 0)
      const available = viewport ? viewport.height - top : box.height
      const height = Math.min(box.width * MAX_ASPECT, available)
      await target
        .page()
        .screenshot({ ...options, path, clip: { x: box.x, y: top, width: box.width, height } })
      appendFileSync(MANIFEST, `${name}\n`, 'utf-8')
      return
    }
  }

  await target.screenshot({ ...options, path })
  // Recorded per theme, not per slug: a shot skipped under one project only would
  // otherwise still have its slug contributed by the other, leaving a stale twin
  // on disk with nothing to notice.
  appendFileSync(MANIFEST, `${name}\n`, 'utf-8')
}
