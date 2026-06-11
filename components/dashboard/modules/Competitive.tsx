import { Swords, AlertTriangle } from 'lucide-react'
import type { CompetitiveResult, CompetitiveRow } from '@/app/actions/dashboard-competitive'

const MONO = { fontFamily: 'var(--font-jetbrains-mono), monospace' } as const

/** Compact integer, e.g. 12,500 → "12.5K", 2,300,000 → "2.3M". */
function fmtCompact(n: number | null): string {
  if (n == null) return '—'
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return Math.round(n).toLocaleString()
}

function fmtCurrency(n: number | null): string {
  if (n == null) return '—'
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`
  return `$${Math.round(n).toLocaleString()}`
}

function fmtScore(n: number | null): string {
  return n == null ? '—' : String(Math.round(n))
}

type Column = {
  key: keyof Pick<
    CompetitiveRow,
    'organicKeywords' | 'organicTraffic' | 'organicCost' | 'referringDomains' | 'authorityScore'
  >
  label: string
  fmt: (n: number | null) => string
}

const COLUMNS: Column[] = [
  { key: 'authorityScore', label: 'Authority', fmt: fmtScore },
  { key: 'organicKeywords', label: 'Keywords', fmt: fmtCompact },
  { key: 'organicTraffic', label: 'Traffic', fmt: fmtCompact },
  { key: 'organicCost', label: 'Traffic Value', fmt: fmtCurrency },
  { key: 'referringDomains', label: 'Ref. Domains', fmt: fmtCompact },
]

function EmptyState() {
  return (
    <div className="rounded-xl border border-surface-700 bg-surface-900 p-8 text-center">
      <Swords className="mx-auto mb-3 h-8 w-8 text-surface-500" aria-hidden="true" />
      <h3 className="text-sm font-semibold text-surface-100">No competitors tracked</h3>
      <p className="mx-auto mt-1.5 max-w-sm text-sm text-surface-400">
        Add competitor domains in client settings to benchmark organic visibility, keywords,
        traffic, and backlinks side by side.
      </p>
    </div>
  )
}

/**
 * Competitive landscape comparison table — the client's own domain benchmarked
 * against tracked competitors on Semrush organic + backlink metrics. The
 * client's own row is highlighted. Renders a graceful empty state when no
 * competitors are configured or Semrush is unavailable.
 */
export default function Competitive({ data }: { data: CompetitiveResult }) {
  if (!data.configured || data.rows.length === 0) {
    return <EmptyState />
  }

  // Self row first, then competitors sorted by organic traffic (desc, nulls last).
  const rows = [...data.rows].sort((a, b) => {
    if (a.isSelf !== b.isSelf) return a.isSelf ? -1 : 1
    return (b.organicTraffic ?? -1) - (a.organicTraffic ?? -1)
  })

  return (
    <div className="rounded-xl border border-surface-700 bg-surface-900">
      <div className="flex items-center gap-2 border-b border-surface-700 px-5 py-3.5">
        <Swords className="h-4 w-4 text-accent-400" aria-hidden="true" />
        <h3 className="text-sm font-semibold text-surface-100">Competitive Landscape</h3>
        <span className="text-xs text-surface-500">Latest Semrush snapshot · not period-linked</span>
      </div>

      {data.error && (
        <div className="flex items-center gap-2 border-b border-surface-700 px-5 py-2.5 text-xs text-amber-400">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span>{data.error}</span>
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-surface-700 text-left">
              <th className="px-5 py-2.5 text-[10px] font-medium uppercase tracking-widest text-surface-500">
                Domain
              </th>
              {COLUMNS.map((col) => (
                <th
                  key={col.key}
                  className="px-5 py-2.5 text-right text-[10px] font-medium uppercase tracking-widest text-surface-500"
                >
                  {col.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={row.domain}
                className={`border-b border-surface-800 last:border-0 ${
                  row.isSelf ? 'bg-accent-400/[0.06]' : 'hover:bg-surface-850'
                }`}
              >
                <td className="px-5 py-3">
                  <div className="flex items-center gap-2">
                    <span
                      className={`truncate ${
                        row.isSelf ? 'font-semibold text-accent-400' : 'text-surface-200'
                      }`}
                    >
                      {row.domain}
                    </span>
                    {row.isSelf && (
                      <span className="rounded border border-accent-400/40 bg-accent-400/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-widest text-accent-400">
                        You
                      </span>
                    )}
                  </div>
                  {row.error && (
                    <span className="mt-0.5 block text-[10px] text-amber-400/80" title={row.error}>
                      Lookup failed
                    </span>
                  )}
                </td>
                {COLUMNS.map((col) => (
                  <td
                    key={col.key}
                    className={`px-5 py-3 text-right tabular-nums ${
                      row.isSelf ? 'text-accent-400' : 'text-surface-300'
                    }`}
                    style={MONO}
                  >
                    {col.fmt(row[col.key])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
