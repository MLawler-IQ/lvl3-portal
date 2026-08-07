import { google } from 'googleapis'
import type { OAuth2Client } from 'google-auth-library'
import { cachedFetch } from '@/lib/api-cache'
import { getAdminGBPOAuthClient } from '@/lib/gbp-auth'

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

export type GBPInsightsGranularity = 'total' | 'monthly' | 'daily'

export interface GBPInsightsRow {
  locationName: string  // "locations/123"
  locationTitle?: string
  metrics: Record<string, number>  // metric -> total over the window
  monthly?: Array<{ month: string; metrics: Record<string, number> }>  // YYYY-MM
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
  /**
   * Whether Google models this location as a service-area business.
   *
   * A BOOLEAN RATHER THAN A TRISTATE, and only because `serviceArea` is in
   * LOCATION_READ_MASK. The API returns the field only for an SAB, so with the field
   * requested its absence is real evidence of "storefront business" rather than "we did
   * not ask" — the same robotsTxtStatus distinction one layer down. If anyone removes
   * `serviceArea` from the mask, every location silently becomes `false` and the §9 false
   * positive comes back; the read mask and this field must move together.
   *
   * The stale-cache half of that hazard is closed by the `gbp:account-audit:v3:` key bump
   * — an 18h payload written before the mask change has no such key and must not be served.
   */
  isServiceAreaBusiness: boolean
  /**
   * Raw `serviceArea.businessType`, null for a storefront business.
   * 'CUSTOMER_LOCATION_ONLY' is the one that hides the storefront address.
   */
  serviceAreaBusinessType: string | null
  /**
   * Declared service areas as localized place names — the API's own example is
   * "Scottsdale, AZ", which is the 'City, ST' shape GbpProfileRecord.serviceAreas wants.
   *
   * A DECLARATION, NOT A MEASUREMENT. Google caps this at 20 places and a business may
   * declare anywhere; nothing here says the profile can rank there. Never use it as a
   * proximity test — see the LOCAL-016 note in lib/findings/checks.ts.
   */
  serviceAreas: string[]
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
  const accounts = res.data.accounts ?? []
  return accounts.map((a) => ({
    name: a.name ?? '',
    accountName: a.accountName ?? a.name ?? '',
    type: a.type ?? 'PERSONAL',
  }))
}

// NOTE: Business Information API v1 nests primary/additional categories under `categories`.
// Top-level `primaryCategory` is not a valid readMask field — using it returns INVALID_ARGUMENT.
//
// AN INVALID FIELD HERE IS A 400 ON EVERY GBP CALL, not a degraded one — it breaks the
// dashboard for every client at once. So every entry must be verified against the API's
// own field list before it lands, never guessed from the shape of the JSON.
//
// `serviceArea` was verified against the generated discovery typings shipped with the
// installed googleapis package — node_modules/googleapis/build/src/apis/
// mybusinessbusinessinformation/v1.d.ts, `Schema$Location.serviceArea?:
// Schema$ServiceAreaBusiness`, whose members are `businessType`, `places` and
// `regionCode`. That file is generated from the live discovery document, so it is the
// same source the request itself is validated against.
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
  // Present only for a service-area business. Requesting it is what turns "no address"
  // into an answerable question: without it, a correctly configured SAB with a hidden
  // address is indistinguishable from a storefront that forgot to enter one, and the
  // documented §9 false positive ("No storefront address", score docked to 85 on a
  // client doing exactly what Google tells SABs to do) is unavoidable.
  'serviceArea',
].join(',')

/** Whether a location list was narrowed to one client, or is a whole account. */
export type GBPLocationScope = 'group' | 'account-wide'

export type GBPScopeDecision =
  | { ok: true; parent: string; scope: GBPLocationScope }
  | { ok: false; reason: 'gbp_scope_unconfigured'; configured: string | null }

