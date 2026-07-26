// The capture servers' scratch homes and the produced-shots manifest.
//
// The paths themselves are owned by `playwright.config.ts`, which publishes them
// onto the environment at load time — the config is what points each server's HOME
// at one, and the runner's workers inherit its environment. They are read back here
// rather than duplicated, and rather than imported: `tests/` carries no
// `package.json`, so under the frontend's `nodenext` resolution these modules are
// CommonJS and the config (an ES module) cannot import them at type-check time.
//
// They live at generic absolute locations outside the repository checkout for one
// reason: a dialog renders a path exactly as the spec typed it, and these specs type
// absolute paths. A scratch home inside the tree would put this machine's username
// into every shot of the import and convert dialogs.
import { join } from 'node:path'

// Absent on a non-capture run (`--project=e2e`), where this module is still loaded
// because Playwright resolves globalSetup for every invocation. Returning an empty
// string keeps that path inert; a capture run always has the values, because
// playwright.config.ts publishes them before any spec loads.
function published(name: string): string {
  return process.env[name] ?? ''
}

export const SHOTS_HOME = published('OSR_SHOTS_HOME')
export const PRISTINE_HOME = published('OSR_PRISTINE_HOME')

/** Where the capture harness records the shots it actually ran. */
export const MANIFEST = join(__dirname, '..', '..', 'frontend', 'test-results', 'produced-shots.txt')
