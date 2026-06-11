'use server'

import { requireAuth, userCanAccessClient } from '@/lib/auth'
import { getClientById } from '@/lib/client-resolution'
import { buildDateRange } from '@/lib/date-range'
import { cachedFetch } from '@/lib/api-cache'
import { fetchGA4PacingTotals } from '@/lib/google-analytics'
import { fetchGSCMetrics } from '@/lib/google-search-console'
import { fetchDashboardGBP } from '@/app/actions/dashboard-gbp'

type PacingClient = {
  id: string
  name: string
  ga4_property_id: string | null
  gsc_site_url: string | null
  gbp_account_id: string | null
}

/**
 * Month-to-date actuals for goal pacing, keyed by the pacing metric ids
 * (sessions / organic_clicks / conversions / revenue / gbp_calls). Sourced
 * together from one MTD window so the run-rate projection is consistent.
 * Never throws — returns {} when the client isn't accessible / configured.
 */
export async function getPacingActuals(clientId: string): Promise<Record<string, number>> {
  const { user } = await requireAuth()
  if (!(await userCanAccessClient(user, clientId))) return {}

  const client = await getClientById<PacingClient>(
    clientId,
    'id, name, ga4_property_id, gsc_site_url, gbp_account_id',
  )
  if (!client) return {}

  const mtd = buildDateRange('mtd', 'prior')

  return cachedFetch(`pacing:actuals:${clientId}:${mtd.startDate}:${mtd.endDate}`, 6 * 3600, async () => {
    const [ga4, gsc, gbp] = await Promise.allSettled([
      client.ga4_property_id ? fetchGA4PacingTotals(client.ga4_property_id, mtd) : Promise.resolve(null),
      client.gsc_site_url ? fetchGSCMetrics(client.gsc_site_url, mtd) : Promise.resolve(null),
      client.gbp_account_id ? fetchDashboardGBP(clientId, { period: 'mtd', compare: 'prior' }) : Promise.resolve(null),
    ])

    const actuals: Record<string, number> = {}
    if (ga4.status === 'fulfilled' && ga4.value) {
      actuals.sessions = ga4.value.sessions
      actuals.conversions = ga4.value.conversions
      actuals.revenue = ga4.value.revenue
    }
    if (gsc.status === 'fulfilled' && gsc.value) actuals.organic_clicks = gsc.value.clicks
    if (gbp.status === 'fulfilled' && gbp.value?.configured && gbp.value.insights) {
      actuals.gbp_calls = gbp.value.insights.totals['CALL_CLICKS'] ?? 0
    }
    return actuals
  })
}
