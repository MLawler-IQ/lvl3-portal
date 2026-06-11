import KpiCard from '@/components/ui/KpiCard'
import type { TrendPoint } from '@/lib/dashboard/types'
import HealthScorecard from './HealthScorecard'
import ActivityFeed from './ActivityFeed'

/** A north-star KPI tile in the exec band. `delta` is a signed percent (e.g. 18, -4.2). */
export interface ExecKpi {
  label: string
  value: string | number
  /** Signed percent change vs the comparison period. Positive = up, negative = down. */
  delta?: number
  /** Overrides the default delta percent text (e.g. "+18%" or an absolute "+312 clicks"). */
  deltaLabel?: string
  /** Inline trend for the KPI, rendered as a sparkline beneath the value. */
  sparkline?: TrendPoint[]
}

/** A site/channel health metric. Provide a `grade` OR a 0–100 `score` (grade is derived). */
export interface HealthItem {
  label: string
  grade?: 'A' | 'B' | 'C' | 'D' | 'F'
  score?: number
}

/** A recent deliverable / milestone for the "what we did → what happened" feed. */
export interface ActivityItem {
  title: string
  /** ISO timestamp or `YYYY-MM-DD`. */
  date: string
  /** Optional category tag, e.g. "Deliverable", "Milestone", "Report". */
  type?: string
}

export interface ExecutiveSummaryBandProps {
  /** Prominent one-line narrative (mono). Typically StructuredInsights.headline. */
  headline?: string
  /** North-star KPI row. Empty array hides the row. */
  kpis?: ExecKpi[]
  /** Compact health scorecard row. Empty/omitted hides the row. */
  health?: HealthItem[]
  /** Recent activity feed. Empty/omitted hides the feed. */
  activity?: ActivityItem[]
}

/** Build the KpiCard `delta` shape from a signed percent + optional label override. */
function toKpiDelta(
  delta: number | undefined,
  deltaLabel: string | undefined
): { direction: 'up' | 'down' | 'flat'; percent: string; absolute?: string } | undefined {
  if (typeof delta !== 'number' && !deltaLabel) return undefined
  const value = typeof delta === 'number' ? delta : 0
  const direction: 'up' | 'down' | 'flat' = value > 0 ? 'up' : value < 0 ? 'down' : 'flat'
  const percent =
    deltaLabel ?? `${Math.abs(value).toLocaleString(undefined, { maximumFractionDigits: 1 })}%`
  return { direction, percent }
}

/**
 * Presentational executive summary band for the dashboard. Lays out, top→bottom:
 *   (a) a prominent mono headline,
 *   (b) the north-star KPI row (KpiCards with sparklines),
 *   (c) a compact health scorecard (colored grade chips),
 *   (d) a "what we did → what happened" activity feed.
 * Every section degrades gracefully when its data is empty/omitted; renders
 * nothing if there is no content at all.
 */
export default function ExecutiveSummaryBand({
  headline,
  kpis = [],
  health = [],
  activity = [],
}: ExecutiveSummaryBandProps) {
  const hasContent = Boolean(headline) || kpis.length > 0 || health.length > 0 || activity.length > 0
  if (!hasContent) return null

  return (
    <section className="bg-surface-900 border border-surface-700 rounded-xl p-6 space-y-6">
      {/* (a) Headline */}
      {headline && (
        <div>
          <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-brand-500">
            Executive Summary
          </p>
          <h2
            className="mt-2 text-lg font-bold leading-snug text-surface-100"
            style={{ fontFamily: 'var(--font-jetbrains-mono), monospace' }}
          >
            {headline}
          </h2>
        </div>
      )}

      {/* (b) North-star KPI row */}
      {kpis.length > 0 && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {kpis.map((kpi, i) => (
            <KpiCard
              key={`${kpi.label}-${i}`}
              label={kpi.label}
              value={String(kpi.value)}
              delta={toKpiDelta(kpi.delta, kpi.deltaLabel)}
              sparkline={kpi.sparkline}
            />
          ))}
        </div>
      )}

      {/* (c) Health scorecard */}
      {health.length > 0 && (
        <div>
          <p className="mb-3 text-[11px] font-medium uppercase tracking-[0.14em] text-surface-500">
            Health
          </p>
          <HealthScorecard items={health} />
        </div>
      )}

      {/* (d) Activity feed */}
      {activity.length > 0 && (
        <div>
          <p className="mb-3 text-[11px] font-medium uppercase tracking-[0.14em] text-surface-500">
            What we did → what happened
          </p>
          <ActivityFeed items={activity} />
        </div>
      )}
    </section>
  )
}
