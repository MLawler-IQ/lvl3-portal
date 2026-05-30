import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/server'
import { getAdminOAuthClient } from '@/lib/google-auth'
import { getAdminGBPOAuthClient } from '@/lib/gbp-auth'
import { google } from 'googleapis'
import Anthropic from '@anthropic-ai/sdk'
import { fetchKEKeywordData, fetchKERelatedKeywords } from '@/lib/connectors/keywords-everywhere'
import { fetchPageSpeedInsights } from '@/lib/connectors/pagespeed'
import { fetchAndParse } from '@/lib/connectors/crawler'
import { fetchSemrushDomainOrganic, fetchSemrushDomainRanks, fetchSemrushBacklinksOverview } from '@/lib/connectors/semrush-portal'
import { listGBPAccounts, listGBPLocations, auditLocation, fetchGBPLocationInsights, GBP_PERF_METRICS, type GBPPerfMetric } from '@/lib/connectors/gbp'
import type { OAuth2Client } from 'google-auth-library'
import * as XLSX from 'xlsx'
import type { ChatMessage, ChatArtifact } from '@/app/actions/ask-lvl3'

// ── Tool definitions ──────────────────────────────────────────────────────────

const TOOLS: Anthropic.Tool[] = [
  {
    name: 'get_gsc_data',
    description: `Query Google Search Console search analytics data for this client.
Use this whenever the question involves keywords, queries, pages, clicks, impressions, CTR, rankings, or organic search trends.
You can call this multiple times with different date ranges to compare periods.

Available dimensions (pass one or more):
  "query"  — keyword/search term level
  "page"   — landing page URL level
  "date"   — daily breakdown
  "device" — desktop / mobile / tablet

Date format: YYYY-MM-DD
rowLimit: max rows to return (default 100, max 25000)

Examples:
  - Top pages by clicks this month: dimensions=["page"], last 30 days
  - Monthly trend for a keyword: dimensions=["date","query"], filter by date range
  - Compare page clicks period over period: call twice with different date ranges`,
    input_schema: {
      type: 'object' as const,
      properties: {
        dimensions: {
          type: 'array',
          items: { type: 'string', enum: ['query', 'page', 'date', 'device'] },
          description: 'Dimensions to group by',
        },
        startDate: { type: 'string', description: 'Start date YYYY-MM-DD' },
        endDate: { type: 'string', description: 'End date YYYY-MM-DD' },
        rowLimit: { type: 'number', description: 'Max rows to return (default 100)' },
      },
      required: ['dimensions', 'startDate', 'endDate'],
    },
  },
  {
    name: 'get_ga4_data',
    description: `Query Google Analytics 4 data for this client.
Use this for questions about sessions, users, pageviews, revenue, conversions, traffic sources, or landing page performance.
You can call this multiple times with different date ranges or metric/dimension combinations.

Common metrics: sessions, totalUsers, screenPageViews, bounceRate, purchaseRevenue, transactions, averageSessionDuration
Common dimensions: sessionDefaultChannelGroup, landingPage, yearMonth, date, deviceCategory, country

Date format: YYYY-MM-DD
rowLimit: max rows to return (default 100)

Examples:
  - Top landing pages by sessions: dimensions=["landingPage"], metrics=["sessions"]
  - Monthly session trend: dimensions=["yearMonth"], metrics=["sessions","totalUsers"]
  - Channel breakdown: dimensions=["sessionDefaultChannelGroup"], metrics=["sessions"]`,
    input_schema: {
      type: 'object' as const,
      properties: {
        metrics: {
          type: 'array',
          items: { type: 'string' },
          description: 'GA4 metric names',
        },
        dimensions: {
          type: 'array',
          items: { type: 'string' },
          description: 'GA4 dimension names (optional)',
        },
        startDate: { type: 'string', description: 'Start date YYYY-MM-DD' },
        endDate: { type: 'string', description: 'End date YYYY-MM-DD' },
        rowLimit: { type: 'number', description: 'Max rows to return (default 100)' },
      },
      required: ['metrics', 'startDate', 'endDate'],
    },
  },
  {
    name: 'get_keyword_data',
    description: `Get search volume, CPC, competition, and 12-month trend data for specific keywords via Keywords Everywhere.
Use this when the user asks about keyword search volume, CPC, keyword difficulty, or monthly trends for specific terms.
Returns data for up to 100 keywords at once.`,
    input_schema: {
      type: 'object' as const,
      properties: {
        keywords: {
          type: 'array',
          items: { type: 'string' },
          description: 'List of keywords to look up (max 100)',
        },
        country: { type: 'string', description: 'Country code (default: us)' },
      },
      required: ['keywords'],
    },
  },
  {
    name: 'get_related_keywords',
    description: `Find related keywords for a seed keyword via Keywords Everywhere.
Use this for keyword research, content ideation, or finding long-tail variations of a topic.
Returns related terms with search volume, CPC, and competition.`,
    input_schema: {
      type: 'object' as const,
      properties: {
        keyword: { type: 'string', description: 'Seed keyword' },
        country: { type: 'string', description: 'Country code (default: us)' },
        limit: { type: 'number', description: 'Max results (default 50, max 1000)' },
      },
      required: ['keyword'],
    },
  },
  {
    name: 'get_domain_visibility',
    description: `Analyze a domain's organic search visibility via Semrush.
Returns organic keyword count, estimated organic traffic, organic traffic cost, and top ranking keywords.
Defaults to the current client's domain if no domain is specified.`,
    input_schema: {
      type: 'object' as const,
      properties: {
        domain: { type: 'string', description: 'Domain to analyze (defaults to client domain)' },
      },
      required: [],
    },
  },
  {
    name: 'get_competitor_gap',
    description: `Find keywords where a competitor ranks in the top 100 but you don't, using Semrush domain_organic.
Compares the competitor's keyword set against the client's, surfacing gap keywords sorted by volume.
Use this when the user asks about competitor keywords, keyword gaps, or competitive analysis.`,
    input_schema: {
      type: 'object' as const,
      properties: {
        competitor: { type: 'string', description: 'Competitor domain to compare against' },
        domain: { type: 'string', description: 'Your domain (defaults to client domain)' },
        limit: { type: 'number', description: 'Max keywords per domain (default 500)' },
      },
      required: ['competitor'],
    },
  },
  {
    name: 'crawl_page_seo',
    description: `Crawl a single web page and extract SEO elements: title, meta description, headings (H1-H6), canonical, robots meta, images (alt text audit), structured data, word count, Open Graph tags, and hreflang.
Use this when the user asks about on-page SEO for a specific URL, or wants a page audit.`,
    input_schema: {
      type: 'object' as const,
      properties: {
        url: { type: 'string', description: 'Full URL to crawl (e.g., https://example.com/page)' },
      },
      required: ['url'],
    },
  },
  {
    name: 'get_core_web_vitals',
    description: `Measure Core Web Vitals and Lighthouse performance for a URL via PageSpeed Insights API.
Returns CrUX field data (LCP, CLS, INP, FCP, TTFB) and Lighthouse lab metrics, with pass/fail assessment.
Use this when the user asks about page speed, performance, or Core Web Vitals.`,
    input_schema: {
      type: 'object' as const,
      properties: {
        url: { type: 'string', description: 'Full URL to analyze' },
        strategy: { type: 'string', enum: ['mobile', 'desktop'], description: 'Device (default: mobile)' },
      },
      required: ['url'],
    },
  },
  {
    name: 'get_backlink_overview',
    description: `Get backlink profile overview for a domain via Semrush: total backlinks, referring domains, follow/nofollow ratio, and authority score.
Defaults to the current client's domain if no domain is specified.`,
    input_schema: {
      type: 'object' as const,
      properties: {
        domain: { type: 'string', description: 'Domain to analyze (defaults to client domain)' },
      },
      required: [],
    },
  },
  {
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
  {
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
  {
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
  {
    name: 'create_spreadsheet',
    description: `Generate a downloadable .xlsx spreadsheet file for the user.
Use this when the user asks to export data, create a spreadsheet, download results, or says "give me a spreadsheet/CSV/Excel file".
You MUST have already fetched the data using other tools before calling this.
Pass the data as structured sheets with headers and rows.
Each sheet has a name (tab label), headers (column names), and rows (2D array of cell values).`,
    input_schema: {
      type: 'object' as const,
      properties: {
        filename: {
          type: 'string',
          description: 'File name without extension (e.g., "top-keywords-march")',
        },
        sheets: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string', description: 'Sheet tab name' },
              headers: { type: 'array', items: { type: 'string' }, description: 'Column headers' },
              rows: {
                type: 'array',
                items: { type: 'array', items: {} },
                description: 'Row data — each row is an array of cell values',
              },
            },
            required: ['name', 'headers', 'rows'],
          },
          description: 'One or more sheets to include in the workbook',
        },
      },
      required: ['filename', 'sheets'],
    },
  },
]

