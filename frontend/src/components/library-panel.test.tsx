// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, expect, test, vi } from 'vitest'

import { LibraryPanel } from '@/components/library-panel'
import { stashPackFullyUsed, usedIndex } from '@/lib/library-badges'
import { projectStore } from '@/store/project-store'
import { makeProjectState } from '@/test/fixtures'
import type { EditorSidecar, SourceState, StashedPack } from '@/types'

vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }),
}))

const ENTRY_ID = 'dungeon:mill-caves/level:1/area:1'
const SECTION_ID = 'dungeon:mill-caves/level:1'

function makeSource(overrides: Partial<SourceState> = {}): SourceState {
  return {
    identity: '/adventures/mill.osr',
    label: 'The Mill on the Moor',
    habitat: 'project',
    findings: [],
    pack: {
      id: '',
      name: 'The Mill on the Moor',
      description: '',
      author: '',
      monsters: [],
      sections: [
        {
          id: SECTION_ID,
          label: 'The mill caves level 1',
          wandering: { chance_in_six: 2, interval_turns: 2, table: null },
          entries: [
            {
              id: ENTRY_ID,
              name: 'The guard post',
              description: 'Orcs dice by torchlight.',
              encounter: {
                monsters: [{ template_id: 'orc', count_dice: null, count_fixed: 4 }],
                alignment: null,
                aware: false,
                stance: null,
                hoard: true,
              },
              trap: null,
              treasure: null,
              features: [],
            },
          ],
        },
      ],
    },
    ...overrides,
  }
}

function makeStashedPack(overrides: Partial<StashedPack> = {}): StashedPack {
  return {
    pack_id: 'stash-1',
    label: 'The mill caves level 1 — 2026-07-28',
    created_at: '2026-07-28T12:00:00+00:00',
    document: {
      kind: 'content_pack',
      schema_version: 2,
      engine_version: '1.4.0',
      payload: {
        id: 'stash-1',
        sections: [
          {
            id: SECTION_ID,
            entries: [{ id: ENTRY_ID }],
            wandering: { chance_in_six: 2, interval_turns: 2, table: null },
          },
        ],
      },
    },
    ...overrides,
  }
}

function sidecarWith(overrides: Partial<EditorSidecar>): void {
  const project = makeProjectState()
  projectStore.setState({
    project: { ...project, sidecar: { ...project.sidecar, ...overrides } },
  })
}

const HANDLERS = {
  projectPath: '/adventures/current.osr',
  onOpenSource: vi.fn(),
  onOpenStash: vi.fn(),
  onClosePack: vi.fn(),
  onRefreshPack: vi.fn(),
  armed: null,
  onArm: vi.fn(),
  onDisarm: vi.fn(),
  onCopyWandering: vi.fn(),
}

beforeEach(() => {
  vi.clearAllMocks()
  projectStore.setState({ project: makeProjectState() })
})

test('an open pack lists its sections, entries, glyphs, and wandering affordance', () => {
  render(<LibraryPanel {...HANDLERS} sources={[makeSource()]} />)
  expect(screen.getByText('The mill caves level 1')).toBeInTheDocument()
  expect(screen.getByText('The guard post')).toBeInTheDocument()
  // Prose plus encounter — the carried-kind glyphs.
  expect(screen.getByTitle('What this entry carries')).toHaveTextContent('pE')
  // The wandering-copy affordance appears exactly when the section carries a
  // wandering entry (the authored predicate, applied server-side).
  fireEvent.click(screen.getByRole('button', { name: 'Copy wandering' }))
  expect(HANDLERS.onCopyWandering).toHaveBeenCalled()
})

test('a section without a wandering entry offers no copy', () => {
  const source = makeSource()
  source.pack.sections[0].wandering = null
  render(<LibraryPanel {...HANDLERS} sources={[source]} />)
  expect(screen.queryByRole('button', { name: 'Copy wandering' })).toBeNull()
})

test('used badges compute from the copies map by pack identity and entry id', () => {
  sidecarWith({
    copies: {
      'dungeon:d/level:1/area:7': [
        { pack_identity: '/adventures/mill.osr', pack_entry_id: ENTRY_ID },
      ],
    },
  })
  render(<LibraryPanel {...HANDLERS} sources={[makeSource()]} />)
  expect(screen.getByTitle('Placed at least once')).toBeInTheDocument()
})

test('another packs records earn this pack no badge', () => {
  sidecarWith({
    copies: {
      'dungeon:d/level:1/area:7': [{ pack_identity: '/elsewhere.osr', pack_entry_id: ENTRY_ID }],
    },
  })
  render(<LibraryPanel {...HANDLERS} sources={[makeSource()]} />)
  expect(screen.queryByTitle('Placed at least once')).toBeNull()
})

