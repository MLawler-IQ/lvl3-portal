'use server'

import { google } from 'googleapis'
import { getAdminOAuthClient } from '@/lib/google-auth'
import { requireAdmin, requireAuth, userCanAccessClient } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/server'
import { parseSheetId, fetchSheetHeaders } from '@/lib/google-sheets'
import { fetchGA4Metrics, GA4Metrics, fetchGA4Report, GA4Report, ChannelRow, SourceMediumRow, LandingPageRow } from '@/lib/google-analytics'
import { fetchGSCMetrics, GSCMetrics, listGSCSites, fetchGSCReport, GSCReport, GSCTrendBucket, QueryRow, UrlRow, SerpDistribution } from '@/lib/google-search-console'
import { buildDateRange, DateRange } from '@/lib/date-range'
import { normalizeDomain } from '@/lib/normalize-domain'
import Anthropic from '@anthropic-ai/sdk'
import type { InsightCard } from '@/lib/dashboard/types'
import { deriveInsightCards, deriveHeadline, type InsightSignals } from '@/lib/dashboard/insights'

export type { GA4Metrics, GSCMetrics, GA4Report, GSCReport, ChannelRow, SourceMediumRow, LandingPageRow, GSCTrendBucket, QueryRow, UrlRow, SerpDistribution, DateRange }

export type SnapshotInsights = {
  takeaways: string
  anomalies: string
  opportunities: string
  /** Structured insight layer (Phase B). Optional so existing consumers keep working. */
  headline?: string
  cards?: InsightCard[]
  generatedAt?: string
}

/**
 * Unapproved LLM draft stored in `clients.snapshot_insights_draft`. Same shape as
 * the published `SnapshotInsights` plus the narrative `summary` (which publishes
 * to `analytics_summary`). NEVER exposed to client-role users — read only behind
 * admin checks; published to the client-facing columns by approveSnapshotInsightsDraft.
 */
export type SnapshotInsightsDraft = SnapshotInsights & { summary: string }

// ── Logo ──────────────────────────────────────────────────────────────────────

export async function fetchLogoUrl(domain: string): Promise<string | null> {
  const clean = domain.trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '')
  if (!clean) return null
  const url = `https://logo.clearbit.com/${clean}`
  try {
    const res = await fetch(url, { method: 'HEAD' })
    return res.ok ? url : null
  } catch {
    return null
  }
}

// ── Sheet headers ─────────────────────────────────────────────────────────────

export async function getSheetHeadersAction(
  sheetIdOrUrl: string,
  headerRow: number
): Promise<{ headers?: string[]; error?: string }> {
  try {
    await requireAdmin()
    const id = parseSheetId(sheetIdOrUrl)
    const headers = await fetchSheetHeaders(id, headerRow)
    return { headers }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Failed to load headers' }
  }
}

// ── Analytics data ────────────────────────────────────────────────────────────

export type AnalyticsData = {
  ga4: GA4Metrics | null
  gsc: GSCMetrics | null
  error?: string
}

export async function fetchAnalyticsData(
  clientId: string,
  opts?: { period?: string; compare?: string }
): Promise<AnalyticsData> {
  const range = buildDateRange(opts?.period, opts?.compare)
  const service = await createServiceClient()
  const { data: client } = await service
    .from('clients')
    .select('ga4_property_id, gsc_site_url')
    .eq('id', clientId)
    .single()

  if (!client) return { ga4: null, gsc: null, error: 'Client not found' }

  const [ga4Result, gscResult] = await Promise.allSettled([
    client.ga4_property_id
      ? fetchGA4Metrics(client.ga4_property_id, range)
      : Promise.resolve(null),
    client.gsc_site_url
      ? fetchGSCMetrics(client.gsc_site_url, range)
      : Promise.resolve(null),
  ])

  const ga4 = ga4Result.status === 'fulfilled' ? ga4Result.value : null
  const gsc = gscResult.status === 'fulfilled' ? gscResult.value : null
  const firstError =
    ga4Result.status === 'rejected'
      ? String(ga4Result.reason)
      : gscResult.status === 'rejected'
      ? String(gscResult.reason)
      : undefined

  return { ga4, gsc, error: firstError }
}

// ── Dashboard report ─────────────────────────────────────────────────────────

export type DashboardReport = {
  ga4: GA4Report | null
  gsc: GSCReport | null
  ga4Error?: string
  gscError?: string
}

