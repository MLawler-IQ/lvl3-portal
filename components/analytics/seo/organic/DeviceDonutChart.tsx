'use client'

import { PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer } from 'recharts'

const COLORS = ['var(--chart-line)', '#2dd4bf', '#60a5fa']

interface Props {
  mobile: number
  desktop: number
  tablet: number
}

export default function DeviceDonutChart({ mobile, desktop, tablet }: Props) {
  const data = [
    { name: 'Mobile', value: mobile },
    { name: 'Desktop', value: desktop },
    { name: 'Tablet', value: tablet },
  ].filter((d) => d.value > 0)

  if (data.length === 0) return null

  return (
    <div className="bg-surface-900 border border-surface-700 rounded-xl p-5">
      <p className="text-sm font-semibold text-surface-100 mb-4">Device Breakdown (Organic)</p>
      <ResponsiveContainer width="100%" height={240}>
        <PieChart>
          <Pie
            data={data}
            cx="50%"
            cy="50%"
            innerRadius={60}
            outerRadius={90}
            paddingAngle={2}
            dataKey="value"
          >
            {data.map((_, i) => (
              <Cell key={i} fill={COLORS[i % COLORS.length]} />
            ))}
          </Pie>
          <Tooltip
            formatter={(v) => [Number(v ?? 0).toLocaleString(), 'Sessions']}
            contentStyle={{ background: 'var(--chart-tooltip-bg)', border: '1px solid var(--chart-tooltip-border)', borderRadius: 2 }}
            itemStyle={{ color: 'var(--chart-tick)' }}
          />
          <Legend
            iconType="circle"
            iconSize={8}
            formatter={(value) => <span style={{ color: 'var(--chart-tick)', fontSize: 12 }}>{value}</span>}
          />
        </PieChart>
      </ResponsiveContainer>
    </div>
  )
}
