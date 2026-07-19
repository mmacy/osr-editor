// Typed test fixtures mirroring the backend's starter project shape. tsc
// checks these against the generated types, so a schema change breaks them
// loudly here rather than silently drifting.
import type { Adventure, ProjectState } from '@/types'

export function makeDocument(overrides: Partial<Adventure> = {}): Adventure {
  return {
    name: 'The mill on the moor',
    description: 'A ruined mill hides the entrance to the caves below.',
    hooks: ['The miller vanished a fortnight ago.'],
    town: {
      name: 'Dusthollow',
      description: 'A wind-scoured crossroads hamlet.',
      services: ['Inn'],
      travel_turns: { 'dungeon-1': 2 },
    },
    dungeons: [
      {
        id: 'dungeon-1',
        name: 'The caves',
        levels: [
          {
            number: 1,
            width: 30,
            height: 30,
            edges: {},
            areas: [],
            features: [],
            transitions: [],
            wandering: { chance_in_six: 1, interval_turns: 2, table: null },
            entrance: [0, 0],
          },
        ],
      },
    ],
    monsters: [],
    ...overrides,
  }
}

export function makeProjectState(overrides: Partial<ProjectState> = {}): ProjectState {
  return {
    id: 'abc123',
    path: '/projects/demo.osr',
    type: 'native',
    document: makeDocument(),
    revision: 'r1',
    diagnostics: { validation: [], lint: [] },
    dropped_fields: [],
    can_undo: false,
    can_redo: false,
    ...overrides,
  }
}
