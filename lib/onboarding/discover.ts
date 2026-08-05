// Auto-discovery: given a client's website, find the GA4 property, Search
// Console property and GBP account the agency already has access to.
//
// Why this exists: the interview was asking a strategist to type ids the portal
// can already see. Typing live pipeline config by hand is slow and a source of
// silent misconfiguration.
//
// Two design rules, both load-bearing:
//
//   1. EVERY SOURCE IS INDEPENDENT. A GA4 failure must not cost you the GSC
//      match. Each returns its own status and a failure produces a VISIBLE gap,
//      never a silent pass — the same contract the pipeline's stations use, and
//      the failure AUTOMATION-CONTEXT.md §17 calls the most important to prevent.
//
//   2. NO LLM. Matching is deterministic string comparison against Google's own
//      APIs. Confidence comes from HOW something matched, not from a model
//      judging it. (Failure mode #7: letting the LLM creep.)
//
// The expensive part is GA4: accountSummaries carries no URL (the `websiteUrl`
// field in listGA4Properties is hardcoded to ''), so the only reliable domain
// signal is each property's web data stream `defaultUri` — one API call per
// property. That index is identical for every client, so it is built once and
// cached agency-wide rather than per client.

import { google } from 'googleapis'
import type { OAuth2Client } from 'google-auth-library'
import { cachedFetch } from '@/lib/api-cache'
import { normalizeDomain, siteMatchesDomain } from '@/lib/normalize-domain'
import { inferClientType, type InferenceSignals } from '@/lib/dashboard/registry'
import type { ClientType } from '@/lib/dashboard/types'
import type { GBPLocation } from '@/lib/connectors/gbp'

/** 12h. The index only changes when a property or data stream is added. */
const GA4_INDEX_TTL_SECONDS = 12 * 3600
const GA4_INDEX_CACHE_KEY = 'discover:ga4-domain-index:v1'

/** Data-stream fan-out concurrency. Bounded for Apex-scale property counts. */
const FANOUT_CONCURRENCY = 8

/** Hard ceiling on the fan-out, so one misconfigured account can't run away. */
const MAX_PROPERTIES = 400

export type SourceStatus = 'ok' | 'no_match' | 'failed'
export type MatchConfidence = 'high' | 'low'

export interface SourceResult<T> {
  status: SourceStatus
  /** Human-readable reason, shown in the UI when not `ok`. */
  message?: string
  data: T | null
  durationMs: number
}

export interface Ga4Match {
  propertyId: string
  displayName: string
  /** `data_stream` is an exact URL match; `display_name` is a weak name guess. */
  matchedOn: 'data_stream' | 'display_name'
  confidence: MatchConfidence
  evidence: string
}

export interface GscMatch {
  siteUrl: string
  confidence: MatchConfidence
  evidence: string
}

export interface GbpMatch {
  accountId: string
  accountName: string
  locationCount: number
  matchedLocations: string[]
  confidence: MatchConfidence
  evidence: string
}

export interface Discovery {
  domain: string
  ga4: SourceResult<Ga4Match>
  gsc: SourceResult<GscMatch>
  gbp: SourceResult<GbpMatch>
  clientType: { value: ClientType; evidence: string } | null
  completedAt: string
}

export interface Ga4IndexEntry {
  propertyId: string
  displayName: string
  /** Normalized domain from the web data stream, or '' when it has none. */
  domain: string
}

// ── Pure matchers (no I/O — this is where the bugs would be, so it's all testable)

/**
 * Find the GA4 property for a domain.
 *
 * Prefers an exact data-stream URL match. Falls back to a display-name guess,
 * returned at `low` confidence — deliberately, because a property called
 * "Tornado HVAC" might belong to a different Tornado. A low match is shown as a
 * suggestion and does NOT count as an answered slot.
 */
