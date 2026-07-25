// The stocking report: what the dice rolled per room and what they left to the
// author. One dialog serves both a level sweep and a single-room roll. The
// follow-up badges are honest about the hand-work still owed, and the header
// carries the undo-does-not-rewind-the-dice note.
import { Badge } from '@/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { STOCKING_UNDO_NOTE, followUpLabel, stockRollLine, trapFollowUpNote } from '@/lib/aids'
import type { StockRoll } from '@/types'

export function StockingReportDialog({
  rolls,
  onClose,
}: {
  rolls: readonly StockRoll[] | null
  onClose: () => void
}) {
  return (
    <Dialog open={rolls !== null} onOpenChange={(next) => !next && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Stocking report</DialogTitle>
          <DialogDescription>{STOCKING_UNDO_NOTE}</DialogDescription>
        </DialogHeader>
        {rolls !== null && rolls.length === 0 && (
          <p className="text-sm text-muted-foreground">
            Every room was already stocked — nothing to roll.
          </p>
        )}
        {rolls !== null && rolls.length > 0 && (
          <ul className="flex flex-col gap-2" data-testid="stocking-report">
            {rolls.map((roll) => (
              <li key={roll.address} className="flex flex-col gap-1 border-b pb-2 last:border-b-0">
                <div className="flex items-baseline gap-2">
                  <span className="font-mono text-sm font-semibold">{roll.area_id}</span>
                  <span className="text-sm">{stockRollLine(roll)}</span>
                </div>
                {(roll.follow_ups.length > 0 || trapFollowUpNote(roll)) && (
                  <div className="flex flex-wrap items-center gap-1">
                    {roll.follow_ups.map((followUp, index) => (
                      <Badge
                        key={`${followUp.kind}-${index}`}
                        variant="outline"
                        className="text-xs font-normal"
                      >
                        {followUpLabel(followUp)}
                      </Badge>
                    ))}
                    {trapFollowUpNote(roll) && (
                      <span className="text-xs text-muted-foreground">
                        {trapFollowUpNote(roll)}
                      </span>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  )
}
