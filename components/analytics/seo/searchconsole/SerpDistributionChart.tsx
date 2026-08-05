'use client'

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from 'recharts'
import type { SerpDistribution } from '@/lib/google-search-console'

interface Props {
  distribution: SerpDistribution
}

const BUCKETS = [
  { key: 'top3' as keyof SerpDistribution, label: 'Top 3', color: 'var(--chart-line)', range: 'positions 1–3' },
  { key: 'top10' as keyof SerpDistribution, label: 'Page 1 (4–10)', color: 'rgb(var(--brand-300))', range: 'positions 4–10' },
  { key: 'page2' as keyof SerpDistribution, label: 'Page 2 (11–20)', color: 'rgb(var(--surface-400))', range: 'positions 11–20' },
  { key: 'page3to5' as keyof SerpDistribution, label: 'Pages 3–5 (21–50)', color: 'rgb(var(--surface-500))', range: 'positions 21–50' },
  { key: 'beyond' as keyof SerpDistribution, label: 'Page 5+ (51+)', color: 'rgb(var(--surface-600))', range: 'positions 51+' },
]

interface TooltipPayload {
  payload?: { range: string; count: number }
}

function CustomTooltip({ active, payload }: { active?: boolean; payload?: TooltipPayload[] }) {
  if (!active || !payload?.length) return null
  const d = payload[0]?.payload
  if (!d) return null
  return (
    <div className="bg-surface-800 border border-surface-600 rounded-lg px-3 py-2 text-xs">
      <p className="text-surface-100 font-medium">{d.count} keywords</p>
      <p className="text-surface-400">{d.range}</p>
    </div>
  )
}

export default function SerpDistributionChart({ distribution }: Props) {
  const total = BUCKETS.reduce((sum, b) => sum + distribution[b.key], 0)

  const data = BUCKETS.map((b) => ({
    label: b.label,
    count: distribution[b.key],
    color: b.color,
    range: b.range,
  }))

  return (
    <div className="bg-surface-900 border border-surface-700 rounded-xl p-5">
      <div className="mb-4">
        <p className="text-sm font-semibold text-surface-100">Keyword Position Distribution</p>
        <p className="text-xs text-surface-400 mt-0.5">{total} keywords tracked</p>
      </div>
      <ResponsiveContainer width="100%" height={220}>
        <BarChart data={data} margin={{ top: 4, right: 8, left: -20, bottom: 4 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" vertical={false} />
          <XAxis
            dataKey="label"
            tick={{ fill: 'var(--chart-tick)', fontSize: 11 }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            tick={{ fill: 'var(--chart-tick)', fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            allowDecimals={false}
          />
          <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(255,255,255,0.04)' }} />
          <Bar dataKey="count" radius={[2, 2, 0, 0]}>
            {data.map((entry, index) => (
              <Cell key={`cell-${index}`} fill={entry.color} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
