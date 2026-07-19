import { useState } from 'react'
import { FileDownIcon } from 'lucide-react'
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
import { api, ApiRequestError } from '@/lib/api'
import { projectStore, useProjectStore } from '@/store/project-store'

export function ExportDialog() {
  const project = useProjectStore((state) => state.project)
  const lastExportPath = useProjectStore((state) => state.lastExportPath)
  const [open, setOpen] = useState(false)
  const [path, setPath] = useState('')

  if (!project) return null

  const openDialog = (next: boolean) => {
    if (next) setPath(lastExportPath ?? '')
    setOpen(next)
  }

  const submit = async () => {
    try {
      const result = await api.exportProject(project.id, path)
      projectStore.getState().setLastExportPath(result.path)
      toast.success(`Exported to ${result.path}`)
      setOpen(false)
    } catch (error) {
      if (error instanceof ApiRequestError) {
        toast.error(error.detail.message, { description: error.detail.remedy ?? undefined })
      } else {
        toast.error(error instanceof Error ? error.message : String(error))
      }
    }
  }

  return (
    <Dialog open={open} onOpenChange={openDialog}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <FileDownIcon /> Export
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Export adventure</DialogTitle>
          <DialogDescription>
            Writes the stamped document to the file path below, overwriting an existing file.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-2">
          <Label htmlFor="export-path">Destination file</Label>
          <Input
            id="export-path"
            className="font-mono"
            value={path}
            onChange={(event) => setPath(event.target.value)}
            placeholder="/absolute/path/to/adventure.json"
            onKeyDown={(event) => {
              if (event.key === 'Enter' && path) void submit()
            }}
          />
        </div>
        <DialogFooter>
          <Button onClick={() => void submit()} disabled={!path}>
            Export
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
