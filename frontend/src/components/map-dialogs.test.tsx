// @vitest-environment jsdom
// The clear-content dialog's stash offer: composition, sequencing, and the
// gate on capturable content — the second of the two destructive acts.
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, expect, test, vi } from 'vitest'

import { ClearLevelContentDialog } from '@/components/map-dialogs'
import { projectStore, type CommitOptions, type OpsInput } from '@/store/project-store'
import { makeDocument, makeProjectState } from '@/test/fixtures'
import type { Adventure, FeatureSpec } from '@/types'

vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }),
}))

type CommitAction = (ops: OpsInput, options?: CommitOptions) => Promise<boolean>

let commit: ReturnType<typeof vi.fn<CommitAction>>
let stashLevel: ReturnType<
  typeof vi.fn<(dungeonId: string, levelNumber: number) => Promise<boolean>>
>

beforeEach(() => {
  vi.clearAllMocks()
  commit = vi.fn<CommitAction>().mockResolvedValue(true)
  stashLevel = vi
    .fn<(dungeonId: string, levelNumber: number) => Promise<boolean>>()
    .mockResolvedValue(true)
  projectStore.setState({ project: makeProjectState(), commit, stashLevel })
})

function documentWith(overrides: {
  areaDescription?: string
  levelFeatures?: FeatureSpec[]
}): Adventure {
  const document = makeDocument()
  const level = document.dungeons[0].levels[0]
  return {
    ...document,
    dungeons: [
      {
        ...document.dungeons[0],
        levels: [
          {
            ...level,
            features: overrides.levelFeatures ?? [],
            areas: overrides.areaDescription
              ? [
                  {
                    id: '1',
                    name: '',
                    description: overrides.areaDescription,
                    cells: [[0, 0]],
                    encounter: null,
                    features: [],
                    trap: null,
                    treasure: null,
                  },
                ]
              : [],
          },
        ],
      },
    ],
  }
}

function renderDialog(document: Adventure) {
  render(
    <ClearLevelContentDialog
      open
      onOpenChange={() => undefined}
      document={document}
      dungeonId="dungeon-1"
      levelNumber={1}
    />,
  )
}

test('the accepted offer captures before the destructive batch', async () => {
  renderDialog(documentWith({ areaDescription: 'Watabou note text' }))
  const offer = screen.getByRole('checkbox', {
    name: "Stash this level's content in the library first",
  })
  expect(offer).toBeChecked()
  fireEvent.click(screen.getByRole('button', { name: 'Clear content' }))
  await waitFor(() => expect(commit).toHaveBeenCalled())
  expect(stashLevel).toHaveBeenCalledWith('dungeon-1', 1)
  expect(stashLevel.mock.invocationCallOrder[0]).toBeLessThan(commit.mock.invocationCallOrder[0])
})

test('a declined offer proceeds with the plain destructive batch', async () => {
  renderDialog(documentWith({ areaDescription: 'Watabou note text' }))
  fireEvent.click(
    screen.getByRole('checkbox', { name: "Stash this level's content in the library first" }),
  )
  fireEvent.click(screen.getByRole('button', { name: 'Clear content' }))
  await waitFor(() => expect(commit).toHaveBeenCalled())
  expect(stashLevel).not.toHaveBeenCalled()
})

test('a failed capture stops the clear with the level intact', async () => {
  stashLevel.mockResolvedValue(false)
  renderDialog(documentWith({ areaDescription: 'Watabou note text' }))
  fireEvent.click(screen.getByRole('button', { name: 'Clear content' }))
  await waitFor(() => expect(stashLevel).toHaveBeenCalled())
  expect(commit).not.toHaveBeenCalled()
})

test('a level with nothing capturable shows no offer', () => {
  // Level-scope features are the one content the stash cannot hold — the
  // offer would mint an empty pack, so it does not show.
  renderDialog(
    documentWith({
      levelFeatures: [
        {
          id: 'feature-1',
          kind: 'custom',
          description: 'A chalk warning.',
          cell: [0, 0],
          item_ids: [],
          coins: { pp: 0, gp: 0, ep: 0, sp: 0, cp: 0 },
          valuables: [],
          trap: null,
        },
      ],
    }),
  )
  expect(
    screen.queryByRole('checkbox', { name: "Stash this level's content in the library first" }),
  ).toBeNull()
  // The clear itself still offers — the features are clearable, just not stashable.
  expect(screen.getByText('1 feature')).toBeInTheDocument()
})
