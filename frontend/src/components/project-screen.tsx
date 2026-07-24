import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { HomeIcon, Redo2Icon, Undo2Icon } from 'lucide-react'
import { toast } from 'sonner'

import { BlockedOpDialog } from '@/components/blocked-op-dialog'
import { CorrectionsPanel } from '@/components/corrections-panel'
import { DiagnosticsPanel } from '@/components/diagnostics-panel'
import { ExportDialog } from '@/components/export-dialog'
import { FidelityDialog } from '@/components/fidelity-dialog'
import { MonsterResolutionPanel } from '@/components/monster-resolution-panel'
import { MonstersSection } from '@/components/monsters-section'
import { PipelinePanel } from '@/components/pipeline-panel'
import { PublishDialog } from '@/components/publish-dialog'
import { ReviewQueue } from '@/components/review-queue'
import { AdventureForm, TownForm } from '@/components/forms'
import { MapEditor } from '@/components/map-editor'
import { buildReviewRows, undismissedFlagCount } from '@/lib/review'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { api, ApiRequestError } from '@/lib/api'
import type { NavTarget } from '@/lib/address'
import { removeInvalidEdgeOps } from '@/lib/lint-actions'
import { cn } from '@/lib/utils'
import { projectStore, useProjectStore } from '@/store/project-store'
import type { Finding } from '@/types'

export function ProjectScreen() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const project = useProjectStore((state) => state.project)
  const gone = useProjectStore((state) => state.gone)
  const [section, setSection] = useState<NavTarget>({ kind: 'adventure' })
  // Bumped on every diagnostics navigation so clicking the same finding twice
  // re-applies its focus (re-select, re-scroll, re-open properties).
  const [focusToken, setFocusToken] = useState(0)

  // Resume where the last session left off: once per opened project, the
  // persisted view state's active level (when the document still has it)
  // replaces the default adventure landing — the render-time adjustment
  // pattern, not an effect.
  const [resumedFor, setResumedFor] = useState<string | null>(null)
  if (project && project.id === id && resumedFor !== project.id) {
    setResumedFor(project.id)
    const viewState = project.sidecar.view_state
    const resumable =
      viewState.active_dungeon_id != null &&
      viewState.active_level_number != null &&
      project.document.dungeons
        .find((dungeon) => dungeon.id === viewState.active_dungeon_id)
        ?.levels.some((level) => level.number === viewState.active_level_number)
    if (resumable) {
      setSection({
        kind: 'level',
        dungeonId: viewState.active_dungeon_id!,
        levelNumber: viewState.active_level_number!,
      })
    }
  }

  const navigateTo = (target: NavTarget) => {
    setSection(target)
    setFocusToken((token) => token + 1)
  }

  // Consume cross-surface navigation requests (the picker's create shortcut
  // lives layers below this section state) — event-driven off the store, so
  // the request navigates exactly once.
  useEffect(
    () =>
      projectStore.subscribe((state) => {
        const intent = state.navigationIntent
        if (!intent) return
        projectStore.getState().clearNavigationIntent()
        setSection(intent)
        setFocusToken((token) => token + 1)
      }),
    [],
  )

  const removeEntry = (finding: Finding) => {
    void projectStore.getState().commit((document) => removeInvalidEdgeOps(finding, document))
  }

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
        <PublishDialog onNavigate={navigateTo} />
      </header>

      <div className="flex min-h-0 flex-1">
        <aside className="w-56 shrink-0 border-r bg-card">
          <ScrollArea className="h-full">
            <nav aria-label="Sections" className="flex flex-col gap-0.5 p-2">
              {project.forge && (
                <>
                  <SectionButton
                    label={`Review${(() => {
                      const count = undismissedFlagCount(
                        buildReviewRows(project.forge.report, project.sidecar),
                      )
                      return count > 0 ? ` (${count})` : ''
                    })()}`}
                    active={section.kind === 'review'}
                    onClick={() => setSection({ kind: 'review' })}
                  />
                  <SectionButton
                    label="Corrections"
                    active={section.kind === 'corrections'}
                    onClick={() => setSection({ kind: 'corrections' })}
                  />
                  <SectionButton
                    label="Pipeline"
                    active={section.kind === 'pipeline'}
                    onClick={() => setSection({ kind: 'pipeline' })}
                  />
                  <SectionButton
                    label="Monster resolution"
                    active={section.kind === 'monster-resolution'}
                    onClick={() => setSection({ kind: 'monster-resolution' })}
                  />
                </>
              )}
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
              <SectionButton
                label="Monsters"
                active={section.kind === 'monsters'}
                onClick={() => setSection({ kind: 'monsters' })}
              />
              {project.document.dungeons.map((dungeon) => (
                <div key={dungeon.id} className="mt-2 flex flex-col gap-0.5">
                  <span className="truncate px-2 text-xs font-medium text-muted-foreground">
                    {dungeon.name || <span className="font-mono">{dungeon.id}</span>}
                  </span>
                  {[...dungeon.levels]
                    .sort((a, b) => a.number - b.number)
                    .map((level) => (
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
                          navigateTo({
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

        <main
          className={cn(
            'min-w-0 flex-1',
            section.kind === 'level' ? 'flex min-h-0 flex-col' : 'overflow-y-auto p-6',
          )}
        >
          {section.kind === 'adventure' && <AdventureForm document={project.document} />}
          {section.kind === 'town' && <TownForm document={project.document} />}
          {section.kind === 'review' && <ReviewQueue project={project} onNavigate={navigateTo} />}
          {section.kind === 'corrections' && (
            <CorrectionsPanel project={project} onNavigate={navigateTo} />
          )}
          {section.kind === 'pipeline' && <PipelinePanel project={project} />}
          {section.kind === 'monster-resolution' && <MonsterResolutionPanel project={project} />}
          {section.kind === 'monsters' && (
            <MonstersSection project={project} section={section} focusToken={focusToken} />
          )}
          {section.kind === 'level' && (
            <MapEditor
              document={project.document}
              diagnostics={project.diagnostics}
              dungeonId={section.dungeonId}
              levelNumber={section.levelNumber}
              focus={section.focus}
              focusToken={focusToken}
              onNavigate={navigateTo}
            />
          )}
        </main>
      </div>

      <DiagnosticsPanel
        diagnostics={project.diagnostics}
        document={project.document}
        onNavigate={navigateTo}
        onRemoveEntry={removeEntry}
      />
      <FidelityDialog />
      <BlockedOpDialog />
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
