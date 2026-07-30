// The magic-item picker: the command-palette pattern over the 164 shipped
// magic items, grouped by category. Cursed forms are marked in the list —
// placing one is a deliberate authoring choice, never a surprise.
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
import { groupMagicItems, loadMagicItemCatalog, useCatalog } from '@/lib/catalogs'

interface MagicItemPickerProps {
  onPick: (itemId: string) => void
  triggerLabel?: string
}

export function MagicItemPicker({ onPick, triggerLabel = 'Add magic item' }: MagicItemPickerProps) {
  const [open, setOpen] = useState(false)
  const items = useCatalog(loadMagicItemCatalog)
  const groups = useMemo(() => (items ? groupMagicItems(items) : []), [items])

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm">
          <PlusIcon /> {triggerLabel}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0" align="start">
        <Command>
          <CommandInput placeholder="Search magic items…" />
          <CommandList>
            <CommandEmpty>{items ? 'No item matches.' : 'Loading the catalog…'}</CommandEmpty>
            {groups.map(([category, groupItems]) => (
              <CommandGroup key={category} heading={category}>
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
                    {item.cursed && (
                      <span className="text-destructive ml-auto text-xs">cursed</span>
                    )}
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
