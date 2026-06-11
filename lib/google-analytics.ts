import { google } from 'googleapis'
import type { DateRange } from './date-range'
import { buildTrendRange } from './date-range'
import type { TrendPoint } from '@/lib/dashboard/types'
import { getAdminOAuthClient } from '@/lib/google-auth'
import { cachedFetch } from '@/lib/api-cache'

const GA4_TTL_SECONDS = 6 * 3600 // GA4 data is ~24h stale; 6h cache is safe.
const rangeKey = (range?: DateRange) =>
  `${range?.startDate ?? 'def'}:${range?.endDate ?? 'def'}:${range?.compareStart ?? 'def'}:${range?.compareEnd ?? 'def'}`

export type GA4Metrics = {
  sessions: number
  users: number
  pageviews: number
  bounceRate: number
  topChannels: { channel: string; sessions: number }[]
  sessionsDelta: number
  usersDelta: number
  pageviewsDelta: number
}

export async function fetchGA4Metrics(propertyId: string, range?: DateRange): Promise<GA4Metrics> {
  return cachedFetch(`ga4:metrics:${propertyId}:${rangeKey(range)}`, GA4_TTL_SECONDS, () =>
    _fetchGA4MetricsUncached(propertyId, range),
  )
}

async function _fetchGA4MetricsUncached(propertyId: string, range?: DateRange): Promise<GA4Metrics> {
  const auth = await getAdminOAuthClient()

  const analyticsdata = google.analyticsdata({ version: 'v1beta', auth })

  let startDate: string
  let endDate: string
  let priorStart: string
  let priorEnd: string

  if (range) {
    startDate = range.startDate
    endDate = range.endDate
    priorStart = range.compareStart
    priorEnd = range.compareEnd
  } else {
    const today = new Date()
    const fmt = (d: Date) => d.toISOString().slice(0, 10)
    endDate = fmt(new Date(today.getTime() - 86400000))
    startDate = fmt(new Date(today.getTime() - 31 * 86400000))
    priorEnd = fmt(new Date(today.getTime() - 32 * 86400000))
    priorStart = fmt(new Date(today.getTime() - 61 * 86400000))
  }

  const [currentRes, priorRes, channelRes] = await Promise.all([
    analyticsdata.properties.runReport({
      property: `properties/${propertyId}`,
      requestBody: {
        dateRanges: [{ startDate, endDate }],
        metrics: [
          { name: 'sessions' },
          { name: 'totalUsers' },
          { name: 'screenPageViews' },
          { name: 'bounceRate' },
        ],
      },
    }),
    analyticsdata.properties.runReport({
      property: `properties/${propertyId}`,
      requestBody: {
        dateRanges: [{ startDate: priorStart, endDate: priorEnd }],
        metrics: [
          { name: 'sessions' },
          { name: 'totalUsers' },
          { name: 'screenPageViews' },
        ],
      },
    }),
    analyticsdata.properties.runReport({
      property: `properties/${propertyId}`,
      requestBody: {
        dateRanges: [{ startDate, endDate }],
        dimensions: [{ name: 'sessionDefaultChannelGroup' }],
        metrics: [{ name: 'sessions' }],
        orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
        limit: '5',
      },
    }),
  ])

  const cur = currentRes.data.rows?.[0]?.metricValues ?? []
  const pri = priorRes.data.rows?.[0]?.metricValues ?? []

  const sessions = parseInt(cur[0]?.value ?? '0')
  const users = parseInt(cur[1]?.value ?? '0')
  const pageviews = parseInt(cur[2]?.value ?? '0')
  const bounceRate = parseFloat(cur[3]?.value ?? '0')

  const priorSessions = parseInt(pri[0]?.value ?? '0')
  const priorUsers = parseInt(pri[1]?.value ?? '0')
  const priorPageviews = parseInt(pri[2]?.value ?? '0')

  const pct = (curr: number, prior: number) =>
    prior === 0 ? 0 : Math.round(((curr - prior) / prior) * 100)

  const topChannels = (channelRes.data.rows ?? []).map((row) => ({
    channel: row.dimensionValues?.[0]?.value ?? 'Unknown',
    sessions: parseInt(row.metricValues?.[0]?.value ?? '0'),
  }))

  return {
    sessions,
    users,
    pageviews,
    bounceRate,
    topChannels,
    sessionsDelta: pct(sessions, priorSessions),
    usersDelta: pct(users, priorUsers),
    pageviewsDelta: pct(pageviews, priorPageviews),
  }
}

