// The equipment picker: the same command-palette pattern over the 51 pickable
// items, grouped by item_type, cost shown in monospace.
import { useMemo, useState } from 'react'
import { PlusIcon } from 'lucide-react'

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
import { groupEquipment, loadEquipmentCatalog, useCatalog } from '@/lib/catalogs'

interface EquipmentPickerProps {
  onPick: (itemId: string) => void
  triggerLabel?: string
}

export function EquipmentPicker({ onPick, triggerLabel = 'Add item' }: EquipmentPickerProps) {
  const [open, setOpen] = useState(false)
  const items = useCatalog(loadEquipmentCatalog)
  const groups = useMemo(() => (items ? groupEquipment(items) : []), [items])

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm">
          <PlusIcon /> {triggerLabel}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0" align="start">
        <Command>
          <CommandInput placeholder="Search equipment…" />
          <CommandList>
            <CommandEmpty>{items ? 'No item matches.' : 'Loading the catalog…'}</CommandEmpty>
            {groups.map(([itemType, groupItems]) => (
              <CommandGroup key={itemType} heading={itemType}>
                {groupItems.map((item) => (
                  <CommandItem
                    key={item.id}
                    value={`${item.id} ${item.name}`}
                    onSelect={() => {
                      onPick(item.id)
                      setOpen(false)
                    }}
                  >
                    <span className="truncate">{item.name}</span>
                    <span className="text-muted-foreground ml-auto font-mono text-xs">
                      {item.cost_gp} gp
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
