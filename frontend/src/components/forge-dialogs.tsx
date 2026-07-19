// The forge map-side dialogs: the SVG preview of a corrected level, the detach
// crossing to a native project, and the blocked-op offer that renders in place.
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { MapIcon } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
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
import { api, ApiRequestError, forgePreviewUrl } from '@/lib/api'
import { projectStore, useProjectStore, type BlockedOp } from '@/store/project-store'

export function SvgPreviewDialog({
  dungeonId,
  levelNumber,
}: {
  dungeonId: string
  levelNumber: number
}) {
  const project = useProjectStore((state) => state.project)
  const [open, setOpen] = useState(false)
  if (!project || !project.forge) return null
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label="Level preview">
          <MapIcon />
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Level {levelNumber} preview</DialogTitle>
          <DialogDescription>Forge&rsquo;s rendering of the corrected plan.</DialogDescription>
        </DialogHeader>
        {open && (
          <div className="flex max-h-[70vh] justify-center overflow-auto">
            <img
              src={forgePreviewUrl(project.id, dungeonId, levelNumber)}
              alt={`Level ${levelNumber} preview`}
              className="max-w-full"
            />
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

export function DetachDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const project = useProjectStore((state) => state.project)
  const navigate = useNavigate()
  const [path, setPath] = useState('')
  if (!project) return null

  const submit = async () => {
    try {
      const native = await api.forgeDetach(project.id, path)
      projectStore.getState().setProject(native)
      onOpenChange(false)
      toast.success('Detached to a native project')
      navigate(`/projects/${native.id}`)
    } catch (error) {
      if (error instanceof ApiRequestError) {
        toast.error(error.detail.message, { description: error.detail.remedy ?? undefined })
      } else {
        toast.error(error instanceof Error ? error.message : String(error))
      }
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Detach to a native project</DialogTitle>
          <DialogDescription>
            The forge re-run loop is severed: corrections will no longer land in overrides.yaml. The
            workdir is untouched; the new project records where it came from.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-2">
          <Label htmlFor="detach-path">Destination directory</Label>
          <Input
            id="detach-path"
            className="font-mono"
            value={path}
            onChange={(event) => setPath(event.target.value)}
            placeholder="/absolute/path/to/new-project.osr"
          />
        </div>
        <DialogFooter>
          <Button onClick={() => void submit()} disabled={!path}>
            Detach
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function BlockedOpDialog({
  blocked,
  onOpenChange,
  onDetach,
}: {
  blocked: BlockedOp | null
  onOpenChange: (open: boolean) => void
  onDetach: () => void
}) {
  return (
    <Dialog open={blocked !== null} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>This edit has no override kind</DialogTitle>
          <DialogDescription>{blocked?.message}</DialogDescription>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          A forge project corrects its draft through overrides.yaml. This gesture ({blocked?.op})
          can only be made in a native project — detach to make it.
        </p>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={() => {
              onOpenChange(false)
              onDetach()
            }}
          >
            Detach&hellip;
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
