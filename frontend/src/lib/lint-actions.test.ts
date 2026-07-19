import { expect, test } from 'vitest'

import { removeInvalidEdgeOps } from '@/lib/lint-actions'
import { makeDocument } from '@/test/fixtures'
import type { Adventure, Finding } from '@/types'

function documentWithEdges(
  edges: Record<string, { kind: 'open' | 'wall'; door: null }>,
): Adventure {
  const document = makeDocument()
  document.dungeons[0].levels[0].edges = edges
  return document
}

function finding(message: string): Finding {
  return {
    source: 'lint',
    code: 'edge_invalid',
    severity: 'error',
    message,
    address: 'dungeon:dungeon-1/level:1',
  }
}

test('the remove-entry action resolves its key by enumeration and commits the delete', () => {
  const document = documentWithEdges({
    '1,0:west': { kind: 'open', door: null },
    '0,1:south': { kind: 'open', door: null },
  })
  const ops = removeInvalidEdgeOps(
    finding("edge key '0,1:south' is never consulted — osrlib's canonical form is '0,2:north'"),
    document,
  )
  expect(ops).toEqual([
    {
      op: 'set_edges',
      dungeon_id: 'dungeon-1',
      level_number: 1,
      edges: { '0,1:south': null },
    },
  ])
})

test('a malformed foreign key resolves by its own rendered message', () => {
  const document = documentWithEdges({ bogus: { kind: 'open', door: null } })
  const ops = removeInvalidEdgeOps(
    finding("edge key 'bogus' is malformed — expected 'x,y:side'"),
    document,
  )
  expect(ops).toEqual([
    { op: 'set_edges', dungeon_id: 'dungeon-1', level_number: 1, edges: { bogus: null } },
  ])
})

test('a stale finding returns no ops — never a guessed delete', () => {
  // The offending key is already gone from the document.
  const document = documentWithEdges({ '1,0:west': { kind: 'open', door: null } })
  expect(
    removeInvalidEdgeOps(finding("edge key 'bogus' is malformed — expected 'x,y:side'"), document),
  ).toEqual([])
})

test('non-edge findings and unparseable addresses decline', () => {
  const document = documentWithEdges({})
  expect(
    removeInvalidEdgeOps(
      {
        source: 'lint',
        code: 'orphan_cell',
        severity: 'warning',
        message: 'x',
        address: 'dungeon:dungeon-1/level:1',
      },
      document,
    ),
  ).toEqual([])
  expect(removeInvalidEdgeOps(finding('x'), { ...document, dungeons: [] })).toEqual([])
})
