'use client'

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts'
import type { TrendPoint, Granularity } from '@/lib/dashboard/types'

export interface TrendChartProps {
  /** Series to plot. If ANY point has `compareValue`, a dashed ghost series is overlaid. */
  data: TrendPoint[]
  /** Series name shown in the tooltip/legend for the primary line. Defaults to "Value". */
  label?: string
  /** Formats both y-axis ticks and tooltip values. Defaults to a compact-number formatter. */
  valueFormatter?: (n: number) => string
  /** Drives x-axis tick formatting (daily → M/D, weekly → week of M/D, monthly → Mon 'YY). */
  granularity?: Granularity
  /** Chart height in px (ResponsiveContainer handles width). Defaults to 240. */
  height?: number
}

function defaultFormat(n: number): string {
  const abs = Math.abs(n)
  if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (abs >= 1000) return `${(n / 1000).toFixed(1)}K`
  return n.toLocaleString()
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** Parse a `YYYY-MM-DD` or `YYYY-MM` bucket key into a Date (UTC, no TZ drift). */
function parseBucket(key: string): Date | null {
  const m = /^(\d{4})-(\d{2})(?:-(\d{2}))?$/.exec(key)
  if (!m) return null
  const year = Number(m[1])
  const month = Number(m[2]) - 1
  const day = m[3] ? Number(m[3]) : 1
  return new Date(Date.UTC(year, month, day))
}

/** Granularity-aware x-axis tick formatter. Falls back to the raw key if unparseable. */
function makeAxisFormatter(granularity: Granularity) {
  return (key: string): string => {
    const d = parseBucket(key)
    if (!d) return key
    const mo = d.getUTCMonth()
    const day = d.getUTCDate()
    const yr = String(d.getUTCFullYear()).slice(2)
    switch (granularity) {
      case 'monthly':
        return `${MONTHS[mo]} '${yr}`
      case 'weekly':
        // Week-start bucket — show the week's starting M/D.
        return `${mo + 1}/${day}`
      case 'daily':
      default:
        return `${mo + 1}/${day}`
    }
  }
}

/**
 * Period-aware line chart with an optional dashed "ghost" comparison overlay.
 * Matches the app's existing Recharts conventions (chart CSS-var tokens, dark
 * tooltip, no vertical grid, hidden axis lines). Presentational only.
 */
export default function TrendChart({
  data,
  label = 'Value',
  valueFormatter = defaultFormat,
  granularity = 'daily',
  height = 240,
}: TrendChartProps) {
  const hasCompare = data.some((p) => typeof p.compareValue === 'number')
  const axisFormatter = makeAxisFormatter(granularity)
  const compareLabel = `${label} (prior)`

  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 4, right: 16, bottom: 0, left: 0 }}>
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
          tickFormatter={valueFormatter}
          tick={{ fill: 'var(--chart-tick)', fontSize: 11 }}
          axisLine={false}
          tickLine={false}
          width={44}
        />
        <Tooltip
          formatter={(v, name) => [valueFormatter(Number(v ?? 0)), name ?? '']}
          labelFormatter={(key) => axisFormatter(String(key))}
          contentStyle={{
            background: 'var(--chart-tooltip-bg)',
            border: '1px solid var(--chart-tooltip-border)',
            borderRadius: 8,
          }}
          labelStyle={{ color: 'var(--chart-label)' }}
          itemStyle={{ color: 'var(--chart-tick)' }}
        />
        {hasCompare && (
          <Legend
            iconType="plainline"
            iconSize={14}
            formatter={(value) => (
              <span style={{ color: 'var(--chart-tick)', fontSize: 12 }}>{value}</span>
            )}
          />
        )}
        {/* Ghost comparison line first so the primary series renders on top. */}
        {hasCompare && (
          <Line
            type="monotone"
            dataKey="compareValue"
            name={compareLabel}
            stroke="var(--chart-line-secondary)"
            strokeWidth={1.5}
            strokeDasharray="4 3"
            dot={false}
            activeDot={{ r: 4 }}
            connectNulls
            isAnimationActive={false}
          />
        )}
        <Line
          type="monotone"
          dataKey="value"
          name={label}
          stroke="var(--chart-line)"
          strokeWidth={2}
          dot={false}
          activeDot={{ r: 5 }}
          connectNulls
          isAnimationActive={false}
        />
      </LineChart>
    </ResponsiveContainer>
  )
}
