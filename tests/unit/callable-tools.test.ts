import { describe, it, expect } from 'vitest'
import { scoreQuickWins } from '@/lib/tools/callable/keyword-quick-wins'
import { brandTokenFromSite, makeBrandMatcher } from '@/lib/tools/callable/ai-visibility'
import { CALLABLE_TOOLS, callableSlugs, runTool } from '@/lib/tools/callable'
import { TOOLS } from '@/lib/tools/registry'
import { missingRequirement } from '@/lib/tools/context'
import type { ToolContext } from '@/lib/tools/contract'

/** A context with nothing resolved, for requirement checks. */
function ctx(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    client: null,
    // These are never touched by the paths under test.
    auth: null as unknown as ToolContext['auth'],
    gbpAuth: null,
    service: null as unknown as ToolContext['service'],
    invoker: { kind: 'orchestrator' },
    ...overrides,
  }
}

const client = (over: Partial<NonNullable<ToolContext['client']>> = {}) => ({
  id: 'c1',
  name: 'Tornado HVAC',
  slug: 'tornado-hvac',
  gsc_site_url: 'sc-domain:tornadohvacca.com',
  ga4_property_id: null,
  gbp_account_id: null,
  website_url: 'https://tornadohvacca.com',
  brand_terms: null,
  brand_match_mode: null,
  competitors: null,
  ...over,
})

describe('scoreQuickWins', () => {
  const row = (over: Partial<Parameters<typeof scoreQuickWins>[0][0]> = {}) => ({
    query: 'q',
    page: '/p',
    position: 8,
    impressions: 500,
    clicks: 5,
    ctr: 1,
    ...over,
  })

  it('keeps only positions 4-20 with real impression volume', () => {
    const out = scoreQuickWins([
      row({ query: 'in-range', position: 8 }),
      row({ query: 'too-high', position: 3 }), // already near the top
      row({ query: 'too-low', position: 21 }),
      row({ query: 'too-few-impressions', impressions: 99 }),
    ])
    expect(out.map((w) => w.query)).toEqual(['in-range'])
  })

  it('includes the exact boundaries', () => {
    const out = scoreQuickWins([
      row({ query: 'pos4', position: 4 }),
      row({ query: 'pos20', position: 20 }),
      row({ query: 'imp100', impressions: 100 }),
    ])
    expect(out.map((w) => w.query).sort()).toEqual(['imp100', 'pos20', 'pos4'])
  })

  it('ranks by opportunity, not by position or volume', () => {
    const out = scoreQuickWins([
      row({ query: 'low-opp', position: 19, impressions: 200, clicks: 2 }),
      row({ query: 'high-opp', position: 5, impressions: 5000, clicks: 3 }),
    ])
    expect(out[0].query).toBe('high-opp')
  })

  it('caps at 50 rows', () => {
    const many = Array.from({ length: 120 }, (_, i) => row({ query: `q${i}`, impressions: 100 + i }))
    expect(scoreQuickWins(many)).toHaveLength(50)
  })

  it('returns an empty list rather than throwing on no input', () => {
    expect(scoreQuickWins([])).toEqual([])
  })
})

describe('brandTokenFromSite', () => {
  it('takes the registrable label, not the subdomain', () => {
    expect(brandTokenFromSite('https://shop.brand.com')).toBe('brand')
    expect(brandTokenFromSite('sc-domain:brand.com')).toBe('brand')
  })

  it('handles a multi-part TLD', () => {
    expect(brandTokenFromSite('https://brand.co.uk')).toBe('brand')
    expect(brandTokenFromSite('https://shop.brand.co.uk')).toBe('brand')
  })
})

describe('makeBrandMatcher', () => {
  it('substring-matches configured terms, mirroring the dashboard module', () => {
    const m = makeBrandMatcher(['tornado'], 'configured', false)
    expect(m('tornado hvac reviews')).toBe(true)
    expect(m('ac repair')).toBe(false)
  })

  it('requires the whole query in exact mode', () => {
    const m = makeBrandMatcher(['tornado hvac'], 'configured', true)
    expect(m('tornado hvac')).toBe(true)
    expect(m('tornado hvac reviews')).toBe(false)
  })

  // The documented asymmetry: the heuristic path is stricter on purpose, so a
  // guessed term can't swallow unrelated queries.
  it('uses word boundaries on the heuristic path', () => {
    const m = makeBrandMatcher(['shoe'], 'heuristic', false)
    expect(m('shoe repair')).toBe(true)
    expect(m('shoelace supplier')).toBe(false)
  })

  it('does not let a regex metacharacter in a brand term escape', () => {
    const m = makeBrandMatcher(['a.c'], 'heuristic', false)
    expect(m('a.c repair')).toBe(true)
    expect(m('abc repair')).toBe(false) // '.' must be literal, not "any char"
  })
})

describe('missingRequirement', () => {
  it('names the missing thing instead of returning an empty result', () => {
    expect(missingRequirement({ client: true }, ctx())).toMatch(/No client selected/)
    expect(missingRequirement({ client: true, gsc: true }, ctx({ client: client({ gsc_site_url: null }) })))
      .toMatch(/No Search Console property configured for Tornado HVAC/)
    expect(missingRequirement({ ga4: true }, ctx({ client: client() }))).toMatch(/No GA4 property/)
    expect(missingRequirement({ gbp: true }, ctx({ client: client() }))).toMatch(/not connected/)
  })

  it('passes when everything it asked for is present', () => {
    expect(missingRequirement({ client: true, gsc: true }, ctx({ client: client() }))).toBeNull()
  })
})

describe('the callable registry', () => {
  it('every callable slug exists in the UI manifest', () => {
    const manifest = new Set(TOOLS.map((t) => t.slug))
    for (const slug of callableSlugs()) {
      expect(manifest.has(slug), `${slug} is callable but missing from lib/tools/registry.ts`).toBe(true)
    }
  })

  it('every tool declares its slug consistently with its key', () => {
    for (const [key, tool] of Object.entries(CALLABLE_TOOLS)) {
      expect(tool.slug).toBe(key)
    }
  })

  // The invariant an orchestrator depends on: one bad entry in a plan must not abort
  // the rest of the run.
  it('returns an error envelope for an unknown slug rather than throwing', async () => {
    const res = await runTool('does-not-exist', {}, ctx())
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error).toMatch(/Unknown tool/)
  })

  it('reports a missing requirement as an error envelope, not an exception', async () => {
    const res = await runTool('keyword-quick-wins', {}, ctx())
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error).toMatch(/No client selected/)
  })
})
