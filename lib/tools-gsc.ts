import { getAdminOAuthClient } from '@/lib/google-auth'
import { google } from 'googleapis'
import { cachedFetch } from '@/lib/api-cache'

export type GSCRow = {
  query: string
  page: string
  clicks: number
  impressions: number
  ctr: number
  position: number
}

const GSC_TTL_SECONDS = 6 * 3600 // GSC data lags ~2-3 days; 6h cache is safe.

export async function fetchGSCRows(
  siteUrl: string,
  days = 90
): Promise<GSCRow[]> {
  return cachedFetch(`gsc:rows:${siteUrl}:${days}`, GSC_TTL_SECONDS, async () => {
    const auth = await getAdminOAuthClient()
    const searchconsole = google.searchconsole({ version: 'v1', auth })

    const today = new Date()
    const fmt = (d: Date) => d.toISOString().slice(0, 10)
    const endDate = fmt(new Date(today.getTime() - 86400000))
    const startDate = fmt(new Date(today.getTime() - days * 86400000))

    const { data } = await searchconsole.searchanalytics.query({
      siteUrl,
      requestBody: {
        startDate,
        endDate,
        dimensions: ['query', 'page'],
        rowLimit: 25000,
      },
    })

    return (data.rows ?? []).map((row) => ({
      query: row.keys?.[0] ?? '',
      page: row.keys?.[1] ?? '',
      clicks: row.clicks ?? 0,
      impressions: row.impressions ?? 0,
      ctr: (row.ctr ?? 0) * 100,
      position: row.position ?? 0,
    }))
  })
}

/** Fetch page-level GSC data for an explicit date range */
export async function fetchGSCPageRows(
  siteUrl: string,
  startDate: string,   // YYYY-MM-DD
  endDate: string      // YYYY-MM-DD
): Promise<{ page: string; clicks: number; impressions: number; position: number }[]> {
  return cachedFetch(`gsc:pages:${siteUrl}:${startDate}:${endDate}`, GSC_TTL_SECONDS, async () => {
    const auth = await getAdminOAuthClient()
    const searchconsole = google.searchconsole({ version: 'v1', auth })
    const { data } = await searchconsole.searchanalytics.query({
      siteUrl,
      requestBody: {
        startDate,
        endDate,
        dimensions: ['page'],
        rowLimit: 25000,
      },
    })
    return (data.rows ?? []).map(row => ({
      page: row.keys?.[0] ?? '',
      clicks: row.clicks ?? 0,
      impressions: row.impressions ?? 0,
      position: row.position ?? 0,
    }))
  })
}