// ── Helpers ───────────────────────────────────────────────────────────────────

function today(): string {
  return new Date(Date.now() - 86400000).toISOString().slice(0, 10)
}

type OAuthClient = Awaited<ReturnType<typeof getAdminOAuthClient>>

function deriveClientDomain(gscSiteUrl: string | null): string {
  if (!gscSiteUrl) return ''
  return gscSiteUrl
    .replace(/^sc-domain:/, '')
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\/.*$/, '')
    .toLowerCase()
    .trim()
}

// Uses a pre-built OAuth client so cookies() is never called inside the stream
async function executeTool(
  name: string,
  input: Record<string, unknown>,
  client: { gsc_site_url: string | null; ga4_property_id: string | null },
  auth: OAuthClient,
  gbpAuth: OAuth2Client | null,
  context?: { service: Awaited<ReturnType<typeof createServiceClient>>; clientId: string; conversationId: string }
): Promise<string> {
  try {
    if (name === 'get_gsc_data') {
      if (!client.gsc_site_url) {
        return 'Error: No Search Console site configured for this client.'
      }
      const searchconsole = google.searchconsole({ version: 'v1', auth })
      const { data } = await searchconsole.searchanalytics.query({
        siteUrl: client.gsc_site_url,
        requestBody: {
          startDate: input.startDate as string,
          endDate: input.endDate as string,
          dimensions: input.dimensions as string[],
          rowLimit: (input.rowLimit as number) ?? 100,
        },
      })
      const rows = (data.rows ?? []).map((row) => ({
        keys: row.keys ?? [],
        clicks: row.clicks ?? 0,
        impressions: row.impressions ?? 0,
        ctr: Math.round((row.ctr ?? 0) * 10000) / 100,
        position: Math.round((row.position ?? 0) * 10) / 10,
      }))
      if (rows.length === 0) return 'No data found for this date range and dimensions.'
      return JSON.stringify(rows)
    }

    if (name === 'get_ga4_data') {
      if (!client.ga4_property_id) {
        return 'Error: No GA4 property configured for this client.'
      }
      const analyticsdata = google.analyticsdata({ version: 'v1beta', auth })
      const { data } = await analyticsdata.properties.runReport({
        property: `properties/${client.ga4_property_id}`,
        requestBody: {
          dateRanges: [
            {
              startDate: input.startDate as string,
              endDate: input.endDate as string,
            },
          ],
          metrics: (input.metrics as string[]).map((n) => ({ name: n })),
          dimensions: ((input.dimensions as string[] | undefined) ?? []).map((n) => ({
            name: n,
          })),
          limit: String((input.rowLimit as number) ?? 100),
        },
      })
      const rows = (data.rows ?? []).map((row) => ({
        dimensions: (row.dimensionValues ?? []).map((d) => d.value ?? ''),
        metrics: (row.metricValues ?? []).map((m) => parseFloat(m.value ?? '0')),
      }))
      if (rows.length === 0) return 'No data found for this date range and dimensions.'
      return JSON.stringify(rows)
    }

    if (name === 'get_keyword_data') {
      const keKey = process.env.KEYWORDS_EVERYWHERE_API_KEY
      if (!keKey) return 'Error: KEYWORDS_EVERYWHERE_API_KEY is not configured.'
      const keywords = input.keywords as string[]
      const country = (input.country as string) ?? 'us'
      const rows = await fetchKEKeywordData(keywords, keKey, country)
      return JSON.stringify(rows)
    }

    if (name === 'get_related_keywords') {
      const keKey = process.env.KEYWORDS_EVERYWHERE_API_KEY
      if (!keKey) return 'Error: KEYWORDS_EVERYWHERE_API_KEY is not configured.'
      const keyword = input.keyword as string
      const country = (input.country as string) ?? 'us'
      const limit = (input.limit as number) ?? 50
      const rows = await fetchKERelatedKeywords(keyword, keKey, country, limit)
      return JSON.stringify(rows)
    }

    if (name === 'get_domain_visibility') {
      const apiKey = process.env.SEMRUSH_API_KEY
      if (!apiKey) return 'Error: SEMRUSH_API_KEY is not configured.'
      const domain = (input.domain as string) || deriveClientDomain(client.gsc_site_url)
      if (!domain) return 'Error: No domain specified and no client GSC site configured.'
      const [ranks, keywords] = await Promise.all([
        fetchSemrushDomainRanks(domain, apiKey),
        fetchSemrushDomainOrganic(domain, apiKey, 'us', 50),
      ])
      return JSON.stringify({ ranks, top_keywords: keywords })
    }

    if (name === 'get_competitor_gap') {
      const apiKey = process.env.SEMRUSH_API_KEY
      if (!apiKey) return 'Error: SEMRUSH_API_KEY is not configured.'
      const competitor = input.competitor as string
      const domain = (input.domain as string) || deriveClientDomain(client.gsc_site_url)
      if (!domain) return 'Error: No domain specified and no client GSC site configured.'
      const limit = (input.limit as number) ?? 500
      const [clientKws, competitorKws] = await Promise.all([
        fetchSemrushDomainOrganic(domain, apiKey, 'us', limit),
        fetchSemrushDomainOrganic(competitor, apiKey, 'us', limit),
      ])
      const clientSet = new Set(clientKws.map((r) => r.keyword.toLowerCase()))
      const gaps = competitorKws
        .filter((r) => !clientSet.has(r.keyword.toLowerCase()))
        .sort((a, b) => b.volume - a.volume)
        .slice(0, 100)
      return JSON.stringify({ client_keywords: clientKws.length, competitor_keywords: competitorKws.length, gaps })
    }

    if (name === 'crawl_page_seo') {
      const url = input.url as string
      const page = await fetchAndParse(url)
      const issues: string[] = []
      if (!page.title) issues.push('Missing title tag')
      if (!page.metaDescription) issues.push('Missing meta description')
      if (page.title.length > 60) issues.push('Title too long (>60 chars)')
      if (page.metaDescription.length > 160) issues.push('Meta description too long (>160 chars)')
      const h1s = page.headings.filter((h) => h.level === 1)
      if (h1s.length === 0) issues.push('Missing H1')
      if (h1s.length > 1) issues.push(`Multiple H1 tags (${h1s.length})`)
      const missingAlt = page.images.filter((i) => !i.hasAlt).length
      if (missingAlt > 0) issues.push(`${missingAlt} images missing alt text`)
      return JSON.stringify({ ...page, issues })
    }

    if (name === 'get_core_web_vitals') {
      const url = input.url as string
      const strategy = (input.strategy as 'mobile' | 'desktop') ?? 'mobile'
      const apiKey = process.env.PAGESPEED_API_KEY
      const result = await fetchPageSpeedInsights(url, strategy, apiKey)
      return JSON.stringify(result)
    }

    if (name === 'get_backlink_overview') {
      const apiKey = process.env.SEMRUSH_API_KEY
      if (!apiKey) return 'Error: SEMRUSH_API_KEY is not configured.'
      const domain = (input.domain as string) || deriveClientDomain(client.gsc_site_url)
      if (!domain) return 'Error: No domain specified and no client GSC site configured.'
      const overview = await fetchSemrushBacklinksOverview(domain, apiKey)
      if (!overview) return 'No backlink data found for this domain.'
      return JSON.stringify(overview)
    }

    if (name === 'list_gbp_accounts') {
      if (!gbpAuth) return 'Error: Google Business Profile is not connected. Connect it from the admin settings.'
      const accounts = await listGBPAccounts(gbpAuth)
      if (accounts.length === 0) return 'No Google Business Profile accounts found.'
      return JSON.stringify(accounts)
    }

    if (name === 'get_gbp_locations') {
      if (!gbpAuth) return 'Error: Google Business Profile is not connected. Connect it from the admin settings.'
      const accountName = input.accountName as string
      if (!accountName) return 'Error: accountName is required (e.g. "accounts/123456789"). Call list_gbp_accounts first.'
      const titleFilter = ((input.titleFilter as string) ?? '').trim().toLowerCase()
      const limit = Math.min(Math.max((input.limit as number) ?? 50, 1), 500)

      const all = await listGBPLocations(accountName, gbpAuth)
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
    }

    if (name === 'get_gbp_insights') {
      if (!gbpAuth) return 'Error: Google Business Profile is not connected. Connect it from the admin settings.'
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
    }

    if (name === 'create_spreadsheet') {
      if (!context) return 'Error: Missing storage context for spreadsheet generation.'
      const filename = (input.filename as string) || 'export'
      const sheets = input.sheets as Array<{ name: string; headers: string[]; rows: unknown[][] }>
      if (!sheets?.length) return 'Error: No sheets provided.'

      const wb = XLSX.utils.book_new()
      for (const sheet of sheets) {
        const ws = XLSX.utils.aoa_to_sheet([sheet.headers, ...sheet.rows])
        // Auto-size columns based on header lengths
        ws['!cols'] = sheet.headers.map((h) => ({ wch: Math.max(h.length + 2, 12) }))
        XLSX.utils.book_append_sheet(wb, ws, sheet.name.slice(0, 31))
      }
      const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer

      const storagePath = `${context.clientId}/${context.conversationId}/${filename}-${Date.now()}.xlsx`
      const { error: uploadErr } = await context.service.storage
        .from('chat-artifacts')
        .upload(storagePath, buffer, {
          contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          upsert: false,
        })
      if (uploadErr) return `Error uploading spreadsheet: ${uploadErr.message}`

      const { data: signed } = await context.service.storage
        .from('chat-artifacts')
        .createSignedUrl(storagePath, 86400) // 24h
      const url = signed?.signedUrl ?? ''

      const totalRows = sheets.reduce((sum, s) => sum + s.rows.length, 0)
      return JSON.stringify({
        artifact: true,
        path: storagePath,
        filename: `${filename}.xlsx`,
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        url,
        sheetCount: sheets.length,
        totalRows,
      })
    }

    return `Unknown tool: ${name}`
  } catch (err) {
    // Extract the specific Google API error reason if available
    type GaxiosErr = { response?: { data?: { error?: { message?: string; errors?: Array<{ reason?: string }> } } } }
    const googleMsg = (err as GaxiosErr)?.response?.data?.error?.message
    const googleReason = (err as GaxiosErr)?.response?.data?.error?.errors?.[0]?.reason
    const baseMsg = err instanceof Error ? err.message : String(err)
    const detail = googleMsg ?? baseMsg
    console.error('[ask-lvl3 tool error]', name, { input, detail, reason: googleReason })
    return `Tool error (${name}): ${detail}${googleReason ? ` (${googleReason})` : ''}`
  }
}

