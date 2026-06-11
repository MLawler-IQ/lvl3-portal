'use client'

import TrendChart from '@/components/analytics/shared/TrendChart'
import type { TrendPoint, Granularity } from '@/lib/dashboard/types'

interface Props {
  /** Period-aware sessions series (with optional comparison ghost overlay). */
  data: TrendPoint[]
  /** Bucket size of `data` — drives the x-axis tick formatting. */
  granularity: Granularity
  /** The window the series covers, e.g. "Last 28 days" — stated on the card. */
  periodLabel?: string
  /** Legend name for the ghost comparison series, e.g. "Sessions (prior year)". */
  compareLabel?: string
}

export default function MonthlySessionsChart({ data, granularity, periodLabel, compareLabel }: Props) {
  return (
    <div className="bg-surface-900 border border-surface-700 rounded-xl p-5">
      <div className="mb-4 flex items-baseline justify-between gap-3">
        <p className="text-sm font-semibold text-surface-100">Sessions Trend</p>
        {periodLabel && <p className="text-xs text-surface-500">{periodLabel}</p>}
      </div>
      <TrendChart data={data} label="Sessions" granularity={granularity} compareLabel={compareLabel} />
    </div>
  )
}