export function matchGa4(index: Ga4IndexEntry[], domain: string): Ga4Match | null {
  const exact = index.find((e) => e.domain && e.domain === domain)
  if (exact) {
    return {
      propertyId: exact.propertyId,
      displayName: exact.displayName,
      matchedOn: 'data_stream',
      confidence: 'high',
      evidence: `Data stream URL matches ${domain}`,
    }
  }

  // Name fallback: compare the domain's root label against the property name.
  const root = domain.split('.')[0]?.toLowerCase() ?? ''
  if (root.length < 4) return null // too short to be a meaningful signal

  const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')
  const target = squash(root)
  const named = index.filter((e) => {
    const name = squash(e.displayName)
    return name.length >= 4 && (name.includes(target) || target.includes(name))
  })

  // Ambiguous is worse than nothing — a wrong GA4 property means wrong numbers.
  if (named.length !== 1) return null

  return {
    propertyId: named[0].propertyId,
    displayName: named[0].displayName,
    matchedOn: 'display_name',
    confidence: 'low',
    evidence: `No data stream matched. Property name "${named[0].displayName}" resembles ${domain} — confirm this is right.`,
  }
}

/**
 * Find the Search Console property covering a domain.
 *
 * Prefers an exact URL-prefix property, then a domain property. Both are `high`
 * confidence: GSC properties are verified ownership, so a match is a fact.
 */
export function matchGscSite(sites: string[], domain: string): GscMatch | null {
  const covering = sites.filter((s) => siteMatchesDomain(s, domain))
  if (covering.length === 0) return null

  const urlPrefix = covering.find((s) => !s.startsWith('sc-domain:'))
  const chosen = urlPrefix ?? covering[0]

  return {
    siteUrl: chosen,
    confidence: 'high',
    evidence: chosen.startsWith('sc-domain:')
      ? `Domain property ${chosen} covers ${domain}`
      : `Verified property ${chosen}`,
  }
}

/** Locations whose website matches the domain. */
export function matchGbpLocations(
  locations: Pick<GBPLocation, 'title' | 'websiteUri'>[],
  domain: string,
): string[] {
  return locations
    .filter((l) => l.websiteUri && normalizeDomain(l.websiteUri) === domain)
    .map((l) => l.title)
}

/**
 * Client type from real signals.
 *
 * inferClientType has existed since the dashboard work but is called with `{}`
 * in ClientSettingsForm, so it has always returned 'lead_gen'. This is the first
 * caller that passes it anything.
 */
export function inferTypeFromDiscovery(signals: InferenceSignals): {
  value: ClientType
  evidence: string
} {
  const value = inferClientType(signals)
  const count = signals.gbpLocationCount ?? 0
  const evidence =
    (signals.transactions ?? 0) > 0 || (signals.purchaseRevenue ?? 0) > 0
      ? 'GA4 reports transactions'
      : count > 5
        ? `${count} matching Google Business Profile locations`
        : count >= 1
          ? `${count} matching Google Business Profile location${count === 1 ? '' : 's'}`
          : 'No Business Profile locations matched and no ecommerce signal'
  return { value, evidence }
}

// ── I/O ───────────────────────────────────────────────────────────────────────

/** Run tasks with a bounded number in flight. */
async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const out: R[] = []
  for (let i = 0; i < items.length; i += limit) {
    out.push(...(await Promise.all(items.slice(i, i + limit).map(fn))))
  }
  return out
}

/**
 * Build (or read from cache) the agency-wide domain → GA4 property index.
 *
 * Cached under one key for the whole agency because the index does not vary by
 * client: the first onboarding pays the fan-out, every later one is free.
 */
export async function buildGa4DomainIndex(auth: OAuth2Client): Promise<Ga4IndexEntry[]> {
  return cachedFetch(GA4_INDEX_CACHE_KEY, GA4_INDEX_TTL_SECONDS, async () => {
    const admin = google.analyticsadmin({ version: 'v1beta', auth })

    const summaries = await admin.accountSummaries.list({ pageSize: 200 })
    const properties: { propertyId: string; displayName: string }[] = []
    for (const account of summaries.data.accountSummaries ?? []) {
      for (const prop of account.propertySummaries ?? []) {
        const propertyId = (prop.property ?? '').replace('properties/', '')
        if (propertyId) {
          properties.push({ propertyId, displayName: prop.displayName ?? 'Unnamed property' })
        }
      }
    }

    const bounded = properties.slice(0, MAX_PROPERTIES)

    const entries = await mapLimit(bounded, FANOUT_CONCURRENCY, async (p) => {
      try {
        const { data } = await admin.properties.dataStreams.list({
          parent: `properties/${p.propertyId}`,
        })
        const web = (data.dataStreams ?? []).find((s) => s.type === 'WEB_DATA_STREAM')
        const uri = web?.webStreamData?.defaultUri ?? ''
        return { ...p, domain: uri ? normalizeDomain(uri) : '' }
      } catch {
        // One inaccessible property must not fail the whole index.
        return { ...p, domain: '' }
      }
    })

    return entries
  })
}

