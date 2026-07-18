import { useNavigate } from 'react-router-dom'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { ScrollArea } from '@/components/ui/scroll-area'
import { projectStore, useProjectStore } from '@/store/project-store'

// The fidelity warning: when the opened document carries fields a newer osrlib
// authored, an always-saved editor would silently drop them on first write —
// so the warning comes before the first edit, with an explicit "edit anyway"
// acknowledgement. Dismissal is per open, not persisted; the warning is the
// feature.
export function FidelityDialog() {
  const navigate = useNavigate()
  const project = useProjectStore((state) => state.project)
  const acknowledged = useProjectStore((state) => state.fidelityAcknowledged)
  if (!project || project.dropped_fields.length === 0) return null
  return (
    <Dialog open={!acknowledged}>
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>This document carries fields a newer osrlib wrote</DialogTitle>
          <DialogDescription>
            The installed osrlib does not understand these fields, and the editor saves on every
            edit — the first committed change drops them from the file permanently. Upgrade osrlib
            and reopen to keep them.
          </DialogDescription>
        </DialogHeader>
        <ScrollArea className="max-h-40 overflow-y-auto rounded-md border bg-muted/50 p-3">
          <ul className="flex flex-col gap-1 font-mono text-xs">
            {project.dropped_fields.map((pointer) => (
              <li key={pointer}>{pointer}</li>
            ))}
          </ul>
        </ScrollArea>
        <DialogFooter>
          <Button variant="outline" onClick={() => navigate('/')}>
            Go back
          </Button>
          <Button onClick={() => projectStore.getState().acknowledgeFidelity()}>Edit anyway</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
