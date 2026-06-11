import { requireAdmin } from '@/lib/auth'
import { resolveSelectedClientId, getClientById } from '@/lib/client-resolution'
import { fetchQuickWins } from '@/app/actions/tools'
import { listToolRuns } from '@/app/actions/tool-runs'
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
      <p className="text-sm text-surface-400">
        {client?.name} — keywords ranking 4-20 with 100+ impressions in the last 90 days
      </p>

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
