// Typed test fixtures mirroring the backend's starter project shape. tsc
// checks these against the generated types, so a schema change breaks them
// loudly here rather than silently drifting.
import type { Adventure, ExtractionReport, ForgeState, ProjectState } from '@/types'

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
    diagnostics: { validation: [], lint: [], forge: [] },
    dropped_fields: [],
    can_undo: false,
    can_redo: false,
    forge: null,
    sidecar: {
      schema_version: 1,
      provenance: null,
      view_state: {
        active_dungeon_id: null,
        active_level_number: null,
        zoom_pan: {},
        review_selection: null,
      },
      notes: {},
      review: [],
      auto_reasons: [],
    },
    ...overrides,
  }
}

// A forge-backed project state: the review fixtures' shape, small but
// carrying every review surface's inputs.
export function makeForgeReport(overrides: Partial<ExtractionReport> = {}): ExtractionReport {
  return {
    schema_version: 1,
    osrforge_version: '0.1.0',
    module: { title: 'The mill on the moor', pages: 2 },
    validation: { passed: true, errors: [] },
    areas: [
      {
        id: 'dungeon-1/1/1',
        source_pages: [1],
        confidence: 0.9,
        flags: ['geometry_synthesized', 'connection_ambiguous:no target stated'],
        overridden: [],
      },
      {
        id: 'dungeon-1/1/2',
        source_pages: [1, 2],
        confidence: 0.55,
        flags: ['monster_unresolved:rat king → grey_ooze'],
        overridden: ['description'],
      },
      { id: 'dungeon-1/1/3', source_pages: [2], confidence: 1, flags: [], overridden: [] },
    ],
    monsters: {
      resolved: 2,
      unresolved: ['rat king'],
      custom: [{ id: 'mill_wisp', name: 'mill wisp', source_pages: [2], derived: ['xp', 'saves'] }],
    },
    usage: { input_tokens: 7400, output_tokens: 1320 },
    flags: ['low_confidence:module title unstated'],
    findings: [],
    ...overrides,
  }
}

export function makeForgeState(overrides: Partial<ForgeState> = {}): ForgeState {
  return {
    report: makeForgeReport(),
    run: {
      schema_version: 1,
      osrforge_version: '0.1.0',
      source_sha256: '6d'.repeat(32),
      source_bytes: 2048,
      page_count: 2,
      settings: {
        render_dpi: 150,
        max_pages: 200,
        max_source_bytes: 104857600,
        blank_page_renders: [],
        content_batch_pages: 8,
        survey_max_pages: 50,
        monster_fuzzy_threshold: 0.85,
        monster_llm_top_k: 8,
        custom_monsters: 'emit',
        unresolved_fallback: 'best-effort',
      },
      provider: 'FixtureProvider',
      model_id: 'fixture-model-1',
      stages: {
        preprocess: {
          status: 'completed',
          error: null,
          started_at: null,
          finished_at: null,
          usage: null,
        },
        survey: {
          status: 'completed',
          error: null,
          started_at: '2026-07-19T12:02:00Z',
          finished_at: '2026-07-19T12:03:00Z',
          usage: { input_tokens: 1200, output_tokens: 300 },
        },
        content: {
          status: 'completed',
          error: null,
          started_at: null,
          finished_at: null,
          usage: null,
        },
        monsters: {
          status: 'completed',
          error: null,
          started_at: null,
          finished_at: null,
          usage: null,
        },
        geometry: {
          status: 'completed',
          error: null,
          started_at: null,
          finished_at: null,
          usage: null,
        },
        assemble: {
          status: 'completed',
          error: null,
          started_at: null,
          finished_at: null,
          usage: null,
        },
      },
    },
    overrides: {
      monsters: {},
      monster_templates: {},
      areas: {},
      geometry: {},
      town: null,
      module: null,
    },
    checked: false,
    ...overrides,
  }
}
