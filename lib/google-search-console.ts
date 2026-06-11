import { google } from 'googleapis'
import type { DateRange, Granularity } from './date-range'
import { buildTrendRange } from './date-range'
import { getAdminOAuthClient } from '@/lib/google-auth'
import { cachedFetch } from '@/lib/api-cache'
import { normalizeDomain } from '@/lib/normalize-domain'
import type { TrendPoint } from '@/lib/dashboard/types'

// GSC data lags ~2-3 days; a 6h cache matches the GA4 TTL and is safe.
const GSC_TTL_SECONDS = 6 * 3600
const gscRangeKey = (range?: DateRange) => `${range?.startDate ?? 'def'}:${range?.endDate ?? 'def'}`

export type GSCMetrics = {
  clicks: number
  impressions: number
  ctr: number
  position: number
  topQueries: { query: string; clicks: number; impressions: number }[]
}

export async function listGSCSites(): Promise<string[]> {
  const auth = await getAdminOAuthClient()
  const searchconsole = google.searchconsole({ version: 'v1', auth })
  const { data } = await searchconsole.sites.list()
  return (data.siteEntry ?? [])
    .map((s) => s.siteUrl ?? '')
    .filter(Boolean)
}

export async function fetchGSCMetrics(siteUrl: string, range?: DateRange): Promise<GSCMetrics> {
  const auth = await getAdminOAuthClient()

  const searchconsole = google.searchconsole({ version: 'v1', auth })

  let startDate: string
  let endDate: string

  if (range) {
    startDate = range.startDate
    endDate = range.endDate
  } else {
    const today = new Date()
    endDate = new Date(today.getTime() - 86400000).toISOString().slice(0, 10)
    startDate = new Date(today.getTime() - 29 * 86400000).toISOString().slice(0, 10)
  }

  const [overallRes, queriesRes] = await Promise.all([
    searchconsole.searchanalytics.query({
      siteUrl,
      requestBody: {
        startDate,
        endDate,
        dimensions: [],
      },
    }),
    searchconsole.searchanalytics.query({
      siteUrl,
      requestBody: {
        startDate,
        endDate,
        dimensions: ['query'],
        rowLimit: 10,
      },
    }),
  ])

  const overall = overallRes.data.rows?.[0] ?? {}
  const clicks = overall.clicks ?? 0
  const impressions = overall.impressions ?? 0
  const ctr = (overall.ctr ?? 0) * 100
  const position = overall.position ?? 0

  const topQueries = (queriesRes.data.rows ?? []).map((row) => ({
    query: row.keys?.[0] ?? '',
    clicks: row.clicks ?? 0,
    impressions: row.impressions ?? 0,
  }))

  return { clicks, impressions, ctr, position, topQueries }
}

// ── Dashboard report types ────────────────────────────────────────────────────

export type GSCMonthlyPoint = { month: string; yearMonth: string; clicks: number; impressions: number }
export type QueryRow = { query: string; clicks: number; clicksDelta: number; impressions: number; impressionsDelta: number; position: number }
export type UrlRow = { page: string; clicks: number; clicksDelta: number; impressions: number; position: number }

export type SerpDistribution = {
  top3: number
  top10: number
  page2: number
  page3to5: number
  beyond: number
}

export type GSCReport = {
  clicks: number; clicksDelta: number
  impressions: number; impressionsDelta: number
  position: number; positionDelta: number
  ctr: number
  compareLabel: string
  monthlyTrend: GSCMonthlyPoint[]
  topQueries: QueryRow[]
  topUrls: UrlRow[]
  serpDistribution: SerpDistribution
}

function normalizeSiteUrl(raw: string): string {
  const url = raw.trim()
  if (url.startsWith('sc-domain:') || url.startsWith('http://') || url.startsWith('https://')) {
    // Already has a protocol — just ensure trailing slash for URL-type properties
    return url.startsWith('sc-domain:') ? url : url.endsWith('/') ? url : url + '/'
  }
  // Bare domain like "tappselectric.com" — assume https with trailing slash
  return `https://${url}/`
}

export async function fetchGSCReport(siteUrl: string, range?: DateRange): Promise<GSCReport> {
  // Cache key includes the comparison window: the report's clicksDelta / per-query
  // / per-URL deltas depend on compareStart/compareEnd, so 'prior' vs 'yoy' at the
  // same period must NOT share a cache entry.
  return cachedFetch(
    `gsc:report:${normalizeSiteUrl(siteUrl)}:${gscRangeKey(range)}:${range?.compareStart ?? 'def'}:${range?.compareEnd ?? 'def'}`,
    GSC_TTL_SECONDS,
    () => _fetchGSCReportUncached(siteUrl, range),
  )
}

