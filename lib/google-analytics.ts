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
export type SourceMediumRow = { sourceMedium: string; sessions: number; users: number }
export type LandingPageRow = { page: string; sessions: number; sessionsDelta: number }

export type GA4Report = {
  sessions: number; sessionsDelta: number; compareLabel: string
  purchaseRevenue: number; purchaseRevenueDelta: number
  transactions: number; transactionsDelta: number
  topChannels: ChannelRow[]
  topSourceMediums: SourceMediumRow[]
  organicSessions: number; organicSessionsDelta: number
  organicUsers: number; organicUsersDelta: number
  organicTransactions: number; organicTransactionsDelta: number
  deviceBreakdown: { mobile: number; desktop: number; tablet: number }
  organicLandingPages: LandingPageRow[]
}

/**
 * Shopify web-pixel sandbox paths (`/wpm@…`, `/web-pixels@…`, `web-pixels-manager`)
 * show up as GA4 landing pages but are tracking infrastructure, not real pages.
 * Kept deliberately tight so real pages are never blocked.
 */
export function isJunkLandingPage(page: string): boolean {
  return (
    page.includes('/wpm@') ||
    page.includes('/web-pixels@') ||
    page.includes('web-pixels-manager')
  )
}

export async function fetchGA4Report(propertyId: string, range?: DateRange): Promise<GA4Report> {
  // v2: junk landing-page filtering — invalidates caches that still carry pixel paths.
  return cachedFetch(`ga4:report:v2:${propertyId}:${rangeKey(range)}`, GA4_TTL_SECONDS, () =>
    _fetchGA4ReportUncached(propertyId, range),
  )
}

export type GA4PacingTotals = { sessions: number; conversions: number; revenue: number }

/**
 * Compact totals for goal pacing over a window: sessions, key-events
 * (conversions — works for lead-gen, not just ecommerce), and purchase revenue.
 * One runReport, cached.
 */
