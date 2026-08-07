import { describe, expect, it } from 'vitest'
import {
  AMBIGUOUS_BRAND_WORDS,
  deriveBrandTerms,
  overCaptureReason,
  registrableLabel,
} from '@/lib/onboarding/brand-terms'
import {
  discoverClientConfig,
  fetchOrganicCompetitors,
  type Ga4IndexEntry,
} from '@/lib/onboarding/discover'
import { describeDiscovery, seedFromDiscovery } from '@/lib/onboarding/seed'
import { isFilled, sanitizeAnswerPatch, type Answers } from '@/lib/onboarding/schema'

// ── deriveBrandTerms ──────────────────────────────────────────────────────────

/** Identity is required; these tests do not exercise brand-term derivation. */
const NO_IDENTITY = { name: null, slug: null }

describe('deriveBrandTerms — the normal case', () => {
  const d = deriveBrandTerms({
    name: 'Tapps Electric',
    slug: 'tapps-electric',
    websiteUrl: 'https://www.tappselectric.com/contact',
  })

  it('derives the name, the slug and the domain label', () => {
    expect(d.terms).toContain('tapps electric') // name, and the slug spaced out
    expect(d.terms).toContain('tappselectric') // registrable label
    expect(d.terms).toContain('tapps') // bare token — distinctive, so proposed
  })

  it('returns lowercased, trimmed terms with no empties and no duplicates', () => {
    for (const t of d.terms) {
      expect(t).toBe(t.trim().toLowerCase())
      expect(t.length).toBeGreaterThan(0)
    }
    expect(new Set(d.terms).size).toBe(d.terms.length)
  })

  it('is a superset of what the two read-time heuristics produced', () => {
    // ai-visibility.ts used [slug, brandTokenFromSite(site), name]; the GSC copy
    // used the domain label alone, and got it wrong for multi-part TLDs. Every
    // one of those cases is still covered — the hyphenated slug in the form that
    // can actually match a space-separated query.
    const uk = deriveBrandTerms({
      name: 'Tapps Electric',
      slug: 'tapps-electric',
      websiteUrl: 'https://shop.tappselectric.co.uk/',
    })
    expect(uk.terms).toContain('tapps electric') // the name (and the spaced slug)
    expect(uk.terms).toContain('tappselectric') // the domain label — "co" in the GSC copy
    expect(uk.terms).toContain('tapps') // the bare token

    // No term carries a hyphen: a query is space-separated, so a hyphenated slug
    // could only ever match a query nobody types.
    for (const t of uk.terms) expect(t).not.toContain('-')
  })

  it('never claims more than low confidence', () => {
    expect(d.confidence).toBe('low')
  })

  it('carries evidence that fits the slot schema cap', () => {
    expect(d.evidence.length).toBeGreaterThan(0)
    expect(d.evidence.length).toBeLessThanOrEqual(300)
    expect(d.evidence).toContain('confirm')
  })
})

describe('deriveBrandTerms — multi-word and corporate names', () => {
  it('keeps the full name and adds a variant without the legal suffix', () => {
    const d = deriveBrandTerms({
      name: 'Rowlett Solar & Roofing Company, LLC',
      slug: 'rowlett-solar',
      websiteUrl: 'rowlettsolar.com',
    })
    expect(d.terms).toContain('rowlett solar & roofing company llc')
    expect(d.terms).toContain('rowlett solar & roofing')
    expect(d.terms).toContain('rowlett solar')
    expect(d.terms).toContain('rowlettsolar')
    expect(d.terms).toContain('rowlett')
  })

  it('drops a leading "the"', () => {
    const d = deriveBrandTerms({ name: 'The Kirkwood Group', slug: '', websiteUrl: '' })
    expect(d.terms).toContain('the kirkwood group')
    expect(d.terms).toContain('kirkwood group')
    expect(d.terms).toContain('kirkwood')
  })
})

/**
 * THE DANGEROUS CASE. The downstream matcher is a substring test
 * (ai-visibility.ts:55, `q.includes(term)`), so a bare generic token marks
 * "tornado damage repair" as branded — which inflates branded share and hides
 * the non-branded opportunity the audit exists to find. Worse than no terms.
 */
