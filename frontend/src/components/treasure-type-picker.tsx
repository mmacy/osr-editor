// The treasure-type picker: the 22 letters grouped by section (hoard,
// individual, group), multi-select for the letters tuple — the popover stays
// open across toggles so a multi-letter pick is one gesture.
import { useMemo, useState } from 'react'
import { CheckIcon } from 'lucide-react'

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
import { groupTreasureTypes, loadTreasureTypeCatalog, useCatalog } from '@/lib/catalogs'
import { cn } from '@/lib/utils'

interface TreasureTypePickerProps {
  selected: readonly string[]
  onToggle: (letter: string) => void
}

export function TreasureTypePicker({ selected, onToggle }: TreasureTypePickerProps) {
  const [open, setOpen] = useState(false)
  const types = useCatalog(loadTreasureTypeCatalog)
  const groups = useMemo(() => (types ? groupTreasureTypes(types) : []), [types])
  const label = selected.length > 0 ? selected.join(', ') : 'Pick types…'

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="justify-start font-mono">
          {label}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-56 p-0" align="start">
        <Command>
          <CommandInput placeholder="Filter letters…" />
          <CommandList>
            <CommandEmpty>{types ? 'No letter matches.' : 'Loading the catalog…'}</CommandEmpty>
            {groups.map(([kind, groupTypes]) => (
              <CommandGroup key={kind} heading={kind}>
                {groupTypes.map((type) => {
                  const checked = selected.includes(type.letter)
                  return (
                    <CommandItem
                      key={type.letter}
                      value={type.letter}
                      onSelect={() => onToggle(type.letter)}
                    >
                      <CheckIcon className={cn('size-4', checked ? 'opacity-100' : 'opacity-0')} />
                      <span className="font-mono">{type.letter}</span>
                    </CommandItem>
                  )
                })}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