test('pack findings render at the top of the pack — visible, never blocking', () => {
  const source = makeSource({
    findings: [
      {
        code: 'pack.encounter.unknown_monster',
        message: "entry 'x' references unknown monster 'gone'",
        entry_id: ENTRY_ID,
      },
    ],
  })
  render(<LibraryPanel {...HANDLERS} sources={[source]} />)
  expect(screen.getByText('pack.encounter.unknown_monster')).toBeInTheDocument()
  // The entries still list — findings are diagnostics, not gates.
  expect(screen.getByText('The guard post')).toBeInTheDocument()
})

test('arming is one click and the armed row toggles back', () => {
  const { rerender } = render(<LibraryPanel {...HANDLERS} sources={[makeSource()]} />)
  fireEvent.click(screen.getByRole('button', { name: 'Place The guard post' }))
  expect(HANDLERS.onArm).toHaveBeenCalledWith({
    identity: '/adventures/mill.osr',
    entryId: ENTRY_ID,
  })
  rerender(
    <LibraryPanel
      {...HANDLERS}
      sources={[makeSource()]}
      armed={{ identity: '/adventures/mill.osr', entryId: ENTRY_ID }}
    />,
  )
  fireEvent.click(screen.getByRole('button', { name: 'Disarm The guard post' }))
  expect(HANDLERS.onDisarm).toHaveBeenCalled()
})

test('the stash lists every sidecar pack and deletes behind the destructive confirm', async () => {
  const patchSidecar = vi.fn().mockResolvedValue(undefined)
  sidecarWith({ stash: [makeStashedPack()] })
  projectStore.setState({ patchSidecar })
  render(<LibraryPanel {...HANDLERS} sources={[]} />)
  expect(screen.getByText('The mill caves level 1 — 2026-07-28')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: /^Delete The mill caves/ }))
  // The confirm names what is discarded; nothing posts until confirmed.
  expect(screen.getByText(/discards the 1 room and wandering table/)).toBeInTheDocument()
  expect(patchSidecar).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Delete pack' }))
  expect(patchSidecar).toHaveBeenCalledWith([{ action: 'remove_stash_pack', pack_id: 'stash-1' }])
  // Deleting also closes the pack if open — the identity dies with it.
  expect(HANDLERS.onClosePack).toHaveBeenCalledWith('stash-1')
})

test('a newer-engine stash pack still lists by its wrapper identity', () => {
  const refused = makeStashedPack({ pack_id: 'stash-2', label: 'From a newer editor', document: 7 })
  sidecarWith({ stash: [refused] })
  render(<LibraryPanel {...HANDLERS} sources={[]} />)
  // The wrapper names it even though its payload is unreadable here.
  expect(screen.getByText('From a newer editor')).toBeInTheDocument()
})

test('opening a stash pack goes through the vetting route', () => {
  sidecarWith({ stash: [makeStashedPack()] })
  render(<LibraryPanel {...HANDLERS} sources={[]} />)
  fireEvent.click(screen.getByRole('button', { name: /^Open The mill caves/ }))
  expect(HANDLERS.onOpenStash).toHaveBeenCalledWith('stash-1')
})

// --- the fully-used computation ---------------------------------------------

test('a stash pack reads fully used when every entry and its wandering have a record', () => {
  const pack = makeStashedPack()
  const identityFor = (entryId: string) =>
    usedIndex({
      copies: { addr: [{ pack_identity: 'stash-1', pack_entry_id: entryId }] },
    } as unknown as EditorSidecar)
  expect(stashPackFullyUsed(pack, identityFor(ENTRY_ID))).toBe(false)
  const both = usedIndex({
    copies: {
      a: [{ pack_identity: 'stash-1', pack_entry_id: ENTRY_ID }],
      b: [{ pack_identity: 'stash-1', pack_entry_id: SECTION_ID }],
    },
  } as unknown as EditorSidecar)
  expect(stashPackFullyUsed(pack, both)).toBe(true)
})

test('a capture without a wandering entry needs only its rooms', () => {
  const pack = makeStashedPack()
  const payload = (pack.document as { payload: { sections: Array<{ wandering: unknown }> } })
    .payload
  payload.sections[0].wandering = null
  const rooms = usedIndex({
    copies: { a: [{ pack_identity: 'stash-1', pack_entry_id: ENTRY_ID }] },
  } as unknown as EditorSidecar)
  expect(stashPackFullyUsed(pack, rooms)).toBe(true)
})

test('an unreadable stored document never reads fully used', () => {
  const pack = makeStashedPack({ document: 'not a pack' })
  expect(stashPackFullyUsed(pack, new Set(['stash-1 anything']))).toBe(false)
})
