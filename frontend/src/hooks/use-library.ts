// The content library's client state and placement flows, mounted by the map
// editor: the open packs (client state — sources are stateless on the server
// and re-opening refreshes), the per-pack collision memory (panel-lifetime,
// never persisted, dying when its pack closes), the armed click-to-place
// entry, and the drop commit with its closure fetch and provenance record.
import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'

import { api, ApiRequestError } from '@/lib/api'
import { areaAddress, levelAddress } from '@/lib/address'
import { loadMonsterCatalog } from '@/lib/catalogs'
import {
  dropCollisions,
  dropOps,
  entryReferences,
  sectionReferences,
  shadowedShippedIds,
  wanderingCopyOps,
  type CollisionChoices,
  type CollisionKind,
  type ShippedMonsters,
} from '@/lib/library-drop'
import { projectStore, useProjectStore } from '@/store/project-store'
import type {
  ContentPack,
  ContentPackEntry,
  LevelSpec,
  MonsterTemplate,
  PackSection,
  SourceState,
} from '@/types'

export interface ArmedEntry {
  identity: string
  entryId: string
}

export interface CollisionPrompt {
  source: SourceState
  entry: ContentPackEntry
  areaId: string
  kinds: CollisionKind[]
}

function toastApiError(error: unknown): void {
  if (error instanceof ApiRequestError) {
    toast.error(error.detail.message, { description: error.detail.remedy ?? undefined })
  } else {
    toast.error(error instanceof Error ? error.message : String(error))
  }
}

// Stash identities are minted `stash-<n>`; everything else is a resolved
// absolute path — the two can never collide, which is what lets one
// remembered list carry both.
const STASH_IDENTITY = /^stash-\d+$/

function findEntry(source: SourceState, entryId: string): ContentPackEntry | null {
  for (const section of source.pack.sections) {
    const entry = section.entries.find((candidate) => candidate.id === entryId)
    if (entry) return entry
  }
  return null
}

