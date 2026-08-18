// The item pickers over their true domains. ItemPicker serves treasure-cache
// item_ids: the *effective* equipment catalog — the document's bundle under a
// "This adventure" group ahead of the four kind groups, shipped-id collisions
// skipped (magic stays magic_item_ids' separate picker, unchanged).
// GateItemPicker serves gate conditions: effective items ∪ shipped magic —
// exactly the domain osrlib's has_item resolves against — with the magic
// items as a trailing group, cursed forms marked. Phase 16's acquisition
// patterns will reuse it.
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
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  effectiveItemCatalog,
  loadEquipmentCatalog,
  loadMagicItemCatalog,
  useCatalog,
  type PickerItem,
} from '@/lib/catalogs'
import type { Adventure } from '@/types'

function groupPickerItems(items: readonly PickerItem[]): [string, PickerItem[]][] {
  const groups = new Map<string, PickerItem[]>()
  for (const item of items) {
    const heading = item.bundled ? 'This adventure' : item.itemType
    const group = groups.get(heading)
    if (group) group.push(item)
    else groups.set(heading, [item])
  }
  return [...groups.entries()]
}

function EquipmentGroups({
  document,
  onSelect,
}: {
  document: Adventure
  onSelect: (itemId: string) => void
}) {
  const shipped = useCatalog(loadEquipmentCatalog)
  const groups = useMemo(
    () => (shipped ? groupPickerItems(effectiveItemCatalog(shipped, document.items)) : []),
    [shipped, document.items],
  )
  return (
    <>
      <CommandEmpty>{shipped ? 'No item matches.' : 'Loading the catalog…'}</CommandEmpty>
      {groups.map(([heading, groupItems]) => (
        <CommandGroup key={heading} heading={heading}>
          {groupItems.map((item) => (
            <CommandItem
              key={item.id}
              value={`${item.id} ${item.name}`}
              onSelect={() => onSelect(item.id)}
            >
              <span className="truncate">{item.name}</span>
              {item.bundled && <Badge variant="secondary">bundled</Badge>}
              <span className="text-muted-foreground ml-auto font-mono text-xs">
                {item.costGp} gp
              </span>
            </CommandItem>
          ))}
        </CommandGroup>
      ))}
    </>
  )
}

export function ItemPicker({
  document,
  onPick,
  triggerLabel = 'Add item',
}: {
  document: Adventure
  onPick: (itemId: string) => void
  triggerLabel?: string
}) {
  const [open, setOpen] = useState(false)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm">
          <PlusIcon /> {triggerLabel}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0" align="start">
        <Command>
          <CommandInput placeholder="Search items…" />
          <CommandList>
            <EquipmentGroups
              document={document}
              onSelect={(itemId) => {
                onPick(itemId)
                setOpen(false)
              }}
            />
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

export function GateItemPicker({
  document,
  onPick,
  triggerLabel = 'Pick item',
}: {
  document: Adventure
  onPick: (itemId: string) => void
  triggerLabel?: string
}) {
  const [open, setOpen] = useState(false)
  const magic = useCatalog(loadMagicItemCatalog)
  const select = (itemId: string) => {
    onPick(itemId)
    setOpen(false)
  }
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm">
          {triggerLabel}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0" align="start">
        <Command>
          <CommandInput placeholder="Search items…" />
          <CommandList>
            <EquipmentGroups document={document} onSelect={select} />
            <CommandGroup heading="magic items">
              {(magic ?? []).map((item) => (
                <CommandItem
                  key={item.id}
                  value={`${item.id} ${item.name}`}
                  onSelect={() => select(item.id)}
                >
                  <span className="truncate">{item.name}</span>
                  {item.cursed && <span className="text-destructive ml-auto text-xs">cursed</span>}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
