// Detach: the explicit, recorded crossing from the reproducible world to the
// native one. The dialog states the consequence in the spec's own terms.
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
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
import { projectStore } from '@/store/project-store'

export function DetachDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open && <DetachBody onOpenChange={onOpenChange} />}
    </Dialog>
  )
}

function DetachBody({ onOpenChange }: { onOpenChange: (open: boolean) => void }) {
  const navigate = useNavigate()
  const [path, setPath] = useState('')
  const [busy, setBusy] = useState(false)
  const detach = () => {
    setBusy(true)
    void projectStore
      .getState()
      .detach(path)
      .then((detached) => {
        setBusy(false)
        if (!detached) return
        onOpenChange(false)
        toast('Detached to a native project', {
          description: 'Provenance is recorded in the new project’s editor.json.',
        })
        navigate(`/projects/${detached.id}`)
      })
  }
  return (
    <DialogContent className="sm:max-w-lg">
      <DialogHeader>
        <DialogTitle>Detach to a native project</DialogTitle>
        <DialogDescription>
          The current assembled adventure is written as a new native project and edits apply to it
          directly. The forge re-run loop is severed: corrections no longer land in overrides.yaml,
          and the workdir stays behind untouched. Provenance — the source workdir and forge version
          — is recorded in the new project&apos;s sidecar, and author notes carry over.
        </DialogDescription>
      </DialogHeader>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="detach-path">New project directory (absolute path)</Label>
        <Input
          id="detach-path"
          className="font-mono"
          placeholder="/adventures/my-module.osr"
          value={path}
          onChange={(event) => setPath(event.target.value)}
        />
      </div>
      <DialogFooter>
        <Button variant="ghost" onClick={() => onOpenChange(false)}>
          Cancel
        </Button>
        <Button disabled={!path.trim() || busy} onClick={detach}>
          Detach
        </Button>
      </DialogFooter>
    </DialogContent>
  )
}
