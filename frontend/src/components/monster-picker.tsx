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

export function MonsterPicker({
  bundled,
  onPick,
  triggerLabel = 'Add monster',
}: MonsterPickerProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [count, setCount] = useState('1')
  const shipped = useCatalog(loadMonsterCatalog)
  const forge = useProjectStore((state) => state.project?.forge != null)
  const monsters = useMemo(
    () => (shipped ? effectiveMonsterCatalog(shipped, bundled) : []),
    [shipped, bundled],
  )
  const ranked = useMemo(() => rankMonsters(monsters, recentMonsterIds(), query), [monsters, query])
  const countInvalid = countToKeyedMonster('x', count) === null

  const pick = (templateId: string) => {
    const line = countToKeyedMonster(templateId, count)
    if (!line) return
    recordRecentMonster(templateId)
    onPick(line)
    setOpen(false)
    setQuery('')
  }

  // The create shortcut: "like an orc, but…" starts where stocking happens.
  // In a forge project the capability stays discoverable and the shortcut
  // routes to the blocked-op dialog, which names detach as what unlocks it.
  const createMonster = () => {
    setOpen(false)
    setQuery('')
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
        <Command shouldFilter={false}>
          <CommandInput placeholder="Search monsters…" value={query} onValueChange={setQuery} />
          <CommandList>
            <CommandEmpty>{shipped ? 'No monster matches.' : 'Loading the catalog…'}</CommandEmpty>
            <CommandGroup>
              {ranked.map((monster) => (
                <CommandItem
                  key={monster.id}
                  value={monster.id}
                  disabled={countInvalid}
                  onSelect={() => pick(monster.id)}
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
