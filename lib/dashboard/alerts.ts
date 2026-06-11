// Alerts engine (Phase C, workstream C2).
//
// PURE, deterministic helpers — NO LLM, NO 'use server', NO fetching, NO side
// effects. Given metric deltas, a GBP health summary, and pacing rows that
// INT-C has already assembled from GA4 / GSC / GBP / clients.targets, derive a
// ranked, deduped list of DashboardAlert[] surfacing the things that need
// attention right now.
//
// Mirrors the conventions established in lib/dashboard/insights.ts: a metric
// signal is `{ value, delta }` where delta is a SIGNED percent (18 = +18%,
// -27 = −27%); the north-star metric set is sessions / organicClicks /
// conversions / revenue / gbpCalls; each metric deep-links to the same module
// as the insight engine; and the proper minus sign (U+2212) is used in copy.
//
// Consumed by INT-C, which builds AlertInput from real data and renders the
// result through components/dashboard/modules/Alerts.tsx.

import type {
  AlertSeverity,
  DashboardAlert,
  DashboardModuleId,
} from '@/lib/dashboard/types'

// ── Input signals ─────────────────────────────────────────────────────────────

/**
 * One metric signal. `value` is the current-period value; `delta` is the signed
 * percent change vs the comparison period. Both optional so callers pass only
 * what they fetched — a missing or non-finite delta yields no metric alert
 * (zero-prior cases must be passed as `delta: undefined`, never Infinity/NaN).
 */
export interface AlertMetricSignal {
  /** Current-period value (display + zero-baseline context). */
  value?: number
  /** Signed percent change vs comparison period (e.g. 18 or -27). */
  delta?: number
}

/** The north-star metrics the engine raises decline alerts on. */
export interface AlertMetrics {
  /** GA4 total sessions. North-star traffic metric. */
  sessions?: AlertMetricSignal
  /** GSC organic clicks. North-star organic metric. */
  organicClicks?: AlertMetricSignal
  /**
   * GA4 ecommerce purchase transactions. North-star outcome metric. Key kept as
   * `conversions` for stability, but it is LABELED "Purchases" (it is backed by
   * GA4 `transactions`, not keyEvents — the word "Conversions" is reserved for
   * keyEvents-backed numbers such as the pacing/goal-miss rows).
   */
  conversions?: AlertMetricSignal
  /** GA4 ecommerce revenue. North-star outcome metric. */
  revenue?: AlertMetricSignal
  /** Google Business Profile phone calls. North-star local metric. */
  gbpCalls?: AlertMetricSignal
  /** Google Business Profile booking actions. North-star local metric. */
  gbpBookings?: AlertMetricSignal
}

/** Aggregate Google Business Profile health, used for GBP health alerts. */
export interface GbpHealthSummary {
  /** Average profile-completeness / health score, 0–100. */
  avgScore?: number
  /** Number of locations currently flagged closed / permanently closed. */
  closedCount?: number
  /** Number of locations missing required info (hours, phone, etc.). */
  missingInfoCount?: number
}

/** Pacing status for a single target metric, as classified by the targets module. */
export type PacingStatus = 'ahead' | 'on_track' | 'behind' | 'no_target'

/** One target-metric pacing row (subset of what the targets module computes). */
export interface PacingRow {
  /** Metric id this target tracks (matches AlertMetrics keys where applicable). */
  metricId: string
  /** Pacing classification for the current period. */
  status: PacingStatus
  /** Fraction of the prorated target achieved so far (1 = exactly on pace). */
  pctToTarget?: number
  /** Human label for the metric, e.g. "Conversions". Falls back to metricId. */
  label?: string
  /** Fraction of the month elapsed (0–1). Used to gate end-of-month goal-miss alerts. */
  monthProgress?: number
}

/**
 * Everything the alerts engine derives from. Every field is optional so INT-C
 * passes only what it actually has; missing signals simply yield no alerts.
 */
export interface AlertInput {
  metrics?: AlertMetrics
  gbp?: GbpHealthSummary
  pacing?: PacingRow[]
}

// ── Metric metadata ─────────────────────────────────────────────────────────
// Mirrors lib/dashboard/insights.ts so an alert deep-links to the same module
// the insight engine would, keeping the two engines visually consistent.

interface AlertMetricMeta {
  key: keyof AlertMetrics
  label: string
  chartRef: DashboardModuleId
  /** The so-what + next-step for the alert detail — adds context beyond the
   *  title's "<metric> down X%" so the strip never restates itself. */
  implication: string
}

