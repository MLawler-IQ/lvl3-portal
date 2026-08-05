'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { RefreshCw, PackageOpen } from 'lucide-react'
import { generateClientSummary } from '@/app/actions/summaries'

interface ClientSummaryProps {
  clientId: string
  clientName: string
  summary: string | null
  summaryUpdatedAt: string | null
  deliverableCount: number
  isAdmin: boolean
}

export default function ClientSummary({
  clientId,
  clientName,
  summary,
  summaryUpdatedAt,
  deliverableCount,
  isAdmin,
}: ClientSummaryProps) {
  const router = useRouter()
  const [refreshing, setRefreshing] = useState(false)

  async function handleRefresh() {
    setRefreshing(true)
    try {
      await generateClientSummary(clientId)
      router.refresh()
    } finally {
      setRefreshing(false)
    }
  }

  const updatedLabel = summaryUpdatedAt
    ? new Date(summaryUpdatedAt).toLocaleString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      })
    : null

  return (
    <div className="rounded-xl border border-surface-700 bg-surface-900 p-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-surface-100">{clientName}</h2>
          <div className="mt-1.5 flex items-center gap-2">
            <div className="flex items-center gap-1.5 rounded-full bg-surface-800 px-2.5 py-1 text-xs text-surface-400">
              <PackageOpen size={12} />
              <span>
                {deliverableCount} {deliverableCount === 1 ? 'deliverable' : 'deliverables'}
              </span>
            </div>
          </div>
        </div>

        {isAdmin && (
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            className="flex items-center gap-1.5 rounded-lg border border-surface-600 bg-surface-800 px-3 py-1.5 text-xs font-medium text-surface-300 transition-colors hover:border-surface-500 hover:text-surface-100 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <RefreshCw size={12} className={refreshing ? 'animate-spin' : ''} />
            {refreshing ? 'Refreshing…' : 'Refresh summary'}
          </button>
        )}
      </div>

      {/* Divider */}
      <div className="my-4 border-t border-surface-700" />

      {/* Summary */}
      <div>
        <p className="mb-2 text-xs font-medium uppercase tracking-widest text-surface-400">
          Monthly Brief
        </p>
        {summary ? (
          <p className="text-sm leading-relaxed text-surface-300 whitespace-pre-wrap">{summary}</p>
        ) : (
          <p className="text-sm text-surface-400 italic">
            No summary yet. Sync the project sheet to generate one.
          </p>
        )}
        {updatedLabel && (
          <p className="mt-3 text-xs text-surface-400">Last updated {updatedLabel}</p>
        )}
      </div>
    </div>
  )
}
