'use client'

import { LineChart, Line, YAxis, ResponsiveContainer } from 'recharts'
import type { TrendPoint } from '@/lib/dashboard/types'

interface SparklineProps {
  /** Either a bare numeric series or TrendPoint[]; TrendPoint[] is mapped to its `value`. */
  data: number[] | TrendPoint[]
  className?: string
  /** Stroke color. Defaults to the chart line token. */
  stroke?: string
  /** Pixel height of the sparkline. Width is always responsive. */
  height?: number
}

/** Normalize either input shape into the `{ value }` rows Recharts plots. */
function toSeries(data: number[] | TrendPoint[]): { value: number }[] {
  if (data.length === 0) return []
  if (typeof data[0] === 'number') {
    return (data as number[]).map((value) => ({ value }))
  }
  return (data as TrendPoint[]).map((p) => ({ value: p.value }))
}

/**
 * Tiny inline trend sparkline — no axes, grid, tooltip, or dots.
 * Responsive width, ~40px tall by default. Renders nothing for <2 points.
 */
export default function Sparkline({
  data,
  className,
  stroke = 'var(--chart-line)',
  height = 40,
}: SparklineProps) {
  const series = toSeries(data)
  if (series.length < 2) return null

  return (
    <div className={className} style={{ width: '100%', height }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={series} margin={{ top: 2, right: 1, bottom: 2, left: 1 }}>
          {/* Padded domain so the line never clips at the box edges. */}
          <YAxis hide domain={['dataMin', 'dataMax']} />
          <Line
            type="monotone"
            dataKey="value"
            stroke={stroke}
            strokeWidth={1.75}
            dot={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}
