// The right-side inspector for the current map selection: the keyed-entry
// reading view — area identity in the serif voice, then the content cards
// (encounter, treasure, trap, features) — plus the door inspector and
// cell/transition details. Every commit goes through the store's builder form
// against the committed document.
import { useEffect, useRef } from 'react'

import { AreaContentCards, type CardIntent } from '@/components/area-content-cards'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { useCommittedField } from '@/hooks/use-committed-field'
import type { MapSelection } from '@/map/render'
import { isAreaStocked } from '@/map/stocking'
import { projectStore } from '@/store/project-store'
import type { Adventure, AreaSpec, DoorSpec, Edge, LevelSpec, Position } from '@/types'

function findLevel(document: Adventure, dungeonId: string, levelNumber: number): LevelSpec | null {
  return (
    document.dungeons
      .find((dungeon) => dungeon.id === dungeonId)
      ?.levels.find((level) => level.number === levelNumber) ?? null
  )
}

export function MapInspector({
  document,
  dungeonId,
  levelNumber,
  selection,
  onSelectionChange,
  cardIntent = null,
}: {
  document: Adventure
  dungeonId: string
  levelNumber: number
  selection: MapSelection | null
  onSelectionChange: (selection: MapSelection | null) => void
  cardIntent?: CardIntent | null
}) {
  const level = findLevel(document, dungeonId, levelNumber)
  if (!level || !selection) {
    return (
      <p className="p-3 text-sm text-muted-foreground">
        Select something on the map to inspect it.
      </p>
    )
  }
  if (selection.kind === 'area') {
    const area = level.areas.find((candidate) => candidate.id === selection.areaId)
    if (!area)
      return <p className="p-3 text-sm text-muted-foreground">This area no longer exists.</p>
    return (
      <AreaInspector
        key={`${dungeonId}/${levelNumber}/${area.id}`}
        document={document}
        area={area}
        dungeonId={dungeonId}
        levelNumber={levelNumber}
        onSelectionChange={onSelectionChange}
        cardIntent={cardIntent}
      />
    )
  }
  if (selection.kind === 'edge') {
    const edge = level.edges[selection.key]
    return (
      <EdgeInspector
        key={`${dungeonId}/${levelNumber}/${selection.key}`}
        edgeKey={selection.key}
        edge={edge}
        dungeonId={dungeonId}
        levelNumber={levelNumber}
      />
    )
  }
  return (
    <CellInspector
      cell={selection.cell}
      level={level}
      dungeonId={dungeonId}
      levelNumber={levelNumber}
      onSelectionChange={onSelectionChange}
    />
  )
}

function AreaInspector({
  document,
  area,
  dungeonId,
  levelNumber,
  onSelectionChange,
  cardIntent,
}: {
  document: Adventure
  area: AreaSpec
  dungeonId: string
  levelNumber: number
  onSelectionChange: (selection: MapSelection | null) => void
  cardIntent: CardIntent | null
}) {
  // The context menu's description intent lands focus in the prose field.
  const descriptionRef = useRef<HTMLTextAreaElement | null>(null)
  useEffect(() => {
    if (cardIntent?.card === 'description') descriptionRef.current?.focus()
  }, [cardIntent])
  const commitField = (field: 'id' | 'name' | 'description', value: string) => {
    void projectStore
      .getState()
      .commit([
        {
          op: 'set_area_field',
          dungeon_id: dungeonId,
          level_number: levelNumber,
          area_id: area.id,
          field,
          value,
        },
      ])
      .then((committed) => {
        if (committed && field === 'id') onSelectionChange({ kind: 'area', areaId: value })
      })
  }
  const id = useCommittedField(area.id, (value) => commitField('id', value))
  const name = useCommittedField(area.name, (value) => commitField('name', value))
  const description = useCommittedField(area.description, (value) =>
    commitField('description', value),
  )
  const removeArea = () => {
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
      .commit([
        { op: 'remove_area', dungeon_id: dungeonId, level_number: levelNumber, area_id: area.id },
      ])
      .then((committed) => {
        if (committed) onSelectionChange(null)
      })
  }
  return (
    <section aria-label={`Area ${area.id}`} className="flex flex-col gap-3 p-3">
      <h3 className="text-sm font-medium">Area</h3>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="area-id">Key</Label>
        <Input id="area-id" className="font-mono" {...id} />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="area-name">Name</Label>
        <Input id="area-name" className="font-serif" {...name} />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="area-description">Description</Label>
        <Textarea
          id="area-description"
          ref={descriptionRef}
          className="min-h-24 font-serif"
          value={description.value}
          onChange={description.onChange}
          onBlur={description.onBlur}
        />
      </div>
      <p className="text-xs text-muted-foreground">
        <span className="font-mono">{area.cells.length}</span> cell(s)
      </p>
      <AreaContentCards
        document={document}
        area={area}
        target={{ dungeonId, levelNumber, areaId: area.id }}
        intent={cardIntent}
      />
      <Button variant="destructive" size="sm" onClick={removeArea}>
        Remove area
      </Button>
    </section>
  )
}

