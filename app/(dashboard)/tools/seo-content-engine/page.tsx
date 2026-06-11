import { requireAdmin } from '@/lib/auth'
import { resolveSelectedClientId, getClientById } from '@/lib/client-resolution'
import SeoContentEngineClient from './SeoContentEngineClient'

export default async function SeoContentEnginePage() {
  const { user } = await requireAdmin()
  const selectedClientId = await resolveSelectedClientId(user)

  if (!selectedClientId) {
    return (
      <div className="max-w-7xl mx-auto p-6">
        <p className="text-sm text-surface-400">Select a client from the top bar to run this tool.</p>
      </div>
    )
  }

  const client = await getClientById<{ id: string; name: string; brand_context: string | null }>(
    selectedClientId,
    'id, name, brand_context'
  )

  return (
    <div className="max-w-7xl mx-auto p-6 space-y-6 pb-8">
      <SeoContentEngineClient
        clientId={selectedClientId}
        clientName={client?.name ?? 'Client'}
        clientBrandContext={client?.brand_context ?? null}
      />
    </div>
  )
}
