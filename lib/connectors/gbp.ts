import { google } from 'googleapis'
import type { OAuth2Client } from 'google-auth-library'

const GBP_PERF_BASE = 'https://businessprofileperformance.googleapis.com/v1'

export const GBP_PERF_METRICS = [
  'BUSINESS_IMPRESSIONS_DESKTOP_MAPS',
  'BUSINESS_IMPRESSIONS_DESKTOP_SEARCH',
  'BUSINESS_IMPRESSIONS_MOBILE_MAPS',
  'BUSINESS_IMPRESSIONS_MOBILE_SEARCH',
  'BUSINESS_CONVERSATIONS',
  'BUSINESS_DIRECTION_REQUESTS',
  'CALL_CLICKS',
  'WEBSITE_CLICKS',
  'BUSINESS_BOOKINGS',
  'BUSINESS_FOOD_ORDERS',
  'BUSINESS_FOOD_MENU_CLICKS',
] as const

export type GBPPerfMetric = (typeof GBP_PERF_METRICS)[number]

export interface GBPInsightsRow {
  locationName: string  // "locations/123"
  locationTitle?: string
  metrics: Record<string, number>  // metric -> total over the window
  daily?: Array<{ date: string; metrics: Record<string, number> }>
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface GBPAccount {
  name: string          // resource name e.g. "accounts/123456"
  accountName: string   // display name
  type: string
}

export interface GBPAddress {
  addressLines: string[]
  locality: string      // city
  administrativeArea: string  // state
  postalCode: string
  regionCode: string    // country code
}

export interface GBPHoursPeriod {
  openDay: string
  openTime: { hours: number; minutes?: number }
  closeDay: string
  closeTime: { hours: number; minutes?: number }
}

export interface GBPLocation {
  name: string          // resource name e.g. "locations/456"
  title: string         // business name
  primaryPhone: string | null
  additionalPhones: string[]
  websiteUri: string | null
  address: GBPAddress | null
  primaryCategory: string | null
  description: string | null
  openStatus: 'OPEN' | 'CLOSED_PERMANENTLY' | 'CLOSED_TEMPORARILY' | 'UNKNOWN'
  hasRegularHours: boolean
  hoursPeriods: GBPHoursPeriod[]
  mapsUri: string | null
  newReviewUri: string | null
}

export interface LocationAudit extends GBPLocation {
  score: number
  issues: string[]
  addressFormatted: string
}

// ── API helpers ────────────────────────────────────────────────────────────────

export async function listGBPAccounts(auth: OAuth2Client): Promise<GBPAccount[]> {
  const api = google.mybusinessaccountmanagement({ version: 'v1', auth })
  const res = await api.accounts.list()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const accounts: any[] = res.data.accounts ?? []
  return accounts.map((a) => ({
    name: a.name ?? '',
    accountName: a.accountName ?? a.name ?? '',
    type: a.type ?? 'PERSONAL',
  }))
}

// NOTE: Business Information API v1 nests primary/additional categories under `categories`.
// Top-level `primaryCategory` is not a valid readMask field — using it returns INVALID_ARGUMENT.
const LOCATION_READ_MASK = [
  'name',
  'title',
  'phoneNumbers',
  'storefrontAddress',
  'websiteUri',
  'regularHours',
  'categories',
  'profile',
  'openInfo',
  'metadata',
].join(',')

export async function listGBPLocations(
  accountName: string,
  auth: OAuth2Client,
): Promise<GBPLocation[]> {
  const api = google.mybusinessbusinessinformation({ version: 'v1', auth })
  const locations: GBPLocation[] = []
  let pageToken: string | undefined

  do {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res: any = await (api.accounts.locations.list as any)({
      parent: accountName,
      readMask: LOCATION_READ_MASK,
      pageSize: 100,
      ...(pageToken ? { pageToken } : {}),
    })

    const raw = res.data.locations ?? []
    for (const loc of raw) {
      locations.push(parseLocation(loc))
    }

    pageToken = res.data.nextPageToken ?? undefined
  } while (pageToken)

  return locations
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseLocation(loc: any): GBPLocation {
  const addr = loc.storefrontAddress ?? null
  const phones = loc.phoneNumbers ?? {}
  const hours = loc.regularHours?.periods ?? []
  const openStatus: GBPLocation['openStatus'] =
    loc.openInfo?.status === 'CLOSED_PERMANENTLY'
      ? 'CLOSED_PERMANENTLY'
      : loc.openInfo?.status === 'CLOSED_TEMPORARILY'
      ? 'CLOSED_TEMPORARILY'
      : loc.openInfo?.status === 'OPEN'
      ? 'OPEN'
      : 'UNKNOWN'

  return {
    name: loc.name ?? '',
    title: loc.title ?? '',
    primaryPhone: phones.primaryPhone ?? null,
    additionalPhones: phones.additionalPhones ?? [],
    websiteUri: loc.websiteUri ?? null,
    address: addr
      ? {
          addressLines: addr.addressLines ?? [],
          locality: addr.locality ?? '',
          administrativeArea: addr.administrativeArea ?? '',
          postalCode: addr.postalCode ?? '',
          regionCode: addr.regionCode ?? '',
        }
      : null,
    primaryCategory: loc.categories?.primaryCategory?.displayName ?? loc.primaryCategory?.displayName ?? null,
    description: loc.profile?.description ?? null,
    openStatus,
    hasRegularHours: hours.length > 0,
    hoursPeriods: hours,
    mapsUri: loc.metadata?.mapsUri ?? null,
    newReviewUri: loc.metadata?.newReviewUri ?? null,
  }
}

// ── Performance / Insights ────────────────────────────────────────────────────

function ymdToParts(ymd: string): { year: number; month: number; day: number } {
  const [y, m, d] = ymd.split('-').map((n) => parseInt(n, 10))
  return { year: y, month: m, day: d }
}

function partsToYmd(p: { year?: number | null; month?: number | null; day?: number | null }): string {
  const y = String(p.year ?? 0).padStart(4, '0')
  const m = String(p.month ?? 0).padStart(2, '0')
  const d = String(p.day ?? 0).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/**
 * Fetch daily-metric time series for a single GBP location across multiple metrics.
 * locationName: "locations/123" (no "accounts/..." prefix)
 * startDate / endDate: YYYY-MM-DD
 */
export async function fetchGBPLocationInsights(
  locationName: string,
  metrics: GBPPerfMetric[],
  startDate: string,
  endDate: string,
  auth: OAuth2Client,
  opts: { includeDaily?: boolean } = {},
): Promise<GBPInsightsRow> {
  const { token } = await auth.getAccessToken()
  if (!token) throw new Error('Failed to obtain GBP access token')

  const start = ymdToParts(startDate)
  const end = ymdToParts(endDate)

  const params = new URLSearchParams()
  for (const m of metrics) params.append('dailyMetrics', m)
  params.append('dailyRange.start_date.year', String(start.year))
  params.append('dailyRange.start_date.month', String(start.month))
  params.append('dailyRange.start_date.day', String(start.day))
  params.append('dailyRange.end_date.year', String(end.year))
  params.append('dailyRange.end_date.month', String(end.month))
  params.append('dailyRange.end_date.day', String(end.day))

  const url = `${GBP_PERF_BASE}/${locationName}:fetchMultiDailyMetricsTimeSeries?${params.toString()}`
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`GBP Performance API ${res.status}: ${body}`)
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const json: any = await res.json()

  const totals: Record<string, number> = {}
  const dailyMap = new Map<string, Record<string, number>>()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const series: any[] = json.multiDailyMetricTimeSeries ?? []
  for (const block of series) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const inner: any[] = block.dailyMetricTimeSeries ?? []
    for (const dm of inner) {
      const metric: string = dm.dailyMetric ?? 'UNKNOWN'
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const datedValues: any[] = dm.timeSeries?.datedValues ?? []
      let total = 0
      for (const dv of datedValues) {
        const value = parseInt(dv.value ?? '0', 10) || 0
        total += value
        if (opts.includeDaily) {
          const ymd = partsToYmd(dv.date ?? {})
          if (!dailyMap.has(ymd)) dailyMap.set(ymd, {})
          dailyMap.get(ymd)![metric] = value
        }
      }
      totals[metric] = (totals[metric] ?? 0) + total
    }
  }

  const daily = opts.includeDaily
    ? Array.from(dailyMap.entries())
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([date, m]) => ({ date, metrics: m }))
    : undefined

