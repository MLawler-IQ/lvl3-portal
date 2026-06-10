import { requireAdmin } from '@/lib/auth'
import { resolveSelectedClientId, getClientById } from '@/lib/client-resolution'
import { fetchQuickWins } from '@/app/actions/tools'
import { listToolRuns } from '@/app/actions/tool-runs'
import { TrendingUp } from 'lucide-react'
import QuickWinsTable from './QuickWinsTable'

export default async function KeywordQuickWinsPage() {
  const { user } = await requireAdmin()
  const selectedClientId = await resolveSelectedClientId(user)

  if (!selectedClientId) {
    return (
      <div className="max-w-7xl mx-auto p-6">
        <p className="text-sm text-surface-400">Select a client from the top bar to run this tool.</p>
      </div>
    )
  }

  const client = await getClientById<{ id: string; name: string }>(
    selectedClientId,
    'id, name'
  )

  const [{ wins, error }, runs] = await Promise.all([
    fetchQuickWins(selectedClientId),
    listToolRuns('keyword-quick-wins', selectedClientId),
  ])

  return (
    <div className="max-w-7xl mx-auto p-6 space-y-6 pb-8">
      <div className="flex items-center gap-3">
        <TrendingUp className="w-5 h-5 text-surface-400" />
        <div>
          <h1 className="text-xl font-semibold text-surface-100">Keyword Quick Wins</h1>
          <p className="mt-0.5 text-sm text-surface-400">
            {client?.name} — keywords ranking 4-20 with 100+ impressions in the last 90 days
          </p>
        </div>
      </div>

      {error ? (
        <div className="bg-surface-900 border border-surface-700 rounded-xl px-5 py-4">
          <p className="text-sm text-red-400">{error}</p>
        </div>
      ) : wins && wins.length === 0 ? (
        <div className="bg-surface-900 border border-surface-700 rounded-xl px-5 py-4">
          <p className="text-sm text-surface-400">No quick wins found for this period.</p>
        </div>
      ) : wins ? (
        <QuickWinsTable wins={wins} clientId={selectedClientId} runs={runs} />
      ) : null}
    </div>
  )
}
