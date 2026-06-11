'use client'

import { Filter } from 'lucide-react'
import DeltaChip from '@/components/ui/DeltaChip'
import { EmptyState } from '@/components/ui/EmptyState'
import type { GA4EcomFunnel } from '@/app/actions/dashboard-ga4'

export interface EcomFunnelProps {
  funnel: GA4EcomFunnel | null
}

function fmtNum(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return n.toLocaleString()
}

function dir(pct: number): 'up' | 'down' | 'flat' {
  if (pct > 0) return 'up'
  if (pct < 0) return 'down'
  return 'flat'
}

type Stage = {
  label: string
  count: number
  delta: number
}

export default function EcomFunnel({ funnel }: EcomFunnelProps) {
  const stages: Stage[] = funnel
    ? [
        { label: 'Items viewed', count: funnel.itemsViewed, delta: funnel.itemsViewedDelta },
        { label: 'Add to cart', count: funnel.addToCarts, delta: funnel.addToCartsDelta },
        { label: 'Checkout', count: funnel.checkouts, delta: funnel.checkoutsDelta },
        { label: 'Purchase', count: funnel.purchases, delta: funnel.purchasesDelta },
      ]
    : []

  const top = stages.length > 0 ? stages[0].count : 0
  const hasData = funnel != null && stages.some((s) => s.count > 0)

  return (
    <div className="bg-surface-900 border border-surface-700 rounded-xl p-5">
      <div className="mb-4">
        <p className="text-sm font-semibold text-surface-100">Ecommerce Funnel</p>
        <p className="text-xs text-surface-400 mt-0.5">Items viewed through to purchase</p>
      </div>

      {!hasData ? (
        <EmptyState
          icon={Filter}
          title="No ecommerce data"
          description="Funnel metrics appear once GA4 ecommerce events are tracked for this client."
          compact
        />
      ) : (
        <div className="space-y-3">
          {stages.map((stage, i) => {
            // Width relative to the top of the funnel (items viewed).
            const widthPct = top > 0 ? Math.max((stage.count / top) * 100, 2) : 0
            // Step-to-step conversion from the previous stage.
            const prev = i > 0 ? stages[i - 1].count : 0
            const stepConv = i > 0 && prev > 0 ? (stage.count / prev) * 100 : null

            return (
              <div key={stage.label}>
                {stepConv != null && (
                  <div className="flex items-center gap-1.5 pb-1.5 pl-0.5 text-[11px] text-surface-500">
                    <span aria-hidden="true">↳</span>
                    <span>{stepConv.toFixed(1)}% step conversion</span>
                  </div>
                )}
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-medium text-surface-300">{stage.label}</span>
                  <div className="flex items-center gap-2.5">
                    <span
                      className="text-sm font-bold leading-none"
                      style={{ color: 'var(--color-accent)', fontFamily: 'var(--font-jetbrains-mono), monospace' }}
                    >
                      {fmtNum(stage.count)}
                    </span>
                    <DeltaChip direction={dir(stage.delta)} percent={`${Math.abs(stage.delta)}%`} />
                  </div>
                </div>
                <div className="h-2.5 w-full rounded-full bg-surface-800 overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-500"
                    style={{ width: `${widthPct}%`, backgroundColor: 'var(--chart-line)' }}
                  />
                </div>
              </div>
            )
          })}

          {/* Overall view-to-purchase conversion */}
          {top > 0 && (
            <div className="flex items-center justify-between border-t border-surface-700 pt-3 mt-1">
              <span className="text-xs font-medium uppercase tracking-wider text-surface-500">
                View → Purchase
              </span>
              <span
                className="text-sm font-bold"
                style={{ color: 'var(--color-accent)', fontFamily: 'var(--font-jetbrains-mono), monospace' }}
              >
                {((stages[3].count / top) * 100).toFixed(1)}%
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
