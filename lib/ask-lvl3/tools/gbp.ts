import {
  auditLocation,
  fetchGBPLocationInsights,
  GBP_PERF_METRICS,
  listGBPAccounts,
  listGBPLocations,
  type GBPPerfMetric,
} from '@/lib/connectors/gbp'
import type { AskTool } from './types'

export const gbpTools: AskTool[] = [
  {
    status: 'Listing Google Business Profile accounts…',
    definition: {
      name: 'list_gbp_accounts',
      description: `List all Google Business Profile accounts accessible to the agency.
Use this first when the user asks about Google Business Profile, GBP, Google My Business, GMB, business listings, or local SEO — you need an account resource name (e.g. "accounts/123456") before you can fetch locations.
Returns an array of accounts with their resource name, display name, and type.`,
      input_schema: {
        type: 'object' as const,
        properties: {},
        required: [],
      },
    },
    handler: async (_input, ctx) => {
      if (!ctx.gbpAuth) return 'Error: Google Business Profile is not connected. Connect it from the admin settings.'
      const accounts = await listGBPAccounts(ctx.gbpAuth)
      if (accounts.length === 0) return 'No Google Business Profile accounts found.'
      return JSON.stringify(accounts)
    },
  },
  {
    status: 'Auditing Google Business Profile locations…',
    definition: {
      name: 'get_gbp_locations',
      description: `Fetch Google Business Profile locations for a given GBP account, with an automatic audit (completeness score 0-100 and a list of issues per location).
Use this when the user asks about a client's GBP locations, business listings, NAP (name/address/phone) consistency, missing hours, missing categories, listing audits, or local SEO health.

IMPORTANT: Some agency-level GBP accounts contain thousands of locations across many brands. Always pass a titleFilter (case-insensitive substring of the business name) when you can — for example titleFilter="True Food Kitchen". Without a filter, results are capped at 'limit' (default 50) and you'll see truncated:true.

Returns each location with: resource name, title, address, phone, website, primary category, description, hours present (boolean), open status, Maps URI, audit score, and specific issues found. Detailed hoursPeriods are omitted to keep responses compact — ask the user if they need them.

Workflow: call list_gbp_accounts first to get an accountName, then pass it here. After this call, use the returned 'name' fields (e.g. "locations/123") with get_gbp_insights for performance data.`,
      input_schema: {
        type: 'object' as const,
        properties: {
          accountName: {
            type: 'string',
            description: 'GBP account resource name from list_gbp_accounts, e.g. "accounts/123456789"',
          },
          titleFilter: {
            type: 'string',
            description: 'Case-insensitive substring to match against location title. Strongly recommended for agency accounts.',
          },
          limit: {
            type: 'number',
            description: 'Max locations to return after filtering (default 50, max 500).',
          },
        },
        required: ['accountName'],
      },
    },
    handler: async (input, ctx) => {
      if (!ctx.gbpAuth) return 'Error: Google Business Profile is not connected. Connect it from the admin settings.'
      const accountName = input.accountName as string
      if (!accountName) return 'Error: accountName is required (e.g. "accounts/123456789"). Call list_gbp_accounts first.'
      const titleFilter = ((input.titleFilter as string) ?? '').trim().toLowerCase()
      const limit = Math.min(Math.max((input.limit as number) ?? 50, 1), 500)

      const all = await listGBPLocations(accountName, ctx.gbpAuth)
      if (all.length === 0) return 'No locations found in this account.'

      const filtered = titleFilter
        ? all.filter((l) => (l.title ?? '').toLowerCase().includes(titleFilter))
        : all

      const truncated = filtered.length > limit
      const window = filtered.slice(0, limit)
      const auditedWindow = window.map(auditLocation)
      const avgScoreWindow = auditedWindow.length
        ? Math.round(auditedWindow.reduce((s, l) => s + l.score, 0) / auditedWindow.length)
        : 0

      // Slim payload: drop verbose hoursPeriods, keep boolean
      const slim = auditedWindow.map((l) => ({
        name: l.name,
        title: l.title,
        primaryPhone: l.primaryPhone,
        websiteUri: l.websiteUri,
        addressFormatted: l.addressFormatted,
        primaryCategory: l.primaryCategory,
        description: l.description,
        openStatus: l.openStatus,
        hasRegularHours: l.hasRegularHours,
        mapsUri: l.mapsUri,
        newReviewUri: l.newReviewUri,
        score: l.score,
        issues: l.issues,
      }))

      return JSON.stringify({
        accountTotal: all.length,
        matched: filtered.length,
        returned: slim.length,
        truncated,
        titleFilter: titleFilter || null,
        avgScore: avgScoreWindow,
        locations: slim,
        ...(truncated
          ? {
              hint: `Showed first ${limit} of ${filtered.length} matches. Narrow titleFilter or raise limit (max 500). For broad analyses, export to spreadsheet via create_spreadsheet.`,
            }
          : {}),
      })
    },
  },
  {
    status: 'Pulling Google Business Profile insights…',
    definition: {
      name: 'get_gbp_insights',
      description: `Pull Google Business Profile performance insights (impressions, calls, website clicks, direction requests, bookings, etc.) for one or more locations over a date range.
Use this for questions about GBP / GMB / Google Business Profile performance — calls from listing, website clicks from listing, direction requests, map vs. search impressions, mobile vs. desktop, period-over-period changes, or local visibility trends.

Workflow:
  1. Call list_gbp_accounts to get an accountName.
  2. Call get_gbp_locations to get location resource names (e.g. "locations/123").
  3. Call this tool with one or more location names.

Available metrics (pass any subset; defaults to the most commonly used ones):
  BUSINESS_IMPRESSIONS_DESKTOP_MAPS, BUSINESS_IMPRESSIONS_DESKTOP_SEARCH,
  BUSINESS_IMPRESSIONS_MOBILE_MAPS, BUSINESS_IMPRESSIONS_MOBILE_SEARCH,
  CALL_CLICKS, WEBSITE_CLICKS, BUSINESS_DIRECTION_REQUESTS,
  BUSINESS_CONVERSATIONS, BUSINESS_BOOKINGS, BUSINESS_FOOD_ORDERS, BUSINESS_FOOD_MENU_CLICKS

Date format: YYYY-MM-DD. The GBP API only returns data through ~3 days ago — avoid using today's date as endDate.
By default returns totals per location over the window. Set granularity="monthly" for a month-by-month breakdown (recommended for trend analysis over multi-month / multi-year ranges) or "daily" for day-by-day (small windows only).
For period comparison, call twice with different date ranges.`,
      input_schema: {
        type: 'object' as const,
        properties: {
          locationNames: {
            type: 'array',
            items: { type: 'string' },
            description: 'Location resource names from get_gbp_locations, e.g. ["locations/123","locations/456"]',
          },
          metrics: {
            type: 'array',
            items: { type: 'string' },
            description: 'GBP performance metric names. Defaults to all common metrics if omitted.',
          },
          startDate: { type: 'string', description: 'Start date YYYY-MM-DD' },
          endDate: { type: 'string', description: 'End date YYYY-MM-DD (must be at least 3 days ago)' },
          granularity: {
            type: 'string',
            enum: ['total', 'monthly', 'daily'],
            description: 'Aggregation level. "total" (default) = single total per metric per location. "monthly" = YYYY-MM bucket. "daily" = per-day (only for short windows).',
          },
        },
        required: ['locationNames', 'startDate', 'endDate'],
      },
    },
    handler: async (input, ctx) => {
      if (!ctx.gbpAuth) return 'Error: Google Business Profile is not connected. Connect it from the admin settings.'
      const gbpAuth = ctx.gbpAuth
      const locationNames = (input.locationNames as string[]) ?? []
      if (!locationNames.length) return 'Error: locationNames is required. Call get_gbp_locations first.'
      const startDate = input.startDate as string
      const endDate = input.endDate as string
      if (!startDate || !endDate) return 'Error: startDate and endDate are required (YYYY-MM-DD).'
      const requested = (input.metrics as string[] | undefined) ?? []
      const allowed = new Set<string>(GBP_PERF_METRICS)
      const metrics: GBPPerfMetric[] = (
        requested.length > 0
          ? requested.filter((m) => allowed.has(m))
          : ['BUSINESS_IMPRESSIONS_DESKTOP_MAPS','BUSINESS_IMPRESSIONS_DESKTOP_SEARCH','BUSINESS_IMPRESSIONS_MOBILE_MAPS','BUSINESS_IMPRESSIONS_MOBILE_SEARCH','CALL_CLICKS','WEBSITE_CLICKS','BUSINESS_DIRECTION_REQUESTS']
      ) as GBPPerfMetric[]
      if (metrics.length === 0) return 'Error: No valid metrics requested. See tool description for the allowed list.'
      const granularity = ((input.granularity as 'total' | 'monthly' | 'daily') ?? 'total')
      if (locationNames.length > 50) {
        return `Error: get_gbp_insights accepts up to 50 locations per call (got ${locationNames.length}). Filter via get_gbp_locations titleFilter first, or batch.`
      }
      if (granularity === 'daily' && locationNames.length > 10) {
        return `Error: granularity="daily" is limited to 10 locations per call (got ${locationNames.length}). Use granularity="monthly" for multi-location trends.`
      }

      const results = await Promise.all(
        locationNames.map(async (loc) => {
          try {
            return await fetchGBPLocationInsights(loc, metrics, startDate, endDate, gbpAuth, { granularity })
          } catch (e) {
            return { locationName: loc, error: e instanceof Error ? e.message : String(e), metrics: {} as Record<string, number> }
          }
        })
      )
      return JSON.stringify({ startDate, endDate, granularity, metrics, locations: results })
    },
  },
]
