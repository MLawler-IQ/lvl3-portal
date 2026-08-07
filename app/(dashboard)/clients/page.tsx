import Link from 'next/link'
import { requireAdmin } from '@/lib/auth'
import {
  getClientsWithStats,
  getArchivedClients,
  getAllClientSlugs,
} from '@/app/actions/clients'
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
  const archived = await getArchivedClients()
  // Includes archived slugs — they still occupy the unique index.
  const allSlugs = await getAllClientSlugs()

  return (
    <div className="p-8">
      <ClientsGrid clients={clients} allSlugs={allSlugs} />

      {/*
        Archived clients are hidden everywhere else by design, so this is the one
        place they remain reachable. Without it, archiving would be
        indistinguishable from deleting — and restoring would mean knowing a URL.
      */}
      {archived.length > 0 && (
        <div className="mt-12">
          <h2 className="text-surface-400 text-xs uppercase tracking-wide mb-3">
            Archived ({archived.length})
          </h2>
          <ul className="divide-y divide-surface-800 rounded-sm border border-surface-800 bg-surface-900">
            {archived.map((c) => (
              <li key={c.id}>
                <Link
                  href={`/clients/${c.id}`}
                  className="flex items-baseline justify-between gap-4 px-4 py-2.5 transition-colors hover:bg-surface-850 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
                >
                  <span className="text-sm text-surface-300 truncate">{c.name}</span>
                  <span className="text-[11px] text-surface-500 shrink-0">
                    Archived {new Date(c.archived_at).toLocaleDateString()}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
