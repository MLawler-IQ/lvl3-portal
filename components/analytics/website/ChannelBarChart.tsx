'use client'

import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts'
import DeltaChip from '@/components/ui/DeltaChip'
import type { ChannelRow } from '@/lib/google-analytics'

function fmtNum(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`
  return n.toLocaleString()
}

interface Props {
  channels: ChannelRow[]
}

export default function ChannelBarChart({ channels }: Props) {
  const data = channels.slice(0, 10)
  // GA4 labels traffic it can't attribute to a channel as "Unassigned" — usually a
  // tracking-parameter problem, not a real marketing channel. Footnote it when shown.
  const hasUnassigned = data.some((c) => c.channel?.toLowerCase() === 'unassigned')

  return (
    <div className="bg-surface-900 border border-surface-700 rounded-xl p-5">
      <p className="text-sm font-semibold text-surface-100 mb-4">Sessions by Channel</p>
      <ResponsiveContainer width="100%" height={240}>
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
            dataKey="channel"
            width={120}
            tick={{ fill: 'var(--chart-tick)', fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            interval={0}
          />
          <Tooltip
            formatter={(v) => [Number(v ?? 0).toLocaleString(), 'Sessions']}
            contentStyle={{ background: 'var(--chart-tooltip-bg)', border: '1px solid var(--chart-tooltip-border)', borderRadius: 8 }}
            labelStyle={{ color: 'var(--chart-label)' }}
            itemStyle={{ color: 'var(--chart-tick)' }}
          />
          <Bar dataKey="sessions" radius={[0, 4, 4, 0]}>
            {data.map((_, i) => (
              <Cell key={i} fill={i === 0 ? 'var(--chart-line)' : 'var(--chart-bar-secondary)'} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>

      {/* Compact table below */}
      <div className="mt-4 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-surface-700">
              <th className="pb-2 text-left text-xs font-medium uppercase tracking-wider text-surface-500">Channel</th>
              <th className="pb-2 text-right text-xs font-medium uppercase tracking-wider text-surface-500">Sessions</th>
              <th className="pb-2 text-right text-xs font-medium uppercase tracking-wider text-surface-500">vs Prior</th>
            </tr>
          </thead>
          <tbody>
            {data.map((row, i) => (
              <tr key={i} className="border-b border-surface-700/50 hover:bg-surface-800/30 transition-colors">
                <td className="py-1.5 text-surface-300">{row.channel}</td>
                <td className="py-1.5 text-right text-surface-300">{row.sessions.toLocaleString()}</td>
                <td className="py-1.5 text-right">
                  <DeltaChip
                    direction={row.sessionsDelta > 0 ? 'up' : row.sessionsDelta < 0 ? 'down' : 'flat'}
                    percent={`${Math.abs(row.sessionsDelta)}%`}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {hasUnassigned && (
        <p className="mt-3 text-xs text-surface-500">
          &ldquo;Unassigned&rdquo; is traffic GA4 couldn&rsquo;t attribute to a channel &mdash;
          usually missing or stripped tracking parameters, not a real marketing channel.
        </p>
      )}
    </div>
  )
}
