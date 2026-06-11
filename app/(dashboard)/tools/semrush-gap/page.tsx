import { requireAdmin } from '@/lib/auth'
import { resolveSelectedClientId, getClientById } from '@/lib/client-resolution'
import { normalizeDomain } from '@/lib/normalize-domain'
import SemrushGapClient from './SemrushGapClient'

export default async function SemrushGapPage() {
  const { user } = await requireAdmin()
  const selectedClientId = await resolveSelectedClientId(user)

  if (!selectedClientId) {
    return (
      <div className="max-w-7xl mx-auto p-6">
        <p className="text-sm text-surface-400">Select a client from the top bar to run this tool.</p>
      </div>
    )
  }

  const client = await getClientById<{
    id: string
    name: string
    gsc_site_url: string | null
    competitors: string[] | null
  }>(selectedClientId, 'id, name, gsc_site_url, competitors')

  const defaultClientDomain = client?.gsc_site_url ? normalizeDomain(client.gsc_site_url) : ''
  const savedCompetitors = (client?.competitors ?? []).filter((c) => c && c.trim())

  return (
    <div className="max-w-7xl mx-auto p-6 space-y-6 pb-8">
      <p className="text-sm text-surface-400">
        {client?.name} — find keywords competitors rank for that you don&apos;t
      </p>

      <SemrushGapClient
        clientName={client?.name ?? ''}
        clientId={selectedClientId}
        defaultClientDomain={defaultClientDomain}
        defaultCompetitors={savedCompetitors}
      />
    </div>
  )
}