describe('deriveBrandTerms — a generic-word brand', () => {
  const d = deriveBrandTerms({
    name: 'Tornado HVAC',
    slug: 'tornado-hvac',
    websiteUrl: 'https://tornadohvacca.com',
  })

  it('does NOT propose the bare generic token', () => {
    expect(d.terms).not.toContain('tornado')
    expect(d.bareToken).toBe('tornado')
    expect(d.overCaptureRisk).toBe(true)
  })

  it('says why it was withheld instead of dropping it silently', () => {
    expect(d.withheld.map((w) => w.term)).toContain('tornado')
    expect(d.withheld.find((w) => w.term === 'tornado')!.reason).toContain('ordinary search word')
    expect(d.evidence).toContain('tornado')
  })

  it('still proposes the multi-word and run-together forms, which are safe', () => {
    expect(d.terms).toContain('tornado hvac')
    expect(d.terms).toContain('tornadohvacca')
    expect(d.terms).toContain('tornadohvac')
  })

  it('withholds a phrase whose every word is an ordinary search word', () => {
    // "comfort air" is a substring of "comfort air conditioning", so a real HVAC
    // brand named Comfort Air would swallow its own non-branded queries.
    const c = deriveBrandTerms({ name: 'Comfort Air', slug: 'comfort-air', websiteUrl: 'comfortair.com' })
    expect(c.terms).not.toContain('comfort air')
    expect(c.terms).not.toContain('comfort')
    expect(c.overCaptureRisk).toBe(true)
    // The run-together domain label is still distinctive enough to propose.
    expect(c.terms).toContain('comfortair')
  })

  it('proposes nothing at all when every candidate would over-capture', () => {
    const apex = deriveBrandTerms({ name: 'Apex', slug: 'apex', websiteUrl: 'apex.com' })
    expect(apex.terms).toEqual([])
    expect(apex.overCaptureRisk).toBe(true)
  })
})

describe('overCaptureReason', () => {
  it('rejects a short token, because a substring match hits inside other words', () => {
    // "ace" is inside "furnace"; "air" is inside "repair".
    expect(overCaptureReason('ace')).toContain('4 characters')
    expect(overCaptureReason('bkt')).toBeTruthy()
  })

  it('rejects a bare ordinary word but accepts a distinctive one', () => {
    expect(overCaptureReason('summit')).toContain('ordinary search word')
    expect(overCaptureReason('tappselectric')).toBeNull()
  })

  it('accepts a phrase as long as one word is outside the service vocabulary', () => {
    // "tornado hvac" is one of the human-confirmed brand terms on the real
    // Tornado account, so the phrase rule must not swallow it even though
    // "tornado" alone is withheld.
    expect(overCaptureReason('tornado hvac')).toBeNull()
    expect(overCaptureReason('apex plumbing')).toBeNull()
  })

  it('rejects a phrase that is nothing but service vocabulary', () => {
    // A substring of "comfort air conditioning" / "heating and air repair".
    expect(overCaptureReason('comfort air')).toContain('service vocabulary')
    expect(overCaptureReason('heating and air')).toBeTruthy()
  })

  it('rejects a token with no letters', () => {
    expect(overCaptureReason('12345')).toContain('no letters')
  })

  it('keeps the ambiguous-word list non-empty and lowercase', () => {
    expect(AMBIGUOUS_BRAND_WORDS.size).toBeGreaterThan(50)
    for (const w of Array.from(AMBIGUOUS_BRAND_WORDS)) expect(w).toBe(w.toLowerCase())
  })
})

describe('deriveBrandTerms — accents and punctuation', () => {
  const d = deriveBrandTerms({
    name: "Café Ramírez Plumbing, Inc.",
    slug: 'cafe-ramirez-plumbing',
    websiteUrl: 'https://caferamirez.com',
  })

  it('keeps the accented form AND the folded form, because people type both', () => {
    expect(d.terms).toContain('café ramírez plumbing inc')
    expect(d.terms).toContain('cafe ramirez plumbing')
  })

  it('strips punctuation that never appears in a query', () => {
    for (const t of d.terms) expect(t).not.toMatch(/[.,]/)
  })

  it('keeps ampersands and apostrophes, which do appear in queries', () => {
    const amp = deriveBrandTerms({ name: "B&B O'Brien Plumbing", slug: '', websiteUrl: '' })
    expect(amp.terms).toContain("b&b o'brien plumbing")
  })
})

