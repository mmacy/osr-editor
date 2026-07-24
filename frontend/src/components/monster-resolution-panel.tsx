// The monster-resolution panel: the report's monsters summary as a work
// surface. Per name, the two corrections as a stated either/or — remap
// through the monster picker, or the printed-notation form over forge's
// StatBlockOverride fields (corrections land pre-mapping; reviewing against
// the printed page is the point).
import { useState } from 'react'

import { MonsterPicker } from '@/components/monster-picker'
import { Badge } from '@/components/ui/badge'
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
import { Textarea } from '@/components/ui/textarea'
import {
  EMPTY_STAT_FORM,
  formFromOverride,
  patchFromForm,
  type StatBlockFormValues,
} from '@/lib/statblock-form'
import { projectStore } from '@/store/project-store'
import type { ProjectState, StatBlockOverride } from '@/types'

// Forge's key normalization, mirrored for lookup only: casefold, collapse
// internal whitespace. Commits send the report's names; forge's matcher is
// the authority.
function normalizeName(name: string): string {
  return name.toLowerCase().split(/\s+/).filter(Boolean).join(' ')
}

function overrideFor(
  project: ProjectState,
  name: string,
): { key: string; entry: StatBlockOverride } | undefined {
  const templates = project.forge?.overrides.monster_templates ?? {}
  const target = normalizeName(name)
  for (const [key, entry] of Object.entries(templates)) {
    if (normalizeName(key) === target) return { key, entry }
  }
  return undefined
}

