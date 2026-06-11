'use server'

// Server actions for the GSC-backed dashboard modules (WS-A2).
//
// Each action resolves the currently selected client's gsc_site_url the same
// way analytics.ts does — requireAuth + resolveSelectedClientId — guards access
// with userCanAccessClient, and returns a typed *empty* result (never throws)
// when GSC is unconfigured or the underlying fetch fails. The UI can render a
// graceful "not configured" state from the empty shape.

import { requireAuth, userCanAccessClient } from '@/lib/auth'
import { resolveSelectedClientId } from '@/lib/client-resolution'
import { createServiceClient } from '@/lib/supabase/server'
import { buildDateRange } from '@/lib/date-range'
import type { TrendPoint } from '@/lib/dashboard/types'
import {
  fetchGSCBrandedSplit,
  fetchGSCTrend,
  fetchGSCIntentSplit,
  fetchGSCReport,
  type GSCBrandedSplit,
  type GSCIntentSplit,
  type GSCReport,
} from '@/lib/google-search-console'

type Opts = { period?: string; compare?: string }

// ── Typed empty results (returned when unconfigured / on failure) ──────────────

const EMPTY_BRANDED: GSCBrandedSplit = {
  branded: { clicks: 0, impressions: 0 },
  nonBranded: { clicks: 0, impressions: 0 },
}

const EMPTY_INTENT: GSCIntentSplit = {
  local: [],
  general: [],
  localClicks: 0,
  generalClicks: 0,
}

/**
 * Resolve the selected client's gsc_site_url for the current user, enforcing
 * access. Returns `null` siteUrl (no throw) when there is no selected client,
 * the user can't access it, or GSC isn't configured — callers map that to the
 * typed empty result.
 */
async function resolveGscSiteUrl(): Promise<{ siteUrl: string | null }> {
  const { user } = await requireAuth()
  const clientId = await resolveSelectedClientId(user)
  if (!clientId) return { siteUrl: null }
  if (!(await userCanAccessClient(user, clientId))) return { siteUrl: null }

  const service = await createServiceClient()
  const { data: client } = await service
    .from('clients')
    .select('gsc_site_url')
    .eq('id', clientId)
    .single()

  return { siteUrl: client?.gsc_site_url ?? null }
}

// ── Actions ────────────────────────────────────────────────────────────────────

/** Period-aware GSC clicks trend (with aligned ghost-overlay comparison). */
export async function getGSCTrendAction(opts?: Opts): Promise<TrendPoint[]> {
  try {
    const { siteUrl } = await resolveGscSiteUrl()
    if (!siteUrl) return []
    return await fetchGSCTrend(siteUrl, opts?.period ?? '28d', opts?.compare ?? 'prior')
  } catch {
    return []
  }
}

/**
 * Branded vs non-branded clicks/impressions. `brandTerms` is optional; when
 * omitted (or empty) a default brand token is derived from the site domain.
 */
export async function getGSCBrandedSplitAction(
  opts?: Opts & { brandTerms?: string[] },
): Promise<GSCBrandedSplit> {
  try {
    const { siteUrl } = await resolveGscSiteUrl()
    if (!siteUrl) return EMPTY_BRANDED
    const range = buildDateRange(opts?.period, opts?.compare)
    return await fetchGSCBrandedSplit(siteUrl, range, opts?.brandTerms ?? [])
  } catch {
    return EMPTY_BRANDED
  }
}

/** Top queries split into local-intent vs general (lightweight heuristic). */
export async function getGSCIntentSplitAction(
  opts?: Opts & { topN?: number },
): Promise<GSCIntentSplit> {
  try {
    const { siteUrl } = await resolveGscSiteUrl()
    if (!siteUrl) return EMPTY_INTENT
    const range = buildDateRange(opts?.period, opts?.compare)
    return await fetchGSCIntentSplit(siteUrl, range, opts?.topN ?? 25)
  } catch {
    return EMPTY_INTENT
  }
}

/**
 * Full GSC report for the selected client (KPIs, monthly trend, top queries,
 * top URLs with restored per-URL clicksDelta, SERP distribution). Returns
 * `null` when unconfigured / on failure rather than throwing.
 */
export async function getGSCReportAction(opts?: Opts): Promise<GSCReport | null> {
  try {
    const { siteUrl } = await resolveGscSiteUrl()
    if (!siteUrl) return null
    const range = buildDateRange(opts?.period, opts?.compare)
    return await fetchGSCReport(siteUrl, range)
  } catch {
    return null
  }
}
