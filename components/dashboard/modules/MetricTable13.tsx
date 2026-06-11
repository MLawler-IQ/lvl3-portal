import { EmptyState } from '@/components/ui/EmptyState'
import { CalendarRange, ArrowUpRight, ArrowDownRight, Minus } from 'lucide-react'
import type { MetricTableRow } from '@/app/actions/dashboard-metrics-table'

export interface MetricTable13Props {
  /** One row per month, expected sorted ascending (oldest → newest). */
  rows: MetricTableRow[]
}

type MetricKey = keyof Omit<MetricTableRow, 'yearMonth' | 'isPartial'>

const COLUMNS: { key: MetricKey; label: string; format: (n: number) => string }[] = [
  { key: 'sessions', label: 'Sessions', format: (n) => n.toLocaleString() },
  { key: 'clicks', label: 'Clicks', format: (n) => n.toLocaleString() },
  { key: 'impressions', label: 'Impressions', format: (n) => n.toLocaleString() },
  { key: 'conversions', label: 'Conversions', format: (n) => n.toLocaleString() },
  {
    key: 'revenue',
    label: 'Revenue',
    format: (n) =>
      n === 0
        ? '$0'
        : n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }),
  },
]

/** Percent change current vs prior; null when prior is 0/absent (no baseline). */
function pctChange(curr: number, prior: number | undefined): number | null {
  if (prior === undefined || prior === 0) return null
  return Math.round(((curr - prior) / prior) * 100)
}

/** Format a YYYY-MM key as e.g. "Jun 2026". */
function monthLabel(yearMonth: string): string {
  const [y, m] = yearMonth.split('-').map((s) => parseInt(s, 10))
  if (!y || !m) return yearMonth
  return new Date(y, m - 1, 1).toLocaleString('en-US', { month: 'short', year: 'numeric' })
}

/** Month label with an "(MTD)" suffix for the in-progress month. */
function rowLabel(row: MetricTableRow): string {
  return row.isPartial ? `${monthLabel(row.yearMonth)} (MTD)` : monthLabel(row.yearMonth)
}

function DeltaBadge({ pct }: { pct: number | null }) {
  if (pct === null) {
    return <span className="text-xs text-surface-500">—</span>
  }
  const up = pct > 0
  const flat = pct === 0
  const Icon = flat ? Minus : up ? ArrowUpRight : ArrowDownRight
  const color = flat ? 'text-surface-400' : up ? 'text-emerald-500' : 'text-rose-500'
  return (
    <span className={`inline-flex items-center gap-0.5 text-xs font-medium ${color}`}>
      <Icon className="w-3 h-3" aria-hidden="true" />
      {up ? '+' : ''}
      {pct}%
    </span>
  )
}

/**
 * 13-month metric table: one row per month (newest first) with Sessions, Clicks,
 * Impressions, Conversions and Revenue. MoM %Δ indicators and the YoY summary
 * strip anchor on the latest COMPLETE month; the in-progress month is labeled
 * "(MTD)" and carries no deltas (a partial month has no fair comparison).
 * Horizontally scrollable on small screens.
 */
export default function MetricTable13({ rows }: MetricTable13Props) {
  if (rows.length === 0) {
    return (
      <div className="bg-surface-900 border border-surface-700 rounded-xl p-5">
        <p className="text-sm font-semibold text-surface-100 mb-4">13-Month Metrics</p>
        <EmptyState
          icon={CalendarRange}
          title="No monthly data"
          description="Connect GA4 and/or Search Console for this client to populate the 13-month table."
          compact
        />
      </div>
    )
  }

  // rows arrive ascending (oldest → newest). Comparisons anchor on the latest
  // COMPLETE month — a trailing isPartial (MTD) row gets no MoM/YoY deltas.
  const ascending = rows
  const newest = ascending[ascending.length - 1]
  const anchorIdx =
    newest.isPartial && ascending.length >= 2 ? ascending.length - 2 : ascending.length - 1
  const latest = ascending[anchorIdx]
  const prevMonth = anchorIdx >= 1 ? ascending[anchorIdx - 1] : undefined
  // YoY peer: 12 months earlier in the ascending series.
  const yoyPeer = anchorIdx >= 12 ? ascending[anchorIdx - 12] : undefined

  // Newest-first for display.
  const display = [...ascending].reverse()

  return (
    <div className="bg-surface-900 border border-surface-700 rounded-xl p-5">
      <div className="mb-4 flex items-baseline justify-between gap-3">
        <p className="text-sm font-semibold text-surface-100">13-Month Metrics</p>
        <p className="text-xs text-surface-500">Newest first · MoM Δ on latest full month</p>
      </div>

      {/* YoY summary strip — latest complete month vs 12 months earlier */}
      <div className="mb-4 rounded-lg border border-surface-700 bg-surface-950/40 p-3">
        <p className="mb-2 text-[11px] font-medium uppercase tracking-wider text-brand-500">
          {yoyPeer
            ? `Year over Year · ${rowLabel(latest)} vs ${monthLabel(yoyPeer.yearMonth)}`
            : `Year over Year · ${rowLabel(latest)} (needs 13 full months)`}
        </p>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
          {COLUMNS.map((col) => (
            <div key={col.key} className="flex flex-col">
              <span className="text-xs text-surface-400">{col.label}</span>
              <span className="font-mono text-base font-semibold text-brand-400">
                {col.format(latest[col.key])}
              </span>
              <DeltaBadge pct={yoyPeer ? pctChange(latest[col.key], yoyPeer[col.key]) : null} />
            </div>
          ))}
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-sm">
          <thead>
            <tr className="border-b border-surface-700">
              <th className="pb-2 pr-4 text-left text-xs font-medium uppercase tracking-wider text-surface-500">
                Month
              </th>
              {COLUMNS.map((col) => (
                <th
                  key={col.key}
                  className="pb-2 pl-4 text-right text-xs font-medium uppercase tracking-wider text-surface-500"
                >
                  {col.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {display.map((row) => {
              const isAnchor = !row.isPartial && row.yearMonth === latest.yearMonth
              return (
                <tr
                  key={row.yearMonth}
                  className={`border-b border-surface-700/50 transition-colors hover:bg-surface-800/30 ${
                    isAnchor ? 'bg-surface-800/20' : ''
                  }`}
                >
                  <td className="py-2 pr-4 text-left">
                    <span className={isAnchor ? 'font-medium text-surface-100' : 'text-surface-300'}>
                      {rowLabel(row)}
                    </span>
                  </td>
                  {COLUMNS.map((col) => (
                    <td key={col.key} className="py-2 pl-4 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <span className="font-mono text-surface-300">{col.format(row[col.key])}</span>
                        {isAnchor && (
                          <DeltaBadge pct={pctChange(row[col.key], prevMonth?.[col.key])} />
                        )}
                      </div>
                    </td>
                  ))}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
