import { useState } from 'react'
import { ChevronDownIcon, ChevronUpIcon } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { navTargetFor, type NavTarget } from '@/lib/address'
import type { Adventure, Diagnostics, Finding } from '@/types'

// The persistent diagnostics panel: a collapsible bottom drawer with a count
// badge, never fully hidden. Click navigates by the address grammar; an
// address that parses to nothing in the document renders unnavigable rather
// than guessing.
export function DiagnosticsPanel({
  diagnostics,
  document,
  onNavigate,
}: {
  diagnostics: Diagnostics
  document: Adventure
  onNavigate: (target: NavTarget) => void
}) {
  const [open, setOpen] = useState(true)
  const findings = [...diagnostics.validation, ...diagnostics.lint]
  return (
    <section aria-label="Diagnostics" className="border-t bg-card">
      <Button
        variant="ghost"
        className="flex w-full justify-between rounded-none px-4 py-2"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
      >
        <span className="flex items-center gap-2 text-sm font-medium">
          Diagnostics
          <Badge
            variant={findings.length > 0 ? 'default' : 'secondary'}
            data-testid="diagnostics-count"
          >
            {findings.length}
          </Badge>
        </span>
        {open ? <ChevronDownIcon /> : <ChevronUpIcon />}
      </Button>
      {open && (
        <ScrollArea className="max-h-40 overflow-y-auto px-4 pb-3">
          {findings.length === 0 ? (
            <p className="py-1 text-sm text-muted-foreground">
              No findings — content validation is clean.
            </p>
          ) : (
            <ul className="flex flex-col gap-1">
              {findings.map((finding, index) => (
                <FindingRow
                  key={`${finding.code}-${index}`}
                  finding={finding}
                  target={navTargetFor(finding.address, document)}
                  onNavigate={onNavigate}
                />
              ))}
            </ul>
          )}
        </ScrollArea>
      )}
    </section>
  )
}

function FindingRow({
  finding,
  target,
  onNavigate,
}: {
  finding: Finding
  target: NavTarget | null
  onNavigate: (target: NavTarget) => void
}) {
  const body = (
    <>
      <span className="font-mono text-xs text-muted-foreground">{finding.code}</span>{' '}
      <span className="text-sm">{finding.message}</span>
    </>
  )
  if (!target) {
    return <li className="px-2 py-1">{body}</li>
  }
  return (
    <li>
      <button
        type="button"
        className="w-full rounded-sm px-2 py-1 text-left hover:bg-accent"
        onClick={() => onNavigate(target)}
      >
        {body}
      </button>
    </li>
  )
}
