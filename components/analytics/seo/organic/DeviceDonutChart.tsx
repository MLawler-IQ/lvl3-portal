'use client'

import { PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer } from 'recharts'
import {
  seriesColorForEntity,
  CHART_OTHER,
  CHART_TOOLTIP_STYLE,
  CHART_TICK,
} from '@/lib/charts/palette'

interface Props {
  mobile: number
  desktop: number
  tablet: number
}

export default function DeviceDonutChart({ mobile, desktop, tablet }: Props) {
  // Colour comes from the device NAME, not the slice's position.
  //
  // This previously did `COLORS[i % COLORS.length]` over a list already filtered by
  // `value > 0`, so a client with no tablet traffic saw Desktop rendered in Mobile's
  // colour. Two of those three colours were also hardcoded #2dd4bf / #60a5fa —
  // Tailwind's teal-400 and blue-400, not the validated #2FA396 / #5B8DE8.
  const data = [
    { name: 'Desktop', value: desktop },
    { name: 'Mobile', value: mobile },
    { name: 'Tablet', value: tablet },
  ].filter((d) => d.value > 0)

  if (data.length === 0) return null

  const total = data.reduce((sum, d) => sum + d.value, 0)
  const share = (n: number) => Math.round((n / total) * 100)
  const summary = `Device breakdown of organic sessions: ${data
    .map((d) => `${d.name} ${share(d.value)}%`)
    .join(', ')}.`

  return (
    <div className="bg-surface-900 border border-surface-700 rounded-xl p-5">
      <p className="text-sm font-semibold text-surface-100 mb-4">Device Breakdown (Organic)</p>
      {/* Text alternative — the SVG is invisible to a screen reader. */}
      <p className="sr-only">{summary}</p>
      <ResponsiveContainer width="100%" height={240}>
        <PieChart role="img" aria-label={summary}>
          <Pie
            data={data}
            cx="50%"
            cy="50%"
            innerRadius={60}
            outerRadius={90}
            paddingAngle={2}
            dataKey="value"
          >
            {data.map((d) => (
              <Cell key={d.name} fill={seriesColorForEntity(d.name) ?? CHART_OTHER} />
            ))}
          </Pie>
          <Tooltip
            formatter={(v) => [Number(v ?? 0).toLocaleString(), 'Sessions']}
            contentStyle={CHART_TOOLTIP_STYLE}
            itemStyle={{ color: 'var(--chart-tooltip-fg)' }}
          />
          <Legend
            iconType="circle"
            iconSize={8}
            formatter={(value) => <span style={CHART_TICK}>{value}</span>}
          />
        </PieChart>
      </ResponsiveContainer>
    </div>
  )
}