// ── Dashboard report types ────────────────────────────────────────────────────

export type ChannelRow = { channel: string; sessions: number; sessionsDelta: number; purchaseRevenue: number }
export type MonthlySessionPoint = { month: string; yearMonth: string; sessions: number }
export type SourceMediumRow = { sourceMedium: string; sessions: number; users: number }
export type LandingPageRow = { page: string; sessions: number; sessionsDelta: number }

export type GA4Report = {
  sessions: number; sessionsDelta: number; compareLabel: string
  purchaseRevenue: number; purchaseRevenueDelta: number
  transactions: number; transactionsDelta: number
  topChannels: ChannelRow[]
  monthlyTrend: MonthlySessionPoint[]
  topSourceMediums: SourceMediumRow[]
  organicSessions: number; organicSessionsDelta: number
  organicUsers: number; organicUsersDelta: number
  organicTransactions: number; organicTransactionsDelta: number
  deviceBreakdown: { mobile: number; desktop: number; tablet: number }
  organicLandingPages: LandingPageRow[]
}

export async function fetchGA4Report(propertyId: string, range?: DateRange): Promise<GA4Report> {
  return cachedFetch(`ga4:report:${propertyId}:${rangeKey(range)}`, GA4_TTL_SECONDS, () =>
    _fetchGA4ReportUncached(propertyId, range),
  )
}

