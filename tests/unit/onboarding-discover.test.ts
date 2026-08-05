import { describe, expect, it } from 'vitest'
import { siteMatchesDomain } from '@/lib/normalize-domain'
import {
  inferTypeFromDiscovery,
  matchGa4,
  matchGbpLocations,
  matchGscSite,
  type Discovery,
  type Ga4IndexEntry,
} from '@/lib/onboarding/discover'
import { describeDiscovery, seedFromDiscovery } from '@/lib/onboarding/seed'
import { isFilled, type Answers } from '@/lib/onboarding/schema'

describe('siteMatchesDomain', () => {
  it('matches a URL-prefix property on an exact host', () => {
    expect(siteMatchesDomain('https://tornadohvacca.com/', 'tornadohvacca.com')).toBe(true)
    expect(siteMatchesDomain('https://www.tornadohvacca.com/', 'tornadohvacca.com')).toBe(true)
  })

  it('matches an sc-domain property on its own domain', () => {
    expect(siteMatchesDomain('sc-domain:tornadohvacca.com', 'tornadohvacca.com')).toBe(true)
  })

  it('lets an sc-domain property cover a subdomain, which is what GSC actually does', () => {
    // The direction that was backwards before this was lifted out of
    // analytics.ts: a domain property covers everything beneath it.
    expect(siteMatchesDomain('sc-domain:brand.com', 'shop.brand.com')).toBe(true)
  })

  it('does NOT let a subdomain property cover the parent domain', () => {
    // The old implementation returned true here, which would have pointed a
    // client at a property that does not contain their data.
    expect(siteMatchesDomain('sc-domain:shop.brand.com', 'brand.com')).toBe(false)
    expect(siteMatchesDomain('https://shop.brand.com/', 'brand.com')).toBe(false)
  })

  it('does not match a different domain that merely ends similarly', () => {
    expect(siteMatchesDomain('sc-domain:notbrand.com', 'brand.com')).toBe(false)
    expect(siteMatchesDomain('https://mybrand.com/', 'brand.com')).toBe(false)
  })
})

const idx = (rows: Array<[string, string, string]>): Ga4IndexEntry[] =>
  rows.map(([propertyId, displayName, domain]) => ({ propertyId, displayName, domain }))

describe('matchGa4', () => {
  it('prefers an exact data-stream match and calls it high confidence', () => {
    const m = matchGa4(
      idx([
        ['111', 'Some Other Co', 'other.com'],
        ['222', 'Tornado HVAC', 'tornadohvacca.com'],
      ]),
      'tornadohvacca.com',
    )
    expect(m).toMatchObject({ propertyId: '222', matchedOn: 'data_stream', confidence: 'high' })
    expect(m!.evidence).toContain('tornadohvacca.com')
  })

  it('falls back to a name match at LOW confidence', () => {
    const m = matchGa4(idx([['222', 'Tornado HVAC', '']]), 'tornadohvacca.com')
    expect(m).toMatchObject({ propertyId: '222', matchedOn: 'display_name', confidence: 'low' })
    expect(m!.evidence).toContain('confirm')
  })

  it('refuses an ambiguous name match rather than guessing between two', () => {
    // A wrong GA4 property means wrong numbers on every report, so ambiguity
    // must produce nothing. Both of these satisfy the containment rule.
    const m = matchGa4(
      idx([
        ['222', 'Tornado HVAC', ''],
        ['333', 'Tornado', ''],
      ]),
      'tornadohvacca.com',
    )
    expect(m).toBeNull()
  })

  it('is narrow about what counts as a name match', () => {
    // Worth pinning because it is mildly surprising: a suffixed variant like
    // "Tornado HVAC (old)" does NOT satisfy containment in either direction
    // against "tornadohvacca", so it is not a rival candidate and the real
    // property still matches.
    const m = matchGa4(
      idx([
        ['222', 'Tornado HVAC', ''],
        ['333', 'Tornado HVAC (old)', ''],
      ]),
      'tornadohvacca.com',
    )
    expect(m?.propertyId).toBe('222')
    expect(m?.confidence).toBe('low')
  })

  it('returns null when nothing matches', () => {
    expect(matchGa4(idx([['111', 'Unrelated', 'other.com']]), 'tornadohvacca.com')).toBeNull()
  })

  it('ignores index entries with no data-stream domain when matching exactly', () => {
    expect(matchGa4(idx([['111', 'Zzz', '']]), 'tornadohvacca.com')).toBeNull()
  })

  it('does not name-match on a too-short domain root', () => {
    expect(matchGa4(idx([['111', 'ab', '']]), 'ab.com')).toBeNull()
  })
})