async function _fetchGSCReportUncached(siteUrl: string, range?: DateRange): Promise<GSCReport> {
  const normalizedUrl = normalizeSiteUrl(siteUrl)
  const auth = await getAdminOAuthClient()
  const searchconsole = google.searchconsole({ version: 'v1', auth })

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

  // 6-month daily range for monthly aggregation
  const firstOfCurrentMonth = new Date(today.getFullYear(), today.getMonth(), 1)
  const monthlyEnd = fmt(new Date(firstOfCurrentMonth.getTime() - 86400000))
  const monthlyStart = fmt(new Date(today.getFullYear(), today.getMonth() - 6, 1))

  const [r1, r2, r3, r4, r5, r6, r7] = await Promise.allSettled([
    // 1: current overall
    searchconsole.searchanalytics.query({ siteUrl: normalizedUrl, requestBody: { startDate, endDate } }),
    // 2: prior/compare overall
    searchconsole.searchanalytics.query({ siteUrl: normalizedUrl, requestBody: { startDate: priorStart, endDate: priorEnd } }),
    // 3: daily data for monthly aggregation
    searchconsole.searchanalytics.query({ siteUrl: normalizedUrl, requestBody: { startDate: monthlyStart, endDate: monthlyEnd, dimensions: ['date'], rowLimit: 200 } }),
    // 4: top queries current (500 rows for SERP distribution; top 25 shown in table)
    searchconsole.searchanalytics.query({ siteUrl: normalizedUrl, requestBody: { startDate, endDate, dimensions: ['query'], rowLimit: 500 } }),
    // 5: top queries prior (for delta)
    searchconsole.searchanalytics.query({ siteUrl: normalizedUrl, requestBody: { startDate: priorStart, endDate: priorEnd, dimensions: ['query'], rowLimit: 100 } }),
    // 6: top pages current
    searchconsole.searchanalytics.query({ siteUrl: normalizedUrl, requestBody: { startDate, endDate, dimensions: ['page'], rowLimit: 25 } }),
    // 7: top pages prior (for per-URL clicksDelta) — restored; was dropped, causing clicksDelta = 0
    searchconsole.searchanalytics.query({ siteUrl: normalizedUrl, requestBody: { startDate: priorStart, endDate: priorEnd, dimensions: ['page'], rowLimit: 100 } }),
  ])

  // If the primary call failed, throw so the caller gets the actual error
  if (r1.status === 'rejected') {
    const reason = r1.reason as { message?: string; errors?: { message: string }[] } | null
    const msg = reason?.errors?.[0]?.message ?? reason?.message ?? String(r1.reason)
    throw new Error(`GSC API error (tried: ${normalizedUrl}): ${msg}`)
  }

  // Overall metrics
  const overall = r1.value.data.rows?.[0] ?? {}
  const priorOverall = r2.status === 'fulfilled' ? (r2.value.data.rows?.[0] ?? {}) : {}

  const clicks = (overall as { clicks?: number }).clicks ?? 0
  const impressions = (overall as { impressions?: number }).impressions ?? 0
  const position = (overall as { position?: number }).position ?? 0
  const ctr = ((overall as { ctr?: number }).ctr ?? 0) * 100

  const priorClicks = (priorOverall as { clicks?: number }).clicks ?? 0
  const priorImpressions = (priorOverall as { impressions?: number }).impressions ?? 0
  const priorPosition = (priorOverall as { position?: number }).position ?? 0

  const pct = (curr: number, prior: number) =>
    prior === 0 ? 0 : Math.round(((curr - prior) / prior) * 100)

  // Monthly trend: aggregate daily rows by yearMonth
  const monthlyMap = new Map<string, { clicks: number; impressions: number }>()
  if (r3.status === 'fulfilled') {
    for (const row of r3.value.data.rows ?? []) {
      const dateStr = row.keys?.[0] ?? ''
      const ym = dateStr.slice(0, 7).replace('-', '') // "2025-01" -> "202501"
      const prev = monthlyMap.get(ym) ?? { clicks: 0, impressions: 0 }
      monthlyMap.set(ym, {
        clicks: prev.clicks + (row.clicks ?? 0),
        impressions: prev.impressions + (row.impressions ?? 0),
      })
    }
  }
  const monthlyTrend: GSCMonthlyPoint[] = Array.from(monthlyMap.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([ym, data]) => {
      const yr = parseInt(ym.slice(0, 4))
      const mo = parseInt(ym.slice(4, 6)) - 1
      const label = new Date(yr, mo, 1).toLocaleString('en-US', { month: 'short' })
      return { month: label, yearMonth: ym, ...data }
    })

  // Queries — all 500 rows used for SERP distribution, top 25 used for table
  const allQueryRows = r4.status === 'fulfilled' ? (r4.value.data.rows ?? []) : []

  // SERP distribution bucketing
  const serpDistribution: SerpDistribution = { top3: 0, top10: 0, page2: 0, page3to5: 0, beyond: 0 }
  for (const row of allQueryRows) {
    const pos = row.position ?? 0
    if (pos <= 3) serpDistribution.top3++
    else if (pos <= 10) serpDistribution.top10++
    else if (pos <= 20) serpDistribution.page2++
    else if (pos <= 50) serpDistribution.page3to5++
    else serpDistribution.beyond++
  }

  const priorQueryMap = new Map<string, { clicks: number; impressions: number }>()
  if (r5.status === 'fulfilled') {
    for (const row of r5.value.data.rows ?? []) {
      priorQueryMap.set(row.keys?.[0] ?? '', { clicks: row.clicks ?? 0, impressions: row.impressions ?? 0 })
    }
  }
  const topQueries: QueryRow[] = []
  for (const row of allQueryRows.slice(0, 25)) {
    const q = row.keys?.[0] ?? ''
    const prior = priorQueryMap.get(q)
    topQueries.push({
      query: q,
      clicks: row.clicks ?? 0,
      clicksDelta: (row.clicks ?? 0) - (prior?.clicks ?? 0),
      impressions: row.impressions ?? 0,
      impressionsDelta: (row.impressions ?? 0) - (prior?.impressions ?? 0),
      position: row.position ?? 0,
    })
  }

  // URLs — match each current page against its prior-period clicks (r7) so the
  // per-URL clicksDelta is a real current−prior figure, not a hardcoded 0.
  const priorPageClicks = new Map<string, number>()
  if (r7.status === 'fulfilled') {
    for (const row of r7.value.data.rows ?? []) {
      priorPageClicks.set(row.keys?.[0] ?? '', row.clicks ?? 0)
    }
  }
  const topUrls: UrlRow[] = []
  if (r6.status === 'fulfilled') {
    for (const row of r6.value.data.rows ?? []) {
      const page = row.keys?.[0] ?? ''
      const currentClicks = row.clicks ?? 0
      const priorClicksForPage = priorPageClicks.get(page) ?? 0
      topUrls.push({
        page,
        clicks: currentClicks,
        clicksDelta: currentClicks - priorClicksForPage,
        impressions: row.impressions ?? 0,
        position: row.position ?? 0,
      })
    }
  }

  return {
    clicks, clicksDelta: pct(clicks, priorClicks),
    impressions, impressionsDelta: pct(impressions, priorImpressions),
    position, positionDelta: pct(position, priorPosition),
    ctr, compareLabel,
    monthlyTrend, topQueries, topUrls, serpDistribution,
  }
}

