import { getAdminTriage } from '@/app/actions/admin-triage'
import AdminTriageStrip from '@/components/home/AdminTriageStrip'

function TriageHeader() {
  return (
    <div className="mb-3 flex items-baseline justify-between gap-3">
      <p className="text-xs font-medium uppercase tracking-widest text-surface-500">
        Portfolio · Needs Attention
      </p>
      <p className="text-[11px] text-surface-500">Sessions · last 28 days vs prior</p>
    </div>
  )
}

function QuietLine({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-surface-700 bg-surface-900/50 px-5 py-4">
      <p className="text-sm text-surface-500 italic">{children}</p>
    </div>
  )
}

/** Suspense fallback for the triage strip — header + a few pulse rows. */
export function AdminTriageSkeleton() {
  return (
    <section aria-hidden="true">
      <TriageHeader />
      <div className="overflow-hidden rounded-xl border border-surface-700 bg-surface-900 divide-y divide-surface-700/50">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="flex items-center justify-between gap-3 px-4 py-3">
            <div className="h-3 w-36 animate-pulse rounded bg-surface-800" />
            <div className="h-3 w-28 animate-pulse rounded bg-surface-800" />
          </div>
        ))}
      </div>
    </section>
  )
}

/**
 * Admin-only cross-client triage section on Home. Fetches the portfolio rows
 * (sessions delta, pacing-behind count, GBP grade per client) and renders the
 * compact strip — or one quiet muted line on error/empty, never a crash.
 */
export default async function AdminTriageSection() {
  const { data, error } = await getAdminTriage()

  return (
    <section>
      <TriageHeader />
      {error || !data ? (
        <QuietLine>Portfolio triage is unavailable right now.</QuietLine>
      ) : data.length === 0 ? (
        <QuietLine>No clients have analytics connected yet.</QuietLine>
      ) : (
        <AdminTriageStrip rows={data} />
      )}
    </section>
  )
}