/**
 * Decide whether this client's GBP reads may run, and against what parent. FAIL-CLOSED.
 *
 * The hole this closes: dashboard-gbp read only `gbp_account_id` and listed every
 * location under it. On a shared container that means one brand's dashboard ranked
 * another brand's locations, cached 18h under a key with no scope in it, on a surface
 * gated by `client_type` rather than by role — so a client login would have seen it.
 *
 * `clients.gbp_location_group` could not be used as a filter to fix it. Its meaning was
 * never pinned down: the column comment calls it a "location-group / label filter", while
 * the onboarding test expects the stored value `'Ungrouped'` — Business Profile Manager's
 * name for locations in NO group. Matching locations against a label called 'Ungrouped'
 * returns nothing, which would trade an over-permissive bug for a silently empty
 * dashboard. Filtering on each location's own `labels` is not available either: that
 * field is absent from LOCATION_READ_MASK, and adding it is unverified against the live
 * API, where an invalid readMask field is a 400 on every GBP call.
 *
 * So this refuses to read an account it cannot prove belongs to this client, and makes
 * the admin state which case applies:
 *
 *   "accounts/..."  a location-group sub-account, used as the list parent so the API
 *                   itself returns only that group. The correct long-term form.
 *   "*"             an explicit assertion that the WHOLE account is this client's.
 *                   Needed for a single-client account and for a multi_location brand
 *                   that owns every location in its own account — faulting correct
 *                   configuration is its own failure mode, so saying "this is fine" has
 *                   to be possible, and has to be deliberate.
 *   anything else   not a usable scope. Refuse.
 *   null            not a usable scope. Refuse.
 */
export function decideGBPScope(
  accountName: string,
  locationGroup: string | null | undefined,
): GBPScopeDecision {
  const group = locationGroup?.trim() || null
  if (group === '*') return { ok: true, parent: accountName, scope: 'account-wide' }
  if (group && group.startsWith('accounts/')) return { ok: true, parent: group, scope: 'group' }
  return { ok: false, reason: 'gbp_scope_unconfigured', configured: group }
}

/**
 * Every location under `accountName`, UNSCOPED.
 *
 * Account-wide by design, and correct for the admin-only callers that genuinely want the
 * whole container: onboarding discovery and the GBP Audit tool. Any path that renders
 * data attributed to ONE client must go through decideGBPScope first — see
 * fetchGBPClientInsights and auditGBPAccount, which do.
 */
