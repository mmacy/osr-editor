// A 422 op_unsupported_forge rendered in place: the gesture named, the
// one-line why, and the choice — detach or cancel. No forge-mode surface is
// preemptively hidden; the spec's rule is "offers it in place when such an
// edit is attempted".
import { useState } from 'react'

import { DetachDialog } from '@/components/detach-dialog'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { projectStore, useProjectStore } from '@/store/project-store'

export function BlockedOpDialog() {
  const blocked = useProjectStore((state) => state.blockedOp)
  const [detachOpen, setDetachOpen] = useState(false)
  const dismiss = () => projectStore.getState().clearBlockedOp()
  return (
    <>
      <Dialog open={blocked !== null} onOpenChange={(open) => !open && dismiss()}>
        {blocked && (
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>This edit needs a native project</DialogTitle>
              <DialogDescription className="flex flex-col gap-2">
                <span>
                  <span className="font-mono text-xs">{blocked.op}</span>
                  {blocked.address && (
                    <>
                      {' '}
                      on <span className="font-mono text-xs">{blocked.address}</span>
                    </>
                  )}{' '}
                  has no overrides.yaml translation.
                </span>
                <span>{blocked.message}</span>
                <span>
                  Detach to make this edit directly — the forge re-run loop is severed — or cancel
                  and keep correcting through overrides.
                </span>
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="ghost" onClick={dismiss}>
                Cancel
              </Button>
              <Button
                onClick={() => {
                  dismiss()
                  setDetachOpen(true)
                }}
              >
                Detach…
              </Button>
            </DialogFooter>
          </DialogContent>
        )}
      </Dialog>
      <DetachDialog open={detachOpen} onOpenChange={setDetachOpen} />
    </>
  )
}
