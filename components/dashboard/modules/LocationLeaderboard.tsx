'use client'

import { useMemo, useState } from 'react'
import { MapPin, ArrowDown, AlertTriangle } from 'lucide-react'
import { EmptyState } from '@/components/ui/EmptyState'
import { gbpLocationLabel, hasDuplicateTitles } from '@/lib/dashboard/gbp-labels'
import type { DashboardGBPData, GBPClientInsights, GBPLocationInsight } from '@/app/actions/dashboard-gbp'

// ── Metric presentation ─────────────────────────────────────────────────────
// Human-friendly column labels for the raw GBP_DASHBOARD_METRICS keys. We
// surface the action metrics plus a derived "Impressions" total (sum of the
// four desktop/mobile × maps/search impression breakdowns) so the table stays
// readable across many locations.

const IMPRESSION_KEYS = [
  'BUSINESS_IMPRESSIONS_DESKTOP_MAPS',
  'BUSINESS_IMPRESSIONS_DESKTOP_SEARCH',
  'BUSINESS_IMPRESSIONS_MOBILE_MAPS',
  'BUSINESS_IMPRESSIONS_MOBILE_SEARCH',
] as const

function sumImpressions(metrics: Record<string, number>): number {
  return IMPRESSION_KEYS.reduce((acc, k) => acc + (metrics[k] ?? 0), 0)
}

type SortKey =
  | 'IMPRESSIONS'
  | 'CALL_CLICKS'
  | 'WEBSITE_CLICKS'
  | 'BUSINESS_DIRECTION_REQUESTS'
  | 'BUSINESS_CONVERSATIONS'

interface ColumnSpec {
  key: SortKey
  label: string
  short: string
  value: (m: Record<string, number>) => number
}

// Column order mirrors the action-first ordering of GBP_DASHBOARD_METRICS,
// with a derived Impressions total leading (matches the server-side default
// sort on summed impressions).
const COLUMNS: ColumnSpec[] = [
  { key: 'IMPRESSIONS', label: 'Impressions', short: 'Impr.', value: sumImpressions },
  { key: 'CALL_CLICKS', label: 'Calls', short: 'Calls', value: (m) => m.CALL_CLICKS ?? 0 },
  { key: 'WEBSITE_CLICKS', label: 'Website', short: 'Web', value: (m) => m.WEBSITE_CLICKS ?? 0 },
  {
    key: 'BUSINESS_DIRECTION_REQUESTS',
    label: 'Directions',
    short: 'Dir.',
    value: (m) => m.BUSINESS_DIRECTION_REQUESTS ?? 0,
  },
  {
    key: 'BUSINESS_CONVERSATIONS',
    label: 'Messages',
    short: 'Msg.',
    value: (m) => m.BUSINESS_CONVERSATIONS ?? 0,
  },
]

const DEFAULT_CAP = 10

interface LeaderboardRow extends GBPLocationInsight {
  impressions: number
}

interface SortHeaderProps {
  col: ColumnSpec
  active: boolean
  onSort: (key: SortKey) => void
}

function SortHeader({ col, active, onSort }: SortHeaderProps) {
  return (
    <th
      className={`pb-2 pl-3 text-right text-xs font-medium uppercase tracking-wider ${
        active ? 'text-accent-400' : 'text-surface-500'
      }`}
    >
      <button
        type="button"
        onClick={() => onSort(col.key)}
        className="inline-flex items-center gap-1 rounded transition-colors hover:text-surface-300 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-surface-600"
        aria-label={`Sort by ${col.label}`}
      >
        <span>{col.short}</span>
        {active && <ArrowDown className="h-3 w-3" aria-hidden="true" />}
      </button>
    </th>
  )
}

// ── Public props ────────────────────────────────────────────────────────────

export interface LocationLeaderboardProps {
  /** Full dashboard payload; component reads `insights`. Pass null while loading/unconfigured. */
  data: DashboardGBPData | null
  /** Max number of locations to show before the "+N more" hint. Default 10. */
  cap?: number
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-surface-900 border border-surface-700 rounded-xl p-5">
      <div className="mb-4 flex items-center gap-2">
        <MapPin className="h-4 w-4 text-surface-500" aria-hidden="true" />
        <p className="text-sm font-semibold text-surface-100">Location Leaderboard</p>
      </div>
      {children}
    </div>
  )
}

