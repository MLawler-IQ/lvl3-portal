'use server'

// Settings-page recommendation actions: pre-fill branded terms, competitors,
// and key-event names from the client's connected data. Admin reviews and
// saves — nothing here writes to the database.

import { google } from 'googleapis'
import Anthropic from '@anthropic-ai/sdk'
import { requireAdmin } from '@/lib/auth'
import { getClientById } from '@/lib/client-resolution'
import { getAdminOAuthClient } from '@/lib/google-auth'
import { gscQuery } from '@/lib/ask-tools'
import { normalizeDomain } from '@/lib/normalize-domain'
import { fetchSemrushOrganicCompetitors } from '@/lib/connectors/semrush-portal'
import { buildDateRange } from '@/lib/date-range'

type RecsClient = {
  id: string
  name: string
  gsc_site_url: string | null
  ga4_property_id: string | null
  brand_context: string | null
}

type RecsResult = { suggestions: string[]; source: string; error?: string }

async function loadClient(clientId: string): Promise<RecsClient | null> {
  await requireAdmin()
  return getClientById<RecsClient>(clientId, 'id, name, gsc_site_url, ga4_property_id, brand_context')
}

/**
 * Extract a JSON string[] from an LLM reply that may include code fences or
 * surrounding prose. Tries the whole (fence-stripped) text first, then every
 * flat [...] block, returning the first that parses. Null when nothing does —
 * callers degrade gracefully instead of surfacing a JSON.parse error.
 */
