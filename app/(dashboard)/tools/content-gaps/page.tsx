import { requireAdmin } from '@/lib/auth'
import { resolveSelectedClientId, getClientById } from '@/lib/client-resolution'
import { fetchContentGaps } from '@/app/actions/tools'
import { listToolRuns } from '@/app/actions/tool-runs'
import { FileSearch } from 'lucide-react'
import ContentGapsTable from './ContentGapsTable'

export default async function ContentGapsPage() {
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

  const [{ gaps, error }, runs] = await Promise.all([
    fetchContentGaps(selectedClientId),
    listToolRuns('content-gaps', selectedClientId),
  ])

  return (
    <div className="max-w-7xl mx-auto p-6 space-y-6 pb-8">
      <div className="flex items-center gap-3">
        <FileSearch className="w-5 h-5 text-surface-400" />
        <div>
          <h1 className="text-xl font-semibold text-surface-100">Content Gap Finder</h1>
          <p className="mt-0.5 text-sm text-surface-400">
            {client?.name} — pages leaving clicks on the table, last 90 days
          </p>
        </div>
      </div>

      {error ? (
        <div className="bg-surface-900 border border-surface-700 rounded-xl px-5 py-4">
          <p className="text-sm text-red-400">{error}</p>
        </div>
      ) : gaps && gaps.length === 0 ? (
        <div className="bg-surface-900 border border-surface-700 rounded-xl px-5 py-4">
          <p className="text-sm text-surface-400">No content gaps detected for this period.</p>
        </div>
      ) : gaps ? (
        <ContentGapsTable gaps={gaps} clientId={selectedClientId} runs={runs} />
      ) : null}
    </div>
  )
}