export async function fetchDashboardReport(
  clientId: string,
  opts?: { period?: string; compare?: string }
): Promise<DashboardReport> {
  const range = buildDateRange(opts?.period, opts?.compare)
  const service = await createServiceClient()
  const { data: client } = await service
    .from('clients')
    .select('ga4_property_id, gsc_site_url')
    .eq('id', clientId)
    .single()

  if (!client) return { ga4: null, gsc: null, ga4Error: 'Client not found' }

  const [ga4Result, gscResult] = await Promise.allSettled([
    client.ga4_property_id ? fetchGA4Report(client.ga4_property_id, range) : Promise.resolve(null),
    client.gsc_site_url ? fetchGSCReport(client.gsc_site_url, range) : Promise.resolve(null),
  ])

  const ga4 = ga4Result.status === 'fulfilled' ? ga4Result.value : null
  const gsc = gscResult.status === 'fulfilled' ? gscResult.value : null

  const ga4Error =
    !client.ga4_property_id
      ? 'GA4 Property ID not configured in client settings'
      : ga4Result.status === 'rejected'
      ? String(ga4Result.reason)
      : undefined

  const gscError =
    !client.gsc_site_url
      ? 'GSC Site URL not configured in client settings'
      : gscResult.status === 'rejected'
      ? String(gscResult.reason)
      : undefined

  return { ga4, gsc, ga4Error, gscError }
}

// ── GSC site detection ────────────────────────────────────────────────────────


function siteMatchesDomain(site: string, domain: string): boolean {
  if (site.startsWith('sc-domain:')) {
    const d = normalizeDomain(site)
    return d === domain || d.endsWith('.' + domain)
  }
  return normalizeDomain(site) === domain
}

export async function detectGSCSiteUrl(
  propertyId: string
): Promise<{ sites: string[]; matched?: string; fromGA4Domain?: boolean; error?: string }> {
  try {
    await requireAdmin()

    const auth = await getAdminOAuthClient()

    const analyticsadmin = google.analyticsadmin({ version: 'v1beta', auth })

    // Fetch GSC sites and GA4 web stream in parallel
    const [sitesResult, streamsResult] = await Promise.allSettled([
      listGSCSites(),
      analyticsadmin.properties.dataStreams.list({
        parent: `properties/${propertyId}`,
      }),
    ])

    // Determine GA4 web stream domain
    let ga4Domain = ''
    if (streamsResult.status === 'fulfilled') {
      const streams = streamsResult.value.data.dataStreams ?? []
      const webStream = streams.find((s) => s.type === 'WEB_DATA_STREAM')
      const defaultUri = webStream?.webStreamData?.defaultUri ?? ''
      if (defaultUri) ga4Domain = normalizeDomain(defaultUri)
    }

    // Best case: service account has GSC access — return real sites + auto-match
    if (sitesResult.status === 'fulfilled' && sitesResult.value.length > 0) {
      const sites = sitesResult.value
      const matched = ga4Domain
        ? sites.find((s) => siteMatchesDomain(s, ga4Domain))
        : undefined
      return { sites, matched }
    }

    // Fallback: generate URL candidates from GA4 domain so user doesn't type manually
    if (ga4Domain) {
      const candidates = [
        `https://${ga4Domain}/`,
        `https://www.${ga4Domain}/`,
        `sc-domain:${ga4Domain}`,
      ]
      return { sites: candidates, matched: candidates[0], fromGA4Domain: true }
    }

    return {
      sites: [],
      error:
        'Could not determine the site URL. Ensure the GA4 property has a web data stream configured.',
    }
  } catch (err) {
    return {
      sites: [],
      error: err instanceof Error ? err.message : 'Failed to detect GSC sites',
    }
  }
}

// ── List accessible GA4 properties ───────────────────────────────────────────

export type GA4PropertyOption = {
  propertyId: string
  displayName: string
  websiteUrl: string
}

export async function listGA4Properties(): Promise<{
  properties?: GA4PropertyOption[]
  error?: string
}> {
  try {
    await requireAdmin()
    const { getAdminOAuthClient } = await import('@/lib/google-auth')
    const auth = await getAdminOAuthClient()
    const analyticsadmin = google.analyticsadmin({ version: 'v1beta', auth })

    const response = await analyticsadmin.accountSummaries.list({ pageSize: 200 })

    const properties: GA4PropertyOption[] = []
    for (const account of response.data.accountSummaries ?? []) {
      for (const prop of account.propertySummaries ?? []) {
        properties.push({
          propertyId: (prop.property ?? '').replace('properties/', ''),
          displayName: prop.displayName ?? 'Unnamed property',
          websiteUrl: '',
        })
      }
    }

    return { properties }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Failed to list GA4 properties' }
  }
}

// ── List accessible GSC sites ─────────────────────────────────────────────────

export type GSCSiteOption = {
  siteUrl: string
  permissionLevel: string
}

