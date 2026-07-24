// Pure helpers the conversion surfaces share: the destination default, the
// lifecycle predicates the polling and control gating read, and the estimate's
// formatting. The band, not the point value, is forge's contract — so the cost
// is always rendered with its "roughly" framing, never as a promise.
import type { ConversionStageRow, ConversionStateName, CostEstimate, Stage } from '@/types'

// Forge's RUNNABLE_STAGES, in chain order: geometry has no independent run —
// it completes inside every assembly.
export const RUNNABLE_STAGES: Stage[] = ['preprocess', 'survey', 'content', 'monsters', 'assemble']

export const MODEL_STAGES: Stage[] = ['survey', 'content', 'monsters']

// The two states that hold a worker. Everything else is idle: the run control
// is live, and polling stops.
export function isActive(state: ConversionStateName): boolean {
  return state === 'estimating' || state === 'running'
}

// The CLI's default, which the dialog prefills and the user may edit:
// <pdf-dir>/<pdf-stem>.forge.
export function defaultWorkdirPath(pdfPath: string): string {
  const trimmed = pdfPath.trim()
  if (!trimmed) return ''
  const cut = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'))
  const directory = cut < 0 ? '' : trimmed.slice(0, cut + 1)
  const file = trimmed.slice(cut + 1)
  const stem = file.replace(/\.pdf$/i, '')
  if (!stem) return ''
  return `${directory}${stem}.forge`
}

// The stage a resume starts from: the first runnable stage that is not
// completed, or assemble when everything is done (re-assembling is all that is
// left to do).
export function firstIncompleteStage(stages: ConversionStageRow[]): Stage {
  for (const stage of RUNNABLE_STAGES) {
    const row = stages.find((candidate) => candidate.stage === stage)
    if (!row || row.status.status !== 'completed') return stage
  }
  return 'assemble'
}

// The model stages a resume from `stage` will actually run — the confirm copy
// names them, because they are what costs money.
export function modelStagesFrom(stage: Stage): Stage[] {
  const start = RUNNABLE_STAGES.indexOf(stage)
  if (start < 0) return []
  return RUNNABLE_STAGES.slice(start).filter((member) => MODEL_STAGES.includes(member))
}

// Previews are rendered from the survey and content caches plus overrides.yaml
// alone — the control appears exactly where those exist and assembly cannot yet
// run.
export function canRegeneratePreviews(stages: ConversionStageRow[]): boolean {
  return (['survey', 'content'] as Stage[]).every(
    (stage) => stages.find((row) => row.stage === stage)?.status.status === 'completed',
  )
}

export function formatUsd(usd: number): string {
  // Sub-cent estimates round to $0.00, which reads as free; say "under $0.01".
  if (usd > 0 && usd < 0.005) return 'under $0.01'
  return `$${usd.toFixed(2)}`
}

export function formatTokens(count: number): string {
  return count.toLocaleString()
}

export interface EstimateRow {
  label: string
  input: number
  output: number
}

// The per-stage token rows the estimate card lists, in chain order.
export function estimateRows(estimate: CostEstimate): EstimateRow[] {
  return [
    {
      label: 'survey',
      input: estimate.survey_input_tokens,
      output: estimate.survey_output_tokens,
    },
    {
      label: 'content',
      input: estimate.content_input_tokens,
      output: estimate.content_output_tokens,
    },
    {
      label: 'monsters',
      input: estimate.monsters_input_tokens,
      output: estimate.monsters_output_tokens,
    },
  ]
}

// "knob=value" → a one-entry settings object; malformed input answers null.
// Shared with the pipeline panel, whose rerun row uses the same grammar.
export function parseKnobEntry(text: string): Record<string, unknown> | null {
  const trimmed = text.trim()
  if (!trimmed) return null
  const separator = trimmed.indexOf('=')
  if (separator <= 0 || separator === trimmed.length - 1) return null
  const key = trimmed.slice(0, separator).trim()
  const raw = trimmed.slice(separator + 1).trim()
  if (!key || !raw) return null
  const asNumber = Number(raw)
  return { [key]: Number.isNaN(asNumber) ? raw : asNumber }
}
