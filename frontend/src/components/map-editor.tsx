// The map editor surface: dungeon switcher, level tabs, toolbar, the canvas
// with its stocking layer and context menu, the inspector, and the management
// dialogs — all driving one selection state and committing through the
// store's single-flight queue, one batch per completed gesture.
import { useEffect, useMemo, useRef, useState } from 'react'
import { usePanelRef } from 'react-resizable-panels'
import {
  ArrowUpDownIcon,
  DoorOpenIcon,
  EyeOffIcon,
  FullscreenIcon,
  HandIcon,
  LogInIcon,
  MaximizeIcon,
  MousePointer2Icon,
  PaintbrushIcon,
  RouteIcon,
  SquareIcon,
  ZapIcon,
  ZoomInIcon,
  ZoomOutIcon,
} from 'lucide-react'

import type { CardIntent } from '@/components/area-content-cards'
import { ContentPreviewLines } from '@/components/content-preview'
import { ForgePreviewDialog } from '@/components/forge-preview-dialog'
import { ImportDialog } from '@/components/import-dialog'
import { LibraryCollisionDialog } from '@/components/library-collision-dialog'
import { LibraryPanel } from '@/components/library-panel'
import { StockingReportDialog } from '@/components/stocking-report'
import { MapCanvas } from '@/components/map-canvas'
import { SourcePagesPane } from '@/components/source-pages-pane'
import {
  AddDungeonDialog,
  AddLevelDialog,
  ClearLevelContentDialog,
  LevelPropertiesDialog,
  RenameDungeonDialog,
  RenumberLevelDialog,
  ResizeLevelDialog,
  TransitionDialog,
} from '@/components/map-dialogs'
import { MapInspector } from '@/components/map-inspector'
import { Button } from '@/components/ui/button'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from '@/components/ui/context-menu'
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable'
import { Separator } from '@/components/ui/separator'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { levelAddress, type LevelFocus, type NavTarget } from '@/lib/address'
import { effectiveMonsterCatalog, loadMonsterCatalog, useCatalog } from '@/lib/catalogs'
import { areaTrapOps, encounterOps, treasureOps } from '@/lib/content-builders'
import { hasClearable } from '@/lib/level-content'
import { formatAreaContents } from '@/lib/notation'
import {
  CANVAS_MIN,
  EMPTY_PANE_WIDTHS,
  INSPECTOR_AREA_DEFAULT,
  PANE_LIMITS,
  paneWidth,
} from '@/lib/pane-widths'
import { areaReportFor } from '@/lib/review'
import {
  TRIGGER_BLOCKED_MESSAGE,
  addTriggerOps,
  areaTriggersFor,
  levelTriggersFor,
  seedAreaTrigger,
  triggerAreaIds,
} from '@/lib/trigger-builders'
import { cn } from '@/lib/utils'
import { parseEdgeKey } from '@/map/edge-key'
import {
  cycleAssignment,
  edgePaintOps,
  rectFrom,
  roomOps,
  corridorOps,
  areaPaintOps,
  type Gesture,
  type Tool,
} from '@/map/gestures'
import { hitTest, type HitTarget } from '@/map/hit-test'
import { HOVER_CARD_DELAY_MS, hoverCardAreaId, hoverCardPlacement } from '@/map/hover-card'
import { DARK_THEME, LIGHT_THEME, markersFor, targetRef, type MapSelection } from '@/map/render'
import {
  areaAt,
  isAreaStocked,
  stockingMenuEntries,
  walkAreas,
  type StockingMenuEntry,
} from '@/map/stocking'
import { cellSizePx, fitView, resetView, zoomAt, type ViewTransform } from '@/map/view'
import { useLibrary } from '@/hooks/use-library'
import { usePaneWidths } from '@/hooks/use-pane-widths'
import { usePrefersDark } from '@/hooks/use-prefers-dark'
import { projectStore, useProjectStore } from '@/store/project-store'
import type {
  Adventure,
  Diagnostics,
  LevelSpec,
  Position,
  StockRoll,
  TransitionSpec,
} from '@/types'

// The persisted camera, restored: the sidecar's view state keyed by level
// address, read once per level entry (not reactive — the map owns the live
// camera from there).
function restoredView(dungeonId: string, levelNumber: number): ViewTransform | null {
  const saved =
    projectStore.getState().project?.sidecar.view_state.zoom_pan[
      levelAddress(dungeonId, levelNumber)
    ]
  return saved ? { scale: saved.zoom, offsetX: saved.pan_x, offsetY: saved.pan_y } : null
}

// Flush the camera and the active level on a navigation transition — the
// resuming-correction-work-across-sessions write the phase 2 scope decision
// deferred to the surface that finally earns it.
function flushViewState(dungeonId: string, levelNumber: number, view: ViewTransform | null): void {
  const project = projectStore.getState().project
  if (!project) return
  const current = project.sidecar.view_state
  const zoomPan = { ...current.zoom_pan }
  if (view) {
    zoomPan[levelAddress(dungeonId, levelNumber)] = {
      zoom: view.scale,
      pan_x: view.offsetX,
      pan_y: view.offsetY,
    }
  }
  void projectStore.getState().patchSidecar([
    {
      action: 'set_view_state',
      view_state: {
        ...current,
        active_dungeon_id: dungeonId,
        active_level_number: levelNumber,
        zoom_pan: zoomPan,
      },
    },
  ])
}

const TOOLS: Array<{ tool: Tool; label: string; shortcut: string; icon: React.ReactNode }> = [
  { tool: 'select', label: 'Select tool', shortcut: 'V', icon: <MousePointer2Icon /> },
  { tool: 'pan', label: 'Pan tool', shortcut: 'H', icon: <HandIcon /> },
  { tool: 'room', label: 'Room tool', shortcut: 'R', icon: <SquareIcon /> },
  { tool: 'corridor', label: 'Corridor tool', shortcut: 'C', icon: <RouteIcon /> },
  { tool: 'wall', label: 'Wall and door tool', shortcut: 'W', icon: <DoorOpenIcon /> },
  { tool: 'area', label: 'Area tool', shortcut: 'A', icon: <PaintbrushIcon /> },
  { tool: 'entrance', label: 'Entrance tool', shortcut: 'E', icon: <LogInIcon /> },
  { tool: 'transition', label: 'Transition tool', shortcut: 'T', icon: <ArrowUpDownIcon /> },
]

