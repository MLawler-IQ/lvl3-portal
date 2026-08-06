'use client'

import { Key, GitCompare, Search, Brain, Globe } from 'lucide-react'
import type { DataAvailability, DataSourceStatus } from '@/lib/seo-content-engine/types'

interface DataAvailabilityPanelProps {
  availability: DataAvailability
}

const sources: {
  key: keyof DataAvailability
  label: string
  icon: typeof Key
}[] = [
  { key: 'keywords_everywhere', label: 'Keywords Everywhere', icon: Key },
  { key: 'semrush', label: 'Semrush', icon: GitCompare },
  { key: 'gsc', label: 'GSC', icon: Search },
  { key: 'anthropic', label: 'Anthropic', icon: Brain },
  { key: 'crawler', label: 'Crawler', icon: Globe },
]

function StatusDot({ status }: { status: DataSourceStatus['status'] }) {
  const colors: Record<DataSourceStatus['status'], string> = {
    success: 'bg-success/10',
    failed: 'bg-error/10',
    skipped: 'bg-surface-500',
    pending: 'bg-warning/10',
  }
  return (
    <span
      className={`inline-block w-2 h-2 rounded-full flex-shrink-0 ${colors[status]}`}
    />
  )
}

function statusLabel(status: DataSourceStatus['status']): string {
  switch (status) {
    case 'success':
      return 'Connected'
    case 'failed':
      return 'Failed'
    case 'skipped':
      return 'Skipped'
    case 'pending':
      return 'Pending'
  }
}

function formatLatency(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms)}ms`
}

export default function DataAvailabilityPanel({
  availability,
}: DataAvailabilityPanelProps) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
      {sources.map(({ key, label, icon: Icon }) => {
        const source = availability[key]
        const status = source?.status ?? 'pending'

        return (
          <div
            key={key}
            className="bg-surface-900 border border-surface-700 rounded-xl p-4"
          >
            {/* Icon + Name */}
            <div className="flex items-center gap-2 mb-3">
              <Icon className="h-4 w-4 text-surface-400 flex-shrink-0" />
              <span className="text-xs font-medium text-surface-300 truncate">
                {label}
              </span>
            </div>

            {/* Status badge */}
            <div className="flex items-center gap-1.5 mb-2">
              <StatusDot status={status} />
              <span className="text-xs text-surface-400">
                {statusLabel(status)}
              </span>
            </div>

            {/* Details */}
            {source && status === 'success' && (
              <div className="space-y-0.5">
                {source.count != null && (
                  <p className="text-xs text-surface-300">
                    {source.count.toLocaleString()}{' '}
                    {key === 'keywords_everywhere' || key === 'semrush'
                      ? 'keywords'
                      : key === 'gsc'
                        ? 'queries'
                        : key === 'crawler'
                          ? 'pages'
                          : 'items'}
                  </p>
                )}
                {source.latency_ms != null && (
                  <p className="text-xs text-surface-400">
                    {formatLatency(source.latency_ms)}
                  </p>
                )}
                {key === 'anthropic' && (
                  <>
                    {source.stages_completed != null && (
                      <p className="text-xs text-surface-300">
                        {source.stages_completed} stages
                      </p>
                    )}
                    {source.total_tokens != null && (
                      <p className="text-xs text-surface-400">
                        {source.total_tokens.toLocaleString()} tokens
                      </p>
                    )}
                  </>
                )}
              </div>
            )}

            {source && status === 'failed' && source.error && (
              <p className="text-xs text-error leading-tight line-clamp-2">
                {source.error}
              </p>
            )}

            {source && status === 'skipped' && source.reason && (
              <p className="text-xs text-surface-400 leading-tight line-clamp-2">
                {source.reason}
              </p>
            )}
          </div>
        )
      })}
    </div>
  )
}
