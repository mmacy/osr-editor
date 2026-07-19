// The publish dialog, a header action beside export. The flow: checkout path
// (collected on first use, saved server-side once the shape test passes),
// name (defaulting the project stem), mode (symlink live-link default, copy
// snapshot), then commit. A publish_blocked answer renders the blocking
// findings as the diagnostics panel's own click-to-navigate rows;
// publish_destination_exists offers the explicit overwrite; a lint-warnings
// confirm interposes when lint findings exist — secret-only access is
// sometimes the point.
import { useState } from 'react'
import { BookUpIcon } from 'lucide-react'
import { toast } from 'sonner'

import { FindingRow } from '@/components/diagnostics-panel'
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
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { api, ApiRequestError } from '@/lib/api'
import { navTargetFor, type NavTarget } from '@/lib/address'
import { projectStore, useProjectStore } from '@/store/project-store'
import type { Finding } from '@/types'

// The project directory's stem: `my-module.osr` → `my-module`.
export function projectStem(path: string): string {
  const base =
    path
      .replace(/[\\/]+$/, '')
      .split(/[\\/]/)
      .pop() ?? ''
  const dot = base.lastIndexOf('.')
  return dot > 0 ? base.slice(0, dot) : base
}

export function PublishDialog({ onNavigate }: { onNavigate: (target: NavTarget) => void }) {
  const project = useProjectStore((state) => state.project)
  const lastCheckoutPath = useProjectStore((state) => state.lastCheckoutPath)
  const [open, setOpen] = useState(false)
  const [checkoutPath, setCheckoutPath] = useState('')
  const [name, setName] = useState('')
  const [mode, setMode] = useState<'symlink' | 'copy'>('symlink')
  const [error, setError] = useState<string | null>(null)
  const [blocked, setBlocked] = useState<Finding[] | null>(null)
  const [collision, setCollision] = useState<string | null>(null)
  const [lintConfirm, setLintConfirm] = useState(false)
  const [publishing, setPublishing] = useState(false)

  if (!project) return null
  // The client-side confirm lists lint and forge findings alike — secret-only
  // access, a delve_incomplete warning: sometimes the point. Validation still
  // gates server-side.
  const lintFindings = [...project.diagnostics.lint, ...project.diagnostics.forge]

  const openDialog = (next: boolean) => {
    if (next) {
      setCheckoutPath(lastCheckoutPath ?? '')
      setName(projectStem(project.path))
      setMode('symlink')
      setError(null)
      setBlocked(null)
      setCollision(null)
      setLintConfirm(false)
    }
    setOpen(next)
  }

  const publish = async (overwrite: boolean) => {
    setPublishing(true)
    setError(null)
    setBlocked(null)
    setCollision(null)
    try {
      const result = await api.publishProject(project.id, {
        mode,
        name: name || undefined,
        overwrite,
        checkout_path: checkoutPath || undefined,
      })
      if (checkoutPath) projectStore.getState().setLastCheckoutPath(checkoutPath)
      toast.success(`Published to ${result.path}`)
      setOpen(false)
    } catch (caught) {
      if (!(caught instanceof ApiRequestError)) {
        setError(caught instanceof Error ? caught.message : String(caught))
        return
      }
      const detail = caught.detail
      if (detail.code === 'publish_blocked') {
        const findings = (detail.details as { findings?: Finding[] } | null)?.findings ?? []
        setBlocked(findings)
      } else if (detail.code === 'publish_destination_exists') {
        setCollision(detail.message)
      } else {
        setError(detail.remedy ? `${detail.message} — ${detail.remedy}` : detail.message)
      }
      // A blocking answer may still have saved a shape-tested path.
      if (checkoutPath && detail.code !== 'osr_web_checkout_invalid') {
        projectStore.getState().setLastCheckoutPath(checkoutPath)
      }
    } finally {
      setPublishing(false)
    }
  }

  const submit = () => {
    // Lint never blocks server-side; the confirm interposes client-side when
    // lint findings exist, listing them.
    if (lintFindings.length > 0 && !lintConfirm) {
      setLintConfirm(true)
      return
    }
    void publish(false)
  }

  const navigateFromFinding = (target: NavTarget) => {
    setOpen(false)
    onNavigate(target)
  }

  return (
    <Dialog open={open} onOpenChange={openDialog}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <BookUpIcon /> Publish
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Publish to osr-web</DialogTitle>
          <DialogDescription>
            Places the adventure in an osr-web checkout's{' '}
            <span className="font-mono">adventures/</span> directory. Publish requires clean
            validation; lint warnings prompt but never block.
          </DialogDescription>
        </DialogHeader>
        {lintConfirm ? (
          <div className="flex flex-col gap-2" aria-label="Lint warnings">
            <p className="text-sm">
              The module carries lint warnings — sometimes the point (a secret-only treasure room).
              Publish anyway?
            </p>
            <ul className="flex max-h-40 flex-col gap-1 overflow-y-auto rounded-md border p-1">
              {lintFindings.map((finding, index) => (
                <FindingRow
                  key={`${finding.code}-${index}`}
                  finding={finding}
                  target={navTargetFor(finding.address, project.document)}
                  onNavigate={navigateFromFinding}
                />
              ))}
            </ul>
            <DialogFooter>
              <Button variant="outline" onClick={() => setLintConfirm(false)}>
                Back
              </Button>
              <Button onClick={() => void publish(false)} disabled={publishing}>
                Publish anyway
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <>
            <div className="flex flex-col gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="publish-checkout">osr-web checkout</Label>
                <Input
                  id="publish-checkout"
                  className="font-mono"
                  value={checkoutPath}
                  onChange={(event) => setCheckoutPath(event.target.value)}
                  placeholder="/absolute/path/to/osr-web"
                />
                <p className="text-muted-foreground text-xs">
                  Saved after the first publish; leave empty to use the saved path.
                </p>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="publish-name">Name</Label>
                <Input
                  id="publish-name"
                  className="font-mono"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                />
              </div>
              <RadioGroup
                value={mode}
                onValueChange={(next) => setMode(next as 'symlink' | 'copy')}
              >
                <label className="flex items-start gap-2 text-sm">
                  <RadioGroupItem value="symlink" className="mt-0.5" />
                  <span>
                    Live link — every save republishes; osr-web's next scan reads the current
                    document.
                  </span>
                </label>
                <label className="flex items-start gap-2 text-sm">
                  <RadioGroupItem value="copy" className="mt-0.5" />
                  <span>Snapshot copy — a point-in-time file that never changes.</span>
                </label>
              </RadioGroup>
              {error && <p className="text-destructive text-sm">{error}</p>}
              {blocked && (
                <div className="flex flex-col gap-1.5" aria-label="Blocking findings">
                  <p className="text-destructive text-sm">
                    Validation findings block publish — fix them first:
                  </p>
                  <ul className="flex max-h-40 flex-col gap-1 overflow-y-auto rounded-md border p-1">
                    {blocked.map((finding, index) => (
                      <FindingRow
                        key={`${finding.code}-${index}`}
                        finding={finding}
                        target={navTargetFor(finding.address, project.document)}
                        onNavigate={navigateFromFinding}
                      />
                    ))}
                  </ul>
                </div>
              )}
              {collision && (
                <div className="flex flex-col gap-1.5">
                  <p className="text-sm">{collision}</p>
                  <Button
                    variant="destructive"
                    size="sm"
                    className="self-start"
                    disabled={publishing}
                    onClick={() => void publish(true)}
                  >
                    Publish with overwrite
                  </Button>
                </div>
              )}
            </div>
            <DialogFooter>
              <Button onClick={submit} disabled={publishing || !name}>
                Publish
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