const METRIC_META: AlertMetricMeta[] = [
  { key: 'revenue', label: 'Revenue', chartRef: 'ecom_funnel', implication: 'Open the funnel to see whether traffic, conversion rate, or order value gave way.' },
  // `conversions` key, but LABELED "Purchases" — backed by GA4 transactions.
  // "Conversions" stays reserved for keyEvents-backed pacing/goal-miss alerts.
  { key: 'conversions', label: 'Purchases', chartRef: 'converting_pages', implication: 'The funnel is converting fewer visitors — check converting pages and channel mix for where it leaks.' },
  { key: 'gbpCalls', label: 'GBP calls', chartRef: 'gbp_overview', implication: 'Calls are direct leads — review Business Profile visibility and the locations driving the drop.' },
  { key: 'gbpBookings', label: 'GBP bookings', chartRef: 'gbp_overview', implication: 'Bookings are direct conversions — check Business Profile actions and the locations driving the drop.' },
  { key: 'organicClicks', label: 'Organic clicks', chartRef: 'search_queries', implication: 'Organic clicks feed pipeline — check which queries and pages lost ground before rankings settle.' },
  { key: 'sessions', label: 'Sessions', chartRef: 'traffic_trend', implication: 'A smaller top of funnel caps everything downstream — open the trend to see when it started and which channels moved.' },
]

const METRIC_LABELS: Record<string, string> = METRIC_META.reduce(
  (acc, m) => {
    acc[m.key] = m.label
    return acc
  },
  {} as Record<string, string>,
)

// ── Thresholds ────────────────────────────────────────────────────────────────

/** North-star decline that escalates to critical (≥ this many percent down). */
const DECLINE_CRITICAL = 25
/** North-star decline that warrants a warning (≥ this many percent down). */
const DECLINE_WARNING = 15
/** Smallest decline worth an (info) alert at all. */
const DECLINE_INFO = 8

/** A behind-pace target only alerts once the month is at least this far along. */
const GOAL_MISS_MONTH_PROGRESS = 0.6
/** ...and the metric is pacing below this fraction of its prorated target. */
const GOAL_MISS_PCT_TO_TARGET = 0.7

/** GBP average score below this is a health warning. */
const GBP_SCORE_WARNING = 60

/** Maximum alerts surfaced at once. */
const MAX_ALERTS = 6

// ── Formatting helpers (match insights.ts) ────────────────────────────────────

const MINUS = '−' // proper minus sign U+2212

/** Format a non-negative percent magnitude, e.g. 27 → "27%", 14.4 → "14.4%". */
function formatPercentMagnitude(absPercent: number): string {
  return `${absPercent.toLocaleString(undefined, { maximumFractionDigits: 1 })}%`
}

// ── Rules ─────────────────────────────────────────────────────────────────────

/** Decline severity for a north-star drop of `absPercent` percent. */
function declineSeverity(absPercent: number): AlertSeverity | null {
  if (absPercent >= DECLINE_CRITICAL) return 'critical'
  if (absPercent >= DECLINE_WARNING) return 'warning'
  if (absPercent >= DECLINE_INFO) return 'info'
  return null
}

/** North-star metric decline alerts. */
function metricDeclineAlerts(metrics: AlertMetrics): DashboardAlert[] {
  const out: DashboardAlert[] = []
  for (const meta of METRIC_META) {
    const signal = metrics[meta.key]
    const delta = signal?.delta
    // Guard non-finite / missing deltas (e.g. zero-prior divide-by-zero upstream
    // must arrive as undefined, never NaN/Infinity).
    if (typeof delta !== 'number' || !Number.isFinite(delta)) continue
    // Only declines raise alerts; growth is the insight engine's job.
    if (delta >= 0) continue

    const absPercent = Math.abs(delta)
    const severity = declineSeverity(absPercent)
    if (!severity) continue

    const magnitude = formatPercentMagnitude(absPercent)
    out.push({
      id: `metric-decline-${meta.key}`,
      severity,
      title: `${meta.label} down ${MINUS}${magnitude}`,
      // Detail ADDS the so-what + next-step rather than restating the title's
      // "<metric> down X%" (which read as a duplicate in the strip).
      detail: meta.implication,
      metric: meta.key,
      chartRef: meta.chartRef,
    })
  }
  return out
}

