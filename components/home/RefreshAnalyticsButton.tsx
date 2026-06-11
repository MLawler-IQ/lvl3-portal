'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { RefreshCw } from 'lucide-react'
import { generateAnalyticsInsights } from '@/app/actions/analytics'

interface RefreshAnalyticsButtonProps {
  clientId: string
  /** Generation frame for the regenerated narrative. Omit for the dashboard
   *  default (last full month vs prior year); the dashboard's context panel
   *  passes the currently selected period/compare so an admin refreshing while
   *  viewing a frame regenerates in that frame. */
  period?: string
  compare?: string
}

export default function RefreshAnalyticsButton({ clientId, period, compare }: RefreshAnalyticsButtonProps) {
  const router = useRouter()
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  async function handleRefresh() {
    setRefreshing(true)
    setError(null)
    setNotice(null)
    const result = await generateAnalyticsInsights(clientId, { period, compare })
    if (result.error) {
      setError(result.error)
    } else {
      // Generation now produces a DRAFT requiring admin approval before clients
      // see it — surface that rather than implying the summary is live.
      setNotice('Draft created — review & approve in the Snapshot tab.')
      router.refresh()
    }
    setRefreshing(false)
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        onClick={handleRefresh}
        disabled={refreshing}
        className="flex items-center gap-1.5 rounded-lg border border-surface-600 bg-surface-800 px-3 py-1.5 text-xs font-medium text-surface-300 transition-colors hover:border-surface-500 hover:text-surface-100 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-surface-400"
      >
        <RefreshCw size={12} className={refreshing ? 'animate-spin' : ''} />
        {refreshing ? 'Generating…' : 'Generate insights'}
      </button>
      {notice && <p className="text-xs text-surface-400 max-w-xs text-right">{notice}</p>}
      {error && <p className="text-xs text-red-400 max-w-xs text-right">{error}</p>}
    </div>
  )
}
