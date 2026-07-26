// The one path input in the app: a text field that still takes a typed path,
// plus a browse button onto the backend's read-only directory listing.
//
// Two rules keep it honest. The picker never validates — the routes that consume
// a path own their refusals, and a destination that does not exist yet is the
// normal case for half these fields, so "Choose" is enabled whenever the box
// holds anything. And the value it hands back is the backend's `display_path`,
// which shortens home to `~`: the backend expands tildes on every route, so the
// short form is a path it accepts verbatim and a path no screenshot can leak an
// account name through.
import { useCallback, useEffect, useState } from 'react'
import { ArrowUpIcon, FileIcon, FolderIcon, FolderOpenIcon, HouseIcon } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { api, ApiRequestError } from '@/lib/api'
import { cn } from '@/lib/utils'
import type { DirectoryListing } from '@/types'

/** What counts as a choice: a directory, a file, or either. */
export type PathKind = 'directory' | 'file' | 'any'

function browseFailure(error: unknown): string {
  return error instanceof ApiRequestError ? error.detail.message : 'That directory cannot be read.'
}

export interface PathFieldProps {
  id: string
  value: string
  onChange: (value: string) => void
  /** What the field names. Files are unselectable in `directory` mode. */
  kind: PathKind
  placeholder?: string
  /** The picker's heading — say what is being chosen, in sentence case. */
  title: string
  /** File extensions worth showing, lowercase and dotted (`['.pdf']`). */
  suffixes?: string[]
  disabled?: boolean
  onKeyDown?: (event: React.KeyboardEvent<HTMLInputElement>) => void
  /** Extra classes for the field row — `flex-1` where a sibling control shares it. */
  className?: string
}

export function PathField({
  id,
  value,
  onChange,
  kind,
  placeholder,
  title,
  suffixes,
  disabled,
  onKeyDown,
  className,
}: PathFieldProps) {
  const [picking, setPicking] = useState(false)
  return (
    <div className={cn('flex gap-2', className)}>
      <Input
        id={id}
        className="font-mono"
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={onKeyDown}
      />
      <Button
        type="button"
        variant="outline"
        disabled={disabled}
        aria-label="Browse"
        onClick={() => setPicking(true)}
      >
        <FolderOpenIcon /> Browse
      </Button>
      {picking && (
        <PathPickerDialog
          open
          onOpenChange={setPicking}
          title={title}
          kind={kind}
          suffixes={suffixes}
          initialPath={value}
          onChoose={onChange}
        />
      )}
    </div>
  )
}

export interface PathPickerDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  kind: PathKind
  suffixes?: string[]
  /** Where to open — the field's current value, which may not exist yet. */
  initialPath: string
  onChoose: (path: string) => void
}

