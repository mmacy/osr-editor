// The editor-side twin of forge's own `minimod_workdir`: the estimate's product,
// built from the committed renders the fixtures were recorded against.
//
// Never a fresh render. Request fingerprints hash the page bytes, and PNG
// byte-stability across pdfium and Pillow versions is explicitly not forge's
// contract, so a freshly rendered workdir would miss every recorded fixture.
//
// Shared by the conversion e2e spec and the capture harness, which drives the
// same resume to reach the review chrome its shots need.
import { cpSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export const MINIMOD = join(__dirname, '..', 'assets', 'minimod')
export const PAGE_COUNT = 5

export function fabricateWarmWorkdir(root: string): void {
  mkdirSync(root, { recursive: true })
  cpSync(join(MINIMOD, 'minimod.pdf'), join(root, 'source.pdf'))
  cpSync(join(MINIMOD, 'pages'), join(root, 'pages'), { recursive: true })
  const pending = { status: 'pending' }
  writeFileSync(
    join(root, 'run.json'),
    JSON.stringify(
      {
        source_sha256: '0'.repeat(64),
        source_bytes: 1,
        page_count: PAGE_COUNT,
        settings: {},
        stages: {
          preprocess: {
            status: 'completed',
            started_at: '2026-07-09T12:00:00+00:00',
            finished_at: '2026-07-09T12:00:05+00:00',
          },
          survey: pending,
          content: pending,
          monsters: pending,
          geometry: pending,
          assemble: pending,
        },
      },
      null,
      2,
    ),
  )
}
