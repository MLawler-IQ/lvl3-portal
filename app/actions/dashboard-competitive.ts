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
} from '@/lib/connectors/semrush-portal'

// 6h TTL — Semrush domain overview / backlink metrics move slowly and the
// dataset is per-domain, so a generous cache keeps the dashboard snappy.
const CACHE_TTL_SECONDS = 6 * 60 * 60
const SEMRUSH_DATABASE = 'us'
// Cap how many competitor domains we fan out to, to bound Semrush API spend.
const MAX_COMPETITORS = 8

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

/** Fetch one domain's Semrush overview, cached, folded into a CompetitiveRow. */
async function fetchDomainRow(
  domain: string,
  isSelf: boolean,
  apiKey: string,
): Promise<CompetitiveRow> {
  const key = `competitive:semrush:${SEMRUSH_DATABASE}:${domain}`
  return cachedFetch<CompetitiveRow>(key, CACHE_TTL_SECONDS, async () => {
    const [ranks, backlinks] = await Promise.all([
      fetchSemrushDomainRanks(domain, apiKey, SEMRUSH_DATABASE),
      fetchSemrushBacklinksOverview(domain, apiKey),
    ])

    // A connector failure (bad key, quota, network) is surfaced as a per-row
    // error so a broken lookup doesn't masquerade as "no data". A successful
    // call with no rows (data === null) stays null without an error.
    if (!ranks.ok || !backlinks.ok) {
      return {
        domain,
        isSelf,
        organicKeywords: null,
        organicTraffic: null,
        organicCost: null,
        referringDomains: null,
        authorityScore: null,
        error: !ranks.ok ? ranks.error : (backlinks as { ok: false; error: string }).error,
      }
    }

    return {
      domain,
      isSelf,
      organicKeywords: ranks.data?.organic_keywords ?? null,
      organicTraffic: ranks.data?.organic_traffic ?? null,
      organicCost: ranks.data?.organic_cost ?? null,
      referringDomains: backlinks.data?.referring_domains ?? null,
      authorityScore: backlinks.data?.authority_score ?? null,
    }
  })
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

    const settled = await Promise.allSettled(
      targets.map((t) => fetchDomainRow(t.domain, t.isSelf, apiKey)),
    )

    const rows: CompetitiveRow[] = settled.map((res, i) => {
      if (res.status === 'fulfilled') return res.value
      const { domain, isSelf } = targets[i]
      return {
        domain,
        isSelf,
        organicKeywords: null,
        organicTraffic: null,
        organicCost: null,
        referringDomains: null,
        authorityScore: null,
        error: res.reason instanceof Error ? res.reason.message : 'Lookup failed',
      }
    })

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