function parseStringArray(raw: string): string[] | null {
  const cleaned = raw.replace(/```(?:json)?/gi, '').trim()
  const candidates = [cleaned, ...(cleaned.match(/\[[^\[\]]*\]/g) ?? [])]
  for (const candidate of candidates) {
    try {
      const parsed: unknown = JSON.parse(candidate)
      if (Array.isArray(parsed)) {
        return parsed.filter((t): t is string => typeof t === 'string' && t.trim().length > 1)
      }
    } catch {
      // try the next candidate
    }
  }
  return null
}

/** Deterministic brand-term seeds from the client name + domain. */
function heuristicBrandTerms(name: string, domain: string): string[] {
  const out = new Set<string>()
  const cleanName = name.toLowerCase().trim()
  if (cleanName) {
    out.add(cleanName)
    out.add(cleanName.replace(/\s+/g, ''))
  }
  const root = domain.split('.')[0]
  if (root && root.length > 2) out.add(root.toLowerCase())
  return Array.from(out)
}

// ── Branded terms ─────────────────────────────────────────────────────────────

/**
 * Recommend branded-query matchers. Heuristic seeds (name + domain root),
 * refined by Claude against the client's real top GSC queries so misspellings
 * and shorthand variants observed in the wild are captured.
 */
export async function recommendBrandTerms(clientId: string): Promise<RecsResult> {
  try {
    const client = await loadClient(clientId)
    if (!client) return { suggestions: [], source: 'none', error: 'Client not found' }

    const domain = client.gsc_site_url ? normalizeDomain(client.gsc_site_url) : ''
    const seeds = heuristicBrandTerms(client.name, domain)

    // Pull real queries so the LLM can spot observed brand variants.
    let topQueries: string[] = []
    if (client.gsc_site_url) {
      try {
        const range = buildDateRange('90d', 'prior')
        const rows = await gscQuery({
          siteUrl: client.gsc_site_url,
          startDate: range.startDate,
          endDate: range.endDate,
          dimensions: ['query'],
          rowLimit: 250,
        })
        topQueries = rows.map((r) => r.keys[0]).filter(Boolean)
      } catch {
        // GSC unavailable — heuristics still work.
      }
    }

    if (!process.env.ANTHROPIC_API_KEY || topQueries.length === 0) {
      return { suggestions: seeds, source: 'heuristic' }
    }

    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 600,
      messages: [
        {
          role: 'user',
          content: `Identify branded-search matchers for the business "${client.name}" (domain: ${domain || 'unknown'}).

A matcher is a lowercase substring: any search query containing it counts as BRANDED. Choose matchers that cover the brand name, observed misspellings, shorthand, and domain-style variants — but that would NEVER match a generic (non-branded) query. Prefer fewer, broader matchers over many narrow ones.

Seed matchers: ${JSON.stringify(seeds)}

Real top search queries for this site (90 days):
${topQueries.slice(0, 250).join('\n')}

Respond with ONLY a JSON array of strings, e.g. ["brand name","brandname"]. Max 10 matchers.`,
        },
      ],
    })

    const raw = message.content[0]?.type === 'text' ? message.content[0].text : '[]'
    // An unparseable LLM reply degrades to the heuristic seeds, never an error.
    const llmTerms = parseStringArray(raw) ?? []
    if (llmTerms.length === 0) return { suggestions: seeds, source: 'heuristic' }

    const merged = Array.from(new Set([...seeds, ...llmTerms.map((t) => t.toLowerCase().trim())])).slice(0, 10)
    return { suggestions: merged, source: 'gsc+llm' }
  } catch (err) {
    return { suggestions: [], source: 'none', error: err instanceof Error ? err.message : 'Failed' }
  }
}

// ── Competitors ───────────────────────────────────────────────────────────────

// Known non-competitor platforms that rank for everything: directories, review
// sites, marketplaces, delivery apps, social, media. Matched on the domain root.
const NON_COMPETITOR_ROOTS = new Set([
  'yelp', 'tripadvisor', 'opentable', 'doordash', 'ubereats', 'grubhub', 'seamless',
  'postmates', 'yellowpages', 'mapquest', 'foursquare', 'zomato', 'allmenus', 'menupages',
  'wikipedia', 'facebook', 'instagram', 'tiktok', 'youtube', 'pinterest', 'reddit',
  'quora', 'linkedin', 'x', 'twitter', 'nextdoor', 'medium',
  'indeed', 'glassdoor', 'ziprecruiter', 'bbb',
  'amazon', 'walmart', 'target', 'ebay', 'etsy', 'instacart', 'groupon',
  'eater', 'thrillist', 'timeout', 'infatuation', 'usatoday', 'nytimes', 'forbes',
])

function isNonCompetitorPlatform(domain: string): boolean {
  const root = domain.split('.')[0]
  return NON_COMPETITOR_ROOTS.has(root)
}

/**
 * AI screen over Semrush candidates: keep only genuine direct competitors
 * (a subset of `candidates` — never invents domains). Null when the model
 * reply is unparseable, so callers fall back to the unscreened list.
 */
async function screenCompetitorsWithLLM(
  client: RecsClient,
  domain: string,
  candidates: Array<{ domain: string; commonKeywords: number }>,
): Promise<string[] | null> {
  if (!process.env.ANTHROPIC_API_KEY) return null
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  const message = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 400,
    messages: [
      {
        role: 'user',
        content: `You are screening organic-search competitor candidates for a business. Keep ONLY genuine direct competitors — businesses a customer would realistically choose INSTEAD of this one (same category of product/service).

Business: ${client.name}
Domain: ${domain}
${client.brand_context ? `Context: ${client.brand_context.slice(0, 1200)}` : ''}

Candidates (domain — shared ranking keywords with the business):
${candidates.map((c) => `${c.domain} — ${c.commonKeywords}`).join('\n')}

EXCLUDE: directories, review/listing sites, marketplaces, delivery platforms, news/media/blogs, shopping malls & mixed-use developments, real-estate/landlord sites, suppliers, and anything that is not a competing business in the same category.

Respond with ONLY a JSON array of the kept domains, ordered most→least competitive, e.g. ["competitor.com"]. Return [] if none qualify. Do not add domains that are not in the candidate list.`,
      },
    ],
  })

  const raw = message.content[0]?.type === 'text' ? message.content[0].text : '[]'
  const kept = parseStringArray(raw)
  if (kept === null) return null
  // Enforce subset-of-candidates: the screen selects, it never invents.
  const candidateSet = new Set(candidates.map((c) => c.domain))
  return kept.map((d) => normalizeDomain(d)).filter((d) => candidateSet.has(d))
}

/**
 * Recommend competitor domains: Semrush organic competitors (real SERP
 * overlap), denylist-filtered and AI-screened down to genuine direct
 * competitors. Falls back to Claude-from-context when Semrush has nothing.
 */
export async function recommendCompetitors(clientId: string): Promise<RecsResult> {
  try {
    const client = await loadClient(clientId)
    if (!client) return { suggestions: [], source: 'none', error: 'Client not found' }

    const domain = client.gsc_site_url ? normalizeDomain(client.gsc_site_url) : ''
    const apiKey = process.env.SEMRUSH_API_KEY

    if (apiKey && domain) {
      // Over-fetch so the screen still has enough to choose from after pruning.
      const res = await fetchSemrushOrganicCompetitors(domain, apiKey, 'us', 20)
      if (res.ok && res.data.length > 0) {
        const candidates = res.data
          .map((c) => ({ domain: normalizeDomain(c.domain), commonKeywords: c.commonKeywords }))
          .filter((c) => c.domain && c.domain !== domain && !isNonCompetitorPlatform(c.domain))
        if (candidates.length > 0) {
          let screened: string[] | null = null
          try {
            screened = await screenCompetitorsWithLLM(client, domain, candidates)
          } catch {
            screened = null // screen unavailable — fall back to unscreened candidates
          }
          const suggestions = (screened ?? candidates.map((c) => c.domain)).slice(0, 8)
          if (suggestions.length > 0) {
            return { suggestions, source: screened ? 'semrush+llm' : 'semrush' }
          }
          // Screen rejected everything — fall through to the from-context path.
        }
      }
    }

    if (!process.env.ANTHROPIC_API_KEY) {
      return { suggestions: [], source: 'none', error: 'Semrush returned no competitors and no LLM key is configured' }
    }

    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 400,
      messages: [
        {
          role: 'user',
          content: `List the most likely direct organic-search competitors for this business.

Business: ${client.name}
Domain: ${domain || 'unknown'}
${client.brand_context ? `Context: ${client.brand_context.slice(0, 1500)}` : ''}

Respond with ONLY a JSON array of up to 6 competitor root domains (no protocol, no www), e.g. ["competitor.com"]. Only include real companies you are confident exist.`,
        },
      ],
    })

    const raw = message.content[0]?.type === 'text' ? message.content[0].text : '[]'
    const llmDomains = parseStringArray(raw)
    if (llmDomains === null) {
      return { suggestions: [], source: 'none', error: 'AI returned an unparseable response — try again' }
    }
    const suggestions = llmDomains
      .map((d) => normalizeDomain(d))
      .filter((d) => d && d !== domain)
      .slice(0, 6)

    return { suggestions, source: 'llm' }
  } catch (err) {
    return { suggestions: [], source: 'none', error: err instanceof Error ? err.message : 'Failed' }
  }
}

// ── Key events ────────────────────────────────────────────────────────────────

export type KeyEventSuggestion = { name: string; count: number }

/**
 * Recommend GA4 key-event names from what is actually firing: eventName ×
 * keyEvents over the last 90 days, ranked by volume.
 */
export async function recommendKeyEvents(
  clientId: string,
): Promise<{ suggestions: KeyEventSuggestion[]; error?: string }> {
  try {
    const client = await loadClient(clientId)
    if (!client) return { suggestions: [], error: 'Client not found' }
    if (!client.ga4_property_id) return { suggestions: [], error: 'No GA4 property configured for this client' }

    const auth = await getAdminOAuthClient()
    const analyticsdata = google.analyticsdata({ version: 'v1beta', auth })
    const range = buildDateRange('90d', 'prior')

    const res = await analyticsdata.properties.runReport({
      property: `properties/${client.ga4_property_id}`,
      requestBody: {
        dateRanges: [{ startDate: range.startDate, endDate: range.endDate }],
        dimensions: [{ name: 'eventName' }],
        metrics: [{ name: 'keyEvents' }],
        orderBys: [{ metric: { metricName: 'keyEvents' }, desc: true }],
        limit: '20',
      },
    })

    const suggestions = (res.data.rows ?? [])
      .map((row) => ({
        name: row.dimensionValues?.[0]?.value ?? '',
        count: Math.round(parseFloat(row.metricValues?.[0]?.value ?? '0')),
      }))
      .filter((s) => s.name && s.count > 0)

    return { suggestions }
  } catch (err) {
    return { suggestions: [], error: err instanceof Error ? err.message : 'Failed' }
  }
}