const DEFAULT_DOOR: DoorSpec = { kind: 'normal', stuck: false, locked: false, starts_open: false }

function EdgeInspector({
  edgeKey,
  edge,
  dungeonId,
  levelNumber,
}: {
  edgeKey: string
  edge: Edge | undefined
  dungeonId: string
  levelNumber: number
}) {
  // Builders read the committed entry so a queued change patches what is
  // actually there; deletes are emitted only for keys that exist.
  const commitEdge = (value: Edge | null) => {
    void projectStore.getState().commit((document) => {
      const level = findLevel(document, dungeonId, levelNumber)
      if (!level) return []
      if (value === null && !(edgeKey in level.edges)) return []
      return [
        {
          op: 'set_edges',
          dungeon_id: dungeonId,
          level_number: levelNumber,
          edges: { [edgeKey]: value },
        },
      ]
    })
  }
  const patchDoor = (patch: Partial<DoorSpec>) => {
    void projectStore.getState().commit((document) => {
      const level = findLevel(document, dungeonId, levelNumber)
      const current = level?.edges[edgeKey]
      if (!level || current?.kind !== 'door') return []
      return [
        {
          op: 'set_edges',
          dungeon_id: dungeonId,
          level_number: levelNumber,
          edges: {
            [edgeKey]: { kind: 'door', door: { ...(current.door ?? DEFAULT_DOOR), ...patch } },
          },
        },
      ]
    })
  }
  const kind = edge?.kind === 'wall' ? 'wall' : (edge?.kind ?? 'wall')
  return (
    <section aria-label="Edge" className="flex flex-col gap-3 p-3">
      <h3 className="text-sm font-medium">Edge</h3>
      <p className="font-mono text-xs text-muted-foreground">{edgeKey}</p>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="edge-kind">Kind</Label>
        <select
          id="edge-kind"
          className="h-8 rounded-md border border-input bg-transparent px-2 text-sm"
          value={kind}
          onChange={(event) => {
            const next = event.target.value
            if (next === 'wall') commitEdge(null)
            else if (next === 'open') commitEdge({ kind: 'open', door: null })
            else commitEdge({ kind: 'door', door: DEFAULT_DOOR })
          }}
        >
          <option value="wall">Wall</option>
          <option value="open">Open</option>
          <option value="door">Door</option>
        </select>
      </div>
      {edge?.kind === 'door' && edge.door && (
        <div className="flex flex-col gap-2" aria-label="Door">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="door-kind">Door kind</Label>
            <select
              id="door-kind"
              className="h-8 rounded-md border border-input bg-transparent px-2 text-sm"
              value={edge.door.kind}
              onChange={(event) => patchDoor({ kind: event.target.value as DoorSpec['kind'] })}
            >
              <option value="normal">Normal</option>
              <option value="secret">Secret</option>
            </select>
          </div>
          <DoorFlag
            label="Stuck"
            checked={edge.door.stuck}
            onChange={(stuck) => patchDoor({ stuck })}
          />
          <DoorFlag
            label="Locked"
            checked={edge.door.locked}
            onChange={(locked) => patchDoor({ locked })}
          />
          <DoorFlag
            label="Starts open"
            checked={edge.door.starts_open}
            onChange={(starts_open) => patchDoor({ starts_open })}
          />
        </div>
      )}
    </section>
  )
}

function DoorFlag({
  label,
  checked,
  onChange,
}: {
  label: string
  checked: boolean
  onChange: (value: boolean) => void
}) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
      {label}
    </label>
  )
}

function CellInspector({
  cell,
  level,
  dungeonId,
  levelNumber,
  onSelectionChange,
}: {
  cell: Position
  level: LevelSpec
  dungeonId: string
  levelNumber: number
  onSelectionChange: (selection: MapSelection | null) => void
}) {
  const transition = level.transitions.find(
    (candidate) => candidate.position[0] === cell[0] && candidate.position[1] === cell[1],
  )
  const isEntrance = level.entrance?.[0] === cell[0] && level.entrance?.[1] === cell[1]
  const removeTransition = () => {
    void projectStore
      .getState()
      .commit((current) => {
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
      .then((committed) => {
        if (committed) onSelectionChange({ kind: 'cell', cell })
      })
  }
  return (
    <section aria-label="Cell" className="flex flex-col gap-3 p-3">
      <h3 className="text-sm font-medium">Cell</h3>
      <p className="font-mono text-xs text-muted-foreground">
        ({cell[0]}, {cell[1]})
      </p>
      {isEntrance && <p className="text-sm">The level entrance is here.</p>}
      {transition ? (
        <div className="flex flex-col gap-2 text-sm">
          <p>
            <span className="font-mono">{transition.kind}</span> to{' '}
            <span className="font-mono">
              {transition.to_dungeon_id}/{transition.to_level_number} ({transition.to_position[0]},{' '}
              {transition.to_position[1]})
            </span>{' '}
            facing <span className="font-mono">{transition.to_facing}</span>
          </p>
          <Button variant="destructive" size="sm" onClick={removeTransition}>
            Remove transition
          </Button>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">No transition on this cell.</p>
      )}
    </section>
  )
}
