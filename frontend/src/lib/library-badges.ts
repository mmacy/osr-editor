// The used-badge computations over the sidecar's copies map and the stash's
// stored envelopes — pure, shared by the library panel and its tests.
import type { EditorSidecar, StashedPack } from '@/types'

// The used-badge index: one pass over the sidecar's copies map, answering
// "has this pack-side id ever been copied from this pack" — used means at
// least once, and undoing a drop never unearns it.
export function usedIndex(sidecar: EditorSidecar): Set<string> {
  const used = new Set<string>()
  for (const records of Object.values(sidecar.copies)) {
    for (const record of records) {
      used.add(`${record.pack_identity} ${record.pack_entry_id}`)
    }
  }
  return used
}

// What a stash wrapper's stored document lists, read tolerantly: a pack a
// newer engine stamped still *names* itself in the listing (the wrapper's
// whole point), and its unknown payload just reads as not fully used.
export function stashedPackIds(
  pack: StashedPack,
): { entries: string[]; wandering: string[] } | null {
  const document = pack.document
  if (typeof document !== 'object' || document === null || Array.isArray(document)) return null
  const payload = (document as Record<string, unknown>).payload
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) return null
  const sections = (payload as Record<string, unknown>).sections
  if (!Array.isArray(sections)) return null
  const entries: string[] = []
  const wandering: string[] = []
  for (const section of sections) {
    if (typeof section !== 'object' || section === null) return null
    const record = section as Record<string, unknown>
    if (typeof record.id !== 'string') return null
    if (record.wandering != null) wandering.push(record.id)
    const sectionEntries = record.entries
    if (!Array.isArray(sectionEntries)) return null
    for (const entry of sectionEntries) {
      const id = (entry as Record<string, unknown> | null)?.id
      if (typeof id !== 'string') return null
      entries.push(id)
    }
  }
  return { entries, wandering }
}

// A stash pack reads fully used when every entry, and its wandering entry if
// the capture carried one, has at least one copy record.
export function stashPackFullyUsed(pack: StashedPack, used: Set<string>): boolean {
  const ids = stashedPackIds(pack)
  if (!ids) return false
  const all = [...ids.entries, ...ids.wandering]
  return all.length > 0 && all.every((id) => used.has(`${pack.pack_id} ${id}`))
}