describe('deriveBrandTerms — missing inputs', () => {
  it('works with no website at all', () => {
    const d = deriveBrandTerms({ name: 'Tapps Electric', slug: 'tapps-electric' })
    expect(d.terms).toContain('tapps electric')
    expect(d.terms).toContain('tappselectric') // run-together slug
  })

  it('works with a website and nothing else', () => {
    const d = deriveBrandTerms({ websiteUrl: 'https://tappselectric.com' })
    expect(d.terms).toEqual(['tappselectric'])
    expect(d.bareToken).toBe('tappselectric')
  })

  it('returns an empty list rather than throwing on empty input', () => {
    const d = deriveBrandTerms({})
    expect(d.terms).toEqual([])
    expect(d.withheld).toEqual([])
    expect(d.evidence).toContain('No client name')
    expect(deriveBrandTerms({ name: null, slug: null, websiteUrl: null }).terms).toEqual([])
    expect(deriveBrandTerms({ name: '   ', slug: '', websiteUrl: '' }).terms).toEqual([])
  })

  it('produces nothing usable from a name with no ASCII-able content', () => {
    expect(deriveBrandTerms({ name: '🔥🔥🔥' }).terms).toEqual([])
  })
})

describe('deriveBrandTerms — de-duplication', () => {
  it('collapses slug, name and domain when they all say the same thing', () => {
    const d = deriveBrandTerms({
      name: 'Tappselectric',
      slug: 'tappselectric',
      websiteUrl: 'https://tappselectric.com',
    })
    expect(d.terms).toEqual(['tappselectric'])
  })

  it('never emits the same term twice however many sources produced it', () => {
    const d = deriveBrandTerms({
      name: 'Tapps Electric',
      slug: 'tapps-electric',
      websiteUrl: 'https://www.tapps-electric.com',
    })
    expect(new Set(d.terms).size).toBe(d.terms.length)
  })
})

describe('registrableLabel', () => {
  it('handles subdomains and multi-part TLDs', () => {
    expect(registrableLabel('https://shop.brand.com/x')).toBe('brand')
    expect(registrableLabel('brand.co.uk')).toBe('brand')
    // The case the google-search-console.ts copy gets wrong (it returns "co").
    expect(registrableLabel('shop.brand.co.uk')).toBe('brand')
    expect(registrableLabel('sc-domain:tornadohvacca.com')).toBe('tornadohvacca')
    expect(registrableLabel('')).toBe('')
  })
})

// ── Seeding from discovery ────────────────────────────────────────────────────

const DOMAIN = 'tornadohvacca.com'
const gbpAuth = {} as never

const idx = (rows: Array<[string, string, string]>): Ga4IndexEntry[] =>
  rows.map(([propertyId, displayName, domain]) => ({ propertyId, displayName, domain }))

/** Every network dependency is stubbed — no test here may reach Google or Semrush. */
const workingDeps = () => ({
  gbpAuth,
  buildGa4Index: async () => idx([['222', 'Tornado HVAC', DOMAIN]]),
  listGscSites: async () => ['https://tornadohvacca.com/'],
  listGbpAccounts: async () => [{ name: 'accounts/1', accountName: 'IgniteIQ' }],
  listGbpLocations: async () =>
    [{ title: 'Sherman Oaks', websiteUri: 'https://tornadohvacca.com' }] as never,
  fetchCompetitors: async () => ({
    ok: true as const,
    data: [
      { domain: 'servicechampions.net', competitionLevel: 0.9, commonKeywords: 400, organicTraffic: 9000 },
      { domain: 'https://www.aireserv.com/', competitionLevel: 0.8, commonKeywords: 300, organicTraffic: 8000 },
      { domain: DOMAIN, competitionLevel: 1, commonKeywords: 999, organicTraffic: 1 },
      { domain: 'dukeofair.com', competitionLevel: 0.7, commonKeywords: 200, organicTraffic: 700 },
      { domain: 'aireserv.com', competitionLevel: 0.6, commonKeywords: 100, organicTraffic: 600 },
      { domain: 'e.com', competitionLevel: 0.5, commonKeywords: 90, organicTraffic: 500 },
      { domain: 'f.com', competitionLevel: 0.4, commonKeywords: 80, organicTraffic: 400 },
      { domain: 'g.com', competitionLevel: 0.3, commonKeywords: 70, organicTraffic: 300 },
    ],
  }),
})

const client = { name: 'Tornado HVAC', slug: 'tornado-hvac' }

