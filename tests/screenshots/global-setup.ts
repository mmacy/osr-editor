// Reset the capture harness's mutable state once per invocation:
//
// - Both scratch homes are removed and recreated, so "pristine" means genuinely
//   empty rather than whatever a previous run left behind. This is what keeps the
//   home-screen shot's first-run empty state honest on a developer machine, whose
//   real config holds a decade of recents with real paths in them.
// - The produced-shots manifest is truncated, so it describes this run alone.
//   Without the reset a deleted shot's slug would survive from an earlier capture
//   and the --produced check would go on passing.
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

import { MANIFEST, PRISTINE_HOME, SHOTS_HOME } from './paths'

export default function globalSetup(): void {
  // Playwright runs globalSetup for every invocation, including `--project=e2e`
  // and the release gate. Nothing here may touch those runs: the plan's promise is
  // that a mistake in the capture environment can never break the shipped
  // artifact's gate, and an unguarded body would falsify it.
  if (!process.env.PLAYWRIGHT_SHOTS) return

  for (const home of [SHOTS_HOME, PRISTINE_HOME]) {
    rmSync(home, { recursive: true, force: true })
    mkdirSync(home, { recursive: true })
  }
  mkdirSync(dirname(MANIFEST), { recursive: true })
  writeFileSync(MANIFEST, '', 'utf-8')
}
