import { google } from 'googleapis'
import type { AskTool } from './types'

export const ga4Tools: AskTool[] = [
  {
    status: 'Querying Google Analytics…',
    definition: {
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
    handler: async (input, ctx) => {
      if (!ctx.client.ga4_property_id) {
        return 'Error: No GA4 property configured for this client.'
      }
      const analyticsdata = google.analyticsdata({ version: 'v1beta', auth: ctx.auth })
      const { data } = await analyticsdata.properties.runReport({
        property: `properties/${ctx.client.ga4_property_id}`,
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
    },
  },
]
