'use client'

import {
  ComposedChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts'
import { makeAxisFormatter } from '@/components/analytics/shared/TrendChart'
import type { GSCTrendBucket } from '@/lib/google-search-console'
import type { Granularity } from '@/lib/dashboard/types'

function fmtNum(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`
  return n.toLocaleString()
}

interface Props {
  /** Period-aware clicks/impressions buckets (window follows the picker). */
  data: GSCTrendBucket[]
  /** Bucket size of `data` — drives the x-axis tick formatting. */
  granularity: Granularity
  /** The window the series covers, e.g. "Last 28 days" — stated on the card. */
  periodLabel?: string
}

export default function GscTrendChart({ data, granularity, periodLabel }: Props) {
  const axisFormatter = makeAxisFormatter(granularity)
  return (
    <div className="bg-surface-900 border border-surface-700 rounded-xl p-5">
      <div className="mb-4 flex items-baseline justify-between gap-3">
        <p className="text-sm font-semibold text-surface-100">Clicks & Impressions Trend</p>
        {periodLabel && <p className="text-xs text-surface-500">{periodLabel}</p>}
      </div>
      <ResponsiveContainer width="100%" height={240}>
        <ComposedChart data={data} margin={{ top: 4, right: 16, bottom: 0, left: 0 }}>
          <CartesianGrid stroke="var(--chart-grid)" strokeDasharray="3 3" vertical={false} />
          <XAxis
            dataKey="date"
            tickFormatter={axisFormatter}
            tick={{ fill: 'var(--chart-tick)', fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            minTickGap={24}
          />
          <YAxis
            yAxisId="left"
            tickFormatter={fmtNum}
            tick={{ fill: 'var(--chart-tick)', fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            width={40}
          />
          <YAxis
            yAxisId="right"
            orientation="right"
            tickFormatter={fmtNum}
            tick={{ fill: 'var(--chart-tick)', fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            width={40}
          />
          <Tooltip
            formatter={(v, name) => [Number(v ?? 0).toLocaleString(), name ?? '']}
            labelFormatter={(key) => axisFormatter(String(key))}
            contentStyle={{ background: 'var(--chart-tooltip-bg)', border: '1px solid var(--chart-tooltip-border)', borderRadius: 8 }}
            labelStyle={{ color: 'var(--chart-label)' }}
            itemStyle={{ color: 'var(--chart-tick)' }}
          />
          <Legend
            iconType="circle"
            iconSize={8}
            formatter={(value) => <span style={{ color: 'var(--chart-tick)', fontSize: 12 }}>{value}</span>}
          />
          <Area
            yAxisId="left"
            type="monotone"
            dataKey="clicks"
            stroke="var(--chart-line)"
            fill="var(--chart-line)22"
            strokeWidth={2}
            dot={{ fill: 'var(--chart-line)', r: 3 }}
            name="Clicks"
          />
          <Area
            yAxisId="right"
            type="monotone"
            dataKey="impressions"
            stroke="var(--chart-line-secondary)"
            fill="rgb(var(--surface-400) / 0.13)"
            strokeWidth={2}
            strokeDasharray="4 2"
            dot={{ fill: 'var(--chart-line-secondary)', r: 3 }}
            name="Impressions"
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  )
}
