// The edge_invalid remediation: the one error-severity finding only foreign
// documents produce is a click to fix. The action resolves its key by
// enumeration, never extraction — the builder recomputes the level's invalid
// keys against the committed document, renders each key's message exactly as
// the lint does, and acts on the key whose rendering equals the finding's
// message. No match (a stale finding) returns no ops; a hostile key can at
// worst decline the click.
import { invalidEdgeKeyMessage } from '@/map/edge-key'
import type { Adventure, AnyEditOp, Finding } from '@/types'

export function removeInvalidEdgeOps(finding: Finding, document: Adventure): AnyEditOp[] {
  if (finding.code !== 'edge_invalid' || !finding.address) return []
  const match = /^dungeon:([^/]*)\/level:(\d+)$/.exec(finding.address)
  if (!match) return []
  let dungeonId: string
  try {
    dungeonId = decodeURIComponent(match[1])
  } catch {
    return []
  }
  const levelNumber = Number(match[2])
  const level = document.dungeons
    .find((dungeon) => dungeon.id === dungeonId)
    ?.levels.find((candidate) => candidate.number === levelNumber)
  if (!level) return []
  for (const key of Object.keys(level.edges)) {
    if (invalidEdgeKeyMessage(key, level) === finding.message) {
      return [
        {
          op: 'set_edges',
          dungeon_id: dungeonId,
          level_number: levelNumber,
          edges: { [key]: null },
        },
      ]
    }
  }
  return []
}
