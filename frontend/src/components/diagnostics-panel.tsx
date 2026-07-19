import { useState } from 'react'
import { ChevronDownIcon, ChevronUpIcon } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { navTargetFor, type NavTarget } from '@/lib/address'
import { cn } from '@/lib/utils'
import type { Adventure, Diagnostics, Finding } from '@/types'

// The persistent diagnostics panel: a collapsible bottom drawer with a count
// badge, never fully hidden. Click navigates by the address grammar; an
// address that parses to nothing in the document renders unnavigable rather
// than guessing. Red is reserved for errors; warnings use the pencil palette.
export function DiagnosticsPanel({
  diagnostics,
  document,
  onNavigate,
  onRemoveEntry,
}: {
  diagnostics: Diagnostics
  document: Adventure
  onNavigate: (target: NavTarget) => void
  onRemoveEntry?: (finding: Finding) => void
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
              No findings — validation and lint are clean.
            </p>
          ) : (
            <ul className="flex flex-col gap-1">
              {findings.map((finding, index) => (
                <FindingRow
                  key={`${finding.code}-${index}`}
                  finding={finding}
                  target={navTargetFor(finding.address, document)}
                  onNavigate={onNavigate}
                  onRemoveEntry={onRemoveEntry}
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
  onRemoveEntry,
}: {
  finding: Finding
  target: NavTarget | null
  onNavigate: (target: NavTarget) => void
  onRemoveEntry?: (finding: Finding) => void
}) {
  const body = (
    <>
      <span
        className={cn(
          'font-mono text-xs',
          finding.severity === 'error' ? 'text-destructive' : 'text-amber-700 dark:text-amber-400',
        )}
      >
        {finding.code}
      </span>{' '}
      <span className="text-sm">{finding.message}</span>
    </>
  )
  // The edge_invalid remediation: the one error only foreign documents
  // produce is a click to fix — the action resolves its key by enumeration
  // against the document, never by extraction from the message.
  const removable = finding.source === 'lint' && finding.code === 'edge_invalid' && onRemoveEntry
  const action = removable && (
    <Button
      variant="outline"
      size="sm"
      className="h-6 shrink-0 px-2 text-xs"
      onClick={(event) => {
        event.stopPropagation()
        onRemoveEntry(finding)
      }}
    >
      Remove entry
    </Button>
  )
  if (!target) {
    return (
      <li className="flex items-center gap-2 px-2 py-1">
        <span className="min-w-0 flex-1">{body}</span>
        {action}
      </li>
    )
  }
  return (
    <li className="flex items-center gap-2">
      <button
        type="button"
        className="min-w-0 flex-1 rounded-sm px-2 py-1 text-left hover:bg-accent"
        onClick={() => onNavigate(target)}
      >
        {body}
      </button>
      {action}
    </li>
  )
}