export function PathPickerDialog({
  open,
  onOpenChange,
  title,
  kind,
  suffixes,
  initialPath,
  onChoose,
}: PathPickerDialogProps) {
  const [listing, setListing] = useState<DirectoryListing | null>(null)
  const [draft, setDraft] = useState(initialPath)
  const [showHidden, setShowHidden] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  // Where the last *successful* browse landed. A refused directory never becomes
  // the origin of the next request, or "up" would walk back into the wall it
  // just bounced off.
  const [at, setAt] = useState<string | null>(initialPath.trim() || null)

  // `sync` is what separates navigating from arriving: a click moves the path
  // box with the user, while the opening browse leaves the field's own value
  // alone — it may name a file, or a directory that does not exist yet, and
  // either way the user typed it and it is not the picker's to rewrite.
  const land = useCallback(
    (next: DirectoryListing, sync: boolean) => {
      setListing(next)
      setAt(next.path)
      setFailure(null)
      // A file field lands on a directory with a separator waiting: the name is
      // the part only the user can supply.
      if (sync) {
        setDraft(kind === 'file' ? `${next.display_path.replace(/\/+$/, '')}/` : next.display_path)
      }
    },
    [kind],
  )

  useEffect(() => {
    let cancelled = false
    api
      .browse(initialPath.trim() || null, false)
      .then((next) => {
        if (!cancelled) land(next, false)
      })
      .catch((error: unknown) => {
        if (!cancelled) setFailure(browseFailure(error))
      })
    return () => {
      cancelled = true
    }
  }, [initialPath, land])

  const browse = (path: string | null, hidden: boolean, sync = false) => {
    api
      .browse(path, hidden)
      .then((next) => land(next, sync))
      .catch((error: unknown) => setFailure(browseFailure(error)))
  }

  const navigate = (path: string | null) => {
    browse(path, showHidden, true)
  }

  const toggleHidden = (hidden: boolean) => {
    setShowHidden(hidden)
    browse(at, hidden)
  }

  const choose = () => {
    onChoose(draft.trim())
    onOpenChange(false)
  }

  const entries = (listing?.entries ?? []).filter(
    (entry) =>
      entry.is_directory ||
      (kind !== 'directory' &&
        (!suffixes || suffixes.some((suffix) => entry.name.toLowerCase().endsWith(suffix)))),
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* Pinned header and footer with only the list scrolling: the choose
          button stays on screen at every viewport this app supports. */}
      <DialogContent className="flex max-h-[80vh] flex-col gap-3 sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            Browse to it, or type the path — <span className="font-mono">~</span> means your home
            directory.
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-2">
          <Button
            type="button"
            size="icon"
            variant="outline"
            aria-label="Home"
            onClick={() => navigate(null)}
          >
            <HouseIcon />
          </Button>
          <Button
            type="button"
            size="icon"
            variant="outline"
            aria-label="Up one directory"
            disabled={!listing?.parent}
            onClick={() => navigate(listing?.parent ?? null)}
          >
            <ArrowUpIcon />
          </Button>
          <p className="truncate font-mono text-sm" data-testid="picker-location">
            {listing?.display_path ?? '…'}
          </p>
        </div>

        {/* A refused browse is said above the list, not in place of it: the
            listing behind it is still the directory the user is standing in. */}
        {failure && (
          <p className="text-sm text-destructive" data-testid="picker-failure">
            {failure}
          </p>
        )}

        <ul
          className="min-h-40 flex-1 overflow-y-auto rounded-md border p-1"
          aria-label="Directory contents"
        >
          {entries.length === 0 ? (
            <li className="p-2 text-sm text-muted-foreground">
              {listing === null && failure === null ? 'Loading…' : 'Nothing here to choose.'}
            </li>
          ) : (
            entries.map((entry) => (
              <li key={entry.path}>
                <button
                  type="button"
                  // A directory row navigates; a file row fills the box. The
                  // current directory is always choosable in directory and any
                  // mode, so navigating never strands the user.
                  onClick={() =>
                    entry.is_directory ? navigate(entry.path) : setDraft(entry.display_path)
                  }
                  className={cn(
                    'flex w-full items-center gap-2 rounded-sm px-2 py-1 text-left text-sm hover:bg-accent/50 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none',
                    !entry.is_directory && draft === entry.display_path && 'bg-accent',
                  )}
                >
                  {entry.is_directory ? (
                    <FolderIcon className="size-4 shrink-0 text-muted-foreground" />
                  ) : (
                    <FileIcon className="size-4 shrink-0 text-muted-foreground" />
                  )}
                  <span className="truncate font-mono">{entry.name}</span>
                  {entry.project_type && (
                    <Badge variant="secondary" className="ml-auto">
                      {entry.project_type}
                    </Badge>
                  )}
                </button>
              </li>
            ))
          )}
        </ul>

        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <Checkbox
            checked={showHidden}
            onCheckedChange={(next) => toggleHidden(next === true)}
            aria-label="Show hidden"
          />
          Show hidden
        </label>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="picker-path">Path</Label>
          <Input
            id="picker-path"
            className="font-mono"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && draft.trim()) choose()
            }}
          />
        </div>

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" onClick={choose} disabled={!draft.trim()}>
            Choose
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