async function _fetchGA4ReportUncached(propertyId: string, range?: DateRange): Promise<GA4Report> {
  const auth = await getAdminOAuthClient()
  const analyticsdata = google.analyticsdata({ version: 'v1beta', auth })

  const today = new Date()
  const fmt = (d: Date) => d.toISOString().slice(0, 10)

  let startDate: string
  let endDate: string
  let priorStart: string
  let priorEnd: string
  let compareLabel: string

  if (range) {
    startDate = range.startDate
    endDate = range.endDate
    priorStart = range.compareStart
    priorEnd = range.compareEnd
    compareLabel = range.compareLabel
  } else {
    endDate = fmt(new Date(today.getTime() - 86400000))
    startDate = fmt(new Date(today.getTime() - 29 * 86400000))
    priorEnd = fmt(new Date(today.getTime() - 30 * 86400000))
    priorStart = fmt(new Date(today.getTime() - 57 * 86400000))
    compareLabel = 'vs. prior 28 days'
  }

  const firstOfCurrentMonth = new Date(today.getFullYear(), today.getMonth(), 1)
  const monthlyEnd = fmt(new Date(firstOfCurrentMonth.getTime() - 86400000))
  const monthlyStart = fmt(new Date(today.getFullYear(), today.getMonth() - 6, 1))

  const prop = `properties/${propertyId}`
  const organicFilter = {
    filter: {
      fieldName: 'sessionDefaultChannelGroup',
      stringFilter: { matchType: 'EXACT', value: 'Organic Search' },
    },
  }

  const [r1, r2, r4cur, r4pri, r5, r6, r7cur, r7pri, r8cur, r8pri] = await Promise.allSettled([
    // 1: overall current
    analyticsdata.properties.runReport({
      property: prop,
      requestBody: {
        dateRanges: [{ startDate, endDate }],
        metrics: [{ name: 'sessions' }, { name: 'purchaseRevenue' }, { name: 'transactions' }],
      },
    }),
    // 2: overall prior/compare
    analyticsdata.properties.runReport({
      property: prop,
      requestBody: {
        dateRanges: [{ startDate: priorStart, endDate: priorEnd }],
        metrics: [{ name: 'sessions' }, { name: 'purchaseRevenue' }, { name: 'transactions' }],
      },
    }),
    // 4cur: channels current
    analyticsdata.properties.runReport({
      property: prop,
      requestBody: {
        dateRanges: [{ startDate, endDate }],
        dimensions: [{ name: 'sessionDefaultChannelGroup' }],
        metrics: [{ name: 'sessions' }, { name: 'purchaseRevenue' }],
        orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
        limit: '20',
      },
    }),
    // 4pri: channels prior
    analyticsdata.properties.runReport({
      property: prop,
      requestBody: {
        dateRanges: [{ startDate: priorStart, endDate: priorEnd }],
        dimensions: [{ name: 'sessionDefaultChannelGroup' }],
        metrics: [{ name: 'sessions' }],
        limit: '20',
      },
    }),
    // 5: monthly trend (fixed 6-month window)
    analyticsdata.properties.runReport({
      property: prop,
      requestBody: {
        dateRanges: [{ startDate: monthlyStart, endDate: monthlyEnd }],
        dimensions: [{ name: 'yearMonth' }],
        metrics: [{ name: 'sessions' }],
        orderBys: [{ dimension: { dimensionName: 'yearMonth' }, desc: false }],
      },
    }),
    // 6: source/medium current
    analyticsdata.properties.runReport({
      property: prop,
      requestBody: {
        dateRanges: [{ startDate, endDate }],
        dimensions: [{ name: 'sessionSourceMedium' }],
        metrics: [{ name: 'sessions' }, { name: 'totalUsers' }],
        orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
        limit: '25',
      },
    }),
    // 7cur: organic device current
    analyticsdata.properties.runReport({
      property: prop,
      requestBody: {
        dateRanges: [{ startDate, endDate }],
        dimensions: [{ name: 'deviceCategory' }],
        metrics: [{ name: 'sessions' }, { name: 'totalUsers' }, { name: 'transactions' }],
        dimensionFilter: organicFilter,
      },
    }),
    // 7pri: organic device prior
    analyticsdata.properties.runReport({
      property: prop,
      requestBody: {
        dateRanges: [{ startDate: priorStart, endDate: priorEnd }],
        dimensions: [{ name: 'deviceCategory' }],
        metrics: [{ name: 'sessions' }, { name: 'totalUsers' }, { name: 'transactions' }],
        dimensionFilter: organicFilter,
      },
    }),
    // 8cur: organic landing pages current
    analyticsdata.properties.runReport({
      property: prop,
      requestBody: {
        dateRanges: [{ startDate, endDate }],
        dimensions: [{ name: 'landingPagePlusQueryString' }],
        metrics: [{ name: 'sessions' }],
        dimensionFilter: organicFilter,
        orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
        limit: '25',
      },
    }),
    // 8pri: organic landing pages prior (for delta)
    analyticsdata.properties.runReport({
      property: prop,
      requestBody: {
        dateRanges: [{ startDate: priorStart, endDate: priorEnd }],
        dimensions: [{ name: 'landingPagePlusQueryString' }],
        metrics: [{ name: 'sessions' }],
        dimensionFilter: organicFilter,
        limit: '50',
      },
    }),
  ])

  const pct = (curr: number, prior: number) =>
    prior === 0 ? 0 : Math.round(((curr - prior) / prior) * 100)

  // Overall metrics
  const cur1 = r1.status === 'fulfilled' ? (r1.value.data.rows?.[0]?.metricValues ?? []) : []
  const cur2 = r2.status === 'fulfilled' ? (r2.value.data.rows?.[0]?.metricValues ?? []) : []

  const sessions = parseInt(cur1[0]?.value ?? '0')
  const purchaseRevenue = parseFloat(cur1[1]?.value ?? '0')
  const transactions = parseInt(cur1[2]?.value ?? '0')
  const priorSessions = parseInt(cur2[0]?.value ?? '0')
  const priorRevenue = parseFloat(cur2[1]?.value ?? '0')
  const priorTransactions = parseInt(cur2[2]?.value ?? '0')

  // Channels
  const channelPriorMap = new Map<string, number>()
  if (r4pri.status === 'fulfilled') {
    for (const row of r4pri.value.data.rows ?? []) {
      channelPriorMap.set(
        row.dimensionValues?.[0]?.value ?? '',
        parseInt(row.metricValues?.[0]?.value ?? '0')
      )
    }
  }
  const topChannels: ChannelRow[] = []
  if (r4cur.status === 'fulfilled') {
    for (const row of r4cur.value.data.rows ?? []) {
      const channel = row.dimensionValues?.[0]?.value ?? ''
      const s = parseInt(row.metricValues?.[0]?.value ?? '0')
      const rev = parseFloat(row.metricValues?.[1]?.value ?? '0')
      topChannels.push({
        channel,
        sessions: s,
        sessionsDelta: pct(s, channelPriorMap.get(channel) ?? 0),
        purchaseRevenue: rev,
      })
    }
  }

  // Monthly trend
  const monthlyTrend: MonthlySessionPoint[] = []
  if (r5.status === 'fulfilled') {
    for (const row of r5.value.data.rows ?? []) {
      const ym = row.dimensionValues?.[0]?.value ?? ''
      const s = parseInt(row.metricValues?.[0]?.value ?? '0')
      if (ym.length === 6) {
        const yr = parseInt(ym.slice(0, 4))
        const mo = parseInt(ym.slice(4, 6)) - 1
        monthlyTrend.push({ month: new Date(yr, mo, 1).toLocaleString('en-US', { month: 'short' }), yearMonth: ym, sessions: s })
      }
    }
  }

  // Source/medium
  const topSourceMediums: SourceMediumRow[] = []
  if (r6.status === 'fulfilled') {
    for (const row of r6.value.data.rows ?? []) {
      topSourceMediums.push({
        sourceMedium: row.dimensionValues?.[0]?.value ?? '',
        sessions: parseInt(row.metricValues?.[0]?.value ?? '0'),
        users: parseInt(row.metricValues?.[1]?.value ?? '0'),
      })
    }
  }

  // Organic device breakdown
  type DeviceMap = Map<string, { sessions: number; users: number; transactions: number }>
  const buildDeviceMap = (result: typeof r7cur): DeviceMap => {
    const map: DeviceMap = new Map()
    if (result.status !== 'fulfilled') return map
    for (const row of result.value.data.rows ?? []) {
      const dev = (row.dimensionValues?.[0]?.value ?? '').toLowerCase()
      map.set(dev, {
        sessions: parseInt(row.metricValues?.[0]?.value ?? '0'),
        users: parseInt(row.metricValues?.[1]?.value ?? '0'),
        transactions: parseInt(row.metricValues?.[2]?.value ?? '0'),
      })
    }
    return map
  }
  const deviceCur = buildDeviceMap(r7cur)
  const devicePri = buildDeviceMap(r7pri)

  const organicSessions = Array.from(deviceCur.values()).reduce((s, v) => s + v.sessions, 0)
  const organicUsers = Array.from(deviceCur.values()).reduce((s, v) => s + v.users, 0)
  const organicTransactions = Array.from(deviceCur.values()).reduce((s, v) => s + v.transactions, 0)
  const priorOrganicSessions = Array.from(devicePri.values()).reduce((s, v) => s + v.sessions, 0)
  const priorOrganicUsers = Array.from(devicePri.values()).reduce((s, v) => s + v.users, 0)
  const priorOrganicTransactions = Array.from(devicePri.values()).reduce((s, v) => s + v.transactions, 0)

  const deviceBreakdown = {
    mobile: deviceCur.get('mobile')?.sessions ?? 0,
    desktop: deviceCur.get('desktop')?.sessions ?? 0,
    tablet: deviceCur.get('tablet')?.sessions ?? 0,
  }

  // Organic landing pages
  const lpPriorMap = new Map<string, number>()
  if (r8pri.status === 'fulfilled') {
    for (const row of r8pri.value.data.rows ?? []) {
      lpPriorMap.set(row.dimensionValues?.[0]?.value ?? '', parseInt(row.metricValues?.[0]?.value ?? '0'))
    }
  }
  const organicLandingPages: LandingPageRow[] = []
  if (r8cur.status === 'fulfilled') {
    for (const row of r8cur.value.data.rows ?? []) {
      const page = row.dimensionValues?.[0]?.value ?? ''
      const s = parseInt(row.metricValues?.[0]?.value ?? '0')
      organicLandingPages.push({ page, sessions: s, sessionsDelta: pct(s, lpPriorMap.get(page) ?? 0) })
    }
  }

  return {
    sessions, sessionsDelta: pct(sessions, priorSessions), compareLabel,
    purchaseRevenue, purchaseRevenueDelta: pct(purchaseRevenue, priorRevenue),
    transactions, transactionsDelta: pct(transactions, priorTransactions),
    topChannels, monthlyTrend, topSourceMediums,
    organicSessions, organicSessionsDelta: pct(organicSessions, priorOrganicSessions),
    organicUsers, organicUsersDelta: pct(organicUsers, priorOrganicUsers),
    organicTransactions, organicTransactionsDelta: pct(organicTransactions, priorOrganicTransactions),
    deviceBreakdown, organicLandingPages,
  }
}

