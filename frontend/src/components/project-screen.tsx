import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { HomeIcon, Redo2Icon, Undo2Icon } from 'lucide-react'
import { toast } from 'sonner'

import { DiagnosticsPanel } from '@/components/diagnostics-panel'
import { ExportDialog } from '@/components/export-dialog'
import { FidelityDialog } from '@/components/fidelity-dialog'
import { AdventureForm, LevelForm, TownForm } from '@/components/forms'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { api, ApiRequestError } from '@/lib/api'
import type { NavTarget } from '@/lib/address'
import { cn } from '@/lib/utils'
import { projectStore, useProjectStore } from '@/store/project-store'

export function ProjectScreen() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const project = useProjectStore((state) => state.project)
  const gone = useProjectStore((state) => state.gone)
  const [section, setSection] = useState<NavTarget>({ kind: 'adventure' })

  // A direct URL load (a second tab) fetches by id; a stale id after a server
  // restart routes home with the toast — the recent is right there to reopen.
  useEffect(() => {
    if (!id) return
    const current = projectStore.getState().project
    if (current?.id === id) return
    api
      .getProject(id)
      .then((state) => projectStore.getState().setProject(state))
      .catch((error: unknown) => {
        if (error instanceof ApiRequestError && error.detail.code === 'unknown_project') {
          toast.error(error.detail.message, { description: error.detail.remedy ?? undefined })
          navigate('/')
        } else if (error instanceof ApiRequestError) {
          toast.error(error.detail.message, { description: error.detail.remedy ?? undefined })
        }
      })
  }, [id, navigate])

  useEffect(() => {
    if (gone) {
      toast.error('The editor restarted', {
        description: 'Reopen the project from its recent entry.',
      })
      projectStore.getState().clear()
      navigate('/')
    }
  }, [gone, navigate])

  // Ctrl/Cmd+Z and Shift+Ctrl/Cmd+Z, the desktop-app undo semantics.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 'z') return
      event.preventDefault()
      if (event.shiftKey) void projectStore.getState().redo()
      else void projectStore.getState().undo()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  if (!project || project.id !== id) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <p className="text-sm text-muted-foreground">Opening project…</p>
      </main>
    )
  }

  return (
    <div className="flex h-screen flex-col">
      <header className="flex items-center gap-3 border-b bg-card px-4 py-2">
        <Button variant="ghost" size="icon-sm" aria-label="Home" onClick={() => navigate('/')}>
          <HomeIcon />
        </Button>
        <h1 className="min-w-0 flex-1 truncate font-serif text-lg font-semibold">
          {project.document.name || 'Untitled adventure'}
        </h1>
        <span className="font-mono text-xs text-muted-foreground" data-testid="revision">
          {project.revision}
        </span>
        <Separator orientation="vertical" className="h-6" />
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Undo"
              disabled={!project.can_undo}
              onClick={() => void projectStore.getState().undo()}
            >
              <Undo2Icon />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Undo (Ctrl/Cmd+Z)</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Redo"
              disabled={!project.can_redo}
              onClick={() => void projectStore.getState().redo()}
            >
              <Redo2Icon />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Redo (Shift+Ctrl/Cmd+Z)</TooltipContent>
        </Tooltip>
        <ExportDialog />
      </header>

      <div className="flex min-h-0 flex-1">
        <aside className="w-56 shrink-0 border-r bg-card">
          <ScrollArea className="h-full">
            <nav aria-label="Sections" className="flex flex-col gap-0.5 p-2">
              <SectionButton
                label="Adventure"
                active={section.kind === 'adventure'}
                onClick={() => setSection({ kind: 'adventure' })}
              />
              <SectionButton
                label="Town"
                active={section.kind === 'town'}
                onClick={() => setSection({ kind: 'town' })}
              />
              {project.document.dungeons.map((dungeon) => (
                <div key={dungeon.id} className="mt-2 flex flex-col gap-0.5">
                  <span className="truncate px-2 text-xs font-medium text-muted-foreground">
                    {dungeon.name || <span className="font-mono">{dungeon.id}</span>}
                  </span>
                  {dungeon.levels.map((level) => (
                    <SectionButton
                      key={level.number}
                      label={`Level ${level.number}`}
                      indent
                      active={
                        section.kind === 'level' &&
                        section.dungeonId === dungeon.id &&
                        section.levelNumber === level.number
                      }
                      onClick={() =>
                        setSection({
                          kind: 'level',
                          dungeonId: dungeon.id,
                          levelNumber: level.number,
                        })
                      }
                    />
                  ))}
                </div>
              ))}
            </nav>
          </ScrollArea>
        </aside>

        <main className="min-w-0 flex-1 overflow-y-auto p-6">
          {section.kind === 'adventure' && <AdventureForm document={project.document} />}
          {section.kind === 'town' && <TownForm document={project.document} />}
          {section.kind === 'level' && (
            <LevelForm
              document={project.document}
              dungeonId={section.dungeonId}
              levelNumber={section.levelNumber}
            />
          )}
        </main>
      </div>

      <DiagnosticsPanel
        diagnostics={project.diagnostics}
        document={project.document}
        onNavigate={setSection}
      />
      <FidelityDialog />
    </div>
  )
}

function SectionButton({
  label,
  active,
  indent = false,
  onClick,
}: {
  label: string
  active: boolean
  indent?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      className={cn(
        'rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-accent',
        indent && 'ml-3',
        active && 'bg-accent font-medium',
      )}
      onClick={onClick}
    >
      {label}
    </button>
  )
}
