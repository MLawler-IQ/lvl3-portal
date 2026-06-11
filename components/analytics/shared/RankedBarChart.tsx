'use client'

import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts'

export interface RankedBarRow {
  label: string
  value: number
}

interface RankedBarChartProps {
  title: string
  rows: RankedBarRow[]
  /** Tooltip value label, e.g. "Impressions". */
  valueLabel?: string
  /** Max bars to show (sorted desc by value). */
  max?: number
  height?: number
}

function fmtNum(n: number): string {
  if (Math.abs(n) >= 1000) return `${(n / 1000).toFixed(1)}K`
  return n.toLocaleString()
}

/**
 * Generic horizontal "ranked" bar chart matching the app's chart conventions
 * (CSS-var tokens, dark tooltip). The top bar is accented; the rest muted.
 * Returns null when there's no data, so callers can render it unconditionally.
 */
export default function RankedBarChart({ title, rows, valueLabel = 'Value', max = 8, height }: RankedBarChartProps) {
  const data = [...rows].filter((r) => r.value > 0).sort((a, b) => b.value - a.value).slice(0, max)
  if (data.length === 0) return null
  const h = height ?? Math.max(160, data.length * 34)

  return (
    <div className="bg-surface-900 border border-surface-700 rounded-xl p-5">
      <p className="text-sm font-semibold text-surface-100 mb-4">{title}</p>
      <ResponsiveContainer width="100%" height={h}>
        <BarChart layout="vertical" data={data} margin={{ top: 0, right: 16, bottom: 0, left: 0 }}>
          <CartesianGrid stroke="var(--chart-grid)" strokeDasharray="3 3" horizontal={false} />
          <XAxis
            type="number"
            tickFormatter={fmtNum}
            tick={{ fill: 'var(--chart-tick)', fontSize: 11 }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            type="category"
            dataKey="label"
            width={140}
            tick={{ fill: 'var(--chart-tick)', fontSize: 11 }}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip
            formatter={(v) => [Number(v ?? 0).toLocaleString(), valueLabel]}
            contentStyle={{ background: 'var(--chart-tooltip-bg)', border: '1px solid var(--chart-tooltip-border)', borderRadius: 8 }}
            labelStyle={{ color: 'var(--chart-label)' }}
            itemStyle={{ color: 'var(--chart-tick)' }}
          />
          <Bar dataKey="value" radius={[0, 4, 4, 0]}>
            {data.map((_, i) => (
              <Cell key={i} fill={i === 0 ? 'var(--chart-line)' : 'var(--chart-bar-secondary)'} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
