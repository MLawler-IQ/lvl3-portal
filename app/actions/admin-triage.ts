'use server'

import { requireAdmin } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/server'
import { fetchAnalyticsData } from '@/app/actions/analytics'
import { fetchDashboardGBP } from '@/app/actions/dashboard-gbp'
import { getPacingActuals } from '@/app/actions/dashboard-pacing'
import { computePacing } from '@/lib/dashboard/pacing'
import type { Targets } from '@/lib/dashboard/types'

export type TriageGbpGrade = 'A' | 'B' | 'C' | 'D' | 'F'

export type TriageRow = {
  clientId: string
  name: string
  /** Sessions over the default rolling 28-day window — same window as Home's KPI strip. */
  sessions: number | null
  sessionsDelta: number | null
  /** GSC clicks delta — GSCMetrics carries no delta, so this is always null today. */
  clicksDelta?: number | null
  pacing: { configured: boolean; behindCount: number }
  gbp: { configured: boolean; grade?: TriageGbpGrade; score?: number }
  error?: boolean
}

type TriageClientRow = {
  id: string
  name: string
  ga4_property_id: string | null
  gsc_site_url: string | null
  gbp_account_id: string | null
  targets: Targets | null
}

// Cap on clients fetched concurrently — keeps the cold-cache Google fan-out bounded.
const CONCURRENCY = 3

// Below this avg profile score GBP counts as a triage signal (same threshold as
// the alerts engine's GBP_SCORE_WARNING in lib/dashboard/alerts.ts).
const GBP_UNHEALTHY_SCORE = 60

/** Run fn over items in batches of `limit` (no concurrency util exists in the repo). */
async function mapBatched<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = []
  for (let i = 0; i < items.length; i += limit) {
    const batch = items.slice(i, i + limit)
    results.push(...(await Promise.all(batch.map(fn))))
  }
  return results
}

/** Same grade thresholds as the exec HealthScorecard chip. */
function scoreToGrade(score: number): TriageGbpGrade {
  if (score >= 90) return 'A'
  if (score >= 80) return 'B'
  if (score >= 70) return 'C'
  if (score >= 60) return 'D'
  return 'F'
}

/**
 * Composite needs-attention weight: sessions decline dominates, then pacing
 * metrics running behind goal, then unhealthy GBP profiles. Higher = worse.
 */
function attentionScore(row: TriageRow): number {
  let score = 0
  if (typeof row.sessionsDelta === 'number' && row.sessionsDelta < 0) {
    score += Math.min(100, -row.sessionsDelta)
  }
  score += row.pacing.behindCount * 20
  if (typeof row.gbp.score === 'number' && row.gbp.score < GBP_UNHEALTHY_SCORE) {
    score += GBP_UNHEALTHY_SCORE - row.gbp.score
  }
  if (row.error) score += 5
  return score
}

async function buildRow(client: TriageClientRow): Promise<TriageRow> {
  const row: TriageRow = {
    clientId: client.id,
    name: client.name,
    sessions: null,
    sessionsDelta: null,
    clicksDelta: null,
    pacing: { configured: false, behindCount: 0 },
    gbp: { configured: Boolean(client.gbp_account_id) },
  }

  try {
    const targets = client.targets ?? {}
    const hasTargets = Object.keys(targets).length > 0
    const hasAnalytics = Boolean(client.ga4_property_id || client.gsc_site_url)

    const [analyticsRes, actualsRes, gbpRes] = await Promise.allSettled([
      hasAnalytics ? fetchAnalyticsData(client.id) : Promise.resolve(null),
      hasTargets ? getPacingActuals(client.id) : Promise.resolve(null),
      client.gbp_account_id
        ? // Dashboard-default opts so the heavy GBP insights fetch shares the
          // dashboard's cache entry; the row only reads the range-independent audit.
          fetchDashboardGBP(client.id, { period: 'last_full_month', compare: 'yoy' })
        : Promise.resolve(null),
    ])

    if (analyticsRes.status === 'fulfilled' && analyticsRes.value) {
      const { ga4, gsc, error } = analyticsRes.value
      if (ga4) {
        row.sessions = ga4.sessions
        row.sessionsDelta = ga4.sessionsDelta
      }
      if (error && !ga4 && !gsc) row.error = true
    } else if (analyticsRes.status === 'rejected' && hasAnalytics) {
      row.error = true
    }

    if (actualsRes.status === 'fulfilled' && actualsRes.value && hasTargets) {
      // Pace against yesterday — getPacingActuals' MTD window is anchored to
      // yesterday, so the elapsed-fraction divisor must match (cf. AnalyticsSection).
      const pacing = computePacing(actualsRes.value, targets, new Date(Date.now() - 86400000))
      const targeted = pacing.filter((p) => p.status !== 'no_target')
      row.pacing = {
        configured: targeted.length > 0,
        behindCount: targeted.filter((p) => p.status === 'behind').length,
      }
    }

    if (gbpRes.status === 'fulfilled' && gbpRes.value?.configured && gbpRes.value.audit) {
      const score = gbpRes.value.audit.avgScore
      row.gbp = { configured: true, score, grade: scoreToGrade(score) }
    }
  } catch {
    row.error = true
  }

  return row
}

/**
 * Cross-client triage rows for the admin Home strip: per-client sessions delta
 * (default rolling 28d, same as Home's KPI strip), count of pacing metrics
 * running behind goal, and the GBP audit grade. Sorted needs-attention first.
 *
 * Auth: requireAdmin FIRST — fetchAnalyticsData has no internal auth check.
 */
export async function getAdminTriage(): Promise<{ data?: TriageRow[]; error?: string }> {
  try {
    await requireAdmin()

    const service = await createServiceClient()
    const { data, error } = await service
      .from('clients')
      .select('id, name, ga4_property_id, gsc_site_url, gbp_account_id, targets')
      .order('name')
    if (error) return { error: error.message }

    const clients = ((data ?? []) as TriageClientRow[]).filter(
      (c) => c.ga4_property_id || c.gsc_site_url || c.gbp_account_id,
    )

    const rows = await mapBatched(clients, CONCURRENCY, buildRow)

    rows.sort((a, b) => {
      const att = attentionScore(b) - attentionScore(a)
      if (att !== 0) return att
      const aDelta = a.sessionsDelta ?? Number.POSITIVE_INFINITY
      const bDelta = b.sessionsDelta ?? Number.POSITIVE_INFINITY
      if (aDelta !== bDelta) return aDelta - bDelta
      if (a.pacing.behindCount !== b.pacing.behindCount) {
        return b.pacing.behindCount - a.pacing.behindCount
      }
      const aGbp = a.gbp.score ?? Number.POSITIVE_INFINITY
      const bGbp = b.gbp.score ?? Number.POSITIVE_INFINITY
      if (aGbp !== bGbp) return aGbp - bGbp
      return a.name.localeCompare(b.name)
    })

    return { data: rows }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Failed to load portfolio triage' }
  }
}