export async function fetchGA4PacingTotals(propertyId: string, range?: DateRange): Promise<GA4PacingTotals> {
  return cachedFetch(`ga4:pacingTotals:${propertyId}:${rangeKey(range)}`, GA4_TTL_SECONDS, async () => {
    const auth = await getAdminOAuthClient()
    const analyticsdata = google.analyticsdata({ version: 'v1beta', auth })
    const today = new Date()
    const fmt = (d: Date) => d.toISOString().slice(0, 10)
    const startDate = range?.startDate ?? fmt(new Date(today.getTime() - 29 * 86400000))
    const endDate = range?.endDate ?? fmt(new Date(today.getTime() - 86400000))
    const res = await analyticsdata.properties.runReport({
      property: `properties/${propertyId}`,
      requestBody: {
        dateRanges: [{ startDate, endDate }],
        metrics: [{ name: 'sessions' }, { name: 'keyEvents' }, { name: 'purchaseRevenue' }],
      },
    })
    const m = res.data.rows?.[0]?.metricValues ?? []
    return {
      sessions: parseInt(m[0]?.value ?? '0'),
      conversions: parseFloat(m[1]?.value ?? '0'),
      revenue: parseFloat(m[2]?.value ?? '0'),
    }
  })
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

  const prop = `properties/${propertyId}`
  const organicFilter = {
    filter: {
      fieldName: 'sessionDefaultChannelGroup',
      stringFilter: { matchType: 'EXACT', value: 'Organic Search' },
    },
  }

  const [r1, r2, r4cur, r4pri, r6, r7cur, r7pri, r8cur, r8pri] = await Promise.allSettled([
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
    // 8cur: organic landing pages current — over-fetch 50 so 25 clean rows
    // survive the junk-page filter below.
    analyticsdata.properties.runReport({
      property: prop,
      requestBody: {
        dateRanges: [{ startDate, endDate }],
        dimensions: [{ name: 'landingPagePlusQueryString' }],
        metrics: [{ name: 'sessions' }],
        dimensionFilter: organicFilter,
        orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
        limit: '50',
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
        limit: '100',
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
      if (organicLandingPages.length >= 25) break
      const page = row.dimensionValues?.[0]?.value ?? ''
      if (isJunkLandingPage(page)) continue // Shopify pixel paths, not real pages
      const s = parseInt(row.metricValues?.[0]?.value ?? '0')
      organicLandingPages.push({ page, sessions: s, sessionsDelta: pct(s, lpPriorMap.get(page) ?? 0) })
    }
  }

  return {
    sessions, sessionsDelta: pct(sessions, priorSessions), compareLabel,
    purchaseRevenue, purchaseRevenueDelta: pct(purchaseRevenue, priorRevenue),
    transactions, transactionsDelta: pct(transactions, priorTransactions),
    topChannels, topSourceMediums,
    organicSessions, organicSessionsDelta: pct(organicSessions, priorOrganicSessions),
    organicUsers, organicUsersDelta: pct(organicUsers, priorOrganicUsers),
    organicTransactions, organicTransactionsDelta: pct(organicTransactions, priorOrganicTransactions),
    deviceBreakdown, organicLandingPages,
  }
}

// ── Period-aware traffic trend ────────────────────────────────────────────────
// The sessions trend that follows the selected KPI period. Buckets sessions at
// the granularity chosen by buildTrendRange, and aligns the comparison window by
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

// ── 13-month metric series (WS-C3) ─────────────────────────────────────────────
// One row per calendar month over a trailing window (default 13 months = current
// month + prior 12), so the latest month has a YoY comparison 12 rows earlier.
// Aggregated server-side by GA4 via the `yearMonth` dimension.
//
// When the client configures specific key_event_names, the keyEvents metric is
// scoped to those events (matching fetchGA4ConvertingPages) so a junk
// high-frequency key event can't inflate "conversions". Because an eventName
// dimensionFilter would also corrupt sessions/purchaseRevenue, the scoped path
// runs TWO reports — one unfiltered for sessions/revenue, one filtered for
// keyEvents — joined by month in JS. With no names configured we count ALL key
// events in a single report, as before.
//
// GA4 Data API v1beta apiNames used:
//   dimension: yearMonth          (YYYYMM bucket)
//   dimension: eventName          (only as a filter, when scoping to specific events)
//   metric:    sessions
//   metric:    keyEvents           (count of key events = "conversions" in GA4)
//   metric:    purchaseRevenue     (ecommerce revenue)

export type GA4MonthlyPoint = {
  /** Calendar month as YYYY-MM. */
  yearMonth: string
  sessions: number
  /** GA4 keyEvents — the conversion-event successor to "conversions". */
  conversions: number
  /** GA4 purchaseRevenue. */
  revenue: number
}

export async function fetchGA4MonthlySeries(
  propertyId: string,
  months = 13,
  keyEventNames: string[] = [],
): Promise<GA4MonthlyPoint[]> {
  // Normalize + sort the event names so the cache key is stable regardless of
  // the order they were configured in (same convention as fetchGA4ConvertingPages).
  const names = Array.from(new Set(keyEventNames.map((n) => n.trim()).filter(Boolean))).sort()
  const namesKey = names.length > 0 ? names.join(',') : 'all'
  // v2: key-event scoping — invalidates caches built from unscoped keyEvents.
  return cachedFetch(`ga4:monthlySeries:v2:${propertyId}:${months}:${namesKey}`, GA4_TTL_SECONDS, () =>
    _fetchGA4MonthlySeriesUncached(propertyId, months, names),
  )
}

async function _fetchGA4MonthlySeriesUncached(
  propertyId: string,
  months: number,
  keyEventNames: string[],
): Promise<GA4MonthlyPoint[]> {
  const auth = await getAdminOAuthClient()
  const analyticsdata = google.analyticsdata({ version: 'v1beta', auth })
  const prop = `properties/${propertyId}`

  const fmt = (d: Date) => d.toISOString().slice(0, 10)
  const today = new Date()
  // Window: first day of the month (months-1) ago, through today (so the current,
  // still-accruing month is the last bucket and has a YoY peer 12 rows earlier).
  const span = Math.max(1, months)
  const startDate = fmt(new Date(today.getFullYear(), today.getMonth() - (span - 1), 1))
  const endDate = fmt(today)

  if (keyEventNames.length > 0) {
    // Scoped path: an eventName filter on the sessions/revenue report would
    // corrupt those metrics, so keyEvents is measured separately and joined
    // by yearMonth. Both reports must succeed — a half-joined series is wrong.
    const [baseRes, keyRes] = await Promise.all([
      analyticsdata.properties.runReport({
        property: prop,
        requestBody: {
          dateRanges: [{ startDate, endDate }],
          dimensions: [{ name: 'yearMonth' }],
          metrics: [{ name: 'sessions' }, { name: 'purchaseRevenue' }],
          orderBys: [{ dimension: { dimensionName: 'yearMonth' }, desc: false }],
        },
      }),
      analyticsdata.properties.runReport({
        property: prop,
        requestBody: {
          dateRanges: [{ startDate, endDate }],
          dimensions: [{ name: 'yearMonth' }],
          metrics: [{ name: 'keyEvents' }],
          dimensionFilter: { filter: { fieldName: 'eventName', inListFilter: { values: keyEventNames } } },
          orderBys: [{ dimension: { dimensionName: 'yearMonth' }, desc: false }],
        },
      }),
    ])

    const keyEventsByMonth = new Map<string, number>()
    for (const row of keyRes.data.rows ?? []) {
      const ym = row.dimensionValues?.[0]?.value ?? '' // YYYYMM
      if (ym.length !== 6) continue
      keyEventsByMonth.set(ym, parseInt(row.metricValues?.[0]?.value ?? '0'))
    }

    const points: GA4MonthlyPoint[] = []
    for (const row of baseRes.data.rows ?? []) {
      const ym = row.dimensionValues?.[0]?.value ?? '' // YYYYMM
      if (ym.length !== 6) continue
      points.push({
        yearMonth: `${ym.slice(0, 4)}-${ym.slice(4, 6)}`,
        sessions: parseInt(row.metricValues?.[0]?.value ?? '0'),
        conversions: keyEventsByMonth.get(ym) ?? 0,
        revenue: parseFloat(row.metricValues?.[1]?.value ?? '0'),
      })
    }
    return points.sort((a, b) => a.yearMonth.localeCompare(b.yearMonth))
  }

  const res = await analyticsdata.properties.runReport({
    property: prop,
    requestBody: {
      dateRanges: [{ startDate, endDate }],
      dimensions: [{ name: 'yearMonth' }],
      metrics: [{ name: 'sessions' }, { name: 'keyEvents' }, { name: 'purchaseRevenue' }],
      orderBys: [{ dimension: { dimensionName: 'yearMonth' }, desc: false }],
    },
  })

  const points: GA4MonthlyPoint[] = []
  for (const row of res.data.rows ?? []) {
    const ym = row.dimensionValues?.[0]?.value ?? '' // YYYYMM
    if (ym.length !== 6) continue
    points.push({
      yearMonth: `${ym.slice(0, 4)}-${ym.slice(4, 6)}`,
      sessions: parseInt(row.metricValues?.[0]?.value ?? '0'),
      conversions: parseInt(row.metricValues?.[1]?.value ?? '0'),
      revenue: parseFloat(row.metricValues?.[2]?.value ?? '0'),
    })
  }
  return points.sort((a, b) => a.yearMonth.localeCompare(b.yearMonth))
}

// ── Lead-gen: converting landing pages (WS-B4) ──────────────────────────────────
// Top landing pages ranked by GA4 KEY EVENTS (the conversion-event successor to
// "conversions" in GA4). When the client configures specific key_event_names we
// scope the keyEvents metric to those events via an eventName IN_LIST filter;
// with no names configured we count ALL key events. Per page we also pull
// sessions and derive a conversion rate (keyEvents / sessions) in JS — robust and
// consistent with how the rest of this module computes rates.
//
// GA4 Data API v1beta apiNames used:
//   dimension: landingPagePlusQueryString  (matches the organic landing-page report)
//   dimension: eventName                   (only when scoping to specific events)
//   metric:    keyEvents                    (count of key events = conversions)
//   metric:    sessions

export type ConvertingPageRow = {
  page: string
  conversions: number
  sessions: number
  /** keyEvents / sessions, as a percentage (e.g. 4.2 for 4.2%). 0 when sessions = 0. */
  conversionRate: number
}

export async function fetchGA4ConvertingPages(
  propertyId: string,
  keyEventNames: string[],
  range?: DateRange,
): Promise<ConvertingPageRow[]> {
  // Normalize + sort the event names so the cache key is stable regardless of
  // the order they were configured in; every varying input (property, range,
  // events) participates in the key.
  const names = Array.from(new Set(keyEventNames.map((n) => n.trim()).filter(Boolean))).sort()
  const namesKey = names.length > 0 ? names.join(',') : 'all'
  // v2: junk landing-page filtering — invalidates caches that still carry pixel paths.
  return cachedFetch(
    `ga4:convertingPages:v2:${propertyId}:${rangeKey(range)}:${namesKey}`,
    GA4_TTL_SECONDS,
    () => _fetchGA4ConvertingPagesUncached(propertyId, names, range),
  )
}

async function _fetchGA4ConvertingPagesUncached(
  propertyId: string,
  keyEventNames: string[],
  range?: DateRange,
): Promise<ConvertingPageRow[]> {
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

  // Scope key events to the configured event names when present; otherwise count
  // all key events on the property.
  const dimensionFilter =
    keyEventNames.length > 0
      ? { filter: { fieldName: 'eventName', inListFilter: { values: keyEventNames } } }
      : undefined

  // 1: conversions (keyEvents) per landing page — ranked by keyEvents.
  //    Over-fetch 50 so 25 clean rows survive the junk-page filter below.
  // 2: sessions per landing page (unfiltered) — joined in JS for the conv-rate.
  const [convRes, sessRes] = await Promise.allSettled([
    analyticsdata.properties.runReport({
      property: prop,
      requestBody: {
        dateRanges: [{ startDate, endDate }],
        dimensions: [{ name: 'landingPagePlusQueryString' }],
        metrics: [{ name: 'keyEvents' }],
        ...(dimensionFilter ? { dimensionFilter } : {}),
        orderBys: [{ metric: { metricName: 'keyEvents' }, desc: true }],
        limit: '50',
      },
    }),
    analyticsdata.properties.runReport({
      property: prop,
      requestBody: {
        dateRanges: [{ startDate, endDate }],
        dimensions: [{ name: 'landingPagePlusQueryString' }],
        metrics: [{ name: 'sessions' }],
        limit: '1000',
      },
    }),
  ])

  // The primary (conversions) report must succeed — otherwise surface the error
  // so a degraded empty result isn't cached.
  if (convRes.status !== 'fulfilled') throw convRes.reason

  const sessionsByPage = new Map<string, number>()
  if (sessRes.status === 'fulfilled') {
    for (const row of sessRes.value.data.rows ?? []) {
      sessionsByPage.set(
        // Match the conversions-loop fallback so a null landing-page dimension
        // ('(not set)') joins correctly instead of missing and forcing rate 0.
        row.dimensionValues?.[0]?.value ?? '(not set)',
        parseInt(row.metricValues?.[0]?.value ?? '0'),
      )
    }
  }

  const rows: ConvertingPageRow[] = []
  for (const row of convRes.value.data.rows ?? []) {
    if (rows.length >= 25) break
    const page = row.dimensionValues?.[0]?.value ?? '(not set)'
    if (isJunkLandingPage(page)) continue // Shopify pixel paths, not real pages
    const conversions = parseInt(row.metricValues?.[0]?.value ?? '0')
    const sessions = sessionsByPage.get(page) ?? 0
    const conversionRate = sessions > 0 ? Math.round((conversions / sessions) * 1000) / 10 : 0
    rows.push({ page, conversions, sessions, conversionRate })
  }
  return rows
}

// ── New vs returning revenue (revenue split by customer recency) ────────────────
// Purchase revenue split by GA4's newVsReturning dimension, for the current window
// AND the comparison window, so a module can show the SHARE of revenue coming from
// new customers and how that share moved (never absolute dollars). GA4 returns
// dimension values 'new' / 'returning' and occasionally '(not set)' or '' (no
// recency signal); anything that isn't exactly new/returning is bucketed as
// unknown, and shares are computed over the total INCLUDING that bucket so
// newShare + returningShare + (unknown share) always sums to ~100%.
//
// GA4 Data API v1beta apiNames used:
//   dimension: newVsReturning
//   metric:    purchaseRevenue

export type NewVsReturningPeriod = {
  newRevenue: number
  returningRevenue: number
  /** Revenue with no recency signal ('(not set)' / '' / any non-new/returning bucket). */
  unknownRevenue: number
  /** newRevenue + returningRevenue + unknownRevenue. */
  totalRevenue: number
  /** new/total and returning/total as 0–100 percentages; null when totalRevenue is 0. */
  newShare: number | null
  returningShare: number | null
}

export type GA4NewVsReturningRevenue = {
  current: NewVsReturningPeriod
  prior: NewVsReturningPeriod
}

export async function fetchGA4NewVsReturningRevenue(
  propertyId: string,
  range?: DateRange,
): Promise<GA4NewVsReturningRevenue> {
  return cachedFetch(`ga4:newVsReturning:${propertyId}:${rangeKey(range)}`, GA4_TTL_SECONDS, () =>
    _fetchGA4NewVsReturningRevenueUncached(propertyId, range),
  )
}

async function _fetchGA4NewVsReturningRevenueUncached(
  propertyId: string,
  range?: DateRange,
): Promise<GA4NewVsReturningRevenue> {
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

  const report = (sd: string, ed: string) =>
    analyticsdata.properties.runReport({
      property: prop,
      requestBody: {
        dateRanges: [{ startDate: sd, endDate: ed }],
        dimensions: [{ name: 'newVsReturning' }],
        metrics: [{ name: 'purchaseRevenue' }],
      },
    })

  const [curRes, priRes] = await Promise.allSettled([
    report(startDate, endDate),
    report(priorStart, priorEnd),
  ])

  // The current window must succeed — otherwise surface the error so a degraded
  // (empty) split isn't cached. A failed prior window just degrades to zeros.
  if (curRes.status !== 'fulfilled') throw curRes.reason

  const tally = (res: PromiseSettledResult<Awaited<ReturnType<typeof report>>>): NewVsReturningPeriod => {
    let newRevenue = 0
    let returningRevenue = 0
    let unknownRevenue = 0
    if (res.status === 'fulfilled') {
      for (const row of res.value.data.rows ?? []) {
        const bucket = (row.dimensionValues?.[0]?.value ?? '').trim().toLowerCase()
        const rev = parseFloat(row.metricValues?.[0]?.value ?? '0')
        if (bucket === 'new') newRevenue += rev
        else if (bucket === 'returning') returningRevenue += rev
        else unknownRevenue += rev
      }
    }
    const totalRevenue = newRevenue + returningRevenue + unknownRevenue
    const share = (x: number) => (totalRevenue > 0 ? Math.round((x / totalRevenue) * 1000) / 10 : null)
    return {
      newRevenue,
      returningRevenue,
      unknownRevenue,
      totalRevenue,
      newShare: share(newRevenue),
      returningShare: share(returningRevenue),
    }
  }

  return { current: tally(curRes), prior: tally(priRes) }
}