export function MonsterResolutionPanel({ project }: { project: ProjectState }) {
  const [patchTarget, setPatchTarget] = useState<string | null>(null)
  if (!project.forge) return null
  const { report, run } = project.forge
  const emitSupported = run.settings.custom_monsters === 'emit'
  const remap = (name: string, templateId: string) => {
    void projectStore
      .getState()
      .commitForgeEdits([{ edit: 'set_monster_remap', name, template_id: templateId }])
  }
  const names = new Set<string>(report.monsters.unresolved)
  const customByName = new Map(report.monsters.custom.map((record) => [record.name, record]))
  for (const record of report.monsters.custom) names.add(record.name)
  return (
    <section
      aria-label="Monster resolution"
      className="mx-auto flex w-full max-w-2xl flex-col gap-4"
    >
      <header className="flex items-center gap-3">
        <h2 className="text-lg font-semibold">Monster resolution</h2>
        <span className="text-xs text-muted-foreground">
          {report.monsters.resolved} resolved · {report.monsters.unresolved.length} unresolved
        </span>
      </header>
      {names.size === 0 ? (
        <p className="text-sm text-muted-foreground">
          Every extracted name resolved against the catalog — nothing needs attention.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {[...names].map((name) => {
            const custom = customByName.get(name)
            const existing = overrideFor(project, name)
            return (
              <li
                key={name}
                className="flex flex-col gap-2 rounded-md border bg-card p-2"
                data-testid={`monster-${name}`}
              >
                <div className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate font-serif text-sm font-medium">
                    {name}
                  </span>
                  {custom ? (
                    <Badge variant="secondary" className="text-[10px]">
                      custom: {custom.id}
                    </Badge>
                  ) : (
                    <Badge variant="destructive" className="text-[10px]">
                      unresolved
                    </Badge>
                  )}
                  {custom && custom.source_pages.length > 0 && (
                    <span className="font-mono text-xs text-muted-foreground">
                      p. {custom.source_pages.join(', ')}
                    </span>
                  )}
                </div>
                {custom && custom.derived.length > 0 && (
                  <p className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
                    derived:
                    {custom.derived.map((field) => (
                      <Badge key={field} variant="outline" className="text-[10px]">
                        {field}
                      </Badge>
                    ))}
                  </p>
                )}
                <div className="flex items-center gap-2">
                  <MonsterPicker
                    bundled={project.document.monsters}
                    triggerLabel="Remap to catalog monster"
                    onPick={(line) => remap(name, line.template_id)}
                  />
                  <span className="text-xs text-muted-foreground">or</span>
                  {emitSupported ? (
                    <Button variant="outline" size="sm" onClick={() => setPatchTarget(name)}>
                      {existing ? 'Edit printed stat block' : 'Correct printed stat block'}
                    </Button>
                  ) : (
                    <span className="text-xs text-muted-foreground">
                      printed-block corrections need the stat-block pass — re-run monsters with
                      --set custom_monsters=emit
                    </span>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      )}
      {patchTarget !== null && (
        <PrintedNotationDialog
          name={patchTarget}
          initial={formFromOverride(overrideFor(project, patchTarget)?.entry)}
          onOpenChange={(open) => !open && setPatchTarget(null)}
        />
      )}
    </section>
  )
}

const TEXT_FIELDS: Array<{ field: keyof StatBlockFormValues; label: string; hint: string }> = [
  { field: 'ac', label: 'AC', hint: '5 [14]' },
  { field: 'thac0', label: 'THAC0', hint: '17 or 19 [+0]' },
  { field: 'hit_dice', label: 'Hit dice', hint: '3+1, ½, 2d8' },
  { field: 'class_level', label: 'Class and level', hint: 'F 3' },
  { field: 'hp', label: 'Fixed hp', hint: '13' },
  { field: 'movement', label: 'Movement', hint: "120' (40')" },
  { field: 'saves', label: 'Saves', hint: 'D12 W13 P14 B15 S16' },
  { field: 'morale', label: 'Morale', hint: '2–12' },
  { field: 'alignment', label: 'Alignment', hint: 'Chaotic' },
  { field: 'xp', label: 'XP', hint: '35' },
  { field: 'number_appearing', label: 'Number appearing', hint: '1d6 (2d6)' },
]

export function PrintedNotationDialog({
  name,
  initial,
  onOpenChange,
}: {
  name: string
  initial?: StatBlockFormValues
  onOpenChange: (open: boolean) => void
}) {
  const [values, setValues] = useState<StatBlockFormValues>(initial ?? EMPTY_STAT_FORM)
  const setField = (field: keyof StatBlockFormValues, value: string) =>
    setValues((state) => ({ ...state, [field]: value }))
  const patch = patchFromForm(values)
  const commit = () => {
    if (!patch) return
    void projectStore
      .getState()
      .commitForgeEdits([{ edit: 'set_template_patch', name, patch }])
      .then((committed) => {
        if (committed) onOpenChange(false)
      })
  }
  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Printed stat block — {name}</DialogTitle>
          <DialogDescription>
            Enter values exactly as the page prints them — &quot;5 [14]&quot;, &quot;3+1&quot;,
            attack lines as written. Corrections land before forge&apos;s mapping, so one printed
            value fixes both derived forms. Empty fields keep the extracted value.
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          {TEXT_FIELDS.map(({ field, label, hint }) => (
            <div key={field} className="flex flex-col gap-1">
              <Label htmlFor={`stat-${field}`}>{label}</Label>
              <Input
                id={`stat-${field}`}
                className="h-8 font-mono text-xs"
                placeholder={hint}
                value={values[field]}
                onChange={(event) => setField(field, event.target.value)}
              />
            </div>
          ))}
          <div className="flex flex-col gap-1">
            <Label htmlFor="stat-ac-notation">AC notation</Label>
            <select
              id="stat-ac-notation"
              className="h-8 rounded-md border bg-transparent px-2 text-sm"
              value={values.ac_notation}
              onChange={(event) => setField('ac_notation', event.target.value)}
            >
              <option value="">as extracted</option>
              <option value="descending">descending</option>
              <option value="ascending">ascending</option>
              <option value="dual">dual</option>
            </select>
          </div>
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="stat-attacks">Attack lines (one per line)</Label>
          <Textarea
            id="stat-attacks"
            className="min-h-16 font-mono text-xs"
            placeholder="2 claws (1d4 each)"
            value={values.attacks}
            onChange={(event) => setField('attacks', event.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="stat-special">Special lines (one per line)</Label>
          <Textarea
            id="stat-special"
            className="min-h-16 font-mono text-xs"
            value={values.special}
            onChange={(event) => setField('special', event.target.value)}
          />
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={!patch} onClick={commit}>
            Commit correction
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
