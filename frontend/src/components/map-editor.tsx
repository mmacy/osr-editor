// The map editor surface: dungeon switcher, level tabs, toolbar, the canvas
// with its stocking layer and context menu, the inspector, and the management
// dialogs — all driving one selection state and committing through the
// store's single-flight queue, one batch per completed gesture.
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowUpDownIcon,
  DoorOpenIcon,
  EyeOffIcon,
  LogInIcon,
  MaximizeIcon,
  MousePointer2Icon,
  PaintbrushIcon,
  RouteIcon,
  SquareIcon,
  ZoomInIcon,
  ZoomOutIcon,
} from 'lucide-react'

import type { CardIntent } from '@/components/area-content-cards'
import { SvgPreviewDialog } from '@/components/forge-dialogs'
import { ImportDialog } from '@/components/import-dialog'
import { MapCanvas } from '@/components/map-canvas'
import {
  AddDungeonDialog,
  AddLevelDialog,
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
import { Separator } from '@/components/ui/separator'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import type { LevelFocus, NavTarget } from '@/lib/address'
import { effectiveMonsterCatalog, loadMonsterCatalog, useCatalog } from '@/lib/catalogs'
import { areaTrapOps, encounterOps, treasureOps } from '@/lib/content-builders'
import { formatAreaContents } from '@/lib/notation'
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
import { DARK_THEME, LIGHT_THEME, markersFor, targetRef, type MapSelection } from '@/map/render'
import {
  areaAt,
  isAreaStocked,
  stockingMenuEntries,
  walkAreas,
  type StockingMenuEntry,
} from '@/map/stocking'
import { cellSizePx, fitView, resetView, zoomAt, type ViewTransform } from '@/map/view'
import { projectStore } from '@/store/project-store'
import type { Adventure, Diagnostics, LevelSpec, Position } from '@/types'

const TOOLS: Array<{ tool: Tool; label: string; shortcut: string; icon: React.ReactNode }> = [
  { tool: 'select', label: 'Select tool', shortcut: 'V', icon: <MousePointer2Icon /> },
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

function findLevel(document: Adventure, dungeonId: string, levelNumber: number): LevelSpec | null {
  return (
    document.dungeons
      .find((dungeon) => dungeon.id === dungeonId)
      ?.levels.find((level) => level.number === levelNumber) ?? null
  )
}

function usePrefersDark(): boolean {
  const [dark, setDark] = useState(
    () =>
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-color-scheme: dark)').matches,
  )
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return
    const query = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => setDark(query.matches)
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [])
  return dark
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
  const [view, setView] = useState<ViewTransform | null>(null)
  const [viewport, setViewport] = useState<{ width: number; height: number } | null>(null)
  const [selection, setSelection] = useState<MapSelection | null>(null)
  const [hover, setHover] = useState<HitTarget | null>(null)
  const [gesture, setGesture] = useState<Gesture | null>(null)
  const [transitionCell, setTransitionCell] = useState<Position | null>(null)
  const [unstockedFilter, setUnstockedFilter] = useState(false)
  const [cardIntent, setCardIntent] = useState<CardIntent | null>(null)
  const [menuAreaId, setMenuAreaId] = useState<string | null>(null)
  const intentToken = useRef(0)
  const [dialog, setDialog] = useState<
    | 'add-dungeon'
    | 'rename-dungeon'
    | 'add-level'
    | 'renumber'
    | 'resize'
    | 'properties'
    | 'import'
    | null
  >(null)
  const prefersDark = usePrefersDark()
  const theme = prefersDark ? DARK_THEME : LIGHT_THEME
  // The hover line's monster names resolve through the effective catalog.
  const shippedMonsters = useCatalog(loadMonsterCatalog)
  const pickerMonsters = useMemo(
    () => (shippedMonsters ? effectiveMonsterCatalog(shippedMonsters, document.monsters) : []),
    [shippedMonsters, document.monsters],
  )
  const monsterNameFor = (templateId: string) =>
    pickerMonsters.find((monster) => monster.id === templateId)?.name ?? templateId

  // A level switch resets the interaction state — the render-time adjustment
  // pattern, not an effect. The view derives fit-level-on-open below, so
  // nulling it here is what re-fits the next level.
  const levelIdentity = `${dungeonId}/${levelNumber}`
  const [seenLevel, setSeenLevel] = useState(levelIdentity)
  if (seenLevel !== levelIdentity) {
    setSeenLevel(levelIdentity)
    setView(null)
    setSelection(null)
    setGesture(null)
    setHover(null)
    setCardIntent(null)
  }

  // A one-shot intent lives only while its area stays selected: the selection
  // leaving the area drops it (render-time adjustment), and consumption nulls
  // it — either way a reselect remounting the inspector never replays an add.
  if (cardIntent && !(selection?.kind === 'area' && selection.areaId === cardIntent.areaId)) {
    setCardIntent(null)
  }

  // Fit-level-on-open, derived: user interactions set the view state; until
  // the first one (or after a level switch), the fitted transform is computed
  // from the viewport.
  const effectiveView =
    view ??
    (viewport && level ? fitView(level.width, level.height, viewport.width, viewport.height) : null)

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
      if (dialog !== null || transitionCell !== null) return
      if (event.metaKey || event.ctrlKey || event.altKey) return
      if (event.key === 'Escape') {
        if (gesture) setGesture(null)
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
      if (shortcut) setTool(shortcut)
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
    setTransitionCell(cell)
  }

  // The stocking context menu: right-click on an area cell offers exactly
  // what the area can hold; anywhere else does nothing this phase.
  const menuArea = menuAreaId
    ? (level.areas.find((candidate) => candidate.id === menuAreaId) ?? null)
    : null
  const applyMenuEntry = (areaId: string, entry: StockingMenuEntry) => {
    setSelection({ kind: 'area', areaId })
    const target = { dungeonId, levelNumber, areaId }
    if (entry.action === 'remove') {
      if (entry.card === 'encounter')
        void projectStore.getState().commit(encounterOps(target, null))
      else if (entry.card === 'treasure')
        void projectStore.getState().commit(treasureOps(target, null))
      else if (entry.card === 'trap') void projectStore.getState().commit(areaTrapOps(target, null))
      return
    }
    intentToken.current += 1
    setCardIntent({ areaId, card: entry.card, action: entry.action, token: intentToken.current })
  }

  // The hover line: the cell/edge ref plus the hovered area's one-line
  // contents in module notation.
  const hoverArea = hover?.kind === 'cell' ? areaAt(level, hover.cell) : null
  const hoverContents = hoverArea ? formatAreaContents(hoverArea, monsterNameFor) : ''
  const hoverLine = hoverArea
    ? `${targetRef(hover)} · ${hoverArea.id}${hoverContents ? `: ${hoverContents}` : ''}`
    : targetRef(hover)

  const markers = markersFor(
    [...diagnostics.validation, ...diagnostics.lint],
    dungeonId,
    levelNumber,
  )
  const sortedLevels = [...dungeon.levels].sort((a, b) => a.number - b.number)
  const lastDungeon = document.dungeons.length === 1

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
        <Button
          variant="outline"
          size="sm"
          onClick={removeDungeon}
          disabled={lastDungeon}
          title={lastDungeon ? 'An adventure needs at least one dungeon.' : undefined}
        >
          Remove dungeon
        </Button>
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
          </button>
        ))}
        <Button variant="ghost" size="sm" onClick={() => setDialog('add-level')}>
          Add level
        </Button>
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
                onClick={() => setTool(candidate)}
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
            effectiveView &&
            viewport &&
            setView(zoomAt(effectiveView, { x: viewport.width / 2, y: viewport.height / 2 }, 1.25))
          }
        >
          <ZoomInIcon />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Zoom out"
          onClick={() =>
            effectiveView &&
            viewport &&
            setView(
              zoomAt(effectiveView, { x: viewport.width / 2, y: viewport.height / 2 }, 1 / 1.25),
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
        <SvgPreviewDialog dungeonId={dungeonId} levelNumber={levelNumber} />
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
        <span className="ml-auto font-mono text-xs text-muted-foreground" data-testid="hover-ref">
          {hoverLine}
        </span>
      </div>

      <div className="flex min-h-0 flex-1">
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
            <div className="relative min-w-0 flex-1">
              <MapCanvas
                level={level}
                view={effectiveView}
                onViewChange={setView}
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
              />
            </div>
          </ContextMenuTrigger>
          <ContextMenuContent aria-label={menuArea ? `Stock area ${menuArea.id}` : undefined}>
            {menuArea &&
              stockingMenuEntries(menuArea).map((entry) => (
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
        <aside
          className={cn(
            'shrink-0 overflow-y-auto border-l bg-card',
            // The deep content forms expand in place and need the room —
            // still an aside, never a modal.
            selection?.kind === 'area' ? 'w-96' : 'w-64',
          )}
          aria-label="Inspector"
        >
          <MapInspector
            document={document}
            dungeonId={dungeonId}
            levelNumber={levelNumber}
            selection={selection}
            onSelectionChange={setSelection}
            cardIntent={cardIntent}
            onCardIntentConsumed={() => setCardIntent(null)}
          />
        </aside>
      </div>

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
        onNavigate={onNavigate}
      />
      <ImportDialog
        open={dialog === 'import'}
        onOpenChange={(open) => setDialog(open ? 'import' : null)}
        document={document}
        dungeonId={dungeonId}
        onNavigate={onNavigate}
      />
      {transitionCell && (
        <TransitionDialog
          open
          onOpenChange={(open) => {
            if (!open) setTransitionCell(null)
          }}
          document={document}
          dungeonId={dungeonId}
          levelNumber={levelNumber}
          sourceCell={transitionCell}
        />
      )}
    </div>
  )
}