// ── Branded vs non-branded split ───────────────────────────────────────────────

export type GSCBrandedSplit = {
  branded: { clicks: number; impressions: number }
  nonBranded: { clicks: number; impressions: number }
}

/**
 * Derive a default brand token from a site domain when no brand terms are
 * supplied. Strips the TLD and any separators so "tappselectric.com" → "tappselectric".
 * Returns the registrable label most likely to appear inside branded queries.
 */
function defaultBrandToken(siteUrl: string): string {
  const host = normalizeDomain(siteUrl) // e.g. "tappselectric.com" / "shop.brand.co.uk"
  const labels = host.split('.').filter(Boolean)
  // Drop the TLD (last label); for multi-part hosts the second-to-last label is
  // the registrable name in the common case (brand.com, sub.brand.com).
  const candidate = labels.length >= 2 ? labels[labels.length - 2] : labels[0] ?? host
  return candidate.toLowerCase()
}

/**
 * Split GSC clicks/impressions into branded vs non-branded by partitioning the
 * query dimension. A query is "branded" if it contains any of `brandTerms`
 * (case-insensitive substring match). When `brandTerms` is empty a sensible
 * default token is derived from the site domain.
 */
export async function fetchGSCBrandedSplit(
  siteUrl: string,
  range: DateRange | undefined,
  brandTerms: string[],
): Promise<GSCBrandedSplit> {
  const normalizedUrl = normalizeSiteUrl(siteUrl)
  const terms = (brandTerms.length > 0 ? brandTerms : [defaultBrandToken(siteUrl)])
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean)
  const termsKey = terms.join(',') || 'none'

  return cachedFetch(
    `gsc:branded:${normalizedUrl}:${gscRangeKey(range)}:${termsKey}`,
    GSC_TTL_SECONDS,
    async () => {
      const auth = await getAdminOAuthClient()
      const searchconsole = google.searchconsole({ version: 'v1', auth })

      const today = new Date()
      const fmt = (d: Date) => d.toISOString().slice(0, 10)
      const startDate = range?.startDate ?? fmt(new Date(today.getTime() - 29 * 86400000))
      const endDate = range?.endDate ?? fmt(new Date(today.getTime() - 86400000))

      const { data } = await searchconsole.searchanalytics.query({
        siteUrl: normalizedUrl,
        requestBody: { startDate, endDate, dimensions: ['query'], rowLimit: 25000 },
      })

      const split: GSCBrandedSplit = {
        branded: { clicks: 0, impressions: 0 },
        nonBranded: { clicks: 0, impressions: 0 },
      }
      for (const row of data.rows ?? []) {
        const query = (row.keys?.[0] ?? '').toLowerCase()
        const isBranded = terms.some((t) => query.includes(t))
        const bucket = isBranded ? split.branded : split.nonBranded
        bucket.clicks += row.clicks ?? 0
        bucket.impressions += row.impressions ?? 0
      }
      return split
    },
  )
}

