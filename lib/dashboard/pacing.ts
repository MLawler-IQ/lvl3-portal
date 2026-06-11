// Goals / targets pacing (Phase C). PURE module — no 'use server', no I/O.
//
// Given the current-period actual values, a Targets map, and how far through
// the current month we are, compute per-metric pacing: where the metric stands
// against its monthly goal and whether the run-rate puts it ahead / on-track /
// behind by month-end.

import type { Targets } from '@/lib/dashboard/types'

// ── Known target metric ids ─────────────────────────────────────────────────
// Fixed set shared with the settings form. Human labels live here so both the
// pacing rows and the form can render consistent copy.

export const TARGET_METRIC_IDS = [
  'sessions',
  'organic_clicks',
  'conversions',
  'revenue',
  'gbp_calls',
] as const

export type TargetMetricId = (typeof TARGET_METRIC_IDS)[number]

export const TARGET_METRIC_LABELS: Record<TargetMetricId, string> = {
  sessions: 'Sessions',
  organic_clicks: 'Organic Clicks',
  conversions: 'Conversions',
  revenue: 'Revenue',
  gbp_calls: 'GBP Calls',
}

// ── Result types ─────────────────────────────────────────────────────────────

export type PacingStatus = 'ahead' | 'on_track' | 'behind' | 'no_target'

export interface PacingRow {
  metricId: string
  label: string
  /** Actual value accrued so far this period. */
  actual: number
  /** Monthly goal, or null when no target is set for this metric. */
  target: number | null
  /** Progress toward the target as a fraction (actual / target). null when no target. */
  pctToTarget: number | null
  /** Run-rate projection for the full month (actual / elapsedFraction). null when no target. */
  projected: number | null
  status: PacingStatus
}

// On-track band: projected within ±5% of target counts as on_track.
const ON_TRACK_TOLERANCE = 0.05

/**
 * Fraction of the current month that has elapsed, in (0, 1]. Uses calendar days:
 * day 1 of a 30-day month → ~0.033, last day → 1. Guarded to never return 0.
 */
export function monthElapsedFraction(now: Date = new Date()): number {
  const year = now.getFullYear()
  const month = now.getMonth()
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  // Count the current day as elapsed so day-1 isn't a divide-by-near-zero spike.
  const dayOfMonth = now.getDate()
  const fraction = dayOfMonth / daysInMonth
  return Math.min(1, Math.max(fraction, 1 / daysInMonth))
}

function statusFor(projected: number, target: number): PacingStatus {
  if (target <= 0) return 'no_target'
  const ratio = projected / target
  if (ratio >= 1 + ON_TRACK_TOLERANCE) return 'ahead'
  if (ratio <= 1 - ON_TRACK_TOLERANCE) return 'behind'
  return 'on_track'
}

/**
 * Compute pacing rows for the known target metric set.
 *
 * @param actuals  Map of metric id → value accrued so far this period.
 * @param targets  clients.targets jsonb (metric id → monthly MetricTarget).
 * @param now      Reference date used to derive the month-elapsed fraction.
 *                 Defaults to the current date.
 *
 * Projected = actual / elapsedFraction (guarded against divide-by-zero).
 * A metric with no positive target is returned with status 'no_target' and
 * null target/projection fields so the UI can omit or grey it out.
 */
export function computePacing(
  actuals: Record<string, number>,
  targets: Targets,
  now: Date = new Date()
): PacingRow[] {
  const elapsed = monthElapsedFraction(now)

  return TARGET_METRIC_IDS.map((metricId) => {
    const label = TARGET_METRIC_LABELS[metricId]
    const actual = Number.isFinite(actuals[metricId]) ? actuals[metricId] : 0
    const targetValue = targets[metricId]?.value
    const hasTarget = typeof targetValue === 'number' && targetValue > 0

    if (!hasTarget) {
      return {
        metricId,
        label,
        actual,
        target: null,
        pctToTarget: null,
        projected: null,
        status: 'no_target',
      }
    }

    const target = targetValue
    // elapsed is guaranteed > 0 by monthElapsedFraction.
    const projected = actual / elapsed
    const pctToTarget = actual / target

    return {
      metricId,
      label,
      actual,
      target,
      pctToTarget,
      projected,
      status: statusFor(projected, target),
    }
  })
}
