'use server'

// Workstream B5 — Competitive landscape data for the upgraded dashboard.
//
// Resolves the currently-selected client (cookie for admin/member, pinned
// client_id for client-role users), reads the client's own domain
// (gsc_site_url) plus the tracked `competitors text[]` column, and returns a
// Semrush domain-overview comparison: the client's own row alongside each
// competitor.
//
// Reuses the EXISTING Semrush wrapper in lib/connectors/semrush-portal.ts
// (fetchSemrushDomainRanks + fetchSemrushBacklinksOverview) — no new Semrush
// endpoints, client, or packages. Per-domain calls are wrapped in cachedFetch
// (the wrapper itself uses plain fetch and must not be edited), so a row's
// metrics are cached across requests and we don't re-hit Semrush on every load.
//
// Never throws: configured:false when no competitors are set or Semrush is
// unavailable; per-row error strings when an individual domain lookup fails.

import { requireAuth } from '@/lib/auth'
import { resolveSelectedClientId, getClientById } from '@/lib/client-resolution'
import { cachedFetch } from '@/lib/api-cache'
import { normalizeDomain } from '@/lib/normalize-domain'
import {
  fetchSemrushDomainRanks,
  fetchSemrushBacklinksOverview,
  type SemrushDomainRank,
  type SemrushBacklinksOverview,
} from '@/lib/connectors/semrush-portal'

// 6h TTL — Semrush domain overview / backlink metrics move slowly and the
// dataset is per-domain, so a generous cache keeps the dashboard snappy.
const CACHE_TTL_SECONDS = 6 * 60 * 60
const SEMRUSH_DATABASE = 'us'
// Cap how many competitor domains we fan out to, to bound Semrush API spend.
const MAX_COMPETITORS = 8
// Domains processed per batch. Each domain makes 2 Semrush calls; Semrush
// rate-limits around 10 req/s, so 3×2 = 6 concurrent stays safely under it
// (an unbounded fan-out made every lookup fail on first uncached load).
const DOMAIN_CONCURRENCY = 3

export interface CompetitiveRow {
  /** Normalized domain (no scheme/www). */
  domain: string
  /** True for the client's own domain (highlighted in the table). */
  isSelf: boolean
  /** Semrush organic keyword count. null when Semrush has no rows for the domain. */
  organicKeywords: number | null
  /** Estimated monthly organic traffic. */
  organicTraffic: number | null
  /** Estimated organic traffic cost (USD). */
  organicCost: number | null
  /** Referring domains from the backlink profile. */
  referringDomains: number | null
  /** Authority score (0–100). */
  authorityScore: number | null
  /** Per-row API error (bad key / quota / network). Metrics will be null. */
  error?: string
}

export interface CompetitiveResult {
  configured: boolean
  /** The client's own normalized domain, when configured. */
  selfDomain?: string
  /** Client row first, then competitors. Empty when not configured. */
  rows: CompetitiveRow[]
  /** Set on a resolution-level failure (auth/client read). Never thrown. */
  error?: string
}

type CompetitiveClient = {
  id: string
  name: string
  gsc_site_url: string | null
  competitors: string[] | null
}

/** Cached organic-overview lookup. Throws on connector failure (not cached). */
async function cachedRanks(domain: string, apiKey: string): Promise<SemrushDomainRank | null> {
  return cachedFetch(`competitive:semrush:ranks:${SEMRUSH_DATABASE}:${domain}`, CACHE_TTL_SECONDS, async () => {
    const res = await fetchSemrushDomainRanks(domain, apiKey, SEMRUSH_DATABASE)
    if (!res.ok) throw new Error(res.error)
    return res.data
  })
}

/** Cached backlinks-overview lookup. Throws on connector failure (not cached). */
async function cachedBacklinks(domain: string, apiKey: string): Promise<SemrushBacklinksOverview | null> {
  return cachedFetch(`competitive:semrush:backlinks:${domain}`, CACHE_TTL_SECONDS, async () => {
    const res = await fetchSemrushBacklinksOverview(domain, apiKey)
    if (!res.ok) throw new Error(res.error)
    return res.data
  })
}

