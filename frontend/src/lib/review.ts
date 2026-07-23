// The review queue's pure logic: the flag grammar, row building, dismissal
// marks, and the forge report-address → NavTarget mapping. The queue is a work
// list of *flags*, so its rows are the areas (and the module) that carry at
// least one — a flagless area gets no row.
import type { NavTarget } from '@/lib/address'
import type { Adventure, AreaReport, EditorSidecar, ExtractionReport, ReviewMark } from '@/types'

// Forge's enumerated flag vocabulary — the contract's own members, mirrored as
// wire values (the type-level suite pins the report's flag strings loosely;
// this list is what the badge renderer keys on).
export const FLAGS = [
  'geometry_synthesized',
  'monster_unresolved',
  'monster_custom',
  'low_confidence',
  'connection_ambiguous',
  'transition_guessed',
  'treasure_unparsed',
  'page_unreadable',
] as const

export type FlagKind = (typeof FLAGS)[number]

export interface ParsedFlag {
  flag: FlagKind
  detail: string | null
}

// Forge's `<flag>` / `<flag>:<detail>` grammar, split exactly as the
// contract's own parser splits it: prefix up to the first colon must be a
// known flag; the detail is free text and may itself contain colons. An
// unknown prefix answers null — render the string verbatim, never guess.
export function parseFlag(value: string): ParsedFlag | null {
  const separator = value.indexOf(':')
  const prefix = separator === -1 ? value : value.slice(0, separator)
  if (!(FLAGS as readonly string[]).includes(prefix)) return null
  if (separator === -1) return { flag: prefix as FlagKind, detail: null }
  const detail = value.slice(separator + 1)
  if (!detail) return null
  return { flag: prefix as FlagKind, detail }
}

export interface ReviewFlag {
  // The exact serialized flag string — the dismissal mark's key.
  value: string
  parsed: ParsedFlag | null
  dismissed: boolean
}

export interface ReviewRow {
  // The forge report address (`dungeon/level/area`), or '' for the module row.
  address: string
  label: string
  confidence: number | null
  overridden: readonly string[]
  flags: ReviewFlag[]
}

function isDismissed(marks: readonly ReviewMark[], address: string, flag: string): boolean {
  return marks.some((mark) => mark.address === address && mark.flag === flag)
}

// Rows in report order: module-scope flags lead as a row at address '', then
// per-area rows for areas carrying at least one flag. Dismissal is per flag,
// matching the {address, flag} mark grain.
export function buildReviewRows(report: ExtractionReport, sidecar: EditorSidecar): ReviewRow[] {
  const marks = sidecar.review
  const rows: ReviewRow[] = []
  if (report.flags.length > 0) {
    rows.push({
      address: '',
      label: 'Module',
      confidence: null,
      overridden: [],
      flags: report.flags.map((value) => ({
        value,
        parsed: parseFlag(value),
        dismissed: isDismissed(marks, '', value),
      })),
    })
  }
  for (const area of report.areas) {
    if (area.flags.length === 0) continue
    rows.push({
      address: area.id,
      label: `Area ${area.id.split('/').slice(1).join('/')}`,
      confidence: area.confidence,
      overridden: area.overridden,
      flags: area.flags.map((value) => ({
        value,
        parsed: parseFlag(value),
        dismissed: isDismissed(marks, area.id, value),
      })),
    })
  }
  return rows
}

export function rowFullyDismissed(row: ReviewRow): boolean {
  return row.flags.every((flag) => flag.dismissed)
}

// The header's honest work-remaining number: undismissed flags, not rows.
export function undismissedFlagCount(rows: readonly ReviewRow[]): number {
  return rows.reduce((count, row) => count + row.flags.filter((flag) => !flag.dismissed).length, 0)
}

export interface ForgeAreaAddress {
  dungeonId: string
  levelNumber: number
  areaKey: string
}

// Forge's report-address grammar (`dungeon/level/area`) — distinct from the
// diagnostics address grammar; dungeon ids and area keys are forge's
// canonical slugs, so a plain split is unambiguous.
export function parseForgeAreaAddress(address: string): ForgeAreaAddress | null {
  const parts = address.split('/')
  if (parts.length !== 3) return null
  const levelNumber = Number(parts[1])
  if (!Number.isInteger(levelNumber) || levelNumber < 1 || !parts[0] || !parts[2]) return null
  return { dungeonId: parts[0], levelNumber, areaKey: parts[2] }
}

// A review row's navigation: the module row lands on the adventure form; an
// area row lands on its level with the area selected — resolved against the
// document, unnavigable when the area is gone (a removed-area tombstone).
export function reviewRowTarget(address: string, document: Adventure): NavTarget | null {
  if (address === '') return { kind: 'adventure' }
  const parsed = parseForgeAreaAddress(address)
  if (!parsed) return null
  const level = document.dungeons
    .find((dungeon) => dungeon.id === parsed.dungeonId)
    ?.levels.find((candidate) => candidate.number === parsed.levelNumber)
  if (!level) return null
  if (!level.areas.some((area) => area.id === parsed.areaKey)) {
    return {
      kind: 'level',
      dungeonId: parsed.dungeonId,
      levelNumber: parsed.levelNumber,
    }
  }
  return {
    kind: 'level',
    dungeonId: parsed.dungeonId,
    levelNumber: parsed.levelNumber,
    focus: { type: 'area', areaId: parsed.areaKey },
  }
}

// The report record for an area id, if any — the source-pages pane's input.
export function areaReportFor(
  report: ExtractionReport | undefined,
  dungeonId: string,
  levelNumber: number,
  areaId: string,
): AreaReport | null {
  if (!report) return null
  const address = `${dungeonId}/${levelNumber}/${areaId}`
  return report.areas.find((area) => area.id === address) ?? null
}