  return { locationName, metrics: totals, daily }
}

// ── Audit ──────────────────────────────────────────────────────────────────────

export function auditLocation(loc: GBPLocation): LocationAudit {
  const issues: string[] = []
  let score = 100

  if (!loc.primaryPhone) {
    issues.push('No primary phone number')
    score -= 20
  }
  if (!loc.websiteUri) {
    issues.push('No website URL')
    score -= 15
  }
  if (!loc.hasRegularHours) {
    issues.push('No business hours set')
    score -= 20
  }
  if (!loc.description) {
    issues.push('No business description')
    score -= 15
  }
  if (!loc.primaryCategory) {
    issues.push('No primary category set')
    score -= 10
  }
  if (!loc.address) {
    issues.push('No storefront address')
    score -= 15
  }
  if (loc.openStatus === 'CLOSED_PERMANENTLY') {
    issues.push('Marked as permanently closed')
    score -= 30
  }
  if (loc.openStatus === 'CLOSED_TEMPORARILY') {
    issues.push('Marked as temporarily closed')
    score -= 10
  }

  const addr = loc.address
  const addressFormatted = addr
    ? [
        addr.addressLines.join(', '),
        addr.locality,
        addr.administrativeArea,
        addr.postalCode,
      ]
        .filter(Boolean)
        .join(', ')
    : ''

  return {
    ...loc,
    score: Math.max(0, score),
    issues,
    addressFormatted,
  }
}
