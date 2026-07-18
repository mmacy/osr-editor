import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { FolderOpenIcon, MapPinOffIcon, PlusIcon } from 'lucide-react'
import { toast } from 'sonner'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { api, ApiRequestError } from '@/lib/api'
import { projectStore } from '@/store/project-store'
import type { ProjectListResponse, RecentProject } from '@/types'

// The CLI's PATH argument is honored once per page load — returning to the
// home screen later does not re-trigger it.
let launchPathConsumed = false

function toastApiError(error: unknown): void {
  if (error instanceof ApiRequestError) {
    toast.error(error.detail.message, { description: error.detail.remedy ?? undefined })
  } else {
    toast.error(error instanceof Error ? error.message : String(error))
  }
}

export function HomeScreen() {
  const navigate = useNavigate()
  const [listing, setListing] = useState<ProjectListResponse | null>(null)

  const openByPath = useCallback(
    async (path: string) => {
      try {
        const state = await api.openProject(path)
        projectStore.getState().setProject(state)
        navigate(`/projects/${state.id}`)
      } catch (error) {
        toastApiError(error)
      }
    },
    [navigate],
  )

  useEffect(() => {
    let cancelled = false
    api
      .listProjects()
      .then((value) => {
        if (!cancelled) setListing(value)
      })
      .catch(toastApiError)
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (listing?.open_at_launch && !launchPathConsumed) {
      launchPathConsumed = true
      void openByPath(listing.open_at_launch)
    }
  }, [listing, openByPath])

  const create = async (path: string, name: string) => {
    try {
      const state = await api.createProject(path, name)
      projectStore.getState().setProject(state)
      navigate(`/projects/${state.id}`)
    } catch (error) {
      toastApiError(error)
    }
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-3xl flex-col gap-8 p-8">
      <header className="flex items-end justify-between gap-4">
        <div>
          <h1 className="font-serif text-3xl font-semibold">osr-editor</h1>
          <p className="text-sm text-muted-foreground">
            Author osrlib adventure modules in your browser
          </p>
        </div>
        <div className="flex gap-2">
          <NewAdventureDialog onCreate={create} />
          <OpenProjectDialog onOpen={openByPath} />
        </div>
      </header>

      <section aria-label="Recent projects" className="flex flex-col gap-3">
        <h2 className="text-sm font-medium text-muted-foreground">Recent projects</h2>
        {listing === null ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : listing.recents.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nothing here yet — create a new adventure or open a project directory.
          </p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {listing.recents.map((recent) => (
              <RecentCard key={recent.path} recent={recent} onOpen={openByPath} />
            ))}
          </div>
        )}
      </section>
    </main>
  )
}

function RecentCard({ recent, onOpen }: { recent: RecentProject; onOpen: (path: string) => void }) {
  if (recent.missing) {
    return (
      <Card className="gap-2 py-4 opacity-70">
        <CardHeader className="px-4">
          <CardTitle className="flex items-center gap-2 font-serif text-base">
            <MapPinOffIcon className="size-4 text-muted-foreground" />
            {recent.name || 'Untitled adventure'}
          </CardTitle>
          <CardDescription className="truncate font-mono text-xs">{recent.path}</CardDescription>
          <CardDescription>The directory has moved or been deleted.</CardDescription>
        </CardHeader>
      </Card>
    )
  }
  return (
    <Card
      role="button"
      tabIndex={0}
      className="cursor-pointer gap-2 py-4 transition-colors hover:bg-accent/50 focus-visible:ring-2 focus-visible:ring-ring/50"
      onClick={() => onOpen(recent.path)}
      onKeyDown={(event) => {
        if (event.key === 'Enter') onOpen(recent.path)
      }}
    >
      <CardHeader className="px-4">
        <CardTitle className="flex items-center justify-between gap-2 font-serif text-base">
          <span className="truncate">{recent.name || 'Untitled adventure'}</span>
          <Badge variant="secondary">{recent.type}</Badge>
        </CardTitle>
        <CardDescription className="truncate font-mono text-xs">{recent.path}</CardDescription>
      </CardHeader>
    </Card>
  )
}

function NewAdventureDialog({
  onCreate,
}: {
  onCreate: (path: string, name: string) => Promise<void>
}) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [path, setPath] = useState('')
  const submit = async () => {
    await onCreate(path, name)
    setOpen(false)
  }
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <PlusIcon /> New adventure
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New adventure</DialogTitle>
          <DialogDescription>
            Creates a project directory holding the adventure document and the editor sidecar.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="new-adventure-name">Adventure name</Label>
            <Input
              id="new-adventure-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="The mill on the moor"
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="new-adventure-path">Destination directory</Label>
            <Input
              id="new-adventure-path"
              className="font-mono"
              value={path}
              onChange={(event) => setPath(event.target.value)}
              placeholder="/absolute/path/to/adventure.osr"
            />
          </div>
        </div>
        <DialogFooter>
          <Button onClick={() => void submit()} disabled={!name || !path}>
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function OpenProjectDialog({ onOpen }: { onOpen: (path: string) => Promise<void> }) {
  const [open, setOpen] = useState(false)
  const [path, setPath] = useState('')
  const submit = async () => {
    await onOpen(path)
    setOpen(false)
  }
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">
          <FolderOpenIcon /> Open project
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Open project</DialogTitle>
          <DialogDescription>Open a project directory by its absolute path.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-2">
          <Label htmlFor="open-project-path">Project directory</Label>
          <Input
            id="open-project-path"
            className="font-mono"
            value={path}
            onChange={(event) => setPath(event.target.value)}
            placeholder="/absolute/path/to/adventure.osr"
            onKeyDown={(event) => {
              if (event.key === 'Enter' && path) void submit()
            }}
          />
        </div>
        <DialogFooter>
          <Button onClick={() => void submit()} disabled={!path}>
            Open
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