describe('discoverClientConfig — competitors', () => {
  it('reports ok and normalizes, de-duplicates and caps the domains', async () => {
    const d = await discoverClientConfig(DOMAIN, workingDeps(), client)
    expect(d.competitors?.status).toBe('ok')
    // www/protocol stripped, the duplicate collapsed, the client's own domain
    // dropped, and the list capped at five.
    expect(d.competitors?.data?.domains).toEqual([
      'servicechampions.net',
      'aireserv.com',
      'dukeofair.com',
      'e.com',
      'f.com',
    ])
    expect(d.competitors?.data?.confidence).toBe('low')
  })

  it('calls an empty Semrush report no_match, not a failure', async () => {
    const d = await discoverClientConfig(DOMAIN, {
      ...workingDeps(),
      fetchCompetitors: async () => ({ ok: true as const, data: [] }),
    }, NO_IDENTITY)
    expect(d.competitors?.status).toBe('no_match')
    expect(d.competitors?.data).toBeNull()
  })

  it('reports a Semrush error as failed without costing any other source', async () => {
    const d = await discoverClientConfig(DOMAIN, {
      ...workingDeps(),
      fetchCompetitors: async () => ({ ok: false as const, error: 'API units exhausted' }),
    }, NO_IDENTITY)
    expect(d.competitors?.status).toBe('failed')
    expect(d.competitors?.message).toContain('API units exhausted')
    // The whole point of the independence rule:
    expect([d.ga4.status, d.gsc.status, d.gbp.status]).toEqual(['ok', 'ok', 'ok'])
    expect(d.clientType?.value).toBe('local_service')
    expect(d.brandTerms?.terms.length).toBeGreaterThan(0)
  })

  it('survives a competitor fetcher that throws rather than returning', async () => {
    const d = await discoverClientConfig(DOMAIN, {
      ...workingDeps(),
      fetchCompetitors: async () => {
        throw new Error('socket hang up')
      },
    }, NO_IDENTITY)
    expect(d.competitors?.status).toBe('failed')
    expect(d.gsc.status).toBe('ok')
  })

  it('reports a missing API key as a failed lookup, and makes no network call', async () => {
    // Guards the default path: "we never asked Semrush" must not look like
    // "Semrush knows of no competitors". SEMRUSH_API_KEY is not set under vitest.
    const res = await fetchOrganicCompetitors(DOMAIN)
    expect(res.ok).toBe(false)
    expect(res.ok === false && res.error).toContain('SEMRUSH_API_KEY')
  })
})

describe('discoverClientConfig — brand terms', () => {
  it('derives them from the client identity when it is passed', async () => {
    const d = await discoverClientConfig(DOMAIN, workingDeps(), client)
    expect(d.brandTerms?.terms).toContain('tornado hvac')
    expect(d.brandTerms?.terms).not.toContain('tornado')
    expect(d.brandTerms?.overCaptureRisk).toBe(true)
  })

  it('falls back to the domain alone when no client identity is passed', async () => {
    const d = await discoverClientConfig(DOMAIN, workingDeps(), NO_IDENTITY)
    expect(d.brandTerms?.terms).toEqual(['tornadohvacca'])
  })
})

/** The real dependency shape, so an override can return a failure result too. */
type DiscoverDeps = Parameters<typeof discoverClientConfig>[1]