export async function listGSCSiteOptions(): Promise<{
  sites?: GSCSiteOption[]
  error?: string
}> {
  try {
    await requireAdmin()
    const { getAdminOAuthClient } = await import('@/lib/google-auth')
    const auth = await getAdminOAuthClient()
    const searchconsole = google.searchconsole({ version: 'v1', auth })

    const { data } = await searchconsole.sites.list()

    const sites: GSCSiteOption[] = (data.siteEntry ?? []).map((s) => ({
      siteUrl: s.siteUrl ?? '',
      permissionLevel: s.permissionLevel ?? '',
    }))

    return { sites }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Failed to list GSC sites' }
  }
}

// ── Generate insights ─────────────────────────────────────────────────────────

export async function generateAnalyticsInsights(
  clientId: string,
  opts?: { period?: string; compare?: string }
): Promise<{ error?: string }> {
  try {
    // Generation is admin- or member-triggered (clients may NOT generate), and a
    // member must have access to the target client. The result is written to the
    // draft column only — never published — so generating does not expose anything
    // to client-role users (approval is a separate admin-only step).
    const { user } = await requireAuth()
    if (user.role === 'client') return { error: 'Not authorized to generate insights' }
    if (!(await userCanAccessClient(user, clientId))) {
      return { error: 'Not authorized for this client' }
    }

    // Generation frame. Defaults match the dashboard's default view
    // (app/(dashboard)/dashboard/page.tsx: last full month vs prior year) so the
    // stored narrative agrees with what the Snapshot opens on; the dashboard's
    // refresh button passes the currently selected frame through instead.
    const period = opts?.period ?? 'last_full_month'
    const compare = opts?.compare ?? 'yoy'
    const range = buildDateRange(period, compare)

    const data = await fetchAnalyticsData(clientId, { period, compare })

    if (!data.ga4 && !data.gsc) {
      const msg = data.error
        ? `Analytics fetch failed: ${data.error}`
        : 'No analytics data available. Configure GA4 Property ID and/or GSC Site URL in client settings, and ensure the service account has been granted access.'
      return { error: msg }
    }

    const parts: string[] = []

    const windowLabel = `${range.label} (${range.startDate} to ${range.endDate})`

    if (data.ga4) {
      const { sessions, users, pageviews, bounceRate, topChannels, sessionsDelta, usersDelta } =
        data.ga4
      parts.push(
        `GA4 (${windowLabel}): ${sessions.toLocaleString()} sessions (${sessionsDelta >= 0 ? '+' : ''}${sessionsDelta}% ${range.compareLabel}), ${users.toLocaleString()} users (${usersDelta >= 0 ? '+' : ''}${usersDelta}%), ${pageviews.toLocaleString()} pageviews, bounce rate ${(bounceRate * 100).toFixed(1)}%. Top channels: ${topChannels
          .slice(0, 3)
          .map((c) => `${c.channel} (${c.sessions.toLocaleString()})`)
          .join(', ')}.`
      )
    }

    if (data.gsc) {
      const { clicks, impressions, ctr, position, topQueries } = data.gsc
      parts.push(
        `Search Console (${windowLabel}): ${clicks.toLocaleString()} clicks, ${impressions.toLocaleString()} impressions, ${ctr.toFixed(1)}% CTR, avg position ${position.toFixed(1)}. Top queries: ${topQueries
          .slice(0, 3)
          .map((q) => `"${q.query}" (${q.clicks} clicks)`)
          .join(', ')}.`
      )
    }

    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1200,
      system:
        'You are a digital marketing analyst. Respond with valid JSON only — no markdown, no explanation, no code blocks.',
      messages: [
        {
          role: 'user',
          content: `Based on this analytics data, generate a structured report using this exact JSON format:
{
  "headline": "ONE punchy sentence (max ~14 words) naming the single most important shift in this reporting window, e.g. \\"Organic clicks up 18% year over year — the strongest result this window.\\"",
  "summary": "2-3 paragraphs in plain, client-friendly language covering overall performance. The FIRST sentence must name the reporting window (e.g. \\"In May 2026…\\" or \\"Over the last 28 days…\\").",
  "takeaways": "2-3 sentences highlighting the most notable positive results, phrased against the stated comparison.",
  "anomalies": "2-3 sentences on any unusual patterns or concerns. If nothing notable, write: No significant anomalies detected this period.",
  "opportunities": "2-3 sentences on specific, actionable opportunities to improve performance."
}

Reporting window: ${windowLabel}, compared ${range.compareLabel}. Every change you cite is measured against that comparison — state the frame that way and never describe it as a different window (e.g. do not write "last 30 days" or "vs prior period" unless that is literally the frame above).

Data:
${parts.join('\n\n')}`,
        },
      ],
    })

    const raw = message.content[0].type === 'text' ? message.content[0].text.trim() : '{}'
    // Strip accidental markdown code fences
    const cleaned = raw.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim()

    let parsed: Partial<SnapshotInsights & { summary: string }> = {}
    try {
      parsed = JSON.parse(cleaned)
    } catch {
      parsed = { summary: raw, takeaways: '', anomalies: '', opportunities: '' }
    }

    const summary = parsed.summary ?? ''

    // ── Structured insight layer ──────────────────────────────────────────────
    // Derive InsightCard[] deterministically from the already-fetched GA4/GSC
    // deltas (no extra LLM call), labeled with the generation frame's compare
    // window. The dashboard renders LIVE cards (AnalyticsSection) — these stored
    // cards are a frame-stamped record only. GA4 exposes signed-percent deltas;
    // GSC metrics carry no comparison fields, so only GA4-backed cards appear.
    const signals: InsightSignals = { period: range.compareLabel }
    if (data.ga4) {
      signals.sessions = { value: data.ga4.sessions, delta: data.ga4.sessionsDelta }
      signals.users = { value: data.ga4.users, delta: data.ga4.usersDelta }
      signals.pageviews = { value: data.ga4.pageviews, delta: data.ga4.pageviewsDelta }
    }
    const cards = deriveInsightCards(signals)
    // Prefer the LLM headline; fall back to a deterministic one from the top card.
    const headline =
      (typeof parsed.headline === 'string' && parsed.headline.trim()) ||
      deriveHeadline(cards) ||
      undefined

    // Write the full LLM output to the DRAFT column only. Nothing here touches
    // analytics_summary / analytics_summary_updated_at / snapshot_insights — those
    // client-facing columns are published exclusively by approveSnapshotInsightsDraft.
    const draft: SnapshotInsightsDraft = {
      summary,
      takeaways: parsed.takeaways ?? '',
      anomalies: parsed.anomalies ?? '',
      opportunities: parsed.opportunities ?? '',
      headline,
      cards,
      generatedAt: new Date().toISOString(),
    }

    const service = await createServiceClient()
    const { error: dbError } = await service
      .from('clients')
      .update({ snapshot_insights_draft: draft })
      .eq('id', clientId)

    if (dbError) return { error: dbError.message }

    return {}
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'An unexpected error occurred' }
  }
}

