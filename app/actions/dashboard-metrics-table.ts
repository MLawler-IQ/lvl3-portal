'use server'

// Workstream C3 — 13-month metric table.
//
// Returns one row per calendar month over the trailing 14 months: the in-progress
// current month (flagged isPartial) plus the prior 13, so the latest COMPLETE
// month has a YoY comparison 12 rows earlier. Merges the GA4 monthly series
// (sessions / conversions / revenue) and the GSC monthly series
// (clicks / impressions) by yearMonth.
//
// Mirrors the dashboard-ga4 / dashboard-gsc auth pattern: requireAuth →
// resolveSelectedClientId → load the selected client's ga4_property_id and
// gsc_site_url behind a service client. Never throws — on missing config or a
// failed fetch it degrades to whatever data it could gather, and reports
// configured:false only when NEITHER GA4 nor GSC is configured for the client.

import { requireAuth, userCanAccessClient } from '@/lib/auth'
import { resolveSelectedClientId } from '@/lib/client-resolution'
import { createServiceClient } from '@/lib/supabase/server'
import { fetchGA4MonthlySeries } from '@/lib/google-analytics'
import { fetchGSCMonthlySeries } from '@/lib/google-search-console'

// 14 buckets = current MTD month + 13 complete months, so the latest complete
// month still has its YoY peer (12 rows earlier) in the data.
const MONTHS = 14

export type MetricTableRow = {
  /** Calendar month as YYYY-MM. */
  yearMonth: string
  sessions: number
  clicks: number
  impressions: number
  conversions: number
  revenue: number
  /** True for the in-progress current calendar month (incomplete data — no fair deltas). */
  isPartial: boolean
  /**
   * 'suspect' when this month's sessions or clicks fall below half the median of
   * the OTHER complete months — a likely tracking gap (data not fully collected)
   * rather than a real drop. Absent/'ok' otherwise. The MTD month is never flagged.
   */
  dataQuality?: 'ok' | 'suspect'
}

export type MetricTableResult = {
  configured: boolean
  rows: MetricTableRow[]
}

/**
 * Resolve the selected client's GA4 property id and GSC site url for the current
 * user, enforcing access. Returns nulls (no throw) when there is no selected
 * client or the user can't access it.
 */
async function resolveSources(): Promise<{ propertyId: string | null; siteUrl: string | null }> {
  const { user } = await requireAuth()
  const clientId = await resolveSelectedClientId(user)
  if (!clientId) return { propertyId: null, siteUrl: null }
  if (!(await userCanAccessClient(user, clientId))) return { propertyId: null, siteUrl: null }

  const service = await createServiceClient()
  const { data: client } = await service
    .from('clients')
    .select('ga4_property_id, gsc_site_url')
    .eq('id', clientId)
    .single()

  return {
    propertyId: client?.ga4_property_id ?? null,
    siteUrl: client?.gsc_site_url ?? null,
  }
}

/**
 * 13-month metric table for the selected client (13 complete months + the current
 * MTD month flagged isPartial). Merges GA4 + GSC monthly series by yearMonth into
 * rows sorted ascending (oldest → newest). configured:false when the client has
 * neither a GA4 property nor a GSC site configured.
 */
export async function get13MonthTable(): Promise<MetricTableResult> {
  try {
    const { propertyId, siteUrl } = await resolveSources()
    if (!propertyId && !siteUrl) return { configured: false, rows: [] }

    // Fetch whichever sources are configured; tolerate one failing without losing
    // the other (each fetch is cached + falls back to an empty series on error).
    const [ga4, gsc] = await Promise.all([
      propertyId
        ? fetchGA4MonthlySeries(propertyId, MONTHS).catch(() => [])
        : Promise.resolve([]),
      siteUrl
        ? fetchGSCMonthlySeries(siteUrl, MONTHS).catch(() => [])
        : Promise.resolve([]),
    ])

    // Merge by yearMonth. UTC current month, matching the repo's date conventions.
    const currentYm = new Date().toISOString().slice(0, 7)
    const byMonth = new Map<string, MetricTableRow>()
    const ensure = (ym: string): MetricTableRow => {
      let row = byMonth.get(ym)
      if (!row) {
        row = {
          yearMonth: ym,
          sessions: 0,
          clicks: 0,
          impressions: 0,
          conversions: 0,
          revenue: 0,
          isPartial: ym === currentYm,
        }
        byMonth.set(ym, row)
      }
      return row
    }

    for (const p of ga4) {
      const row = ensure(p.yearMonth)
      row.sessions = p.sessions
      row.conversions = p.conversions
      row.revenue = p.revenue
    }
    for (const p of gsc) {
      const row = ensure(p.yearMonth)
      row.clicks = p.clicks
      row.impressions = p.impressions
    }

    const rows = Array.from(byMonth.values()).sort((a, b) => a.yearMonth.localeCompare(b.yearMonth))
    flagSuspectMonths(rows)
    return { configured: true, rows }
  } catch {
    return { configured: false, rows: [] }
  }
}

/** Median of a numeric list (0 for empty). */
function median(xs: number[]): number {
  if (xs.length === 0) return 0
  const s = [...xs].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 === 0 ? (s[mid - 1] + s[mid]) / 2 : s[mid]
}

/**
 * Mark complete months whose sessions OR clicks read like a tracking gap: less
 * than half the median of the OTHER complete months for that metric. The MTD
 * month is excluded (expected to be partial) and a metric with no baseline
 * (median 0 — e.g. GSC not configured, all clicks 0) can't trigger a flag.
 * Needs ≥4 complete months for a meaningful baseline; below that we don't guess.
 */
function flagSuspectMonths(rows: MetricTableRow[]): void {
  const complete = rows.filter((r) => !r.isPartial)
  if (complete.length < 4) return
  for (const row of complete) {
    const others = complete.filter((r) => r !== row)
    const medSessions = median(others.map((r) => r.sessions))
    const medClicks = median(others.map((r) => r.clicks))
    const sessionsGap = medSessions > 0 && row.sessions < medSessions * 0.5
    const clicksGap = medClicks > 0 && row.clicks < medClicks * 0.5
    if (sessionsGap || clicksGap) row.dataQuality = 'suspect'
  }
}