describe('matchGscSite', () => {
  it('prefers a URL-prefix property over a domain property', () => {
    const m = matchGscSite(
      ['sc-domain:tornadohvacca.com', 'https://tornadohvacca.com/'],
      'tornadohvacca.com',
    )
    expect(m!.siteUrl).toBe('https://tornadohvacca.com/')
  })

  it('uses the domain property when that is all there is', () => {
    const m = matchGscSite(['sc-domain:tornadohvacca.com'], 'tornadohvacca.com')
    expect(m).toMatchObject({ siteUrl: 'sc-domain:tornadohvacca.com', confidence: 'high' })
    expect(m!.evidence).toContain('covers')
  })

  it('returns null on no match and on an empty list', () => {
    expect(matchGscSite(['https://other.com/'], 'tornadohvacca.com')).toBeNull()
    expect(matchGscSite([], 'tornadohvacca.com')).toBeNull()
  })
})

describe('matchGbpLocations', () => {
  it('matches on websiteUri, ignoring www and protocol', () => {
    const got = matchGbpLocations(
      [
        { title: 'Sherman Oaks', websiteUri: 'https://www.tornadohvacca.com' },
        { title: 'Unrelated', websiteUri: 'https://other.com' },
        { title: 'No website', websiteUri: null },
      ],
      'tornadohvacca.com',
    )
    expect(got).toEqual(['Sherman Oaks'])
  })

  it('returns an empty list rather than throwing on empty input', () => {
    expect(matchGbpLocations([], 'tornadohvacca.com')).toEqual([])
  })
})

describe('inferTypeFromDiscovery', () => {
  it('reads a single GBP location as a local service business', () => {
    const r = inferTypeFromDiscovery({ gbpLocationCount: 1 })
    expect(r.value).toBe('local_service')
    expect(r.evidence).toContain('1 matching')
  })

  it('reads many locations as multi-location', () => {
    expect(inferTypeFromDiscovery({ gbpLocationCount: 12 }).value).toBe('multi_location')
  })

  it('reads transactions as ecommerce regardless of locations', () => {
    expect(inferTypeFromDiscovery({ gbpLocationCount: 3, transactions: 5 }).value).toBe('ecommerce')
  })

  it('names its basis when nothing matched, so the default is visible as a default', () => {
    const r = inferTypeFromDiscovery({ gbpLocationCount: 0 })
    expect(r.value).toBe('lead_gen')
    expect(r.evidence).toContain('No Business Profile locations matched')
  })
})

// ── Seeding ───────────────────────────────────────────────────────────────────

const okSource = <T,>(data: T) => ({ status: 'ok' as const, data, durationMs: 1 })
const noMatch = { status: 'no_match' as const, message: 'nope', data: null, durationMs: 1 }
const failed = { status: 'failed' as const, message: 'boom', data: null, durationMs: 1 }

function discovery(over: Partial<Discovery> = {}): Discovery {
  return {
    domain: 'tornadohvacca.com',
    ga4: okSource({
      propertyId: '222',
      displayName: 'Tornado HVAC',
      matchedOn: 'data_stream' as const,
      confidence: 'high' as const,
      evidence: 'Data stream URL matches tornadohvacca.com',
    }),
    gsc: okSource({
      siteUrl: 'sc-domain:tornadohvacca.com',
      confidence: 'high' as const,
      evidence: 'Domain property covers it',
    }),
    gbp: okSource({
      accountId: 'accounts/123',
      accountName: 'IgniteIQ',
      locationCount: 1,
      matchedLocations: ['Sherman Oaks'],
      confidence: 'high' as const,
      evidence: '1 location lists it',
    }),
    clientType: { value: 'local_service', evidence: '1 matching location' },
    completedAt: '2026-08-05T12:00:00.000Z',
    ...over,
  }
}