/** Behind-pace goal-miss alerts, gated to near month-end. */
function goalMissAlerts(pacing: PacingRow[]): DashboardAlert[] {
  const out: DashboardAlert[] = []
  for (const row of pacing) {
    if (row.status !== 'behind') continue

    const pct = row.pctToTarget
    if (typeof pct !== 'number' || !Number.isFinite(pct)) continue
    if (pct >= GOAL_MISS_PCT_TO_TARGET) continue

    // Only fire late in the month, when a behind-pace metric is unlikely to
    // recover. If monthProgress is unknown, assume it's late enough to surface.
    const progress = row.monthProgress
    if (typeof progress === 'number' && Number.isFinite(progress) && progress < GOAL_MISS_MONTH_PROGRESS) {
      continue
    }

    // Goal-miss alerts label from the pacing row's OWN label. This is where the
    // two `conversions` meanings meet: pacing's `conversions` is keyEvents-backed
    // and its row.label is "Conversions", so it stays "Conversions" here — only
    // the transactions-backed metric-DROP alert (METRIC_META) reads "Purchases".
    const label = row.label ?? METRIC_LABELS[row.metricId] ?? row.metricId
    const attained = formatPercentMagnitude(Math.max(0, pct) * 100)
    const knownMetric = (row.metricId in METRIC_LABELS ? row.metricId : undefined)
    const chartRef = METRIC_META.find((m) => m.key === row.metricId)?.chartRef ?? 'targets'

    out.push({
      id: `goal-miss-${row.metricId}`,
      severity: 'warning',
      title: `${label} behind goal`,
      detail: `${label} is at ${attained} of its pace-adjusted target and trending to miss this month.`,
      metric: knownMetric,
      chartRef,
    })
  }
  return out
}

/** Google Business Profile health alerts. */
function gbpHealthAlerts(gbp: GbpHealthSummary): DashboardAlert[] {
  const out: DashboardAlert[] = []

  const closed = gbp.closedCount
  if (typeof closed === 'number' && Number.isFinite(closed) && closed > 0) {
    const noun = closed === 1 ? 'location is' : 'locations are'
    out.push({
      id: 'gbp-closed-locations',
      severity: 'warning',
      title: `${closed} ${closed === 1 ? 'location' : 'locations'} flagged closed`,
      detail: `${closed} Business Profile ${noun} marked closed — listings flagged closed lose visibility and calls.`,
      chartRef: 'gbp_overview',
    })
  }

  const score = gbp.avgScore
  if (typeof score === 'number' && Number.isFinite(score) && score < GBP_SCORE_WARNING) {
    const missing = gbp.missingInfoCount
    const missingClause =
      typeof missing === 'number' && Number.isFinite(missing) && missing > 0
        ? ` ${missing} ${missing === 1 ? 'location is' : 'locations are'} missing required info.`
        : ''
    out.push({
      id: 'gbp-low-score',
      severity: 'warning',
      title: `GBP health score ${Math.round(score)}/100`,
      detail: `Average profile health is below ${GBP_SCORE_WARNING}.${missingClause}`,
      chartRef: 'gbp_overview',
    })
  }

  return out
}

// ── Ranking ─────────────────────────────────────────────────────────────────

const SEVERITY_RANK: Record<AlertSeverity, number> = {
  critical: 3,
  warning: 2,
  info: 1,
}

/**
 * Derive a ranked, deduped DashboardAlert[] from the assembled signals.
 * Deterministic and pure. Order: critical → warning → info, then a stable
 * source order within each severity (metric declines, then goal misses, then
 * GBP health). Deduped by `id`. Capped at MAX_ALERTS.
 */
export function deriveAlerts(input: AlertInput): DashboardAlert[] {
  const raw: DashboardAlert[] = [
    ...(input.metrics ? metricDeclineAlerts(input.metrics) : []),
    ...(input.pacing ? goalMissAlerts(input.pacing) : []),
    ...(input.gbp ? gbpHealthAlerts(input.gbp) : []),
  ]

  // Dedupe by id, keeping the first (source-ordered) occurrence.
  const seen = new Set<string>()
  const deduped: DashboardAlert[] = []
  for (const alert of raw) {
    if (seen.has(alert.id)) continue
    seen.add(alert.id)
    deduped.push(alert)
  }

  // Stable sort by severity rank (Array#sort is stable in modern engines, so
  // equal-severity alerts retain their source order). Index decorate-sort
  // keeps it deterministic regardless of engine.
  const sorted = deduped
    .map((alert, index) => ({ alert, index }))
    .sort((a, b) => {
      const sevDiff = SEVERITY_RANK[b.alert.severity] - SEVERITY_RANK[a.alert.severity]
      if (sevDiff !== 0) return sevDiff
      return a.index - b.index
    })
    .map((x) => x.alert)

  return sorted.slice(0, MAX_ALERTS)
}