const SHORTCUTS = new Map<string, Tool>(
  TOOLS.map(({ tool, shortcut }) => [shortcut.toLowerCase(), tool]),
)

// A control that has to explain why it is unavailable. The reason cannot ride
// the button: `disabled` takes it out of the tab order, and the button variants
// add `disabled:pointer-events-none`, which takes it out of hit testing too —
// so a `title` on the button itself is unreachable by hover and by focus at
// exactly the moment it has something to say. The wrapper still receives
// pointer events, so the tooltip appears where the user is already pointing.
function ReasonedButton({
  reason,
  disabled,
  ...props
}: React.ComponentProps<typeof Button> & { reason: string }) {
  return (
    <span title={disabled ? reason : undefined}>
      <Button {...props} disabled={disabled} />
    </span>
  )
}

function findLevel(document: Adventure, dungeonId: string, levelNumber: number): LevelSpec | null {
  return (
    document.dungeons
      .find((dungeon) => dungeon.id === dungeonId)
      ?.levels.find((level) => level.number === levelNumber) ?? null
  )
}

export function MapEditor({
  document,
  diagnostics,
  dungeonId,
  levelNumber,
  focus,
  focusToken,
  onNavigate,
}: {
  document: Adventure
  diagnostics: Diagnostics
  dungeonId: string
  levelNumber: number
  focus?: LevelFocus
  focusToken: number
  onNavigate: (target: NavTarget) => void
}) {
  const dungeon = document.dungeons.find((candidate) => candidate.id === dungeonId)
  const level = dungeon?.levels.find((candidate) => candidate.number === levelNumber)

  const [tool, setTool] = useState<Tool>('select')
  const [view, setView] = useState<ViewTransform | null>(() => restoredView(dungeonId, levelNumber))
  const [viewport, setViewport] = useState<{ width: number; height: number } | null>(null)
  const [selection, setSelection] = useState<MapSelection | null>(null)
  const [hover, setHover] = useState<HitTarget | null>(null)
  const [gesture, setGesture] = useState<Gesture | null>(null)
  const [transitionDialog, setTransitionDialog] = useState<{
    cell: Position
    existing: TransitionSpec | null
  } | null>(null)
  const [unstockedFilter, setUnstockedFilter] = useState(false)
  const [cardIntent, setCardIntent] = useState<CardIntent | null>(null)
  const [menuAreaId, setMenuAreaId] = useState<string | null>(null)
  // The stocking report: the rolls from the last sweep or single-room roll, or
  // null while the dialog is closed.
  const [stockingRolls, setStockingRolls] = useState<StockRoll[] | null>(null)
  const intentToken = useRef(0)
  const [dialog, setDialog] = useState<
    | 'add-dungeon'
    | 'rename-dungeon'
    | 'add-level'
    | 'renumber'
    | 'resize'
    | 'properties'
    | 'clear-content'
    | 'import'
    | 'forge-preview'
    | null
  >(null)
  const prefersDark = usePrefersDark()
  const theme = prefersDark ? DARK_THEME : LIGHT_THEME
  // The forge review chrome: the preview dialog and the source-pages pane
  // exist only for forge-backed projects.
  const forgeProject = useProjectStore((state) => state.project?.forge ?? null)
  const forgeProjectId = useProjectStore((state) => state.project?.id ?? null)
  const projectPath = useProjectStore((state) => state.project?.path ?? '')
  // The three map-side panes and their splitters: widths come from the sidecar
  // and go back to it when a drag ends.
  const paneWidths = useProjectStore(
    (state) => state.project?.sidecar.view_state.pane_widths ?? EMPTY_PANE_WIDTHS,
  )
  const { onPaneResize, onLayoutChanged } = usePaneWidths()
  const inspectorPanel = usePanelRef()
  // The inspector's width while nobody has dragged it: wider for an area,
  // because the deep content forms expand in place and need the room. Once the
  // author has sized the pane it is theirs, whatever is selected.
  const inspectorWidth = paneWidth(
    paneWidths,
    'inspector',
    selection?.kind === 'area' ? INSPECTOR_AREA_DEFAULT : undefined,
  )
  // Applied imperatively, because a panel takes `defaultSize` at mount and the
  // inspector never remounts across a selection change. Resizing the panel is
  // an external system's business, not React state, and the layout change it
  // provokes is not a user interaction — so nothing about it is persisted.
  useEffect(() => {
    inspectorPanel.current?.resize(inspectorWidth)
  }, [inspectorWidth, inspectorPanel])

  // The content library: open packs, collision memory, and the armed
  // click-to-place entry all live for the map surface's lifetime.
  const library = useLibrary(dungeonId, levelNumber, level)
  // The area under an entry drag, resolved by the wrapper's dragover — the
  // canvas highlights it like the armed hover.
  const [dropAreaId, setDropAreaId] = useState<string | null>(null)
  // The panel mounts only while open — a toolbar toggle, the fit-to-level
  // precedent — so it costs the canvas nothing at rest. Closing it disarms
  // (the aim must not survive out of sight) while the open packs and their
  // collision memory ride the library hook and survive the toggle: hidden is
  // not closed, and re-opening shows the packs exactly as they were.
  const [libraryOpen, setLibraryOpen] = useState(false)
  const toggleLibrary = () => {
    if (libraryOpen) library.disarm()
    setLibraryOpen((current) => !current)
  }
  // Arming a library entry and the modal tools are mutually exclusive:
  // arming displaces the active tool's claim on the primary click, and
  // choosing a tool disarms — there is never a click both would claim.
  const chooseTool = (next: Tool) => {
    library.disarm()
    setTool(next)
  }
  // The hover line's monster names resolve through the effective catalog.
  const shippedMonsters = useCatalog(loadMonsterCatalog)
  const pickerMonsters = useMemo(
    () => (shippedMonsters ? effectiveMonsterCatalog(shippedMonsters, document.monsters) : []),
    [shippedMonsters, document.monsters],
  )
  const monsterNameFor = (templateId: string) =>
    pickerMonsters.find((monster) => monster.id === templateId)?.name ?? templateId

  // The hovered area, shared by the toolbar's hover line and the hover card:
  // null off the grid, over corridor, and on a vanished level.
  const hoverArea = level && hover?.kind === 'cell' ? areaAt(level, hover.cell) : null

  // The hover card: the hovered area's contents beside the area itself,
  // raised after a rest so sweeping the map stays quiet. The eligibility
  // rules — the inspect posture only, and never while another surface owns
  // the hover — live in map/hover-card with the placement math. An
  // eligibility change drops the card at once (render-time adjustment); the
  // effect only arms the raise timer.
  const [hoverCard, setHoverCard] = useState<{ eligible: string | null; shown: boolean }>({
    eligible: null,
    shown: false,
  })
  const eligibleHoverCardId = hoverCardAreaId(hoverArea, {
    tool,
    gesturing: gesture !== null,
    placing: library.armed !== null,
    dragging: dropAreaId !== null,
  })
  if (hoverCard.eligible !== eligibleHoverCardId) {
    setHoverCard({ eligible: eligibleHoverCardId, shown: false })
  }
  useEffect(() => {
    if (eligibleHoverCardId === null) return
    const timer = window.setTimeout(
      () => setHoverCard({ eligible: eligibleHoverCardId, shown: true }),
      HOVER_CARD_DELAY_MS,
    )
    return () => window.clearTimeout(timer)
  }, [eligibleHoverCardId])

  // A level switch resets the interaction state — the render-time adjustment
  // pattern, not an effect. The view derives fit-level-on-open below, so
  // nulling it here is what re-fits the next level.
  const levelIdentity = `${dungeonId}/${levelNumber}`
  const [seenLevel, setSeenLevel] = useState(levelIdentity)
  if (seenLevel !== levelIdentity) {
    setSeenLevel(levelIdentity)
    setView(restoredView(dungeonId, levelNumber))
    setSelection(null)
    setGesture(null)
    setHover(null)
    setCardIntent(null)
  }

  // The persisted camera: the latest user-set view per level rides a ref so
  // the flush-on-leave effect can read the *outgoing* level's camera after
  // the new level has already rendered. Writes coalesce on navigation
  // transitions (level switch, unmount) — never per pointer frame.
  const lastViewRef = useRef<Record<string, ViewTransform>>({})
  useEffect(() => {
    if (view) lastViewRef.current[levelAddress(dungeonId, levelNumber)] = view
  }, [view, dungeonId, levelNumber])
  useEffect(() => {
    const address = levelAddress(dungeonId, levelNumber)
    return () => flushViewState(dungeonId, levelNumber, lastViewRef.current[address] ?? null)
  }, [dungeonId, levelNumber])

  // A one-shot intent lives only while its area stays selected: the selection
  // leaving the area drops it (render-time adjustment), and consumption nulls
  // it — either way a reselect remounting the inspector never replays an add.
  if (cardIntent && !(selection?.kind === 'area' && selection.areaId === cardIntent.areaId)) {
    setCardIntent(null)
  }

  // Fit-level-on-open, derived: user interactions set the view state; until
  // the first one (or after a level switch), the fitted transform is computed
  // from the viewport.
  const fittedView =
    viewport && level ? fitView(level.width, level.height, viewport.width, viewport.height) : null
  const effectiveView = view ?? fittedView

  // The canvas hands back an updater rather than a view, so a burst of wheel or
  // pointer frames composes instead of the last one winning. The fitted
  // transform is the base until the first interaction sets state.
  const updateView = (update: (current: ViewTransform) => ViewTransform) => {
    setView((current) => {
      const base = current ?? fittedView
      return base ? update(base) : current
    })
  }

  const ensureVisible = (cell: Position) => {
    setView(() => {
      const current = effectiveView
      if (!current || !viewport) return current
      const size = cellSizePx(current)
      const cx = current.offsetX + (cell[0] + 0.5) * size
      const cy = current.offsetY + (cell[1] + 0.5) * size
      const margin = 40
      const visible =
        cx >= margin &&
        cx <= viewport.width - margin &&
        cy >= margin &&
        cy <= viewport.height - margin
      if (visible) return current
      return {
        ...current,
        offsetX: viewport.width / 2 - (cell[0] + 0.5) * size,
        offsetY: viewport.height / 2 - (cell[1] + 0.5) * size,
      }
    })
  }

  // Diagnostics navigation: focus the addressed target — selected, outlined,
  // scrolled into view — or open the level properties. Applied per navigation
  // event via the token, as a render-time adjustment; starting from 0 means a
  // focus already present at mount (navigating from another section) applies.
  const [seenFocusToken, setSeenFocusToken] = useState(0)
  if (seenFocusToken !== focusToken) {
    setSeenFocusToken(focusToken)
    if (focus?.type === 'properties') {
      setDialog('properties')
    } else if (focus?.type === 'area') {
      setSelection({ kind: 'area', areaId: focus.areaId })
      const first = level?.areas.find((area) => area.id === focus.areaId)?.cells[0]
      if (first) ensureVisible(first)
    } else if (focus?.type === 'cell') {
      setSelection({ kind: 'cell', cell: focus.cell })
      ensureVisible(focus.cell)
    } else if (focus?.type === 'edge') {
      setSelection({ kind: 'edge', key: focus.key })
      const parsed = parseEdgeKey(focus.key)
      if (parsed) ensureVisible([parsed.x, parsed.y])
    }
  }

  const deleteSelection = () => {
    if (!selection || !level) return
    if (selection.kind === 'area') {
      const area = level.areas.find((candidate) => candidate.id === selection.areaId)
      if (!area) return
      // The stocked predicate guards the confirm — a described area never
      // vanishes silently, content or not.
      if (
        isAreaStocked(area) &&
        !window.confirm(`Remove area ${area.id} and the content it carries?`)
      ) {
        return
      }
      void projectStore
        .getState()
        .commit((current) => {
          const target = findLevel(current, dungeonId, levelNumber)
          if (!target?.areas.some((candidate) => candidate.id === area.id)) return []
          return [
            {
              op: 'remove_area',
              dungeon_id: dungeonId,
              level_number: levelNumber,
              area_id: area.id,
            },
          ]
        })
        .then((committed) => {
          if (committed) setSelection(null)
        })
      return
    }
    if (selection.kind === 'edge') {
      void projectStore.getState().commit((current) => {
        const target = findLevel(current, dungeonId, levelNumber)
        if (!target || !(selection.key in target.edges)) return []
        return [
          {
            op: 'set_edges',
            dungeon_id: dungeonId,
            level_number: levelNumber,
            edges: { [selection.key]: null },
          },
        ]
      })
      return
    }
    const cell = selection.cell
    const transition = level.transitions.find(
      (candidate) => candidate.position[0] === cell[0] && candidate.position[1] === cell[1],
    )
    if (transition) {
      // The builder form: a queued duplicate Delete no-ops instead of posting
      // a remove the op would reject.
      void projectStore.getState().commit((current) => {
        const target = findLevel(current, dungeonId, levelNumber)
        const present = target?.transitions.some(
          (candidate) => candidate.position[0] === cell[0] && candidate.position[1] === cell[1],
        )
        if (!present) return []
        return [
          {
            op: 'remove_transition',
            dungeon_id: dungeonId,
            level_number: levelNumber,
            position: cell,
          },
        ]
      })
    }
  }

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (
        target &&
        (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.isContentEditable)
      ) {
        return
      }
      // Keys pressed inside an open popover, menu, or dialog belong to that
      // surface — Escape closes the picker, it never clears the map selection.
      if (
        target?.closest(
          '[data-slot="popover-content"], [data-slot="context-menu-content"], [role="dialog"]',
        )
      ) {
        return
      }
      if (dialog !== null || transitionDialog !== null) return
      if (event.metaKey || event.ctrlKey || event.altKey) return
      if (event.key === 'Escape') {
        if (library.armed) library.disarm()
        else if (gesture) setGesture(null)
        else setSelection(null)
        return
      }
      if (event.key === 'Delete' || event.key === 'Backspace') {
        deleteSelection()
        return
      }
      if (event.key === '0') {
        setView(resetView())
        return
      }
      if (event.key.toLowerCase() === 'f') {
        setUnstockedFilter((current) => !current)
        return
      }
      if ((event.key === '[' || event.key === ']') && level) {
        // The previous/next-area walk in key order; with the filter on it
        // visits unstocked areas only — stocking a big dungeon is a walk.
        const currentAreaId = selection?.kind === 'area' ? selection.areaId : null
        const nextId = walkAreas(
          level.areas,
          currentAreaId,
          event.key === ']' ? 1 : -1,
          unstockedFilter,
        )
        if (nextId !== null) {
          setSelection({ kind: 'area', areaId: nextId })
          const first = level.areas.find((area) => area.id === nextId)?.cells[0]
          if (first) ensureVisible(first)
        }
        return
      }
      const shortcut = SHORTCUTS.get(event.key.toLowerCase())
      if (shortcut) chooseTool(shortcut)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  })

  if (!dungeon || !level) {
    return <p className="p-6 text-sm text-muted-foreground">This level no longer exists.</p>
  }

  const completeGesture = (finished: Gesture) => {
    const store = projectStore.getState()
    if (finished.tool === 'room') {
      let createdId: string | null = null
      void store
        .commit((current) => {
          const target = findLevel(current, dungeonId, levelNumber)
          if (!target) return []
          const ops = roomOps(
            rectFrom(finished.start, finished.end),
            target,
            dungeonId,
            levelNumber,
          )
          createdId = ops[0].op === 'create_area' ? ops[0].area_id : null
          return ops
        })
        .then((committed) => {
          if (committed && createdId) setSelection({ kind: 'area', areaId: createdId })
        })
    } else if (finished.tool === 'corridor') {
      void store.commit(corridorOps(finished.path, dungeonId, levelNumber))
    } else if (finished.tool === 'wall') {
      // The cycle's next value is computed inside the queue against the
      // committed document — never against a possibly stale render.
      void store.commit((current) => {
        const target = findLevel(current, dungeonId, levelNumber)
        if (!target) return []
        const assignment = cycleAssignment(target.edges[finished.keys[0]])
        return edgePaintOps(finished.keys, assignment, target, dungeonId, levelNumber)
      })
    } else {
      const paintTarget = selection?.kind === 'area' ? selection.areaId : null
      let paintedId: string | null = paintTarget
      void store
        .commit((current) => {
          const target = findLevel(current, dungeonId, levelNumber)
          if (!target) return []
          const ops = areaPaintOps(finished.cells, paintTarget, target, dungeonId, levelNumber)
          if (ops[0]?.op === 'create_area') paintedId = ops[0].area_id
          return ops
        })
        .then((committed) => {
          if (committed && paintedId) setSelection({ kind: 'area', areaId: paintedId })
        })
    }
  }

  const selectTarget = (target: HitTarget) => {
    if (target.kind === 'edge') {
      setSelection({ kind: 'edge', key: target.key })
      return
    }
    const cell = target.cell
    const transition = level.transitions.find(
      (candidate) => candidate.position[0] === cell[0] && candidate.position[1] === cell[1],
    )
    if (transition) {
      setSelection({ kind: 'cell', cell })
      return
    }
    const area = level.areas.find((candidate) =>
      candidate.cells.some((c) => c[0] === cell[0] && c[1] === cell[1]),
    )
    setSelection(area ? { kind: 'area', areaId: area.id } : { kind: 'cell', cell })
  }

  const placeEntrance = (cell: Position) => {
    void projectStore
      .getState()
      .commit([
        { op: 'set_entrance', dungeon_id: dungeonId, level_number: levelNumber, entrance: cell },
      ])
  }

  const transitionAt = (cell: Position) => {
    const existing = level.transitions.find(
      (candidate) => candidate.position[0] === cell[0] && candidate.position[1] === cell[1],
    )
    if (existing) {
      setSelection({ kind: 'cell', cell })
      return
    }
    setTransitionDialog({ cell, existing: null })
  }

  // The stocking context menu: right-click on an area cell offers exactly
  // what the area can hold; anywhere else does nothing this phase.
  const menuArea = menuAreaId
    ? (level.areas.find((candidate) => candidate.id === menuAreaId) ?? null)
    : null
  const applyMenuEntry = (areaId: string, entry: StockingMenuEntry) => {
    setSelection({ kind: 'area', areaId })
    const target = { dungeonId, levelNumber, areaId }
    if (entry.card === 'trigger') {
      // One gesture on the map, deep editing in the panel: add mints a
      // next-free-id area trigger and lands in the Quests section; edit
      // navigates to the existing trigger. In forge mode the add routes to
      // the blocked-op dialog client-side — the server's 422 stays the
      // authority for any batch that arrives.
      if (entry.action === 'edit') {
        onNavigate({ kind: 'quests', triggerId: entry.triggerId })
        return
      }
      if (forgeProject) {
        projectStore.getState().setBlockedOp({
          op: 'add_trigger',
          address: 'triggers',
          message: TRIGGER_BLOCKED_MESSAGE,
        })
        return
      }
      let mintedId = ''
      void projectStore
        .getState()
        .commit((current) => {
          const trigger = seedAreaTrigger(current, dungeonId, levelNumber, areaId)
          mintedId = trigger.id
          return addTriggerOps(trigger)
        })
        .then((committed) => {
          if (committed && mintedId) onNavigate({ kind: 'quests', triggerId: mintedId })
        })
      return
    }
    if (entry.action === 'remove') {
      if (entry.card === 'encounter')
        void projectStore.getState().commit(encounterOps(target, null))
      else if (entry.card === 'treasure')
        void projectStore.getState().commit(treasureOps(target, null))
      else if (entry.card === 'trap') void projectStore.getState().commit(areaTrapOps(target, null))
      return
    }
    if (entry.card === 'stock') {
      void rollStocking(areaId)
      return
    }
    intentToken.current += 1
    setCardIntent({ areaId, card: entry.card, action: entry.action, token: intentToken.current })
  }

  // Roll SRD stocking over one blank room (an area id) or the level's unstocked
  // areas (null), then open the report. The batch already applied through the
  // store — key numbers fill and glyphs appear at once.
  const rollStocking = async (areaId: string | null) => {
    const response = await projectStore.getState().stock(dungeonId, levelNumber, areaId)
    if (response) setStockingRolls([...response.rolls])
  }
  const unstockedCount = level.areas.filter((area) => !isAreaStocked(area)).length

  // The drop target's resolution — the context menu's own hit-test + areaAt
  // shape, over the same wrapper geometry. Existing areas only: corridors are
  // unkeyed floor, and creating areas stays the area tool's job.
  const resolveDropArea = (event: React.DragEvent<HTMLDivElement>) => {
    if (!effectiveView) return null
    const rect = event.currentTarget.getBoundingClientRect()
    const point = { x: event.clientX - rect.left, y: event.clientY - rect.top }
    const target = hitTest(point, level, effectiveView, 'cell')
    return target?.kind === 'cell' ? areaAt(level, target.cell) : null
  }
  // The hover line: the cell/edge ref plus the hovered area's one-line
  // contents in module notation.
  const hoverContents = hoverArea ? formatAreaContents(hoverArea, monsterNameFor) : ''
  const hoverLine = hoverArea
    ? `${targetRef(hover)} · ${hoverArea.id}${hoverContents ? `: ${hoverContents}` : ''}`
    : targetRef(hover)

  // The raised card resolves against the current document, so an area edited
  // or removed mid-hover renders fresh or not at all; placement is the pure
  // computation over the live view transform, so the card rides a pan.
  const hoverCardArea =
    hoverCard.shown && hoverCard.eligible !== null
      ? (level.areas.find((candidate) => candidate.id === hoverCard.eligible) ?? null)
      : null
  const hoverCardBox =
    hoverCardArea && effectiveView && viewport
      ? hoverCardPlacement(hoverCardArea.cells, effectiveView, viewport)
      : null

  const markers = markersFor(
    [...diagnostics.validation, ...diagnostics.lint],
    dungeonId,
    levelNumber,
  )

  // The selected area's printed pages, when the report knows any. Resolved here
  // rather than inside the pane because the pane and its splitter now mount
  // together: a forge area whose report lists no page must not leave a bare
  // splitter and an empty column behind.
  const selectedAreaPages =
    forgeProject && selection?.kind === 'area'
      ? (areaReportFor(forgeProject.report, dungeonId, levelNumber, selection.areaId)
          ?.source_pages ?? [])
      : []
  const sourcePages =
    forgeProjectId && selectedAreaPages.length > 0
      ? { projectId: forgeProjectId, pages: selectedAreaPages }
      : null
  const sortedLevels = [...dungeon.levels].sort((a, b) => a.number - b.number)
  const lastDungeon = document.dungeons.length === 1
  const lastLevel = dungeon.levels.length === 1

  const removeLevel = () => {
    if (
      !window.confirm(`Remove level ${levelNumber} of ${dungeonId}? Its geometry is discarded.`)
    ) {
      return
    }
    const fallback = dungeon.levels.find((candidate) => candidate.number !== levelNumber)
    void projectStore
      .getState()
      .commit([{ op: 'remove_level', dungeon_id: dungeonId, level_number: levelNumber }])
      .then((committed) => {
        if (committed && fallback) {
          onNavigate({ kind: 'level', dungeonId, levelNumber: fallback.number })
        }
      })
  }

  const removeDungeon = () => {
    if (!window.confirm(`Remove dungeon ${dungeonId}? Its levels are discarded.`)) return
    const fallback = document.dungeons.find((candidate) => candidate.id !== dungeonId)
    void projectStore
      .getState()
      .commit([{ op: 'remove_dungeon', dungeon_id: dungeonId }])
      .then((committed) => {
        if (committed && fallback) {
          onNavigate({
            kind: 'level',
            dungeonId: fallback.id,
            levelNumber: fallback.levels[0].number,
          })
        }
      })
  }

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="map-editor">
      <div className="flex flex-wrap items-center gap-2 border-b bg-card px-3 py-1.5">
        <label htmlFor="dungeon-switcher" className="text-xs text-muted-foreground">
          Dungeon
        </label>
        <select
          id="dungeon-switcher"
          className="h-7 rounded-md border border-input bg-transparent px-2 text-sm"
          value={dungeonId}
          onChange={(event) => {
            const next = document.dungeons.find((candidate) => candidate.id === event.target.value)
            if (next) {
              onNavigate({ kind: 'level', dungeonId: next.id, levelNumber: next.levels[0].number })
            }
          }}
        >
          {document.dungeons.map((candidate) => (
            <option key={candidate.id} value={candidate.id}>
              {candidate.name || candidate.id}
            </option>
          ))}
        </select>
        <Button variant="outline" size="sm" onClick={() => setDialog('add-dungeon')}>
          Add dungeon
        </Button>
        <Button variant="outline" size="sm" onClick={() => setDialog('rename-dungeon')}>
          Rename dungeon
        </Button>
        <ReasonedButton
          variant="outline"
          size="sm"
          onClick={removeDungeon}
          disabled={lastDungeon}
          reason="An adventure needs at least one dungeon."
        >
          Remove dungeon
        </ReasonedButton>
        <Button variant="outline" size="sm" onClick={() => setDialog('import')}>
          Import geometry
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-1 border-b bg-card px-3 py-1">
        {sortedLevels.map((candidate) => (
          <button
            key={candidate.number}
            type="button"
            className={cn(
              'rounded-md px-2.5 py-1 text-sm transition-colors hover:bg-accent',
              candidate.number === levelNumber && 'bg-accent font-medium',
            )}
            onClick={() => onNavigate({ kind: 'level', dungeonId, levelNumber: candidate.number })}
          >
            Level {candidate.number}
            {levelTriggersFor(document, dungeonId, candidate.number).length > 0 && (
              <ZapIcon
                aria-label={`Level ${candidate.number} has triggers`}
                className="ml-1 inline size-3"
              />
            )}
          </button>
        ))}
        <Button variant="ghost" size="sm" onClick={() => setDialog('add-level')}>
          Add level
        </Button>
        <ReasonedButton
          variant="ghost"
          size="sm"
          onClick={removeLevel}
          disabled={lastLevel}
          reason="A dungeon needs at least one level."
        >
          Remove level
        </ReasonedButton>
        <ReasonedButton
          variant="ghost"
          size="sm"
          onClick={() => setDialog('clear-content')}
          disabled={!hasClearable(level)}
          reason="This level has no keyed areas and no content — there is nothing to clear."
        >
          Clear content…
        </ReasonedButton>
        <div className="ml-auto">
          <Button variant="ghost" size="sm" onClick={() => setDialog('properties')}>
            Level properties
          </Button>
        </div>
      </div>

      <div className="flex items-center gap-1 border-b bg-card px-3 py-1">
        {TOOLS.map(({ tool: candidate, label, shortcut, icon }) => (
          <Tooltip key={candidate}>
            <TooltipTrigger asChild>
              <Button
                variant={tool === candidate ? 'secondary' : 'ghost'}
                size="icon-sm"
                aria-label={label}
                aria-pressed={tool === candidate}
                onClick={() => chooseTool(candidate)}
              >
                {icon}
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              {label} ({shortcut})
            </TooltipContent>
          </Tooltip>
        ))}
        <Separator orientation="vertical" className="mx-1 h-5" />
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Zoom in"
          onClick={() =>
            viewport &&
            updateView((current) =>
              zoomAt(current, { x: viewport.width / 2, y: viewport.height / 2 }, 1.25),
            )
          }
        >
          <ZoomInIcon />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Zoom out"
          onClick={() =>
            viewport &&
            updateView((current) =>
              zoomAt(current, { x: viewport.width / 2, y: viewport.height / 2 }, 1 / 1.25),
            )
          }
        >
          <ZoomOutIcon />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Reset zoom"
          onClick={() => setView(resetView())}
        >
          <MaximizeIcon />
        </Button>
        {/* Fit-the-level, on demand. The same transform the editor opens a
            level with, which until now was reachable exactly once — before the
            first pan or zoom — and never again. Reset zoom stays a hard 100% at
            the pinned margin: it is the deterministic anchor the e2e coordinate
            math is computed from, so the two controls are separate. */}
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Fit level"
          onClick={() =>
            viewport &&
            level &&
            setView(fitView(level.width, level.height, viewport.width, viewport.height))
          }
        >
          <FullscreenIcon />
        </Button>
        <Separator orientation="vertical" className="mx-1 h-5" />
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant={unstockedFilter ? 'secondary' : 'ghost'}
              size="icon-sm"
              aria-label="Unstocked filter"
              aria-pressed={unstockedFilter}
              onClick={() => setUnstockedFilter((current) => !current)}
            >
              <EyeOffIcon />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Dim stocked areas (F)</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            {/* The span is the trigger, not the button: a disabled button is no
                hit target, so the tooltip explaining *why* it is disabled is
                the one it could never show. */}
            <span>
              <Button
                variant="ghost"
                size="sm"
                disabled={unstockedCount === 0}
                onClick={() => void rollStocking(null)}
              >
                Roll stocking
              </Button>
            </span>
          </TooltipTrigger>
          <TooltipContent>
            {unstockedCount === 0
              ? 'Every room is stocked'
              : `Roll SRD stocking over ${unstockedCount} blank room${unstockedCount === 1 ? '' : 's'} — one undo step`}
          </TooltipContent>
        </Tooltip>
        <Button
          variant={libraryOpen ? 'secondary' : 'ghost'}
          size="sm"
          aria-pressed={libraryOpen}
          onClick={toggleLibrary}
        >
          Library
        </Button>
        {forgeProject && (
          <>
            <Separator orientation="vertical" className="mx-1 h-5" />
            <Button variant="ghost" size="sm" onClick={() => setDialog('forge-preview')}>
              Forge preview
            </Button>
          </>
        )}
        <span className="ml-auto font-mono text-xs text-muted-foreground" data-testid="hover-ref">
          {hoverLine}
        </span>
      </div>

      <ResizablePanelGroup
        orientation="horizontal"
        className="min-h-0 flex-1"
        onLayoutChanged={onLayoutChanged}
      >
        <ResizablePanel id="pane-canvas" minSize={CANVAS_MIN} className="overflow-hidden">
          <ContextMenu>
            <ContextMenuTrigger
              asChild
              onContextMenu={(event) => {
                // The trigger only fires over an area cell; preventDefault
                // suppresses both radix and the native menu everywhere else.
                if (!effectiveView) {
                  event.preventDefault()
                  return
                }
                const rect = event.currentTarget.getBoundingClientRect()
                const point = { x: event.clientX - rect.left, y: event.clientY - rect.top }
                const target = hitTest(point, level, effectiveView, 'cell')
                const area = target?.kind === 'cell' ? areaAt(level, target.cell) : null
                if (!area) {
                  event.preventDefault()
                  return
                }
                setMenuAreaId(area.id)
              }}
            >
              <div
                className="relative h-full w-full overflow-hidden"
                onDragOver={(event) => {
                  if (!event.dataTransfer.types.includes('application/x-osr-pack-entry')) return
                  event.preventDefault()
                  event.dataTransfer.dropEffect = 'copy'
                  setDropAreaId(resolveDropArea(event)?.id ?? null)
                }}
                onDragLeave={() => setDropAreaId(null)}
                onDrop={(event) => {
                  if (!event.dataTransfer.types.includes('application/x-osr-pack-entry')) return
                  event.preventDefault()
                  setDropAreaId(null)
                  const area = resolveDropArea(event)
                  if (!area) return
                  try {
                    const payload = JSON.parse(
                      event.dataTransfer.getData('application/x-osr-pack-entry'),
                    ) as { identity?: string; entryId?: string }
                    if (payload.identity && payload.entryId) {
                      library.placeDropped(payload.identity, payload.entryId, area.id)
                    }
                  } catch {
                    // A malformed payload is not a drop.
                  }
                }}
              >
                <MapCanvas
                  level={level}
                  view={effectiveView}
                  onViewChange={updateView}
                  onViewportSize={setViewport}
                  tool={tool}
                  gesture={gesture}
                  onGestureChange={setGesture}
                  onGestureComplete={completeGesture}
                  selection={selection}
                  hover={hover}
                  onHover={setHover}
                  onSelect={selectTarget}
                  onPlaceEntrance={placeEntrance}
                  onTransitionAt={transitionAt}
                  markers={markers}
                  theme={theme}
                  dimStocked={unstockedFilter}
                  placing={library.armed !== null}
                  onPlace={(cell) => {
                    // Corridor, empty cell, off-grid: a no-op that stays armed —
                    // a missed click must not destroy the aim.
                    const area = areaAt(level, cell)
                    if (area) library.placeArmed(area.id)
                  }}
                  placementAreaId={dropAreaId ?? (library.armed ? (hoverArea?.id ?? null) : null)}
                  triggerAreaIds={triggerAreaIds(document, dungeonId, levelNumber)}
                />
                {/* Hover-only and pointer-transparent: the card never takes a
                  click, and it duplicates what the inspector already offers
                  accessibly, so it hides from the accessibility tree. */}
                {hoverCardArea && hoverCardBox && (
                  <div
                    aria-hidden="true"
                    data-testid="area-hover-card"
                    className="pointer-events-none absolute z-10 flex max-h-56 w-72 flex-col gap-1 overflow-hidden rounded-md border bg-popover p-2 text-popover-foreground shadow-md"
                    style={{ left: hoverCardBox.left, top: hoverCardBox.top }}
                  >
                    <p className="text-xs font-medium">
                      Area {hoverCardArea.id}
                      {hoverCardArea.name !== '' && ` — ${hoverCardArea.name}`}
                    </p>
                    {hoverCardArea.description !== '' && (
                      <p className="line-clamp-3 text-xs break-words text-muted-foreground">
                        {hoverCardArea.description}
                      </p>
                    )}
                    <ContentPreviewLines contents={hoverCardArea} nameFor={monsterNameFor} />
                  </div>
                )}
              </div>
            </ContextMenuTrigger>
            <ContextMenuContent aria-label={menuArea ? `Stock area ${menuArea.id}` : undefined}>
              {menuArea &&
                stockingMenuEntries(
                  menuArea,
                  areaTriggersFor(document, dungeonId, levelNumber, menuArea.id).map(
                    (trigger) => trigger.id,
                  ),
                ).map((entry) => (
                  <ContextMenuItem
                    key={entry.id}
                    variant={entry.action === 'remove' ? 'destructive' : 'default'}
                    onSelect={() => applyMenuEntry(menuArea.id, entry)}
                  >
                    {entry.label}
                  </ContextMenuItem>
                ))}
            </ContextMenuContent>
          </ContextMenu>
        </ResizablePanel>
        <ResizableHandle />
        <ResizablePanel
          id="pane-inspector"
          panelRef={inspectorPanel}
          // The mount width; the effect above is what tracks the selection
          // afterwards, since a changed `defaultSize` does not resize a panel
          // that already has a size.
          defaultSize={inspectorWidth}
          minSize={PANE_LIMITS.inspector.min}
          maxSize={PANE_LIMITS.inspector.max}
          groupResizeBehavior="preserve-pixel-size"
          onResize={onPaneResize('inspector')}
        >
          <aside className="h-full overflow-y-auto bg-card" aria-label="Inspector">
            <MapInspector
              document={document}
              dungeonId={dungeonId}
              levelNumber={levelNumber}
              selection={selection}
              onSelectionChange={setSelection}
              onEditTransition={(cell, transition) =>
                setTransitionDialog({ cell, existing: transition })
              }
              cardIntent={cardIntent}
              onCardIntentConsumed={() => setCardIntent(null)}
            />
          </aside>
        </ResizablePanel>
        {libraryOpen && (
          <>
            <ResizableHandle />
            <ResizablePanel
              id="pane-library"
              defaultSize={paneWidth(paneWidths, 'library')}
              minSize={PANE_LIMITS.library.min}
              maxSize={PANE_LIMITS.library.max}
              groupResizeBehavior="preserve-pixel-size"
              onResize={onPaneResize('library')}
            >
              <LibraryPanel
                projectPath={projectPath}
                sources={library.sources}
                onOpenSource={library.openSource}
                onOpenStash={library.openStash}
                onClosePack={library.closePack}
                onRefreshPack={library.refreshPack}
                armed={library.armed}
                onArm={library.arm}
                onDisarm={library.disarm}
                onCopyWandering={library.copyWandering}
              />
            </ResizablePanel>
          </>
        )}
        {sourcePages !== null && (
          <>
            <ResizableHandle />
            <ResizablePanel
              id="pane-source-pages"
              defaultSize={paneWidth(paneWidths, 'source_pages')}
              minSize={PANE_LIMITS.source_pages.min}
              maxSize={PANE_LIMITS.source_pages.max}
              groupResizeBehavior="preserve-pixel-size"
              onResize={onPaneResize('source_pages')}
            >
              <SourcePagesPane projectId={sourcePages.projectId} pages={sourcePages.pages} />
            </ResizablePanel>
          </>
        )}
      </ResizablePanelGroup>

      <AddDungeonDialog
        open={dialog === 'add-dungeon'}
        onOpenChange={(open) => setDialog(open ? 'add-dungeon' : null)}
        document={document}
        onNavigate={onNavigate}
      />
      <RenameDungeonDialog
        open={dialog === 'rename-dungeon'}
        onOpenChange={(open) => setDialog(open ? 'rename-dungeon' : null)}
        dungeonId={dungeonId}
        levelNumber={levelNumber}
        onNavigate={onNavigate}
      />
      <AddLevelDialog
        open={dialog === 'add-level'}
        onOpenChange={(open) => setDialog(open ? 'add-level' : null)}
        dungeon={dungeon}
        onNavigate={onNavigate}
      />
      <RenumberLevelDialog
        open={dialog === 'renumber'}
        onOpenChange={(open) => setDialog(open ? 'renumber' : null)}
        dungeonId={dungeonId}
        levelNumber={levelNumber}
        onNavigate={onNavigate}
      />
      <ResizeLevelDialog
        open={dialog === 'resize'}
        onOpenChange={(open) => setDialog(open ? 'resize' : null)}
        document={document}
        dungeonId={dungeonId}
        levelNumber={levelNumber}
        onNavigate={onNavigate}
      />
      <LevelPropertiesDialog
        open={dialog === 'properties'}
        onOpenChange={(open) => setDialog(open ? 'properties' : null)}
        document={document}
        dungeonId={dungeonId}
        levelNumber={levelNumber}
        onOpenResize={() => setDialog('resize')}
        onOpenRenumber={() => setDialog('renumber')}
        forge={forgeProject !== null}
        onNavigate={onNavigate}
      />
      <ClearLevelContentDialog
        open={dialog === 'clear-content'}
        onOpenChange={(open) => setDialog(open ? 'clear-content' : null)}
        document={document}
        dungeonId={dungeonId}
        levelNumber={levelNumber}
      />
      <ImportDialog
        open={dialog === 'import'}
        onOpenChange={(open) => setDialog(open ? 'import' : null)}
        document={document}
        dungeonId={dungeonId}
        onNavigate={onNavigate}
        forge={forgeProject !== null}
      />
      {forgeProjectId && (
        <ForgePreviewDialog
          open={dialog === 'forge-preview'}
          onOpenChange={(open) => setDialog(open ? 'forge-preview' : null)}
          projectId={forgeProjectId}
          dungeonId={dungeonId}
          levelNumber={levelNumber}
        />
      )}
      {transitionDialog && (
        <TransitionDialog
          open
          onOpenChange={(open) => {
            if (!open) setTransitionDialog(null)
          }}
          document={document}
          dungeonId={dungeonId}
          levelNumber={levelNumber}
          sourceCell={transitionDialog.cell}
          existing={transitionDialog.existing}
        />
      )}
      <StockingReportDialog rolls={stockingRolls} onClose={() => setStockingRolls(null)} />
      {library.prompt && (
        <LibraryCollisionDialog
          kinds={library.prompt.kinds}
          onSubmit={library.submitPrompt}
          onCancel={library.cancelPrompt}
        />
      )}
    </div>
  )
}
