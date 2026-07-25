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
// reason: the editor's backend does no tilde expansion, so any path a dialog
// renders is shown exactly as typed. A scratch home inside the tree would put this
// machine's username into every shot of the import and convert dialogs.
import { join } from 'node:path'

function required(name: string): string {
  const value = process.env[name]
  if (!value) {
    throw new Error(`${name} is unset — the capture specs must run through playwright.config.ts`)
  }
  return value
}

export const SHOTS_HOME = required('OSR_SHOTS_HOME')
export const PRISTINE_HOME = required('OSR_PRISTINE_HOME')

/** Where the capture harness records the shots it actually ran. */
export const MANIFEST = join(__dirname, '..', '..', 'frontend', 'test-results', 'produced-shots.txt')