export async function listGBPLocations(
  accountName: string,
  auth: OAuth2Client,
): Promise<GBPLocation[]> {
  const api = google.mybusinessbusinessinformation({ version: 'v1', auth })
  const locations: GBPLocation[] = []
  let pageToken: string | undefined

  do {
    // The googleapis typings for accounts.locations.list don't accept the
    // readMask/pagination params this endpoint requires — keep `any` here.
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

// Structural shape of the raw location payload from the Business Information API
// (only the fields we read — all optional/nullable since the API may omit any).
interface RawGBPLocation {
  name?: string | null
  title?: string | null
  phoneNumbers?: {
    primaryPhone?: string | null
    additionalPhones?: string[] | null
  } | null
  storefrontAddress?: {
    addressLines?: string[] | null
    locality?: string | null
    administrativeArea?: string | null
    postalCode?: string | null
    regionCode?: string | null
  } | null
  websiteUri?: string | null
  regularHours?: { periods?: GBPHoursPeriod[] | null } | null
  categories?: { primaryCategory?: { displayName?: string | null } | null } | null
  primaryCategory?: { displayName?: string | null } | null
  profile?: { description?: string | null } | null
  openInfo?: { status?: string | null } | null
  metadata?: { mapsUri?: string | null; newReviewUri?: string | null } | null
  // Schema$ServiceAreaBusiness. `places.placeInfos[].placeName` is documented as "the
  // localized name of the place. For example, `Scottsdale, AZ`".
  serviceArea?: {
    businessType?: string | null
    places?: { placeInfos?: Array<{ placeId?: string | null; placeName?: string | null }> | null } | null
    regionCode?: string | null
  } | null
}

function parseLocation(loc: RawGBPLocation): GBPLocation {
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
    // Presence of the object is the signal, not the truthiness of businessType: the API
    // returns `serviceArea` only for a service-area business, and a payload carrying
    // `places` but an unset `businessType` is still one.
    isServiceAreaBusiness: loc.serviceArea != null,
    serviceAreaBusinessType: loc.serviceArea?.businessType ?? null,
    serviceAreas: (loc.serviceArea?.places?.placeInfos ?? [])
      .map((p) => p?.placeName ?? '')
      .filter((n) => n.trim().length > 0),
  }
}

// ── Performance / Insights ────────────────────────────────────────────────────

// Structural shape of the GBP Performance API fetchMultiDailyMetricsTimeSeries
// response (only the fields we read).
interface GBPDatedValue {
  value?: string | null
  date?: { year?: number | null; month?: number | null; day?: number | null } | null
}

interface GBPDailyMetricTimeSeries {
  dailyMetric?: string | null
  timeSeries?: { datedValues?: GBPDatedValue[] | null } | null
}

interface GBPPerfResponse {
  multiDailyMetricTimeSeries?: Array<{
    dailyMetricTimeSeries?: GBPDailyMetricTimeSeries[] | null
  }> | null
}

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
  opts: { granularity?: GBPInsightsGranularity } = {},
): Promise<GBPInsightsRow> {
  const granularity: GBPInsightsGranularity = opts.granularity ?? 'total'
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
  const json = (await res.json()) as GBPPerfResponse

  const totals: Record<string, number> = {}
  const dailyMap = new Map<string, Record<string, number>>()
  const monthlyMap = new Map<string, Record<string, number>>()

  const series = json.multiDailyMetricTimeSeries ?? []
  for (const block of series) {
    const inner = block.dailyMetricTimeSeries ?? []
    for (const dm of inner) {
      const metric: string = dm.dailyMetric ?? 'UNKNOWN'
      const datedValues = dm.timeSeries?.datedValues ?? []
      let total = 0
      for (const dv of datedValues) {
        const value = parseInt(dv.value ?? '0', 10) || 0
        total += value
        const ymd = partsToYmd(dv.date ?? {})
        if (granularity === 'daily') {
          if (!dailyMap.has(ymd)) dailyMap.set(ymd, {})
          dailyMap.get(ymd)![metric] = (dailyMap.get(ymd)![metric] ?? 0) + value
        } else if (granularity === 'monthly') {
          const ym = ymd.slice(0, 7) // YYYY-MM
          if (!monthlyMap.has(ym)) monthlyMap.set(ym, {})
          monthlyMap.get(ym)![metric] = (monthlyMap.get(ym)![metric] ?? 0) + value
        }
      }
      totals[metric] = (totals[metric] ?? 0) + total
    }
  }

  const daily =
    granularity === 'daily'
      ? Array.from(dailyMap.entries())
          .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
          .map(([date, m]) => ({ date, metrics: m }))
      : undefined

  const monthly =
    granularity === 'monthly'
      ? Array.from(monthlyMap.entries())
          .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
          .map(([month, m]) => ({ month, metrics: m }))
      : undefined

  return { locationName, metrics: totals, monthly, daily }
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
  // THE DOCUMENTED §9 FALSE POSITIVE, FIXED AT THE SOURCE.
  //
  // This branch used to be unconditional, and it is the one the pilot caught: Tornado is
  // a service-area business with a deliberately hidden address, the audit reported "No
  // storefront address" and docked the score to 85 — faulting a client for doing exactly
  // what Google tells service-area businesses to do. "An automated audit that faults a
  // client for correct configuration destroys trust in every other finding."
  //
  // Google's own Location resource says the storefront address "should not be set for
  // locations of type CUSTOMER_LOCATION_ONLY, but if set, any value provided will be
  // discarded" — so for those businesses the absence is not merely acceptable, it is the
  // only state the API permits. Only a storefront business missing its address is a
  // defect. Same precondition, same reasoning, as the LOCAL-003 detector.
  //
  // This could not be written until `serviceArea` joined LOCATION_READ_MASK: without it
  // every location parsed as a storefront and the fix would have been a coin flip.
  if (!loc.address && !loc.isServiceAreaBusiness) {
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

// ── Dashboard aggregate insights (WS-A3) ────────────────────────────────────────

// Key GBP performance metrics surfaced on the dashboard GBP overview. Order is
// intentional: actions first, then the four impression breakdowns.
export const GBP_DASHBOARD_METRICS: GBPPerfMetric[] = [
  'CALL_CLICKS',
  'WEBSITE_CLICKS',
  'BUSINESS_DIRECTION_REQUESTS',
  'BUSINESS_CONVERSATIONS',
  'BUSINESS_BOOKINGS',
  'BUSINESS_IMPRESSIONS_DESKTOP_MAPS',
  'BUSINESS_IMPRESSIONS_DESKTOP_SEARCH',
  'BUSINESS_IMPRESSIONS_MOBILE_MAPS',
  'BUSINESS_IMPRESSIONS_MOBILE_SEARCH',
]

/** Minimal date-range shape consumed here — structurally satisfied by DateRange. */
export interface GBPDateRange {
  startDate: string
  endDate: string
  compareStart: string
  compareEnd: string
}

export interface GBPMetricDelta {
  metric: string
  current: number
  previous: number
  /** Absolute change current − previous. */
  delta: number
  /** Percent change vs previous; null when previous is 0 (undefined growth). */
  deltaPct: number | null
}

export interface GBPLocationInsight {
  locationName: string // "locations/123"
  locationTitle: string
  /** City from the storefront address — disambiguates chain locations that all share one title. */
  locality?: string | null
  /** State/region code from the storefront address. */
  administrativeArea?: string | null
  /** Current-window totals per metric. */
  metrics: Record<string, number>
  /** true if the per-location insights fetch failed (counts as zero). */
  error?: string
}

export interface GBPClientInsights {
  accountName: string
  locationCount: number
  /** Number of locations whose insights fetch failed. */
  errorCount: number
  /** Summed current-window totals across all locations. */
  totals: Record<string, number>
  /** Summed comparison-window totals across all locations. */
  compareTotals: Record<string, number>
  /** Per-metric deltas (current vs comparison), in GBP_DASHBOARD_METRICS order. */
  deltas: GBPMetricDelta[]
  /** Per-location current-window rows, sorted by total impressions desc. */
  locations: GBPLocationInsight[]
  range: GBPDateRange
}

function sumImpressions(metrics: Record<string, number>): number {
  return (
    (metrics.BUSINESS_IMPRESSIONS_DESKTOP_MAPS ?? 0) +
    (metrics.BUSINESS_IMPRESSIONS_DESKTOP_SEARCH ?? 0) +
    (metrics.BUSINESS_IMPRESSIONS_MOBILE_MAPS ?? 0) +
    (metrics.BUSINESS_IMPRESSIONS_MOBILE_SEARCH ?? 0)
  )
}

function emptyMetricTotals(metrics: GBPPerfMetric[]): Record<string, number> {
  const out: Record<string, number> = {}
  for (const m of metrics) out[m] = 0
  return out
}

function addInto(target: Record<string, number>, src: Record<string, number>): void {
  for (const [k, v] of Array.from(Object.entries(src))) {
    target[k] = (target[k] ?? 0) + v
  }
}

/**
 * Aggregate GBP Performance insights for one account across all of its locations.
 *
 * Lists locations for `accountName`, then for each location fetches the key
 * dashboard metrics over both the current window (range.startDate..endDate) and
 * the comparison window (range.compareStart..compareEnd). Returns summed account
 * totals + per-metric deltas + per-location rows.
 *
 * The whole computation is cached via cachedFetch with a long TTL since the GBP
 * Performance API is heavily rate-limited and data only updates daily. Failed
 * per-location fetches degrade gracefully (counted as zero, flagged in errorCount).
 *
 * accountName: "accounts/123456"
 */
export async function fetchGBPClientInsights(
  accountName: string,
  range: GBPDateRange,
  opts: { granularity?: GBPInsightsGranularity; ttlSeconds?: number } = {},
): Promise<GBPClientInsights> {
  const ttlSeconds = opts.ttlSeconds ?? 60 * 60 * 18 // 18h — within the 12–24h band
  const cacheKey = [
    // v3: callers now pass a SCOPED parent (see decideGBPScope). Bumped so the 18h
    // unscoped entries written before that change are never served.
    'gbp:client-insights:v3',
    accountName,
    range.startDate,
    range.endDate,
    range.compareStart,
    range.compareEnd,
  ].join(':')

  return cachedFetch(cacheKey, ttlSeconds, async () => {
    const auth = await getAdminGBPOAuthClient()
    const locations = await listGBPLocations(accountName, auth)

    const totals = emptyMetricTotals(GBP_DASHBOARD_METRICS)
    const compareTotals = emptyMetricTotals(GBP_DASHBOARD_METRICS)
    const locationRows: GBPLocationInsight[] = []
    let errorCount = 0

    // Per-location, fetch current + comparison windows. Sequential across
    // locations keeps us within GBP Performance API rate limits; the two
    // windows for a single location run in parallel.
    for (const loc of locations) {
      try {
        const [cur, prev] = await Promise.all([
          fetchGBPLocationInsights(
            loc.name,
            GBP_DASHBOARD_METRICS,
            range.startDate,
            range.endDate,
            auth,
            { granularity: opts.granularity ?? 'total' },
          ),
          fetchGBPLocationInsights(
            loc.name,
            GBP_DASHBOARD_METRICS,
            range.compareStart,
            range.compareEnd,
            auth,
            { granularity: 'total' },
          ),
        ])

        addInto(totals, cur.metrics)
        addInto(compareTotals, prev.metrics)
        locationRows.push({
          locationName: loc.name,
          locationTitle: loc.title || loc.name,
          locality: loc.address?.locality ?? null,
          administrativeArea: loc.address?.administrativeArea ?? null,
          metrics: cur.metrics,
        })
      } catch (err) {
        errorCount += 1
        locationRows.push({
          locationName: loc.name,
          locationTitle: loc.title || loc.name,
          locality: loc.address?.locality ?? null,
          administrativeArea: loc.address?.administrativeArea ?? null,
          metrics: emptyMetricTotals(GBP_DASHBOARD_METRICS),
          error: err instanceof Error ? err.message : 'Insights fetch failed',
        })
      }
    }

    const deltas: GBPMetricDelta[] = GBP_DASHBOARD_METRICS.map((metric) => {
      const current = totals[metric] ?? 0
      const previous = compareTotals[metric] ?? 0
      const delta = current - previous
      const deltaPct = previous === 0 ? null : (delta / previous) * 100
      return { metric, current, previous, delta, deltaPct }
    })

    locationRows.sort(
      (a, b) => sumImpressions(b.metrics) - sumImpressions(a.metrics),
    )

    return {
      accountName,
      locationCount: locations.length,
      errorCount,
      totals,
      compareTotals,
      deltas,
      locations: locationRows,
      range,
    }
  })
}

// ── Audit rollup (WS-A3) ────────────────────────────────────────────────────────

export interface GBPAccountAudit {
  accountName: string
  locationCount: number
  /** Mean completeness score across locations (0–100), 0 when no locations. */
  avgScore: number
  /** Per-location audits, sorted by score ascending (worst first). */
  locations: LocationAudit[]
  /** issue text -> number of locations exhibiting it. */
  issueCounts: Record<string, number>
}

/**
 * Run auditLocation across every location in an account and roll the results up
 * into an account-level completeness summary. Cached with a long TTL — location
 * profile data changes infrequently.
 *
 * accountName: "accounts/123456"
 */
export async function auditGBPAccount(
  accountName: string,
  opts: { ttlSeconds?: number } = {},
): Promise<GBPAccountAudit> {
  const ttlSeconds = opts.ttlSeconds ?? 60 * 60 * 18 // 18h
  // v3: the payload shape changed. LocationAudit extends GBPLocation, which now carries
  // `isServiceAreaBusiness` — and an entry written before `serviceArea` joined the read
  // mask has no such key, so it deserializes as `undefined` and every service-area
  // business re-acquires the "No storefront address" false positive for up to 18 hours.
  // Bumping the key is the only way a shape change and a cache can both be safe.
  // (v2 bumped v1 for the scoped-parent change; see client-insights above.)
  const cacheKey = `gbp:account-audit:v3:${accountName}`

  return cachedFetch(cacheKey, ttlSeconds, async () => {
    const auth = await getAdminGBPOAuthClient()
    const locations = await listGBPLocations(accountName, auth)

    const audits = locations.map(auditLocation)

    const issueCounts: Record<string, number> = {}
    for (const a of audits) {
      for (const issue of a.issues) {
        issueCounts[issue] = (issueCounts[issue] ?? 0) + 1
      }
    }

    const avgScore =
      audits.length === 0
        ? 0
        : Math.round(audits.reduce((sum, a) => sum + a.score, 0) / audits.length)

    audits.sort((a, b) => a.score - b.score)

    return {
      accountName,
      locationCount: audits.length,
      avgScore,
      locations: audits,
      issueCounts,
    }
  })
}