describe('seedFromDiscovery', () => {
  it('seeds the matched slots with auto provenance and evidence', () => {
    const patch = seedFromDiscovery(discovery(), {})
    expect(Object.keys(patch).sort()).toEqual([
      'client_type',
      'ga4_property_id',
      'gbp_account_id',
      'gsc_site_url',
    ])
    expect(patch['ga4_property_id']).toMatchObject({
      value: '222',
      source: 'auto',
      confidence: 'high',
    })
    expect(patch['ga4_property_id']?.evidence).toContain('tornadohvacca.com')
  })

  it('a high-confidence auto match counts as answered', () => {
    const patch = seedFromDiscovery(discovery(), {})
    expect(isFilled(patch['ga4_property_id'])).toBe(true)
  })

  it('a LOW-confidence auto match does NOT count as answered', () => {
    // It's a suggestion. The strategist still has to confirm it, so the slot
    // must keep showing as outstanding.
    const patch = seedFromDiscovery(
      discovery({
        ga4: okSource({
          propertyId: '222',
          displayName: 'Tornado HVAC',
          matchedOn: 'display_name' as const,
          confidence: 'low' as const,
          evidence: 'name resembles it',
        }),
      }),
      {},
    )
    expect(patch['ga4_property_id']?.value).toBe('222')
    expect(isFilled(patch['ga4_property_id'])).toBe(false)
  })

  it('records NOTHING for a source that found nothing', () => {
    // "We couldn't find it" must not become "the client doesn't know" — that
    // would let the interview skip a question it should still ask.
    const patch = seedFromDiscovery(discovery({ ga4: noMatch }), {})
    expect('ga4_property_id' in patch).toBe(false)
  })

  it('records NOTHING for a source that failed', () => {
    const patch = seedFromDiscovery(discovery({ gsc: failed }), {})
    expect('gsc_site_url' in patch).toBe(false)
  })

  it('never overwrites an answer a human already gave', () => {
    const existing: Answers = {
      ga4_property_id: { value: '999', unknown: false, source: 'interview' },
    }
    const patch = seedFromDiscovery(discovery(), existing)
    expect('ga4_property_id' in patch).toBe(false)
    expect('gsc_site_url' in patch).toBe(true)
  })

  it('marks an unsupported client_type default as low confidence', () => {
    // With no GBP locations, inferClientType falls through to lead_gen. That is
    // a default, not a finding, so it must not read as confirmed.
    const patch = seedFromDiscovery(
      discovery({
        gbp: noMatch,
        clientType: { value: 'lead_gen', evidence: 'No Business Profile locations matched' },
      }),
      {},
    )
    expect(patch['client_type']).toMatchObject({ value: 'lead_gen', confidence: 'low' })
    expect(isFilled(patch['client_type'])).toBe(false)
  })
})

describe('describeDiscovery', () => {
  it('reports what was found', () => {
    const s = describeDiscovery(discovery())
    expect(s).toContain('tornadohvacca.com')
    expect(s).toContain('222')
    expect(s).toContain('IgniteIQ')
  })

  it('says a failed lookup is a gap rather than a confirmation', () => {
    const s = describeDiscovery(discovery({ gbp: failed }))
    expect(s).toContain('lookup failed')
    expect(s).toContain('gaps, not confirmations')
  })

  it('distinguishes not-found from failed', () => {
    const s = describeDiscovery(discovery({ ga4: noMatch }))
    expect(s).toContain('not found')
    expect(s).not.toContain('gaps, not confirmations')
  })
})

/**
 * Ground truth. These are the values actually stored on the Tornado HVAC row in
 * production (queried, not invented), so this asserts the matchers would
 * reproduce the real config rather than merely being self-consistent.
 *
 * The live API call itself is still untested — it is admin-gated and needs a
 * session. This pins everything downstream of the API response.
 */
describe('Tornado HVAC — reproduces the stored production config', () => {
  const DOMAIN = 'tornadohvacca.com'
  const STORED = {
    ga4_property_id: '529114768',
    gsc_site_url: 'https://tornadohvacca.com/',
    gbp_account_id: 'accounts/112185427316407534556',
  }

  it('picks the stored GA4 property from a data-stream match', () => {
    const m = matchGa4(
      idx([
        ['111111111', 'Some Other Client', 'othersite.com'],
        [STORED.ga4_property_id, 'Tornado HVAC', DOMAIN],
      ]),
      DOMAIN,
    )
    expect(m?.propertyId).toBe(STORED.ga4_property_id)
    expect(m?.confidence).toBe('high')
  })

  it('picks the stored GSC property, preferring the URL-prefix form', () => {
    const m = matchGscSite(
      [
        'sc-domain:othersite.com',
        'sc-domain:tornadohvacca.com',
        STORED.gsc_site_url,
      ],
      DOMAIN,
    )
    // The stored value is the URL-prefix form, and that is what we prefer.
    expect(m?.siteUrl).toBe(STORED.gsc_site_url)
  })

  it('matches the GBP location by its website', () => {
    expect(
      matchGbpLocations(
        [
          { title: 'Tornado HVAC', websiteUri: 'https://tornadohvacca.com/' },
          { title: 'A Different Client', websiteUri: 'https://othersite.com' },
        ],
        DOMAIN,
      ),
    ).toEqual(['Tornado HVAC'])
  })

  it('would set the client_type that is currently null on the row', () => {
    // Tornado is a single-location service-area business, and client_type being
    // null is why its local dashboard modules stay dark (blocker #1 in the doc).
    const patch = seedFromDiscovery(
      discovery({
        gbp: okSource({
          accountId: STORED.gbp_account_id,
          accountName: 'IgniteIQ',
          locationCount: 1,
          matchedLocations: ['Tornado HVAC'],
          confidence: 'high' as const,
          evidence: '1 location lists tornadohvacca.com',
        }),
        clientType: { value: 'local_service', evidence: '1 matching location' },
      }),
      {},
    )
    expect(patch['client_type']?.value).toBe('local_service')
    expect(isFilled(patch['client_type'])).toBe(true)
    expect(patch['gbp_account_id']?.value).toBe(STORED.gbp_account_id)
  })
})
