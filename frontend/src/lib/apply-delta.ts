// The RFC 6901 pointer walk that applies a batch result's changed-subtree
// delta to the local document. Server deltas always resolve by construction —
// they were computed against the same document lineage — so an unresolvable
// path is a programming error, thrown loudly rather than papered over.
import type { Adventure, SubtreeChange } from '@/types'

function unescapeToken(token: string): string {
  return token.replace(/~1/g, '/').replace(/~0/g, '~')
}

function child(node: unknown, token: string, pointer: string): unknown {
  if (Array.isArray(node)) return node[Number(token)]
  if (typeof node === 'object' && node !== null) {
    return (node as Record<string, unknown>)[token]
  }
  throw new Error(`delta path ${pointer} does not resolve`)
}

function assign(node: unknown, token: string, value: unknown, pointer: string): void {
  if (Array.isArray(node)) {
    node[Number(token)] = value
    return
  }
  if (typeof node === 'object' && node !== null) {
    ;(node as Record<string, unknown>)[token] = value
    return
  }
  throw new Error(`delta path ${pointer} does not resolve`)
}

export function applyDelta(document: Adventure, delta: readonly SubtreeChange[]): Adventure {
  let root: unknown = structuredClone(document)
  for (const change of delta) {
    if (change.path === '') {
      root = structuredClone(change.value)
      continue
    }
    const tokens = change.path.slice(1).split('/').map(unescapeToken)
    let node = root
    for (const token of tokens.slice(0, -1)) {
      node = child(node, token, change.path)
    }
    assign(node, tokens[tokens.length - 1], structuredClone(change.value), change.path)
  }
  return root as Adventure
}