/**
 * Discover everything we can for a domain.
 *
 * Never throws. Each source reports its own status so a partial result is
 * visibly partial rather than quietly incomplete.
 */
export async function discoverClientConfig(
  websiteOrDomain: string,
  deps: {
    auth: OAuth2Client
    gbpAuth: OAuth2Client | null
    listGscSites: () => Promise<string[]>
    listGbpAccounts: (auth: OAuth2Client) => Promise<{ name: string; accountName: string }[]>
    listGbpLocations: (accountName: string, auth: OAuth2Client) => Promise<GBPLocation[]>
  },
): Promise<Discovery> {
  const domain = normalizeDomain(websiteOrDomain)

  const timed = async <T>(fn: () => Promise<SourceResult<T>>): Promise<SourceResult<T>> => {
    const started = Date.now()
    try {
      const r = await fn()
      return { ...r, durationMs: Date.now() - started }
    } catch (err) {
      return {
        status: 'failed',
        message: err instanceof Error ? err.message : String(err),
        data: null,
        durationMs: Date.now() - started,
      }
    }
  }

  const [ga4, gsc, gbp] = await Promise.all([
    timed<Ga4Match>(async () => {
      const index = await buildGa4DomainIndex(deps.auth)
      const match = matchGa4(index, domain)
      return match
        ? { status: 'ok', data: match, durationMs: 0 }
        : {
            status: 'no_match',
            message: `No GA4 property has a web data stream for ${domain}. Checked ${index.length} propert${index.length === 1 ? 'y' : 'ies'}.`,
            data: null,
            durationMs: 0,
          }
    }),

    timed<GscMatch>(async () => {
      const sites = await deps.listGscSites()
      const match = matchGscSite(sites, domain)
      return match
        ? { status: 'ok', data: match, durationMs: 0 }
        : {
            status: 'no_match',
            message: `No Search Console property covers ${domain}. Checked ${sites.length}.`,
            data: null,
            durationMs: 0,
          }
    }),

    timed<GbpMatch>(async () => {
      if (!deps.gbpAuth) {
        return {
          status: 'failed',
          message: 'Google Business Profile is not connected. Connect it in Admin.',
          data: null,
          durationMs: 0,
        }
      }
      const accounts = await deps.listGbpAccounts(deps.gbpAuth)
      for (const account of accounts) {
        const locations = await deps.listGbpLocations(account.name, deps.gbpAuth)
        const matched = matchGbpLocations(locations, domain)
        if (matched.length > 0) {
          return {
            status: 'ok',
            data: {
              accountId: account.name,
              accountName: account.accountName,
              locationCount: matched.length,
              matchedLocations: matched,
              confidence: 'high',
              evidence: `${matched.length} location${matched.length === 1 ? '' : 's'} in "${account.accountName}" list ${domain} as their website`,
            },
            durationMs: 0,
          }
        }
      }
      return {
        status: 'no_match',
        message: `No Business Profile location lists ${domain} as its website. Checked ${accounts.length} account${accounts.length === 1 ? '' : 's'}.`,
        data: null,
        durationMs: 0,
      }
    }),
  ])

  // Only infer a type when GBP actually answered. A failed GBP lookup must not
  // masquerade as "no locations found", which would wrongly suggest lead_gen.
  const clientType =
    gbp.status === 'failed'
      ? null
      : inferTypeFromDiscovery({ gbpLocationCount: gbp.data?.locationCount ?? 0 })

  return { domain, ga4, gsc, gbp, clientType, completedAt: new Date().toISOString() }
}
