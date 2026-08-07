import { requireAdmin } from '@/lib/auth'
import { getClientsWithStats } from '@/app/actions/clients'
import ClientsGrid from '@/components/clients/clients-grid'

/**
 * The new-client modal lives on this page, and createClient now runs discovery
 * before returning. Server actions inherit the invoking page's duration budget,
 * and discovery's cold-cache path fans out one dataStreams.list call per GA4
 * property, so the Vercel default would cut it off mid-index. Same reason the
 * onboarding page carried this. Creation itself survives that — discovery is
 * best-effort — but the admin would land on an emptier form for no good reason.
 */
export const maxDuration = 300

export default async function ClientsPage() {
  await requireAdmin()

  const clients = await getClientsWithStats()

  return (
    <div className="p-8">
      <ClientsGrid clients={clients} />
    </div>
  )
}
