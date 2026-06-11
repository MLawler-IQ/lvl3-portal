import Link from 'next/link'
import { Target as TargetIcon } from 'lucide-react'
import type { PacingRow, PacingStatus } from '@/lib/dashboard/pacing'

interface TargetsProps {
  pacing: PacingRow[]
  /** Admins with no targets configured see a setup nudge instead of nothing. */
  isAdmin?: boolean
  /** Client id for the settings deep-link in the admin nudge. */
  clientId?: string
}

// Per-status color tokens.
const STATUS_STYLES: Record<
  Exclude<PacingStatus, 'no_target'>,
  { bar: string; chip: string; label: string }
> = {
  ahead: {
    bar: 'bg-accent-400',
    chip: 'text-accent-400 border-accent-400/40 bg-accent-400/10',
    label: 'Ahead',
  },
  on_track: {
    bar: 'bg-sky-400',
    chip: 'text-sky-400 border-sky-400/40 bg-sky-400/10',
    label: 'On track',
  },
  behind: {
    bar: 'bg-rose-400',
    chip: 'text-rose-400 border-rose-400/40 bg-rose-400/10',
    label: 'Behind',
  },
}

const MONO = { fontFamily: 'var(--font-jetbrains-mono), monospace' }

/** Compact, locale-aware number formatting (e.g. 12.4K, 1.2M) — Intl handles the
 *  magnitude boundaries correctly (999,999 → "1M", not "1000K"). */
function formatValue(n: number): string {
  if (Math.abs(n) < 1_000) return Math.round(n).toLocaleString('en-US')
  return new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(n)
}

function PacingRowItem({ row }: { row: PacingRow }) {
  // no_target rows are filtered out before render, but guard for safety.
  if (row.status === 'no_target' || row.target === null) return null

  const styles = STATUS_STYLES[row.status]
  const pct = row.pctToTarget ?? 0
  const pctLabel = `${Math.round(pct * 100)}%`
  const barWidth = `${Math.min(100, Math.max(0, pct * 100))}%`

  return (
    <li className="border-b border-surface-700/50 py-3 first:pt-0 last:border-0 last:pb-0">
      <div className="mb-2 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <span className="truncate text-sm font-medium text-surface-200">{row.label}</span>
          <span
            className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.1em] ${styles.chip}`}
          >
            {styles.label}
          </span>
        </div>
        <div className="shrink-0 text-right text-sm" style={MONO}>
          <span className="text-surface-100 font-semibold">{formatValue(row.actual)}</span>
          <span className="text-surface-500"> / {formatValue(row.target)}</span>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-800">
          <div className={`h-full rounded-full ${styles.bar}`} style={{ width: barWidth }} />
        </div>
        <span className="w-10 shrink-0 text-right text-xs text-surface-400" style={MONO}>
          {pctLabel}
        </span>
      </div>

      {row.projected !== null && (
        <p className="mt-1.5 text-xs text-surface-500">
          Projected month-end:{' '}
          <span className="text-surface-300" style={MONO}>
            {formatValue(row.projected)}
          </span>
        </p>
      )}
    </li>
  )
}

/**
 * Presentational targets / pacing module. Renders each metric with a monthly
 * goal as a row showing actual vs target, a progress bar (% to target, visually
 * capped at 100%), and a color-coded pace-status chip. With no targets set,
 * admins get a minimal "set goals" nudge; everyone else sees nothing.
 */
export default function Targets({ pacing, isAdmin = false, clientId }: TargetsProps) {
  const rows = pacing.filter((r) => r.status !== 'no_target' && r.target !== null)
  if (rows.length === 0) {
    if (!isAdmin || !clientId) return null
    return (
      <div className="bg-surface-900 border border-surface-700 rounded-xl p-5">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <TargetIcon className="h-4 w-4 text-surface-500" aria-hidden="true" />
            <p className="text-sm font-semibold text-surface-100">Monthly Goals</p>
          </div>
          <Link
            href={`/clients/${clientId}`}
            className="shrink-0 text-xs font-medium text-accent-400 transition-colors hover:text-accent-500"
          >
            Set monthly goals →
          </Link>
        </div>
        <p className="mt-2 text-xs text-surface-500">
          No targets configured for this client yet — goal pacing appears here once monthly goals are set.
        </p>
      </div>
    )
  }

  return (
    <div className="bg-surface-900 border border-surface-700 rounded-xl p-5">
      <div className="mb-4 flex items-center gap-2">
        <TargetIcon className="h-4 w-4 text-surface-500" aria-hidden="true" />
        <p className="text-sm font-semibold text-surface-100">Monthly Goals</p>
      </div>

      <ul>
        {rows.map((row) => (
          <PacingRowItem key={row.metricId} row={row} />
        ))}
      </ul>
    </div>
  )
}
