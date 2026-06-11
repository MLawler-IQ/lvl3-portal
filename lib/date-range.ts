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

// ── Calendar presets (Phase B6) ─────────────────────────────────────────────
// Calendar-aligned windows (month/quarter boundaries) that live alongside the
// rolling periods above. They are *not* in PERIOD_DAYS — buildDateRange branches
// on these keys first, then falls back to the rolling-period path.

export const CALENDAR_PERIODS = ['last_full_month', 'mtd', 'qtd'] as const
export type CalendarPeriod = (typeof CALENDAR_PERIODS)[number]

const CALENDAR_LABELS: Record<CalendarPeriod, string> = {
  last_full_month: 'Last full month',
  mtd: 'Month to date',
  qtd: 'Quarter to date',
}

/** Iterable list for the UI period selector. */
export const CALENDAR_PRESETS: { value: CalendarPeriod; label: string }[] =
  CALENDAR_PERIODS.map((value) => ({ value, label: CALENDAR_LABELS[value] }))

function isCalendarPeriod(period: string): period is CalendarPeriod {
  return (CALENDAR_PERIODS as readonly string[]).includes(period)
}

// UTC date helpers — formatting elsewhere uses toISOString().slice(0,10), so all
// calendar math is done in UTC to stay consistent and DST-safe.
const fmtUTC = (d: Date) => d.toISOString().slice(0, 10)
const utc = (y: number, m: number, day: number) => new Date(Date.UTC(y, m, day))
/** Whole days between two UTC midnights (b − a), inclusive count = +1. */
const dayDiff = (a: Date, b: Date) =>
  Math.round((b.getTime() - a.getTime()) / 86400000)
/** Quarter index (0–3) for a 0-based month. */
const quarterOf = (month: number) => Math.floor(month / 3)

/**
 * Compute a calendar-aligned DateRange. `now` is the current instant; the public
 * endDate convention is "yesterday", so windows are anchored to yesterday (in UTC).
 */
function buildCalendarRange(period: CalendarPeriod, compare: string, now: Date): DateRange {
  // Yesterday (UTC) — the inclusive upper bound for any "to date" window.
  const y = new Date(now.getTime() - 86400000)
  const yYear = y.getUTCFullYear()
  const yMonth = y.getUTCMonth()
  const yDay = y.getUTCDate()

  let startDate: string
  let endDate: string
  let compareStart: string
  let compareEnd: string
  const label = CALENDAR_LABELS[period]
  let compareLabel: string

  if (period === 'last_full_month') {
    // The most recent fully-completed calendar month, relative to *today*.
    const tYear = now.getUTCFullYear()
    const tMonth = now.getUTCMonth()
    // First day of current month; the prior month is the last full month.
    const start = utc(tYear, tMonth - 1, 1) // normalizes Jan→Dec of prior year
    const sYear = start.getUTCFullYear()
    const sMonth = start.getUTCMonth()
    const end = utc(sYear, sMonth + 1, 0) // last day of that month
    startDate = fmtUTC(start)
    endDate = fmtUTC(end)

    if (compare === 'yoy') {
      const cStart = utc(sYear - 1, sMonth, 1)
      const cEnd = utc(sYear - 1, sMonth + 1, 0)
      compareStart = fmtUTC(cStart)
      compareEnd = fmtUTC(cEnd)
      compareLabel = 'vs. prior year'
    } else {
      const cStart = utc(sYear, sMonth - 1, 1)
      const cEnd = utc(sYear, sMonth, 0) // last day of the month before
      compareStart = fmtUTC(cStart)
      compareEnd = fmtUTC(cEnd)
      compareLabel = 'vs. prior month'
    }
  } else if (period === 'mtd') {
    // Month-to-date: 1st of yesterday's month → yesterday.
    const start = utc(yYear, yMonth, 1)
    const end = utc(yYear, yMonth, yDay)
    startDate = fmtUTC(start)
    endDate = fmtUTC(end)
    const len = dayDiff(start, end) // inclusive length − 1; same offset reused below

    if (compare === 'yoy') {
      const cStart = utc(yYear - 1, yMonth, 1)
      const cEnd = utc(yYear - 1, yMonth, 1 + len)
      compareStart = fmtUTC(cStart)
      compareEnd = fmtUTC(cEnd)
      compareLabel = 'vs. prior year'
    } else {
      // Same-length window in the prior month, anchored to its 1st.
      const cStart = utc(yYear, yMonth - 1, 1)
      const cEnd = utc(cStart.getUTCFullYear(), cStart.getUTCMonth(), 1 + len)
      compareStart = fmtUTC(cStart)
      compareEnd = fmtUTC(cEnd)
      compareLabel = 'vs. prior month to date'
    }
  } else {
    // qtd — Quarter-to-date: 1st of yesterday's quarter → yesterday.
    const q = quarterOf(yMonth)
    const qStartMonth = q * 3
    const start = utc(yYear, qStartMonth, 1)
    const end = utc(yYear, yMonth, yDay)
    startDate = fmtUTC(start)
    endDate = fmtUTC(end)
    const len = dayDiff(start, end)

    if (compare === 'yoy') {
      const cStart = utc(yYear - 1, qStartMonth, 1)
      const cEnd = utc(cStart.getUTCFullYear(), cStart.getUTCMonth(), 1 + len)
      compareStart = fmtUTC(cStart)
      compareEnd = fmtUTC(cEnd)
      compareLabel = 'vs. prior year'
    } else {
      // Same-length window in the prior quarter, anchored to its 1st.
      const cStart = utc(yYear, qStartMonth - 3, 1)
      const cEnd = utc(cStart.getUTCFullYear(), cStart.getUTCMonth(), 1 + len)
      compareStart = fmtUTC(cStart)
      compareEnd = fmtUTC(cEnd)
      compareLabel = 'vs. prior quarter to date'
    }
  }

  return { startDate, endDate, compareStart, compareEnd, label, compareLabel, period, compare }
}

export function buildDateRange(period = '28d', compare = 'prior'): DateRange {
  if (isCalendarPeriod(period)) {
    return buildCalendarRange(period, compare, new Date())
  }

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
    // Calendar presets:
    case 'last_full_month':
    case 'mtd':
      return 'daily'
    case 'qtd':
      return 'weekly'
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
