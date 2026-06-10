'use client'

import { Clock, CheckCircle2, XCircle, Loader2, ChevronRight } from 'lucide-react'
import { RunStatusBadge } from '@/components/ui/StatusBadge'

function relativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  const minutes = Math.floor(diff / 60000)
  const hours = Math.floor(diff / 3600000)
  const days = Math.floor(diff / 86400000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  if (hours < 24) return `${hours}h ago`
  if (days < 7) return `${days}d ago`
  return new Date(dateStr).toLocaleDateString()
}

export interface ToolRun {
  id: string
  tool_slug: string
  client_id: string | null
  status: string
  created_at: string
  completed_at: string | null
  input: Record<string, unknown>
  output: Record<string, unknown> | null
  error: string | null
}

interface Props {
  runs: ToolRun[]
  onLoad?: (run: ToolRun) => void
  emptyMessage?: string
}

function StatusIcon({ status }: { status: string }) {
  if (status === 'complete') return <CheckCircle2 size={13} style={{ color: 'var(--color-success)' }} />
  if (status === 'failed') return <XCircle size={13} className="text-error" />
  if (status === 'running' || status === 'queued') return <Loader2 size={13} className="animate-spin text-surface-400" />
  return <Clock size={13} className="text-surface-400" />
}

export default function RunHistory({ runs, onLoad, emptyMessage = 'No previous runs.' }: Props) {
  if (runs.length === 0) {
    return (
      <div className="py-8 text-center">
        <p className="text-sm text-surface-400">{emptyMessage}</p>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {runs.map(run => (
        <div
          key={run.id}
          className="flex items-center gap-3 bg-surface-900 border border-surface-700 rounded-xl px-4 py-3"
        >
          <StatusIcon status={run.status} />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <RunStatusBadge variant={run.status as 'queued' | 'running' | 'complete' | 'failed' | 'partial'} />
              <span className="text-xs text-surface-500">{relativeTime(run.created_at)}</span>
            </div>
            {run.error && (
              <p className="text-xs text-error mt-0.5 truncate">{run.error}</p>
            )}
          </div>
          {onLoad && run.status === 'complete' && run.output && (
            <button
              onClick={() => onLoad(run)}
              className="flex items-center gap-1 text-xs text-surface-400 hover:text-surface-200 transition-colors shrink-0"
            >
              Load
              <ChevronRight size={13} />
            </button>
          )}
        </div>
      ))}
    </div>
  )
}
