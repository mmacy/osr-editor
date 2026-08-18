// The monster picker: a command palette over the effective catalog — bundled
// templates first, then this session's recently used, then shipped order —
// with the count landing inline in the same gesture. A segmented dice-or-fixed
// input: all digits reads as fixed, anything else as dice with the convenience
// mirror's check; the server's parse stays the authority.
import { useMemo, useState } from 'react'
import { PlusIcon } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  effectiveMonsterCatalog,
  loadMonsterCatalog,
  rankMonsters,
  recentMonsterIds,
  recordRecentMonster,
  useCatalog,
} from '@/lib/catalogs'
import { BUNDLED_TEMPLATE_BLOCKED_MESSAGE } from '@/lib/monster-builders'
import { formatHitDice, parseDice } from '@/lib/notation'
import { projectStore, useProjectStore } from '@/store/project-store'
import type { KeyedMonster, MonsterTemplate } from '@/types'

export function countToKeyedMonster(templateId: string, countText: string): KeyedMonster | null {
  const trimmed = countText.trim()
  if (trimmed === '') return null
  if (/^[0-9]+$/.test(trimmed)) {
    const fixed = Number(trimmed)
    if (fixed < 1) return null
    return { template_id: templateId, count_dice: null, count_fixed: fixed }
  }
  if (!parseDice(trimmed)) return null
  return { template_id: templateId, count_dice: trimmed, count_fixed: null }
}

interface MonsterPickerProps {
  bundled: readonly MonsterTemplate[]
  onPick: (line: KeyedMonster) => void
  triggerLabel?: string
}

// The shared searchable list over the effective catalog and its ranking —
// both pickers render exactly this body, so the domain and the ordering can
// never drift between them. A pick records recency and answers the bare id;
// what the id becomes (a keyed line with a count, a pattern's template) is
// the host's business.
function MonsterCommandList({
  bundled,
  disabled = false,
  onSelect,
}: {
  bundled: readonly MonsterTemplate[]
  disabled?: boolean
  onSelect: (templateId: string) => void
}) {
  const [query, setQuery] = useState('')
  const shipped = useCatalog(loadMonsterCatalog)
  const monsters = useMemo(
    () => (shipped ? effectiveMonsterCatalog(shipped, bundled) : []),
    [shipped, bundled],
  )
  const ranked = useMemo(() => rankMonsters(monsters, recentMonsterIds(), query), [monsters, query])
  return (
    <Command shouldFilter={false}>
      <CommandInput placeholder="Search monsters…" value={query} onValueChange={setQuery} />
      <CommandList>
        <CommandEmpty>{shipped ? 'No monster matches.' : 'Loading the catalog…'}</CommandEmpty>
        <CommandGroup>
          {ranked.map((monster) => (
            <CommandItem
              key={monster.id}
              value={monster.id}
              disabled={disabled}
              onSelect={() => {
                recordRecentMonster(monster.id)
                onSelect(monster.id)
              }}
            >
              <span className="truncate">{monster.name}</span>
              {monster.bundled && <Badge variant="secondary">bundled</Badge>}
              <span className="text-muted-foreground ml-auto font-mono text-xs">
                HD {formatHitDice(monster.hitDice)}
              </span>
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
    </Command>
  )
}

// The bare-id variant over the same effective catalog and ranking — the
// trigger surface's picker (a monster_defeated pattern and a spawn's
// template name a monster; their counts, when any, are the form's own
// control, not the pick's).
export function MonsterIdPicker({
  bundled,
  onPick,
  triggerLabel = 'Pick monster',
}: {
  bundled: readonly MonsterTemplate[]
  onPick: (templateId: string) => void
  triggerLabel?: string
}) {
  const [open, setOpen] = useState(false)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm">
          {triggerLabel}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0" align="start">
        <MonsterCommandList
          bundled={bundled}
          onSelect={(templateId) => {
            onPick(templateId)
            setOpen(false)
          }}
        />
      </PopoverContent>
    </Popover>
  )
}

export function MonsterPicker({
  bundled,
  onPick,
  triggerLabel = 'Add monster',
}: MonsterPickerProps) {
  const [open, setOpen] = useState(false)
  const [count, setCount] = useState('1')
  const forge = useProjectStore((state) => state.project?.forge != null)
  const countInvalid = countToKeyedMonster('x', count) === null

  const pick = (templateId: string) => {
    const line = countToKeyedMonster(templateId, count)
    if (!line) return
    onPick(line)
    setOpen(false)
  }

  // The create shortcut: "like an orc, but…" starts where stocking happens.
  // In a forge project the capability stays discoverable and the shortcut
  // routes to the blocked-op dialog, which names detach as what unlocks it.
  const createMonster = () => {
    setOpen(false)
    if (forge) {
      projectStore.getState().setBlockedOp({
        op: 'add_monster_template',
        address: 'monsters',
        message: BUNDLED_TEMPLATE_BLOCKED_MESSAGE,
      })
      return
    }
    projectStore.getState().requestNavigation({ kind: 'monsters', create: true })
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm">
          <PlusIcon /> {triggerLabel}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0" align="start">
        <div className="flex items-center gap-2 border-b p-2">
          <Label htmlFor="monster-count" className="text-muted-foreground shrink-0 text-xs">
            Count
          </Label>
          <Input
            id="monster-count"
            className="h-7 w-24 font-mono text-sm"
            value={count}
            onChange={(event) => setCount(event.target.value)}
            aria-invalid={countInvalid}
          />
          {countInvalid && <span className="text-destructive text-xs">dice or a number</span>}
        </div>
        <MonsterCommandList bundled={bundled} disabled={countInvalid} onSelect={pick} />
        <div className="border-t p-1">
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-start"
            onClick={createMonster}
          >
            <PlusIcon /> Create monster…
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}