// ── Period-aware traffic trend ────────────────────────────────────────────────
// Replaces the legacy hardcoded 6-month monthlyTrend for chart consumers that
// want a trend that follows the selected KPI period. Buckets sessions at the
// granularity chosen by buildTrendRange, and aligns the comparison window by
// bucket index so the ghost-overlay series lines up 1:1 with the current series.

/** Convert YYYYMMDD (GA4 `date` dimension) → YYYY-MM-DD. */
function ga4DateToIso(d: string): string {
  return d.length === 8 ? `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}` : d
}

/** ISO-week key (YYYY-Www) for a YYYY-MM-DD date string, in UTC. */
function isoWeekKey(iso: string): string {
  const dt = new Date(`${iso}T00:00:00Z`)
  // Shift to Thursday of the current week (ISO weeks belong to the year of their Thursday).
  const day = (dt.getUTCDay() + 6) % 7 // Mon=0..Sun=6
  dt.setUTCDate(dt.getUTCDate() - day + 3)
  const thursday = new Date(dt.getTime())
  const firstThursday = new Date(Date.UTC(thursday.getUTCFullYear(), 0, 4))
  const firstDay = (firstThursday.getUTCDay() + 6) % 7
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDay + 3)
  const week = 1 + Math.round((thursday.getTime() - firstThursday.getTime()) / (7 * 86400000))
  return `${thursday.getUTCFullYear()}-W${String(week).padStart(2, '0')}`
}