// ── Route Handler ─────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  // ── All cookie-dependent calls MUST happen before the ReadableStream ─────────
  // cookies() from next/headers is unavailable inside ReadableStream callbacks.

  // 1. Auth check
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 })
  }

  const service = await createServiceClient()
  const { data: profile } = await service
    .from('users')
    .select('role')
    .eq('id', user.id)
    .single()

  if (!profile || profile.role !== 'admin') {
    return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 })
  }

  // 2. Pre-fetch OAuth client (calls createServiceClient → cookies internally)
  let oauthClient: OAuthClient
  try {
    oauthClient = await getAdminOAuthClient()
  } catch (err) {
    return new Response(
      JSON.stringify({
        error: err instanceof Error ? err.message : 'Google account not connected',
      }),
      { status: 500 }
    )
  }

  // GBP uses a separate OAuth token. Pre-fetch so cookies() isn't called inside the stream.
  // If GBP isn't connected, GBP tools will return a friendly error; everything else still works.
  let gbpOAuthClient: OAuth2Client | null = null
  try {
    gbpOAuthClient = await getAdminGBPOAuthClient()
  } catch {
    gbpOAuthClient = null
  }

  // 3. Parse body
  const body = await req.json()
  const {
    clientId,
    messages,
    conversationId: incomingConvId,
  }: { clientId: string; messages: ChatMessage[]; conversationId?: string } = body

  // ── Stream ────────────────────────────────────────────────────────────────────
  const encoder = new TextEncoder()

  function emit(controller: ReadableStreamDefaultController, obj: object) {
    controller.enqueue(encoder.encode(JSON.stringify(obj) + '\n'))
  }

  const stream = new ReadableStream({
    async start(controller) {
      try {
        // Fetch client row — uses pre-created service client (no new cookies() call)
        const { data: client } = await service
          .from('clients')
          .select('name, gsc_site_url, ga4_property_id, analytics_summary, snapshot_insights')
          .eq('id', clientId)
          .single()

        if (!client) {
          emit(controller, { type: 'error', message: 'Client not found' })
          controller.close()
          return
        }

        // Build system prompt
        const contextParts: string[] = [
          `Client: ${client.name}`,
          `Today's date: ${today()}`,
          `GSC site: ${client.gsc_site_url ?? 'not configured'}`,
          `GA4 property: ${client.ga4_property_id ?? 'not configured'}`,
        ]

        if (client.analytics_summary) {
          contextParts.push(`Stored Analytics Summary:\n${client.analytics_summary}`)
        }

        if (client.snapshot_insights) {
          const si = client.snapshot_insights as {
            takeaways?: string
            anomalies?: string
            opportunities?: string
          }
          if (si.takeaways) contextParts.push(`Key Takeaways: ${si.takeaways}`)
          if (si.anomalies) contextParts.push(`Anomalies: ${si.anomalies}`)
          if (si.opportunities) contextParts.push(`Opportunities: ${si.opportunities}`)
        }

        const clientDomain = deriveClientDomain(client.gsc_site_url)

        const systemPrompt = `You are Ask LVL3, an expert SEO and digital marketing strategist for the agency LVL3, advising the internal team on a specific client.

${contextParts.join('\n\n')}

Client domain: ${clientDomain || 'not configured'}

You have 13 tools available to fetch live data:
- get_gsc_data: Query Google Search Console (keywords, pages, clicks, impressions, rankings)
- get_ga4_data: Query Google Analytics 4 (sessions, users, traffic, revenue, landing pages)
- get_keyword_data: Look up search volume, CPC, competition, and trends for specific keywords
- get_related_keywords: Find related/long-tail keywords for a seed term
- get_domain_visibility: Semrush organic visibility (keyword count, traffic estimate, top keywords)
- get_competitor_gap: Find keywords a competitor ranks for that this client doesn't
- crawl_page_seo: On-page SEO audit of a URL (title, meta, headings, images, structured data)
- get_core_web_vitals: PageSpeed Insights + Core Web Vitals for a URL
- get_backlink_overview: Semrush backlink profile (total backlinks, referring domains, authority score)
- list_gbp_accounts: List Google Business Profile accounts the agency has access to (call first for any GBP question)
- get_gbp_locations: Fetch and audit all GBP locations under an account (NAP, hours, categories, completeness score)
- get_gbp_insights: Pull GBP performance metrics (impressions, calls, website clicks, direction requests, bookings) for one or more locations over a date range
- create_spreadsheet: Generate a downloadable .xlsx file from structured data. Use AFTER fetching data with other tools when the user wants to export, download, or get a spreadsheet/CSV/Excel file.

When a question requires data, use the tools to fetch it rather than saying you don't have it.
When the user asks to export data, download a spreadsheet, or get an Excel file, first fetch the data with the appropriate tool, then call create_spreadsheet with the results formatted as headers and rows.
For trend or comparison questions, call the tool twice — once for the current period and once for the prior period — then calculate the delta yourself.
Tools that accept a domain default to "${clientDomain || 'the client domain'}" when not specified.
Be specific and direct. Skip preamble. Lead with the actual answer, then support it with data.`

        // Upsert conversation
        let conversationId: string = incomingConvId ?? ''
        if (!conversationId) {
          const lastUserMsg = [...messages].reverse().find((m) => m.role === 'user')
          const title = lastUserMsg ? lastUserMsg.content.slice(0, 80) : 'New conversation'
          const { data: conv } = await service
            .from('ask_lvl3_conversations')
            .insert({ client_id: clientId, title })
            .select('id')
            .single()
          conversationId = conv?.id ?? ''
        } else {
          await service
            .from('ask_lvl3_conversations')
            .update({ updated_at: new Date().toISOString() })
            .eq('id', conversationId)
        }

        // Insert the new user message (last in array)
        const lastUserMsg = [...messages].reverse().find((m) => m.role === 'user')
        if (lastUserMsg && conversationId) {
          await service.from('ask_lvl3_messages').insert({
            conversation_id: conversationId,
            role: 'user',
            content: lastUserMsg.content,
          })
        }

        const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

        const loopMessages: Anthropic.MessageParam[] = messages.map((m) => ({
          role: m.role,
          content: m.content,
        }))

        const MAX_ITERATIONS = 6
        let assistantText = ''
        const allArtifacts: ChatArtifact[] = []

        for (let i = 0; i < MAX_ITERATIONS; i++) {
          const streamObj = anthropic.messages.stream({
            model: 'claude-sonnet-4-6',
            max_tokens: 4096,
            system: systemPrompt,
            tools: TOOLS,
            messages: loopMessages,
          })

          let isToolIteration = false
          let partialText = '' // text emitted this iteration; cleared if tool_use detected

          for await (const event of streamObj) {
            if (
              event.type === 'content_block_start' &&
              event.content_block.type === 'tool_use'
            ) {
              if (!isToolIteration) {
                isToolIteration = true
                // Clear any thinking text streamed before detecting tool_use
                if (partialText) {
                  emit(controller, { type: 'clear_partial' })
                  assistantText = assistantText.slice(
                    0,
                    assistantText.length - partialText.length
                  )
                  partialText = ''
                }
              }
            }
            if (
              !isToolIteration &&
              event.type === 'content_block_delta' &&
              event.delta.type === 'text_delta'
            ) {
              partialText += event.delta.text
              assistantText += event.delta.text
              emit(controller, { type: 'text', delta: event.delta.text })
            }
          }

          const finalMsg = await streamObj.finalMessage()

          if (finalMsg.stop_reason === 'end_turn') {
            if (conversationId && assistantText) {
              await service.from('ask_lvl3_messages').insert({
                conversation_id: conversationId,
                role: 'assistant',
                content: assistantText,
                artifacts: allArtifacts.length > 0 ? allArtifacts : [],
              })
            }
            emit(controller, { type: 'done', conversationId })
            controller.close()
            return
          }

          if (finalMsg.stop_reason === 'tool_use') {
            loopMessages.push({ role: 'assistant', content: finalMsg.content })

            const toolBlocks = finalMsg.content.filter((b) => b.type === 'tool_use')

            // Emit status before executing tools
            const STATUS_MAP: Record<string, string> = {
              get_gsc_data: 'Querying Search Console\u2026',
              get_ga4_data: 'Querying Google Analytics\u2026',
              get_keyword_data: 'Looking up keyword data\u2026',
              get_related_keywords: 'Finding related keywords\u2026',
              get_domain_visibility: 'Analyzing domain visibility\u2026',
              get_competitor_gap: 'Comparing competitor keywords\u2026',
              crawl_page_seo: 'Crawling page for SEO audit\u2026',
              get_core_web_vitals: 'Running PageSpeed analysis\u2026',
              get_backlink_overview: 'Fetching backlink profile\u2026',
              list_gbp_accounts: 'Listing Google Business Profile accounts\u2026',
              get_gbp_locations: 'Auditing Google Business Profile locations\u2026',
              get_gbp_insights: 'Pulling Google Business Profile insights\u2026',
              create_spreadsheet: 'Generating spreadsheet\u2026',
            }
            for (const block of toolBlocks) {
              if (block.type !== 'tool_use') continue
              const statusText = STATUS_MAP[block.name] ?? `Running ${block.name}\u2026`
              emit(controller, { type: 'status', text: statusText })
            }

            // Execute tools in parallel using the pre-built oauthClient
            const collectedArtifacts: ChatArtifact[] = []
            const toolResults = await Promise.all(
              toolBlocks.map(async (block) => {
                if (block.type !== 'tool_use') return null
                const result = await executeTool(
                  block.name,
                  block.input as Record<string, unknown>,
                  { gsc_site_url: client.gsc_site_url, ga4_property_id: client.ga4_property_id },
                  oauthClient,
                  gbpOAuthClient,
                  { service, clientId, conversationId }
                )

                // Detect artifact results and emit download event
                try {
                  const parsed = JSON.parse(result)
                  if (parsed?.artifact === true && parsed.url) {
                    const artifact: ChatArtifact = {
                      path: parsed.path,
                      filename: parsed.filename,
                      mimeType: parsed.mimeType,
                    }
                    collectedArtifacts.push(artifact)
                    emit(controller, {
                      type: 'artifact',
                      path: parsed.path,
                      filename: parsed.filename,
                      mimeType: parsed.mimeType,
                      url: parsed.url,
                    })
                  }
                } catch {
                  // Not JSON or not an artifact — fine
                }

                return {
                  type: 'tool_result' as const,
                  tool_use_id: block.id,
                  content: result,
                }
              })
            )

            allArtifacts.push(...collectedArtifacts)

            loopMessages.push({
              role: 'user',
              content: toolResults.filter(
                Boolean
              ) as Anthropic.Messages.ToolResultBlockParam[],
            })

            continue
          }

          // Unexpected stop reason — close out
          emit(controller, { type: 'done', conversationId })
          controller.close()
          return
        }

        // Hit max iterations — emit fallback
        const fallback =
          'I ran into repeated errors fetching the data and was unable to complete your request. ' +
          "This usually means the GSC or GA4 data source is unavailable or the date range returned no results. " +
          "Try a simpler question, or check that the client's GSC site URL and GA4 property are configured correctly in client settings."
        emit(controller, { type: 'text', delta: fallback })
        if (conversationId) {
          await service.from('ask_lvl3_messages').insert({
            conversation_id: conversationId,
            role: 'assistant',
            content: fallback,
          })
        }
        emit(controller, { type: 'done', conversationId })
        controller.close()
      } catch (err) {
        emit(controller, {
          type: 'error',
          message: err instanceof Error ? err.message : 'Failed to get response',
        })
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson',
      'Cache-Control': 'no-cache',
    },
  })
}
