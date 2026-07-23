// Forge's own SVG rendering of the corrected plan, for eyeballing whole-level
// geometry beside the editor's canvas. Always fresh: every commit and every
// open refreshes previews through assemble() itself.
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { forgePreviewUrl } from '@/lib/api'

export function ForgePreviewDialog({
  open,
  onOpenChange,
  projectId,
  dungeonId,
  levelNumber,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  projectId: string
  dungeonId: string
  levelNumber: number
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open && (
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>
              Forge preview — {dungeonId} level {levelNumber}
            </DialogTitle>
            <DialogDescription>
              Forge&apos;s own rendering of the corrected plan, regenerated on every assembly.
            </DialogDescription>
          </DialogHeader>
          <img
            src={forgePreviewUrl(projectId, dungeonId, levelNumber)}
            alt={`Forge preview of ${dungeonId} level ${levelNumber}`}
            className="w-full rounded-sm border bg-white"
          />
        </DialogContent>
      )}
    </Dialog>
  )
}