type Granularity = 'daily' | 'weekly' | 'monthly'

/**
 * Roll the GA4 `date`-dimension rows of one window into ordered buckets.
 * Returns buckets sorted ascending by their natural key; each bucket carries the
 * date label used as TrendPoint.date and the summed sessions.
 */
/** Bucket key for an ISO (YYYY-MM-DD) date at the given granularity. */
function bucketKeyForIso(iso: string, granularity: Granularity): string {
  if (granularity === 'monthly') return iso.slice(0, 7) // YYYY-MM
  if (granularity === 'weekly') return isoWeekKey(iso)
  return iso // daily
}

/** Monday (UTC) of the week containing `iso`, as YYYY-MM-DD — the weekly chart label. */
function weekMondayIso(iso: string): string {
  const dt = new Date(`${iso}T00:00:00Z`)
  const day = (dt.getUTCDay() + 6) % 7
  dt.setUTCDate(dt.getUTCDate() - day)
  return dt.toISOString().slice(0, 10)
}

function addDaysIso(iso: string, n: number): string {
  const dt = new Date(`${iso}T00:00:00Z`)
  dt.setUTCDate(dt.getUTCDate() + n)
  return dt.toISOString().slice(0, 10)
}

function daysBetweenIso(fromIso: string, toIso: string): number {
  return Math.round((Date.parse(`${toIso}T00:00:00Z`) - Date.parse(`${fromIso}T00:00:00Z`)) / 86400000)
}

function bucketSessions(
  rows: Array<{ date: string; sessions: number }>,
  granularity: Granularity,
): Array<{ key: string; date: string; value: number }> {
  const map = new Map<string, { date: string; value: number }>()
  for (const r of rows) {
    const iso = ga4DateToIso(r.date)
    const key = bucketKeyForIso(iso, granularity)
    const label =
      granularity === 'weekly' ? weekMondayIso(iso) : granularity === 'monthly' ? key : iso
    const existing = map.get(key)
    if (existing) {
      existing.value += r.sessions
    } else {
      map.set(key, { date: label, value: r.sessions })
    }
  }
  return Array.from(map.entries())
    .map(([key, v]) => ({ key, date: v.date, value: v.value }))
    .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
}