export function useLibrary(dungeonId: string, levelNumber: number, level: LevelSpec | undefined) {
  const projectId = useProjectStore((state) => state.project?.id ?? null)
  const [sources, setSources] = useState<SourceState[]>([])
  const [memory, setMemory] = useState<Record<string, CollisionChoices>>({})
  const [armed, setArmed] = useState<ArmedEntry | null>(null)
  const [prompt, setPrompt] = useState<CollisionPrompt | null>(null)
  // Shipped definitions fetched for closure comparisons, cached for the
  // panel's lifetime — the catalog is frozen data.
  const shippedCache = useRef<Record<string, MonsterTemplate>>({})

  // An armed entry names a pack and entry that must still be open — closing
  // the pack or refreshing it away disarms (render-time adjustment).
  if (armed) {
    const source = sources.find((candidate) => candidate.identity === armed.identity)
    if (!source || !findEntry(source, armed.entryId)) setArmed(null)
  }

  // The open-source list rides the sidecar's view state — the same species
  // as the active level and the cameras — so returning to a project restores
  // its loaded packs. Each restoration is an ordinary fresh open, never a
  // sync; an identity that no longer opens surfaces its refusal once and is
  // forgotten.
  const rememberedSources = (): readonly string[] =>
    projectStore.getState().project?.sidecar.view_state.library_sources ?? []

  const rememberSource = (identity: string): void => {
    const current = projectStore.getState().project?.sidecar.view_state
    if (!current || current.library_sources.includes(identity)) return
    void projectStore.getState().patchSidecar([
      {
        action: 'set_view_state',
        view_state: { ...current, library_sources: [...current.library_sources, identity] },
      },
    ])
  }

  const forgetSource = (identity: string): void => {
    const current = projectStore.getState().project?.sidecar.view_state
    if (!current || !current.library_sources.includes(identity)) return
    void projectStore.getState().patchSidecar([
      {
        action: 'set_view_state',
        view_state: {
          ...current,
          library_sources: current.library_sources.filter((entry) => entry !== identity),
        },
      },
    ])
  }

  const admit = (state: SourceState): void => {
    setSources((current) => {
      const index = current.findIndex((candidate) => candidate.identity === state.identity)
      if (index < 0) return [...current, state]
      const next = [...current]
      next[index] = state
      return next
    })
  }

  const openSource = (path: string): void => {
    api
      .openSource(path)
      .then((state) => {
        admit(state)
        // The server-resolved identity is what the list remembers — the
        // typed path may be a tilde form or an unresolved symlink.
        rememberSource(state.identity)
      })
      .catch(toastApiError)
  }

  const openStash = (packId: string): void => {
    if (!projectId) return
    api
      .openStashPack(projectId, packId)
      .then((state) => {
        admit(state)
        rememberSource(state.identity)
      })
      .catch(toastApiError)
  }

  // One restoration per project: on the map surface's first mount for this
  // project, re-open every remembered source fresh.
  const restoredFor = useRef<string | null>(null)
  useEffect(() => {
    if (!projectId || restoredFor.current === projectId) return
    restoredFor.current = projectId
    for (const identity of rememberedSources()) {
      const opening = STASH_IDENTITY.test(identity)
        ? api.openStashPack(projectId, identity)
        : api.openSource(identity)
      opening.then(admit).catch((error: unknown) => {
        toastApiError(error)
        forgetSource(identity)
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one-shot per project; the helpers are stable by construction
  }, [projectId])

  const closePack = (identity: string): void => {
    forgetSource(identity)
    setSources((current) => current.filter((candidate) => candidate.identity !== identity))
    // The remembered choices die with the pack — the spec's lifetime.
    setMemory((current) => {
      const rest = { ...current }
      delete rest[identity]
      return rest
    })
  }

  const refreshPack = (source: SourceState): void => {
    if (source.habitat === 'stash') openStash(source.identity)
    else openSource(source.identity)
  }

  const shippedFor = async (
    referencedIds: string[],
    pack: ContentPack,
  ): Promise<ShippedMonsters> => {
    const catalog = await loadMonsterCatalog()
    const ids = new Set(catalog.map((monster) => monster.id))
    const needed = shadowedShippedIds(referencedIds, pack, ids).filter(
      (id) => !shippedCache.current[id],
    )
    const fetched = await Promise.all(needed.map((id) => api.getCatalogMonster(id)))
    for (const template of fetched) shippedCache.current[template.id] = template
    return { ids, byId: shippedCache.current }
  }

  const commitDrop = async (
    source: SourceState,
    entry: ContentPackEntry,
    areaId: string,
    choices: CollisionChoices,
  ): Promise<void> => {
    let shipped: ShippedMonsters
    try {
      shipped = await shippedFor(entryReferences(entry), source.pack)
    } catch (error) {
      toastApiError(error)
      return
    }
    const address = areaAddress(dungeonId, levelNumber, areaId)
    const committed = await projectStore
      .getState()
      .commit((current) =>
        dropOps(entry, source.pack, current, { dungeonId, levelNumber, areaId }, choices, shipped),
      )
    if (committed) {
      // Provenance chains onto the same single-flight queue. A crash between
      // batch and patch costs a badge, not content — re-dropping is allowed.
      void projectStore.getState().patchSidecar([
        {
          action: 'record_copy',
          address,
          pack_identity: source.identity,
          pack_entry_id: entry.id,
        },
      ])
    }
  }

  const placeEntry = (source: SourceState, entry: ContentPackEntry, areaId: string): void => {
    const area = level?.areas.find((candidate) => candidate.id === areaId)
    if (!area) return
    const remembered = memory[source.identity] ?? {}
    const unanswered = dropCollisions(entry, area).filter((kind) => !(kind in remembered))
    if (unanswered.length > 0) {
      setPrompt({ source, entry, areaId, kinds: unanswered })
      return
    }
    void commitDrop(source, entry, areaId, remembered)
  }

  const placeDropped = (identity: string, entryId: string, areaId: string): void => {
    const source = sources.find((candidate) => candidate.identity === identity)
    const entry = source ? findEntry(source, entryId) : null
    if (source && entry) placeEntry(source, entry, areaId)
  }

  // One placement per arm: the click places and disarms; re-arming is one
  // click, and repeats are what drag serves.
  const placeArmed = (areaId: string): void => {
    if (!armed) return
    setArmed(null)
    placeDropped(armed.identity, armed.entryId, areaId)
  }

  const submitPrompt = (choices: CollisionChoices): void => {
    if (!prompt) return
    const remembered = { ...(memory[prompt.source.identity] ?? {}), ...choices }
    setMemory((current) => ({ ...current, [prompt.source.identity]: remembered }))
    setPrompt(null)
    void commitDrop(prompt.source, prompt.entry, prompt.areaId, remembered)
  }

  const copyWandering = (source: SourceState, section: PackSection): void => {
    void (async () => {
      let shipped: ShippedMonsters
      try {
        shipped = await shippedFor(sectionReferences(section), source.pack)
      } catch (error) {
        toastApiError(error)
        return
      }
      const committed = await projectStore
        .getState()
        .commit((current) =>
          wanderingCopyOps(section, source.pack, current, { dungeonId, levelNumber }, shipped),
        )
      if (committed) {
        void projectStore.getState().patchSidecar([
          {
            action: 'record_copy',
            address: levelAddress(dungeonId, levelNumber),
            pack_identity: source.identity,
            pack_entry_id: section.id,
          },
        ])
      }
    })()
  }

  return {
    sources,
    openSource,
    openStash,
    closePack,
    refreshPack,
    armed,
    arm: setArmed,
    disarm: () => setArmed(null),
    prompt,
    cancelPrompt: () => setPrompt(null),
    submitPrompt,
    placeDropped,
    placeArmed,
    copyWandering,
  }
}