// ── Period-aware clicks trend ──────────────────────────────────────────────────

/** Bucket a YYYY-MM-DD date string to its bucket key for the given granularity. */
function bucketKey(dateStr: string, granularity: Granularity): string {
  if (granularity === 'monthly') return dateStr.slice(0, 7) // YYYY-MM
  if (granularity === 'weekly') {
    // Anchor each week to the Monday on/before the date (UTC) so buckets are stable.
    const d = new Date(dateStr + 'T00:00:00Z')
    const dow = (d.getUTCDay() + 6) % 7 // 0 = Monday
    d.setUTCDate(d.getUTCDate() - dow)
    return d.toISOString().slice(0, 10)
  }
  return dateStr // daily
}

function addDaysIso(iso: string, n: number): string {
  const d = new Date(iso + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

function daysBetweenIso(fromIso: string, toIso: string): number {
  return Math.round((Date.parse(toIso + 'T00:00:00Z') - Date.parse(fromIso + 'T00:00:00Z')) / 86400000)
}

/**
 * Period-aware GSC clicks trend. Returns one TrendPoint per bucket over the
 * selected period (bucket size from buildTrendRange granularity), with
 * compareValue carried from the comparison window. The comparison series is
 * aligned by shifting its dates forward onto the current window's calendar and
 * bucketing with the same keys, so the ghost overlay lines up correctly even at
 * weekly/monthly granularity where the windows aren't week/month aligned.
 */
export async function fetchGSCTrend(
  siteUrl: string,
  period = '28d',
  compare = 'prior',
): Promise<TrendPoint[]> {
  const normalizedUrl = normalizeSiteUrl(siteUrl)
  const trend = buildTrendRange(period, compare)

  return cachedFetch(
    `gsc:trend:${normalizedUrl}:${period}:${compare}:${trend.startDate}:${trend.endDate}`,
    GSC_TTL_SECONDS,
    async () => {
      const auth = await getAdminOAuthClient()
      const searchconsole = google.searchconsole({ version: 'v1', auth })

      const queryDaily = (startDate: string, endDate: string) =>
        searchconsole.searchanalytics.query({
          siteUrl: normalizedUrl,
          requestBody: { startDate, endDate, dimensions: ['date'], rowLimit: 25000 },
        })

      const [curRes, cmpRes] = await Promise.allSettled([
        queryDaily(trend.startDate, trend.endDate),
        queryDaily(trend.compareStart, trend.compareEnd),
      ])

      const aggregate = (
        rows: { keys?: (string | null)[] | null; clicks?: number | null }[],
      ): { key: string; clicks: number }[] => {
        const map = new Map<string, number>()
        for (const row of rows) {
          const dateStr = row.keys?.[0] ?? ''
          if (!dateStr) continue
          const key = bucketKey(dateStr, trend.granularity)
          map.set(key, (map.get(key) ?? 0) + (row.clicks ?? 0))
        }
        return Array.from(map.entries())
          .sort((a, b) => a[0].localeCompare(b[0]))
          .map(([key, clicks]) => ({ key, clicks }))
      }

      // Don't cache a degraded (empty) trend if the primary window failed — let it retry.
      if (curRes.status !== 'fulfilled') throw curRes.reason

      const current = aggregate(curRes.value.data.rows ?? [])

      // Shift the comparison dates forward by the window offset onto the current
      // calendar, then bucket with the same keys → robust alignment for weekly /
      // monthly granularity (index pairing would mismatch partial edge buckets).
      const offsetDays = daysBetweenIso(trend.compareStart, trend.startDate)
      const cmpByKey = new Map<string, number>()
      if (cmpRes.status === 'fulfilled') {
        for (const row of cmpRes.value.data.rows ?? []) {
          const dateStr = row.keys?.[0] ?? ''
          if (!dateStr) continue
          const key = bucketKey(addDaysIso(dateStr, offsetDays), trend.granularity)
          cmpByKey.set(key, (cmpByKey.get(key) ?? 0) + (row.clicks ?? 0))
        }
      }

      return current.map((point) => {
        const cmp = cmpByKey.get(point.key)
        return {
          date: point.key,
          value: point.clicks,
          ...(cmp !== undefined ? { compareValue: cmp } : {}),
        }
      })
    },
  )
}

// ── Geo / search intent split (lightweight heuristic) ──────────────────────────

export type GSCIntentQuery = { query: string; clicks: number; impressions: number; position: number }
export type GSCIntentSplit = {
  local: GSCIntentQuery[]
  general: GSCIntentQuery[]
  localClicks: number
  generalClicks: number
}

// "near me", "nearby", "in <place>", "<place> area", and common locality words.
const LOCAL_INTENT_RE =
  /\b(near\s*me|nearby|near\s+by|close\s+to\s+me|in\s+my\s+area|around\s+me|local|in\s+town|directions|open\s+now|\d{5}|near\b)\b/i
// Light geo markers that suggest a place qualifier without a full gazetteer.
const GEO_HINT_RE = /\b(city|county|near|street|avenue|downtown|zip|county| on|st\.?|ave\.?|blvd)\b/i

function isLocalIntent(query: string): boolean {
  const q = query.toLowerCase()
  if (LOCAL_INTENT_RE.test(q)) return true
  // "service in springfield" style: a leading service phrase + an "in <token>" tail.
  if (/\bin\s+[a-z]/.test(q) && GEO_HINT_RE.test(q)) return true
  return false
}

/**
 * Split top queries into local-intent (near me / nearby / locality heuristics)
 * vs general. Deliberately modest — a substring/regex heuristic, not a gazetteer.
 */
export async function fetchGSCIntentSplit(
  siteUrl: string,
  range?: DateRange,
  topN = 25,
): Promise<GSCIntentSplit> {
  const normalizedUrl = normalizeSiteUrl(siteUrl)

  return cachedFetch(
    `gsc:intent:${normalizedUrl}:${gscRangeKey(range)}:${topN}`,
    GSC_TTL_SECONDS,
    async () => {
      const auth = await getAdminOAuthClient()
      const searchconsole = google.searchconsole({ version: 'v1', auth })

      const today = new Date()
      const fmt = (d: Date) => d.toISOString().slice(0, 10)
      const startDate = range?.startDate ?? fmt(new Date(today.getTime() - 29 * 86400000))
      const endDate = range?.endDate ?? fmt(new Date(today.getTime() - 86400000))

      const { data } = await searchconsole.searchanalytics.query({
        siteUrl: normalizedUrl,
        requestBody: { startDate, endDate, dimensions: ['query'], rowLimit: 25000 },
      })

      const split: GSCIntentSplit = { local: [], general: [], localClicks: 0, generalClicks: 0 }
      for (const row of data.rows ?? []) {
        const query = row.keys?.[0] ?? ''
        const entry: GSCIntentQuery = {
          query,
          clicks: row.clicks ?? 0,
          impressions: row.impressions ?? 0,
          position: row.position ?? 0,
        }
        if (isLocalIntent(query)) {
          split.local.push(entry)
          split.localClicks += entry.clicks
        } else {
          split.general.push(entry)
          split.generalClicks += entry.clicks
        }
      }

      const byClicks = (a: GSCIntentQuery, b: GSCIntentQuery) => b.clicks - a.clicks
      split.local.sort(byClicks)
      split.general.sort(byClicks)
      split.local = split.local.slice(0, topN)
      split.general = split.general.slice(0, topN)
      return split
    },
  )
}
