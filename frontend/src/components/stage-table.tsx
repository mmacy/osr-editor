// The per-stage table both pipeline surfaces render: the panel reads it from a
// project's run.json, the conversion screen from a live session's rows. One
// shape (forge's StageStatus), one rendering — a stage row means the same thing
// wherever it appears.
import { Badge } from '@/components/ui/badge'
import type { ConversionStageRow, StageStatus } from '@/types'

export function formatTimestamp(value: string | null | undefined): string {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString()
}

export function formatUsage(status: StageStatus): string {
  if (!status.usage) return '—'
  const { input_tokens, output_tokens } = status.usage
  if (!input_tokens && !output_tokens) return '—'
  return `${input_tokens.toLocaleString()} in / ${output_tokens.toLocaleString()} out`
}

function badgeVariant(status: StageStatus['status']): 'secondary' | 'destructive' | 'outline' {
  if (status === 'completed') return 'secondary'
  if (status === 'failed') return 'destructive'
  return 'outline'
}

export function StageTable({ rows }: { rows: ConversionStageRow[] }) {
  return (
    <div className="overflow-x-auto rounded-md border">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
            <th className="px-2 py-1 font-medium">Stage</th>
            <th className="px-2 py-1 font-medium">Status</th>
            <th className="px-2 py-1 font-medium">Finished</th>
            <th className="px-2 py-1 font-medium">Tokens</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ stage, status }) => (
            <tr key={stage} className="border-b last:border-b-0" data-testid={`stage-row-${stage}`}>
              <td className="px-2 py-1 font-mono text-xs">{stage}</td>
              <td className="px-2 py-1">
                <Badge variant={badgeVariant(status.status)} className="text-[10px]">
                  {status.status}
                </Badge>
                {status.error && (
                  <span className="ml-2 text-xs text-muted-foreground">{status.error}</span>
                )}
              </td>
              <td className="px-2 py-1 text-xs text-muted-foreground">
                {formatTimestamp(status.finished_at)}
              </td>
              <td className="px-2 py-1 font-mono text-xs">{formatUsage(status)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
