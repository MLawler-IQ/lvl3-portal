'use client'

import { useRef } from 'react'
import { StopCircle, RefreshCw, CheckCircle2, XCircle } from 'lucide-react'

export type JobStatus = 'idle' | 'running' | 'complete' | 'failed'

interface Props {
  status: JobStatus
  progress: number          // 0–100
  logs: string[]
  error?: string | null
  onCancel?: () => void
  onReset?: () => void
  children: React.ReactNode                    // Config form (shown when idle)
  renderResult?: () => React.ReactNode          // Result view (shown when complete)
  resultLabel?: string                          // e.g. "Report" (default "Results")
}

export default function BackgroundJobTool({
  status,
  progress,
  logs,
  error,
  onCancel,
  onReset,
  children,
  renderResult,
  resultLabel = 'Results',
}: Props) {
  const logEndRef = useRef<HTMLDivElement>(null)

  // Auto-scroll log
  if (logEndRef.current) {
    logEndRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }

  if (status === 'idle') {
    return <div className="max-w-7xl mx-auto px-6 py-6">{children}</div>
  }

  if (status === 'running') {
    return (
      <div className="max-w-7xl mx-auto px-6 py-6 space-y-6">
        {/* Progress bar */}
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs text-surface-400">
            <span>Running\u2026</span>
            <span>{Math.round(progress)}%</span>
          </div>
          <div className="h-1.5 bg-surface-800 rounded-full overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{ width: `${progress}%`, backgroundColor: 'var(--color-accent)' }}
            />
          </div>
        </div>

        {/* Log */}
        {logs.length > 0 && (
          <div className="bg-surface-900 border border-surface-700 rounded-xl p-4 max-h-64 overflow-y-auto font-mono text-xs text-surface-400 space-y-0.5">
            {logs.map((line, i) => (
              <div key={i}>{line}</div>
            ))}
            <div ref={logEndRef} />
          </div>
        )}

        {/* Cancel */}
        {onCancel && (
          <button
            onClick={onCancel}
            className="flex items-center gap-2 text-xs text-surface-400 hover:text-surface-200 transition-colors"
          >
            <StopCircle size={14} />
            Cancel
          </button>
        )}
      </div>
    )
  }

  if (status === 'failed') {
    return (
      <div className="max-w-7xl mx-auto px-6 py-6 space-y-4">
        <div className="flex items-start gap-3 bg-surface-900 border border-surface-700 rounded-xl p-5">
          <XCircle size={16} className="text-error shrink-0 mt-0.5" />
          <div className="space-y-1">
            <p className="text-sm font-medium text-surface-100">Run failed</p>
            {error && <p className="text-xs text-surface-400">{error}</p>}
          </div>
        </div>
        {onReset && (
          <button
            onClick={onReset}
            className="flex items-center gap-2 text-xs text-surface-400 hover:text-surface-200 transition-colors"
          >
            <RefreshCw size={13} />
            Try again
          </button>
        )}
      </div>
    )
  }

  // complete
  return (
    <div className="max-w-7xl mx-auto px-6 py-6 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <CheckCircle2 size={15} style={{ color: 'var(--color-success)' }} />
          <span className="text-sm font-medium text-surface-100">{resultLabel}</span>
        </div>
        {onReset && (
          <button
            onClick={onReset}
            className="flex items-center gap-1.5 text-xs text-surface-400 hover:text-surface-200 transition-colors"
          >
            <RefreshCw size={12} />
            New run
          </button>
        )}
      </div>
      {renderResult?.()}
    </div>
  )
}