/**
 * Fetch one domain's Semrush overview as a CompetitiveRow. The two endpoints
 * are cached independently so one failing doesn't poison (or waste) the other —
 * a partial row keeps whatever data succeeded, with `error` noting the gap.
 * Never throws.
 */
async function fetchDomainRow(
  domain: string,
  isSelf: boolean,
  apiKey: string,
): Promise<CompetitiveRow> {
  const [ranks, backlinks] = await Promise.allSettled([
    cachedRanks(domain, apiKey),
    cachedBacklinks(domain, apiKey),
  ])

  const reason = (r: PromiseRejectedResult) =>
    r.reason instanceof Error ? r.reason.message : 'Lookup failed'

  let error: string | undefined
  if (ranks.status === 'rejected' && backlinks.status === 'rejected') {
    error = reason(ranks)
  } else if (ranks.status === 'rejected') {
    error = `Organic lookup failed: ${reason(ranks)}`
  } else if (backlinks.status === 'rejected') {
    error = `Backlinks lookup failed: ${reason(backlinks)}`
  }

  const ranksData = ranks.status === 'fulfilled' ? ranks.value : null
  const backlinksData = backlinks.status === 'fulfilled' ? backlinks.value : null

  return {
    domain,
    isSelf,
    organicKeywords: ranksData?.organic_keywords ?? null,
    organicTraffic: ranksData?.organic_traffic ?? null,
    organicCost: ranksData?.organic_cost ?? null,
    referringDomains: backlinksData?.referring_domains ?? null,
    authorityScore: backlinksData?.authority_score ?? null,
    ...(error ? { error } : {}),
  }
}

/**
 * Competitive landscape comparison for the selected client. Returns the
 * client's own domain alongside each tracked competitor on Semrush organic +
 * backlink metrics. configured:false when there's no client, no own domain,
 * no competitors, or Semrush isn't configured.
 */
export async function getCompetitiveData(): Promise<CompetitiveResult> {
  try {
    const { user } = await requireAuth()
    const clientId = await resolveSelectedClientId(user)
    if (!clientId) return { configured: false, rows: [] }

    const client = await getClientById<CompetitiveClient>(
      clientId,
      'id, name, gsc_site_url, competitors',
    )
    if (!client) return { configured: false, rows: [] }

    const apiKey = process.env.SEMRUSH_API_KEY
    if (!apiKey) return { configured: false, rows: [] }

    const selfDomain = client.gsc_site_url ? normalizeDomain(client.gsc_site_url) : ''

    // Normalize + dedupe competitors, drop blanks and the self domain.
    const competitorDomains = Array.from(
      new Set(
        (client.competitors ?? [])
          .map((c) => normalizeDomain(c ?? ''))
          .filter((d) => d && d !== selfDomain),
      ),
    ).slice(0, MAX_COMPETITORS)

    // Nothing to compare against → graceful empty state in the UI.
    if (competitorDomains.length === 0) {
      return { configured: false, selfDomain: selfDomain || undefined, rows: [] }
    }

    const targets: Array<{ domain: string; isSelf: boolean }> = []
    if (selfDomain) targets.push({ domain: selfDomain, isSelf: true })
    competitorDomains.forEach((domain) => targets.push({ domain, isSelf: false }))

    // Bounded fan-out: DOMAIN_CONCURRENCY domains per batch so the 2-calls-per-
    // domain pattern stays under Semrush's rate limit. fetchDomainRow never
    // throws, and per-endpoint results are cached, so retries are cheap.
    const rows: CompetitiveRow[] = []
    for (let i = 0; i < targets.length; i += DOMAIN_CONCURRENCY) {
      const batch = targets.slice(i, i + DOMAIN_CONCURRENCY)
      const batchRows = await Promise.all(
        batch.map((t) => fetchDomainRow(t.domain, t.isSelf, apiKey)),
      )
      rows.push(...batchRows)
    }

    return {
      configured: true,
      selfDomain: selfDomain || undefined,
      rows,
    }
  } catch (err) {
    return {
      configured: false,
      rows: [],
      error: err instanceof Error ? err.message : 'Failed to load competitive data',
    }
  }
}