// ── Approve / discard draft ────────────────────────────────────────────────────

/**
 * Admin-only. Publishes the pending draft to the client-facing columns, applying
 * any inline edits (an edited save counts as approval). Reads the draft behind a
 * requireAdmin() gate, so draft content is never exposed to client-role users.
 * Publishes atomically in a single update and clears the draft.
 */
export async function approveSnapshotInsightsDraft(
  clientId: string,
  edits?: {
    headline?: string
    summary?: string
    takeaways?: string
    anomalies?: string
    opportunities?: string
  }
): Promise<{ error?: string }> {
  try {
    await requireAdmin()
    const service = await createServiceClient()

    const { data: row, error: loadError } = await service
      .from('clients')
      .select('snapshot_insights_draft')
      .eq('id', clientId)
      .single()

    if (loadError) return { error: loadError.message }
    if (!row?.snapshot_insights_draft) return { error: 'No draft to approve' }

    const draft = row.snapshot_insights_draft as SnapshotInsightsDraft

    // Merge edits over the draft's text fields; an edited (non-undefined) value wins.
    const pick = (edited: string | undefined, fallback: string | undefined): string =>
      typeof edited === 'string' ? edited : fallback ?? ''

    const summary = pick(edits?.summary, draft.summary)
    const takeaways = pick(edits?.takeaways, draft.takeaways)
    const anomalies = pick(edits?.anomalies, draft.anomalies)
    const opportunities = pick(edits?.opportunities, draft.opportunities)
    const headline =
      typeof edits?.headline === 'string'
        ? edits.headline.trim() || undefined
        : draft.headline

    // Published shape consumed by the dashboard (no `summary` — that lives in
    // analytics_summary). Preserve the draft's deterministic cards + frame stamp.
    const snapshot_insights: SnapshotInsights = {
      takeaways,
      anomalies,
      opportunities,
      headline,
      cards: draft.cards,
      generatedAt: draft.generatedAt,
    }

    const { error: dbError } = await service
      .from('clients')
      .update({
        snapshot_insights,
        analytics_summary: summary,
        analytics_summary_updated_at: new Date().toISOString(),
        snapshot_insights_draft: null,
      })
      .eq('id', clientId)

    if (dbError) return { error: dbError.message }

    return {}
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Failed to approve draft' }
  }
}

/** Admin-only. Discards the pending draft without publishing anything. */
export async function discardSnapshotInsightsDraft(
  clientId: string
): Promise<{ error?: string }> {
  try {
    await requireAdmin()
    const service = await createServiceClient()
    const { error: dbError } = await service
      .from('clients')
      .update({ snapshot_insights_draft: null })
      .eq('id', clientId)

    if (dbError) return { error: dbError.message }

    return {}
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Failed to discard draft' }
  }
}
