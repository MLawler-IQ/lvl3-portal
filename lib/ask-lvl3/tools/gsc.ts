import { google } from 'googleapis'
import type { AskTool } from './types'

export const gscTools: AskTool[] = [
  {
    status: 'Querying Search Console…',
    definition: {
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
    handler: async (input, ctx) => {
      if (!ctx.client.gsc_site_url) {
        return 'Error: No Search Console site configured for this client.'
      }
      const searchconsole = google.searchconsole({ version: 'v1', auth: ctx.auth })
      const { data } = await searchconsole.searchanalytics.query({
        siteUrl: ctx.client.gsc_site_url,
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
    },
  },
]
