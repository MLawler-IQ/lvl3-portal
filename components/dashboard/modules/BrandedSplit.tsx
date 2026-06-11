'use client'

import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts'
import { Search } from 'lucide-react'
import { EmptyState } from '@/components/ui/EmptyState'
import type { GSCBrandedSplit, GSCIntentSplit } from '@/lib/google-search-console'

export interface BrandedSplitProps {
  branded: GSCBrandedSplit | null
  /** Optional local-vs-general intent breakdown; hidden when absent or empty. */
  intent?: GSCIntentSplit | null
}

const BRANDED_COLOR = 'var(--chart-line)'
const NONBRANDED_COLOR = 'var(--chart-bar-secondary)'

function fmtNum(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return n.toLocaleString()
}

function pct(part: number, total: number): number {
  return total > 0 ? Math.round((part / total) * 100) : 0
}

interface TooltipPayload {
  name?: string
  value?: number
  payload?: { name: string; clicks: number; impressions: number }
}

function ClicksTooltip({ active, payload }: { active?: boolean; payload?: TooltipPayload[] }) {
  if (!active || !payload?.length) return null
  const d = payload[0]?.payload
  if (!d) return null
  return (
    <div className="bg-surface-800 border border-surface-600 rounded-lg px-3 py-2 text-xs">
      <p className="text-surface-100 font-medium">{d.name}</p>
      <p className="text-surface-400">{fmtNum(d.clicks)} clicks</p>
      <p className="text-surface-400">{fmtNum(d.impressions)} impressions</p>
    </div>
  )
}

export default function BrandedSplit({ branded, intent }: BrandedSplitProps) {
  const brandedClicks = branded?.branded.clicks ?? 0
  const nonBrandedClicks = branded?.nonBranded.clicks ?? 0
  const totalClicks = brandedClicks + nonBrandedClicks
  const hasBranded = totalClicks > 0

  const donutData = [
    {
      name: 'Branded',
      clicks: brandedClicks,
      impressions: branded?.branded.impressions ?? 0,
      color: BRANDED_COLOR,
    },
    {
      name: 'Non-branded',
      clicks: nonBrandedClicks,
      impressions: branded?.nonBranded.impressions ?? 0,
      color: NONBRANDED_COLOR,
    },
  ].filter((d) => d.clicks > 0)

  const localClicks = intent?.localClicks ?? 0
  const generalClicks = intent?.generalClicks ?? 0
  const totalIntentClicks = localClicks + generalClicks
  const hasIntent = totalIntentClicks > 0

  return (
    <div className="bg-surface-900 border border-surface-700 rounded-xl p-5">
      <div className="mb-4">
        <p className="text-sm font-semibold text-surface-100">Branded Search</p>
        <p className="text-xs text-surface-400 mt-0.5">Branded vs non-branded query mix</p>
      </div>

      {!hasBranded ? (
        <EmptyState
          icon={Search}
          title="No search data"
          description="Branded query splits appear once Google Search Console is connected for this client."
          compact
        />
      ) : (
        <>
          <div className="flex items-center gap-4">
            <div className="relative shrink-0" style={{ width: 132, height: 132 }}>
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={donutData}
                    cx="50%"
                    cy="50%"
                    innerRadius={44}
                    outerRadius={64}
                    paddingAngle={2}
                    dataKey="clicks"
                    stroke="none"
                  >
                    {donutData.map((entry, i) => (
                      <Cell key={i} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip content={<ClicksTooltip />} />
                </PieChart>
              </ResponsiveContainer>
              <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                <span
                  className="text-lg font-bold leading-none"
                  style={{ color: 'var(--color-accent)', fontFamily: 'var(--font-jetbrains-mono), monospace' }}
                >
                  {pct(brandedClicks, totalClicks)}%
                </span>
                <span className="text-[10px] uppercase tracking-wider text-surface-500 mt-0.5">Branded</span>
              </div>
            </div>

            <div className="flex-1 space-y-2.5">
              {donutData.map((d) => (
                <div key={d.name} className="flex items-center justify-between">
                  <span className="flex items-center gap-2 text-xs text-surface-300">
                    <span
                      className="inline-block w-2.5 h-2.5 rounded-full"
                      style={{ backgroundColor: d.color }}
                      aria-hidden="true"
                    />
                    {d.name}
                  </span>
                  <span className="flex items-center gap-2">
                    <span className="text-xs text-surface-400 tabular-nums">{fmtNum(d.clicks)}</span>
                    <span
                      className="text-xs font-medium tabular-nums w-9 text-right"
                      style={{ color: 'var(--color-accent)', fontFamily: 'var(--font-jetbrains-mono), monospace' }}
                    >
                      {pct(d.clicks, totalClicks)}%
                    </span>
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Optional local-vs-general intent breakdown */}
          {hasIntent && (
            <div className="border-t border-surface-700 pt-4 mt-4">
              <p className="text-xs font-medium uppercase tracking-wider text-surface-500 mb-2.5">
                Local vs General Intent
              </p>
              <div className="flex h-2.5 w-full rounded-full overflow-hidden bg-surface-800">
                <div
                  className="h-full"
                  style={{
                    width: `${pct(localClicks, totalIntentClicks)}%`,
                    backgroundColor: BRANDED_COLOR,
                  }}
                />
                <div
                  className="h-full"
                  style={{
                    width: `${pct(generalClicks, totalIntentClicks)}%`,
                    backgroundColor: 'rgb(var(--brand-300))',
                  }}
                />
              </div>
              <div className="flex items-center justify-between mt-2 text-xs">
                <span className="flex items-center gap-2 text-surface-300">
                  <span
                    className="inline-block w-2.5 h-2.5 rounded-full"
                    style={{ backgroundColor: BRANDED_COLOR }}
                    aria-hidden="true"
                  />
                  Local
                  <span className="text-surface-500 tabular-nums">
                    {pct(localClicks, totalIntentClicks)}% · {fmtNum(localClicks)}
                  </span>
                </span>
                <span className="flex items-center gap-2 text-surface-300">
                  <span className="text-surface-500 tabular-nums">
                    {fmtNum(generalClicks)} · {pct(generalClicks, totalIntentClicks)}%
                  </span>
                  General
                  <span
                    className="inline-block w-2.5 h-2.5 rounded-full"
                    style={{ backgroundColor: 'rgb(var(--brand-300))' }}
                    aria-hidden="true"
                  />
                </span>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