export default function LocationLeaderboard({ data, cap = DEFAULT_CAP }: LocationLeaderboardProps) {
  // Default to Calls (CALL_CLICKS) descending — the highest-intent GBP action.
  // Impressions stays an available, sortable column.
  const [sortKey, setSortKey] = useState<SortKey>('CALL_CLICKS')

  const insights: GBPClientInsights | undefined = data?.insights

  const rows: LeaderboardRow[] = useMemo(() => {
    if (!insights) return []
    return insights.locations.map((loc) => ({
      ...loc,
      impressions: sumImpressions(loc.metrics),
    }))
  }, [insights])

  const sortedRows = useMemo(() => {
    const col = COLUMNS.find((c) => c.key === sortKey) ?? COLUMNS[0]
    return [...rows].sort((a, b) => col.value(b.metrics) - col.value(a.metrics))
  }, [rows, sortKey])

  // Unconfigured / error / empty states -----------------------------------------
  if (!data || !data.configured) {
    return (
      <Shell>
        <EmptyState
          icon={MapPin}
          title="Google Business Profile not connected"
          description="Connect a GBP account for this client to see per-location performance."
          compact
        />
      </Shell>
    )
  }

  if (data.insightsError || !insights) {
    return (
      <Shell>
        <EmptyState
          icon={AlertTriangle}
          title="Couldn't load location insights"
          description={data.insightsError ?? 'GBP performance data is unavailable right now.'}
          compact
        />
      </Shell>
    )
  }

  if (rows.length === 0) {
    return (
      <Shell>
        <EmptyState
          icon={MapPin}
          title="No locations found"
          description="This GBP account has no locations to rank."
          compact
        />
      </Shell>
    )
  }

  const visible = sortedRows.slice(0, cap)
  const hidden = sortedRows.length - visible.length
  const activeCol = COLUMNS.find((c) => c.key === sortKey) ?? COLUMNS[0]
  // Chain brands share one title across every location — label by city instead.
  const preferCity = hasDuplicateTitles(rows.map((r) => r.locationTitle))

  return (
    <div className="bg-surface-900 border border-surface-700 rounded-xl p-5">
      <div className="mb-4 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <MapPin className="h-4 w-4 text-surface-500" aria-hidden="true" />
          <p className="text-sm font-semibold text-surface-100">Location Leaderboard</p>
        </div>
        <div className="flex items-center gap-2">
          {insights.errorCount > 0 && (
            <span className="inline-flex items-center gap-1 text-[10px] font-medium uppercase tracking-widest text-amber-400">
              <AlertTriangle className="h-3 w-3" aria-hidden="true" />
              {insights.errorCount} location{insights.errorCount === 1 ? '' : 's'}: data unavailable
            </span>
          )}
          <span className="text-xs text-surface-500">
            {insights.locationCount} location{insights.locationCount === 1 ? '' : 's'}
          </span>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-surface-700">
              <th className="pb-2 text-left text-xs font-medium uppercase tracking-wider text-surface-500">
                Location
              </th>
              {COLUMNS.map((col) => (
                <SortHeader
                  key={col.key}
                  col={col}
                  active={col.key === sortKey}
                  onSort={setSortKey}
                />
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.map((row, i) => (
              <tr
                key={row.locationName}
                className="border-b border-surface-700/50 transition-colors hover:bg-surface-800/30"
              >
                <td className="py-2 pr-3">
                  <div className="flex items-center gap-2">
                    <span
                      className="w-5 shrink-0 text-right text-xs text-surface-500"
                      style={{ fontFamily: 'var(--font-jetbrains-mono), monospace' }}
                    >
                      {i + 1}
                    </span>
                    <span
                      className="truncate text-surface-200"
                      title={`${row.locationTitle}${row.locality ? ` — ${row.locality}${row.administrativeArea ? `, ${row.administrativeArea}` : ''}` : ''}`}
                    >
                      {gbpLocationLabel(row.locationTitle, row.locality, row.administrativeArea, preferCity)}
                    </span>
                    {row.error && (
                      <AlertTriangle
                        className="h-3 w-3 shrink-0 text-amber-400"
                        aria-label="Insights fetch failed for this location"
                      />
                    )}
                  </div>
                </td>
                {COLUMNS.map((col) => {
                  const v = col.value(row.metrics)
                  const isActive = col.key === activeCol.key
                  return (
                    <td
                      key={col.key}
                      className={`py-2 pl-3 text-right ${
                        isActive ? 'font-semibold text-accent-400' : 'text-surface-300'
                      }`}
                      style={
                        isActive
                          ? { fontFamily: 'var(--font-jetbrains-mono), monospace' }
                          : undefined
                      }
                    >
                      {v.toLocaleString()}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {hidden > 0 && (
        <p className="mt-3 text-xs text-surface-500">
          + {hidden} more location{hidden === 1 ? '' : 's'} not shown
        </p>
      )}
    </div>
  )
}
