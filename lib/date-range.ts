export type DateRange = {
  startDate: string
  endDate: string
  compareStart: string
  compareEnd: string
  label: string
  compareLabel: string
  period: string
  compare: string
}

const PERIOD_DAYS: Record<string, number> = {
  '7d': 7,
  '28d': 28,
  '90d': 90,
  '180d': 180,
  '365d': 365,
}

const PERIOD_LABELS: Record<string, string> = {
  '7d': 'Last 7 days',
  '28d': 'Last 28 days',
  '90d': 'Last 3 months',
  '180d': 'Last 6 months',
  '365d': 'Last 12 months',
}

const PERIOD_SHORT: Record<string, string> = {
  '7d': '7 days',
  '28d': '28 days',
  '90d': '3 months',
  '180d': '6 months',
  '365d': '12 months',
}

export function buildDateRange(period = '28d', compare = 'prior'): DateRange {
  const days = PERIOD_DAYS[period] ?? 28
  const fmt = (d: Date) => d.toISOString().slice(0, 10)

  const today = new Date()
  // endDate = yesterday
  const endDate = fmt(new Date(today.getTime() - 86400000))
  // startDate = today − days (inclusive window of `days` days ending yesterday)
  const startDate = fmt(new Date(today.getTime() - days * 86400000))

  let compareStart: string
  let compareEnd: string
  let compareLabel: string

  if (compare === 'yoy') {
    compareEnd = fmt(new Date(today.getTime() - 365 * 86400000 - 86400000))
    compareStart = fmt(new Date(today.getTime() - 365 * 86400000 - days * 86400000))
    compareLabel = `vs. prior year`
  } else {
    // prior: immediately preceding equal-length window (no gap)
    compareEnd = fmt(new Date(today.getTime() - (days + 1) * 86400000))
    compareStart = fmt(new Date(today.getTime() - (days * 2) * 86400000))
    compareLabel = `vs. prior ${PERIOD_SHORT[period] ?? `${days} days`}`
  }

  return {
    startDate,
    endDate,
    compareStart,
    compareEnd,
    label: PERIOD_LABELS[period] ?? `Last ${days} days`,
    compareLabel,
    period,
    compare,
  }
}

// ── Period-aware trends (Phase A) ───────────────────────────────────────────
// Replaces the legacy hardcoded 6-month trend: the trend window follows the
// selected KPI period, with a bucket size chosen by pickGranularity.

export type Granularity = 'daily' | 'weekly' | 'monthly'

/** Choose a sensible trend bucket size for a KPI period. */
export function pickGranularity(period = '28d'): Granularity {
  switch (period) {
    case '7d':
    case '28d':
      return 'daily'
    case '90d':
    case '180d':
      return 'weekly'
    case '365d':
      return 'monthly'
    default:
      return (PERIOD_DAYS[period] ?? 28) > 120 ? 'monthly' : 'daily'
  }
}

export type TrendRange = {
  startDate: string
  endDate: string
  granularity: Granularity
  /** Comparison window aligned to the trend, for the ghost-overlay series. */
  compareStart: string
  compareEnd: string
}

/**
 * Window to query for a period-aware trend chart. Covers the selected `period`
 * ending yesterday at the granularity from pickGranularity, plus an aligned
 * prior/YoY window for the ghost-overlay comparison series. Date math is reused
 * from buildDateRange so the trend and KPI windows always agree.
 */
export function buildTrendRange(period = '28d', compare = 'prior'): TrendRange {
  const base = buildDateRange(period, compare)
  return {
    startDate: base.startDate,
    endDate: base.endDate,
    granularity: pickGranularity(period),
    compareStart: base.compareStart,
    compareEnd: base.compareEnd,
  }
}