export async function fetchGA4Trend(
  propertyId: string,
  period = '28d',
  compare = 'prior',
): Promise<TrendPoint[]> {
  return cachedFetch(
    `ga4:trend:${propertyId}:${period}:${compare}`,
    GA4_TTL_SECONDS,
    () => _fetchGA4TrendUncached(propertyId, period, compare),
  )
}

async function _fetchGA4TrendUncached(
  propertyId: string,
  period: string,
  compare: string,
): Promise<TrendPoint[]> {
  const auth = await getAdminOAuthClient()
  const analyticsdata = google.analyticsdata({ version: 'v1beta', auth })
  const prop = `properties/${propertyId}`

  const { startDate, endDate, granularity, compareStart, compareEnd } = buildTrendRange(period, compare)

  // Always query the `date` dimension and bucket in JS — this keeps weekly ISO
  // bucketing consistent and lets us align current vs. compare by bucket index.
  const dateReport = (sd: string, ed: string) =>
    analyticsdata.properties.runReport({
      property: prop,
      requestBody: {
        dateRanges: [{ startDate: sd, endDate: ed }],
        dimensions: [{ name: 'date' }],
        metrics: [{ name: 'sessions' }],
        orderBys: [{ dimension: { dimensionName: 'date' }, desc: false }],
        limit: '1000',
      },
    })

  const [curRes, cmpRes] = await Promise.allSettled([
    dateReport(startDate, endDate),
    dateReport(compareStart, compareEnd),
  ])

  // Don't cache a degraded (empty) trend if the primary window failed — let it retry.
  if (curRes.status !== 'fulfilled') throw curRes.reason

  const toRows = (res: typeof curRes) => {
    if (res.status !== 'fulfilled') return [] as Array<{ date: string; sessions: number }>
    return (res.value.data.rows ?? []).map((row) => ({
      date: row.dimensionValues?.[0]?.value ?? '',
      sessions: parseInt(row.metricValues?.[0]?.value ?? '0'),
    }))
  }

  const curBuckets = bucketSessions(toRows(curRes), granularity)

  // Align the comparison series by shifting its dates forward onto the current
  // window's calendar, then bucketing with the SAME keys — robust for weekly /
  // monthly granularity where the two windows aren't week/month aligned.
  const offsetDays = daysBetweenIso(compareStart, startDate)
  const cmpByKey = new Map<string, number>()
  if (cmpRes.status === 'fulfilled') {
    for (const r of toRows(cmpRes)) {
      const key = bucketKeyForIso(addDaysIso(ga4DateToIso(r.date), offsetDays), granularity)
      cmpByKey.set(key, (cmpByKey.get(key) ?? 0) + r.sessions)
    }
  }

  return curBuckets.map((b) => {
    const cmp = cmpByKey.get(b.key)
    const point: TrendPoint = { date: b.date, value: b.value }
    if (cmp !== undefined) point.compareValue = cmp
    return point
  })
}

// ── Ecommerce funnel ──────────────────────────────────────────────────────────
// itemsViewed → addToCarts → checkouts → ecommercePurchases, with period-over-
// period deltas. Metric apiNames match GA4 Data API v1beta exactly.

export type GA4EcomFunnel = {
  itemsViewed: number
  addToCarts: number
  checkouts: number
  purchases: number
  itemsViewedDelta: number
  addToCartsDelta: number
  checkoutsDelta: number
  purchasesDelta: number
}

export async function fetchGA4EcomFunnel(propertyId: string, range?: DateRange): Promise<GA4EcomFunnel> {
  return cachedFetch(`ga4:ecomFunnel:${propertyId}:${rangeKey(range)}`, GA4_TTL_SECONDS, () =>
    _fetchGA4EcomFunnelUncached(propertyId, range),
  )
}

