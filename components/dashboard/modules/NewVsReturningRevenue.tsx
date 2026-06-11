import { Users2 } from 'lucide-react'
import { EmptyState } from '@/components/ui/EmptyState'
import type { GA4NewVsReturningRevenue } from '@/app/actions/dashboard-ga4'

export interface NewVsReturningRevenueProps {
  data: GA4NewVsReturningRevenue | null
}

// Intentionally SHARES + TREND only — never absolute dollars. The dimension is
// GA4's session-based attribution, so the tooltip warns it won't match Shopify.
const TOOLTIP =
  "Share of purchase revenue from customers GA4 classifies as new (first visit) vs returning, via the newVsReturning dimension. This is GA4's session-based attribution and won't match Shopify's customer counts, which dedupe buyers differently."

const pctText = (n: number): string => `${Math.round(n)}%`

/**
 * New-customer revenue share for ecommerce clients: the SHARE of revenue from
 * new vs returning customers and how the new-customer share moved period over
 * period. Presentational only.
 *
 * TODO: ADMIN-ONLY for now — the render site (AnalyticsSection/DashboardTabs)
 * gates this behind `isAdmin && client_type === 'ecommerce'`, mirroring
 * MetricTable13. Making it client-visible is a deliberate later decision; keep
 * the gate until then.
 */
export default function NewVsReturningRevenue({ data }: NewVsReturningRevenueProps) {
  const cur = data?.current
  const prior = data?.prior
  const hasData =
    cur != null && cur.newShare != null && cur.returningShare != null && cur.totalRevenue > 0

  const newShare = cur?.newShare ?? 0
  const retShare = cur?.returningShare ?? 0
  // Remainder = revenue GA4 couldn't tag as new/returning. Derived so the three
  // segments always fill the bar even with rounding.
  const unkShare = Math.max(0, Math.round((100 - newShare - retShare) * 10) / 10)

  const priorNew = prior?.newShare
  let trendText: string | null = null
  if (hasData && priorNew != null) {
    const d = Math.round(newShare) - Math.round(priorNew)
    trendText =
      d > 0
        ? `up from ${pctText(priorNew)}`
        : d < 0
          ? `down from ${pctText(priorNew)}`
          : `level with ${pctText(priorNew)} last period`
  }

  return (
    <div className="bg-surface-900 border border-surface-700 rounded-xl p-5">
      <div className="mb-4 flex items-center gap-1.5">
        <p className="text-sm font-semibold text-surface-100">New-customer revenue share</p>
        <div className="relative group">
          <button
            className="w-4 h-4 rounded-full border border-surface-700 text-surface-400 hover:text-surface-500 text-[10px] flex items-center justify-center transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-surface-700"
            aria-label="About new vs returning revenue"
          >
            ?
          </button>
          <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 w-64 bg-surface-100 border border-surface-700 rounded-lg px-3 py-2 text-xs text-surface-900 opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity z-10 whitespace-normal shadow-[0_4px_16px_rgba(0,0,0,0.12)]">
            {TOOLTIP}
          </div>
        </div>
        <span className="ml-auto rounded border border-surface-700 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-surface-500">
          Admin
        </span>
      </div>

      {!hasData ? (
        <EmptyState
          icon={Users2}
          title="No purchase revenue"
          description="New vs returning revenue appears once GA4 records ecommerce purchases for this client in this period."
          compact
        />
      ) : (
        <>
          <p className="text-sm text-surface-300">
            New-customer share of revenue:{' '}
            <span
              className="font-bold"
              style={{ color: 'var(--color-accent)', fontFamily: 'var(--font-jetbrains-mono), monospace' }}
            >
              {pctText(newShare)}
            </span>
            {trendText && <span className="text-surface-400">, {trendText}</span>}
          </p>

          {/* Share split — percentages only, never dollar amounts. */}
          <div className="mt-4 flex h-2.5 w-full overflow-hidden rounded-full bg-surface-800">
            <div className="bg-brand-400" style={{ width: `${newShare}%` }} aria-hidden="true" />
            <div className="bg-brand-600" style={{ width: `${retShare}%` }} aria-hidden="true" />
            {unkShare > 0 && (
              <div className="bg-surface-600" style={{ width: `${unkShare}%` }} aria-hidden="true" />
            )}
          </div>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-surface-400">
            <span>
              <span className="inline-block w-2 h-2 rounded-sm align-middle mr-1 bg-brand-400" />
              New {pctText(newShare)}
            </span>
            <span>
              <span className="inline-block w-2 h-2 rounded-sm align-middle mr-1 bg-brand-600" />
              Returning {pctText(retShare)}
            </span>
            {unkShare > 0 && (
              <span>
                <span className="inline-block w-2 h-2 rounded-sm align-middle mr-1 bg-surface-600" />
                Unattributed {pctText(unkShare)}
              </span>
            )}
          </div>
        </>
      )}
    </div>
  )
}
