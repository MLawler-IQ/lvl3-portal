import { requireAdmin } from '@/lib/auth'
import { resolveSelectedClientId, getClientById } from '@/lib/client-resolution'
import { fetchBacklinkOverview } from '@/app/actions/tools-extended'
import { listToolRuns } from '@/app/actions/tool-runs'
import ExportTool from '@/components/tools/primitives/ExportTool'
import RunHistory from '@/components/tools/RunHistory'
import { Link2 } from 'lucide-react'

export default async function BacklinkOverviewPage() {
  const { user } = await requireAdmin()
  const selectedClientId = await resolveSelectedClientId(user)

  if (!selectedClientId) {
    return (
      <div className="max-w-7xl mx-auto p-6">
        <p className="text-sm text-surface-400">Select a client from the top bar to run this tool.</p>
      </div>
    )
  }

  const client = await getClientById<{ id: string; name: string }>(selectedClientId, 'id, name')
  const [{ data, error }, runs] = await Promise.all([
    fetchBacklinkOverview(selectedClientId),
    listToolRuns('backlink-overview', selectedClientId),
  ])

  return (
    <div className="max-w-7xl mx-auto p-6 space-y-6 pb-8">
      <div className="flex items-center gap-3">
        <Link2 className="w-5 h-5 text-surface-400" />
        <div>
          <h1 className="text-xl font-semibold text-surface-100">Backlink Overview</h1>
          <p className="mt-0.5 text-sm text-surface-400">
            {client?.name} — domain authority, traffic, and backlink profile via Semrush.
          </p>
        </div>
      </div>

      {error ? (
        <div className="bg-surface-900 border border-surface-700 rounded-xl px-5 py-4">
          <p className="text-sm text-error">Semrush request failed for {client?.name ?? 'this client'}: {error}</p>
          <p className="text-xs text-surface-500 mt-1">
            This is an API error, not an empty backlink profile — check the Semrush key/quota if it persists.
          </p>
        </div>
      ) : data ? (
        <div className="space-y-4">
          <ExportTool
            toolSlug="backlink-overview"
            clientId={selectedClientId}
            input={{ clientId: selectedClientId, domain: data.domain }}
            output={{ data }}
            filename={`backlink-overview-${new Date().toISOString().slice(0, 10)}`}
            title="Backlink Overview"
            data={{
              headers: ['Metric', 'Value'],
              rows: [
                ['Domain', data.domain],
                ...(data.ranks
                  ? ([
                      ['Organic Keywords', data.ranks.organic_keywords],
                      ['Organic Traffic', data.ranks.organic_traffic],
                      ['Traffic Cost ($)', data.ranks.organic_cost],
                    ] as unknown[][])
                  : []),
                ...(data.backlinks
                  ? ([
                      ['Total Backlinks', data.backlinks.total_backlinks],
                      ['Referring Domains', data.backlinks.referring_domains],
                      ['Follow Links', data.backlinks.follow_links],
                      ['Nofollow Links', data.backlinks.nofollow_links],
                      ['Authority Score', data.backlinks.authority_score],
                    ] as unknown[][])
                  : []),
              ],
            }}
            formats={['csv', 'xlsx']}
          />
          <div className="bg-surface-900 border border-surface-700 rounded-xl p-5">
            <p className="text-xs text-surface-400 mb-3 uppercase tracking-wide">Domain: {data.domain}</p>

            {data.ranks && (
              <div className="grid grid-cols-3 gap-4 mb-4">
                <div>
                  <p className="text-xs text-surface-400">Organic Keywords</p>
                  <p className="text-xl font-bold" style={{ color: 'var(--color-accent)' }}>
                    {data.ranks.organic_keywords.toLocaleString()}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-surface-400">Organic Traffic</p>
                  <p className="text-xl font-bold" style={{ color: 'var(--color-accent)' }}>
                    {data.ranks.organic_traffic.toLocaleString()}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-surface-400">Traffic Cost</p>
                  <p className="text-xl font-bold" style={{ color: 'var(--color-accent)' }}>
                    ${data.ranks.organic_cost.toLocaleString()}
                  </p>
                </div>
              </div>
            )}

            {data.backlinks && (
              <div className="grid grid-cols-2 md:grid-cols-5 gap-4 pt-4 border-t border-surface-700">
                <div>
                  <p className="text-xs text-surface-400">Total Backlinks</p>
                  <p className="text-lg font-bold text-surface-100">{data.backlinks.total_backlinks.toLocaleString()}</p>
                </div>
                <div>
                  <p className="text-xs text-surface-400">Referring Domains</p>
                  <p className="text-lg font-bold text-surface-100">{data.backlinks.referring_domains.toLocaleString()}</p>
                </div>
                <div>
                  <p className="text-xs text-surface-400">Follow Links</p>
                  <p className="text-lg font-bold text-surface-100">{data.backlinks.follow_links.toLocaleString()}</p>
                </div>
                <div>
                  <p className="text-xs text-surface-400">Nofollow Links</p>
                  <p className="text-lg font-bold text-surface-100">{data.backlinks.nofollow_links.toLocaleString()}</p>
                </div>
                <div>
                  <p className="text-xs text-surface-400">Authority Score</p>
                  <p className="text-lg font-bold" style={{ color: 'var(--color-accent)' }}>
                    {data.backlinks.authority_score}
                  </p>
                </div>
              </div>
            )}

            {!data.ranks && !data.backlinks && (
              <p className="text-sm text-surface-400">No Semrush data available for this domain.</p>
            )}
          </div>

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