async function _fetchGA4EcomFunnelUncached(propertyId: string, range?: DateRange): Promise<GA4EcomFunnel> {
  const auth = await getAdminOAuthClient()
  const analyticsdata = google.analyticsdata({ version: 'v1beta', auth })
  const prop = `properties/${propertyId}`

  const today = new Date()
  const fmt = (d: Date) => d.toISOString().slice(0, 10)

  let startDate: string, endDate: string, priorStart: string, priorEnd: string
  if (range) {
    startDate = range.startDate
    endDate = range.endDate
    priorStart = range.compareStart
    priorEnd = range.compareEnd
  } else {
    endDate = fmt(new Date(today.getTime() - 86400000))
    startDate = fmt(new Date(today.getTime() - 29 * 86400000))
    priorEnd = fmt(new Date(today.getTime() - 30 * 86400000))
    priorStart = fmt(new Date(today.getTime() - 57 * 86400000))
  }

  const funnelMetrics = [
    { name: 'itemsViewed' },
    { name: 'addToCarts' },
    { name: 'checkouts' },
    { name: 'ecommercePurchases' },
  ]

  const [curRes, priRes] = await Promise.allSettled([
    analyticsdata.properties.runReport({
      property: prop,
      requestBody: { dateRanges: [{ startDate, endDate }], metrics: funnelMetrics },
    }),
    analyticsdata.properties.runReport({
      property: prop,
      requestBody: { dateRanges: [{ startDate: priorStart, endDate: priorEnd }], metrics: funnelMetrics },
    }),
  ])

  const cur = curRes.status === 'fulfilled' ? (curRes.value.data.rows?.[0]?.metricValues ?? []) : []
  const pri = priRes.status === 'fulfilled' ? (priRes.value.data.rows?.[0]?.metricValues ?? []) : []

  const num = (vals: typeof cur, i: number) => parseInt(vals[i]?.value ?? '0')
  const pct = (curr: number, prior: number) =>
    prior === 0 ? 0 : Math.round(((curr - prior) / prior) * 100)

  const itemsViewed = num(cur, 0)
  const addToCarts = num(cur, 1)
  const checkouts = num(cur, 2)
  const purchases = num(cur, 3)

  return {
    itemsViewed,
    addToCarts,
    checkouts,
    purchases,
    itemsViewedDelta: pct(itemsViewed, num(pri, 0)),
    addToCartsDelta: pct(addToCarts, num(pri, 1)),
    checkoutsDelta: pct(checkouts, num(pri, 2)),
    purchasesDelta: pct(purchases, num(pri, 3)),
  }
}

// ── Top products ──────────────────────────────────────────────────────────────
// Top 10 products by item revenue (dimension itemName).

export type GA4TopProduct = {
  itemName: string
  itemRevenue: number
  itemsPurchased: number
}

export async function fetchGA4TopProducts(propertyId: string, range?: DateRange): Promise<GA4TopProduct[]> {
  return cachedFetch(`ga4:topProducts:${propertyId}:${rangeKey(range)}`, GA4_TTL_SECONDS, () =>
    _fetchGA4TopProductsUncached(propertyId, range),
  )
}

async function _fetchGA4TopProductsUncached(propertyId: string, range?: DateRange): Promise<GA4TopProduct[]> {
  const auth = await getAdminOAuthClient()
  const analyticsdata = google.analyticsdata({ version: 'v1beta', auth })
  const prop = `properties/${propertyId}`

  const today = new Date()
  const fmt = (d: Date) => d.toISOString().slice(0, 10)

  let startDate: string, endDate: string
  if (range) {
    startDate = range.startDate
    endDate = range.endDate
  } else {
    endDate = fmt(new Date(today.getTime() - 86400000))
    startDate = fmt(new Date(today.getTime() - 29 * 86400000))
  }

  const res = await analyticsdata.properties.runReport({
    property: prop,
    requestBody: {
      dateRanges: [{ startDate, endDate }],
      dimensions: [{ name: 'itemName' }],
      metrics: [{ name: 'itemRevenue' }, { name: 'itemsPurchased' }],
      orderBys: [{ metric: { metricName: 'itemRevenue' }, desc: true }],
      limit: '10',
    },
  })

  return (res.data.rows ?? []).map((row) => ({
    itemName: row.dimensionValues?.[0]?.value ?? '(not set)',
    itemRevenue: parseFloat(row.metricValues?.[0]?.value ?? '0'),
    itemsPurchased: parseInt(row.metricValues?.[1]?.value ?? '0'),
  }))
}
