import { requireAdmin } from '@/lib/auth'
import { resolveSelectedClientId, getClientById } from '@/lib/client-resolution'
import { checkAIVisibility } from '@/app/actions/tools'
import { listToolRuns } from '@/app/actions/tool-runs'
import ExportTool from '@/components/tools/primitives/ExportTool'
import RunHistory from '@/components/tools/RunHistory'

export default async function AIVisibilityPage() {
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

  const [{ result, error }, runs] = await Promise.all([
    checkAIVisibility(selectedClientId),
    listToolRuns('ai-visibility', selectedClientId),
  ])

  return (
    <div className="max-w-7xl mx-auto p-6 space-y-6 pb-8">
      <p className="text-sm text-surface-400">
        {client?.name} — fixed window: last {result?.periodDays ?? 90} days
        {result &&
          (result.termsSource === 'configured'
            ? ` · configured brand terms (${result.brandTerms.length})`
            : ' · name/slug heuristic (no brand terms configured)')}
      </p>

      {error ? (
        <div className="bg-surface-900 border border-surface-700 rounded-xl px-5 py-4">
          <p className="text-sm text-red-400">{error}</p>
        </div>
      ) : result ? (
        <div className="space-y-6">
          <ExportTool
            toolSlug="ai-visibility"
            clientId={selectedClientId}
            input={{ clientId: selectedClientId }}
            output={{ result }}
            filename={`ai-visibility-${new Date().toISOString().slice(0, 10)}`}
            title="AI Visibility Check"
            data={{
              headers: ['Metric / Query', 'Type', 'Clicks', 'Impressions', 'Position'],
              rows: [
                ['Branded Click Share (%)', 'KPI', result.brandedClickShare, '', ''],
                ['Branded Impression Share (%)', 'KPI', result.brandedImpressionShare, '', ''],
                ['Total Clicks', 'KPI', result.totalClicks, '', ''],
                ['Total Impressions', 'KPI', result.totalImpressions, '', ''],
                ...result.topBrandedQueries.map((q) => [q.query, 'Branded', q.clicks, q.impressions, q.position]),
                ...result.topNonBrandedQueries.map((q) => [q.query, 'Non-Branded', q.clicks, q.impressions, q.position]),
              ],
            }}
            formats={['csv', 'xlsx']}
          />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {[
              { title: 'Top Branded Queries', data: result.topBrandedQueries },
              { title: 'Top Non-Branded Queries', data: result.topNonBrandedQueries },
            ].map(({ title, data }) => (
              <div key={title} className="bg-surface-900 border border-surface-700 rounded-xl overflow-hidden">
                <div className="px-5 py-3 border-b border-surface-700">
                  <p className="text-sm font-semibold text-surface-100">{title}</p>
                </div>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-surface-700 bg-surface-800/50">
                      <th className="text-left px-4 py-2.5 text-xs font-medium uppercase tracking-wide text-surface-400">Query</th>
                      <th className="text-right px-4 py-2.5 text-xs font-medium uppercase tracking-wide text-surface-400">Clicks</th>
                      <th className="text-right px-4 py-2.5 text-xs font-medium uppercase tracking-wide text-surface-400">Impressions</th>
                      <th className="text-right px-4 py-2.5 text-xs font-medium uppercase tracking-wide text-surface-400">Pos</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-surface-700">
                    {data.map((q, i) => (
                      <tr key={i} className="hover:bg-surface-800/40 transition-colors">
                        <td className="px-4 py-2.5 text-surface-200 max-w-[160px] truncate">{q.query}</td>
                        <td className="px-4 py-2.5 text-right text-surface-300">{q.clicks.toLocaleString()}</td>
                        <td className="px-4 py-2.5 text-right text-surface-400">{q.impressions.toLocaleString()}</td>
                        <td className="px-4 py-2.5 text-right text-surface-400">#{q.position}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
          </div>

          <p className="text-xs text-surface-500">
            {result.termsSource === 'configured'
              ? 'Branded queries match the brand terms configured in client settings — the same terms the dashboard’s Branded Search module uses (over its selected period).'
              : 'No brand terms configured — brand detection falls back to the client name, slug, and domain. Set brand terms in client settings to match the dashboard’s Branded Search module.'}{' '}
            High branded share may indicate strong AI-driven brand awareness. Low branded share
            means most organic traffic is discovery-based. Branded-share KPIs live on the dashboard
            (Detail → Branded Search); this tool breaks the split down by query.
          </p>

          {runs.length > 0 && (
            <div className="space-y-2">
              <h2 className="text-xs font-medium uppercase tracking-wide text-surface-400">Recent Runs</h2>
              <RunHistory runs={runs} />
            </div>
          )}
        </div>
      ) : null}
    </div>
  )
}
