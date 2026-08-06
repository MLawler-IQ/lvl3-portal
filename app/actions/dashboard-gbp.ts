'use server'

import { requireAuth, userCanAccessClient } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/server'
import { buildDateRange } from '@/lib/date-range'
import type { GBPInsightsGranularity } from '@/lib/connectors/gbp'
import {
  fetchGBPClientInsights,
  auditGBPAccount,
  decideGBPScope,
  type GBPClientInsights,
  type GBPAccountAudit,
} from '@/lib/connectors/gbp'

export type {
  GBPClientInsights,
  GBPAccountAudit,
  GBPLocationInsight,
  GBPMetricDelta,
} from '@/lib/connectors/gbp'

/**
 * GBP overview payload for the dashboard.
 *
 * `configured` is false when the selected client has no gbp_account_id — the
 * caller renders an empty / "connect GBP" state. This action never throws for
 * an unconfigured client; data-fetch failures surface via `insightsError` /
 * `auditError` while still returning configured:true so the UI can show a
 * partial / error state instead of nothing.
 */
export type DashboardGBPData = {
  configured: boolean
  accountName?: string
  insights?: GBPClientInsights
  audit?: GBPAccountAudit
  insightsError?: string
  auditError?: string
  error?: string
}

/**
 * Resolve the selected client's GBP account and return aggregate insights +
 * audit rollup for the dashboard GBP overview module.
 *
 * Auth: requireAuth + userCanAccessClient — same untrusted-clientId guard used
 * before any service-client (RLS-bypassing) read. Admins always pass; members
 * pass for granted clients; client-role users pass only for their own client.
 *
 * @param clientId  the selected client id (resolveSelectedClientId on the page)
 * @param opts.period   KPI period key ('7d' | '28d' | '90d' | '180d' | '365d')
 * @param opts.compare  comparison mode ('prior' | 'yoy')
 * @param opts.granularity  per-location insight granularity ('total' default)
 */
export async function fetchDashboardGBP(
  clientId: string,
  opts?: { period?: string; compare?: string; granularity?: GBPInsightsGranularity },
): Promise<DashboardGBPData> {
  try {
    const { user } = await requireAuth()
    if (!(await userCanAccessClient(user, clientId))) {
      return { configured: false, error: 'Not authorized for this client' }
    }

    const service = await createServiceClient()
    const { data: client } = await service
      .from('clients')
      .select('gbp_account_id, gbp_location_group')
      .eq('id', clientId)
      .single()

    const accountName = client?.gbp_account_id as string | null | undefined
    if (!accountName) {
      // Not configured — graceful empty state, never throw.
      return { configured: false }
    }

    // FAIL CLOSED on an unscoped account.
    //
    // This used to read gbp_account_id alone and list every location under it. On a
    // shared container that rendered another brand's locations inside this brand's
    // leaderboard — and `showGbp` is gated by client_type, not by role, so a client login
    // would have seen it. gbp_location_group was collected by onboarding and the settings
    // form and read by no query anywhere; this is the first read.
    const scope = decideGBPScope(accountName, client?.gbp_location_group as string | null)
    if (!scope.ok) {
      return {
        configured: false,
        error:
          'GBP location scope not configured. Set the client\'s Location Group to a ' +
          '"accounts/..." location group, or to "*" to confirm the whole account belongs ' +
          'to this client.',
      }
    }

    const range = buildDateRange(opts?.period, opts?.compare)

    const [insightsResult, auditResult] = await Promise.allSettled([
      fetchGBPClientInsights(scope.parent, range, { granularity: opts?.granularity }),
      auditGBPAccount(scope.parent),
    ])

    const insights =
      insightsResult.status === 'fulfilled' ? insightsResult.value : undefined
    const audit = auditResult.status === 'fulfilled' ? auditResult.value : undefined

    const insightsError =
      insightsResult.status === 'rejected'
        ? String(insightsResult.reason)
        : undefined
    const auditError =
      auditResult.status === 'rejected' ? String(auditResult.reason) : undefined

    return {
      configured: true,
      accountName,
      insights,
      audit,
      insightsError,
      auditError,
    }
  } catch (err) {
    return {
      configured: false,
      error: err instanceof Error ? err.message : 'Failed to load GBP data',
    }
  }
}