describe('seedFromDiscovery — brand_terms and competitors', () => {
  const seeded = async (over?: Partial<DiscoverDeps>) => {
    const d = await discoverClientConfig(DOMAIN, { ...workingDeps(), ...over }, client)
    return { discovery: d, patch: seedFromDiscovery(d, {}) }
  }

  it('seeds both slots with source auto and evidence', async () => {
    const { patch } = await seeded()
    expect(Object.keys(patch).sort()).toEqual([
      'brand_terms',
      'client_type',
      'competitors',
      'ga4_property_id',
      'gbp_account_id',
      'gsc_site_url',
    ])
    for (const id of ['brand_terms', 'competitors']) {
      expect(patch[id]?.source).toBe('auto')
      expect((patch[id]?.evidence ?? '').length).toBeGreaterThan(0)
      expect((patch[id]?.evidence ?? '').length).toBeLessThanOrEqual(300)
      expect(patch[id]?.recordedAt).toBe(patch['ga4_property_id']?.recordedAt)
    }
    expect(patch['brand_terms']?.value).toContain('tornado hvac')
    expect(patch['competitors']?.value).toContain('servicechampions.net')
  })

  // The load-bearing rule. auto/high counts as ANSWERED (schema.ts:isFilled), so
  // a guessed brand list recorded at high confidence would let a session reach
  // ready_for_review on a branded split nobody checked.
  it('records both at LOW confidence, so neither counts as answered', async () => {
    const { patch } = await seeded()
    expect(patch['brand_terms']?.confidence).toBe('low')
    expect(patch['competitors']?.confidence).toBe('low')
    expect(isFilled(patch['brand_terms'])).toBe(false)
    expect(isFilled(patch['competitors'])).toBe(false)
    // …while a real lookup still does count, so this is not blanket timidity.
    expect(isFilled(patch['ga4_property_id'])).toBe(true)
  })

  it('survives sanitizeAnswerPatch, which is what actually writes the draft', async () => {
    const { patch } = await seeded()
    const clean = sanitizeAnswerPatch(patch)
    expect(Object.keys(clean).sort()).toEqual(Object.keys(patch).sort())
    expect(clean['brand_terms']?.value).toEqual(patch['brand_terms']?.value)
    expect(clean['competitors']?.source).toBe('auto')
  })

  it('leaves competitors unseeded when Semrush failed, without touching the rest', async () => {
    const { patch } = await seeded({
      fetchCompetitors: async () => ({ ok: false as const, error: 'quota' }),
    })
    expect('competitors' in patch).toBe(false)
    // Everything else still seeded — a Semrush outage costs only Semrush.
    expect(patch['ga4_property_id']?.value).toBe('222')
    expect(patch['gsc_site_url']?.value).toBe('https://tornadohvacca.com/')
    expect(patch['brand_terms']?.value).toContain('tornado hvac')
    expect(patch['client_type']?.value).toBe('local_service')
  })

  it('leaves competitors unseeded when Semrush found nothing', async () => {
    const { patch } = await seeded({ fetchCompetitors: async () => ({ ok: true as const, data: [] }) })
    expect('competitors' in patch).toBe(false)
  })

  it('never overwrites an answer a human already gave', async () => {
    const d = await discoverClientConfig(DOMAIN, workingDeps(), client)
    const existing: Answers = {
      brand_terms: { value: ['tornado air'], unknown: false, source: 'interview' },
      competitors: { value: ['a-real-rival.com'], unknown: false, source: 'manual' },
    }
    const patch = seedFromDiscovery(d, existing)
    expect('brand_terms' in patch).toBe(false)
    expect('competitors' in patch).toBe(false)
    expect('ga4_property_id' in patch).toBe(true)
  })

  it('seeds no brand_terms at all when every candidate would over-capture', async () => {
    const d = await discoverClientConfig('apex.com', workingDeps(), { name: 'Apex', slug: 'apex' })
    const patch = seedFromDiscovery(d, {})
    // No terms is better than terms that mark ordinary queries as branded.
    expect('brand_terms' in patch).toBe(false)
    // …but the transcript still says so, because a silent absence reads as
    // "nothing to report" rather than "ask the client for these".
    expect(describeDiscovery(d)).toContain('none safe to guess')
  })

  it('tells the transcript what was found, and that terms are unconfirmed', async () => {
    const { discovery } = await seeded()
    const text = describeDiscovery(discovery)
    expect(text).toContain('Competitors: 5 from Semrush, unconfirmed')
    expect(text).toContain('confirm before use')
  })

  it('counts a failed Semrush lookup as a visible gap in the transcript', async () => {
    const { discovery } = await seeded({
      fetchCompetitors: async () => ({ ok: false as const, error: 'quota' }),
    })
    const text = describeDiscovery(discovery)
    expect(text).toContain('Competitors: lookup failed')
    expect(text).toContain('gaps, not confirmations')
  })

  it('is unchanged for a Discovery that predates these two sources', () => {
    // The optional fields exist so an older Discovery (or one built by a caller
    // with no Semrush key and no client identity) is still valid.
    const patch = seedFromDiscovery(
      {
        domain: DOMAIN,
        ga4: { status: 'no_match', data: null, durationMs: 1 },
        gsc: { status: 'no_match', data: null, durationMs: 1 },
        gbp: { status: 'no_match', data: null, durationMs: 1 },
        clientType: null,
        completedAt: '2026-08-07T00:00:00.000Z',
      },
      {},
    )
    expect(patch).toEqual({})
  })
})
