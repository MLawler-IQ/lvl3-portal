// The four derived analyses, tested against both eval fixtures.
//
// Where §9 records a number, this file pins it. The point is not coverage — it is
// that the analyses were written from the documented Tornado audit rather than
// from each other, so a fixture that stops reproducing §9's arithmetic is a
// regression in one of the two and this file says which numbers moved.
//
// §9 numbers pinned here:
//   206   URLs crawled
//   191   pages with no H1 — and that they collapse to 3 template families
//   130   the /Service/ family, the single biggest one-template fix
//   ~186  median inbound internal links, IDENTICAL for both visibility cohorts
//   1500 / 1420  near-identical median word counts across cohorts
//   29% / 71%    unique content vs boilerplate in the template-dominated groups

import { describe, it, expect } from 'vitest'
import { runChecks } from '@/lib/findings/engine'
import { onpage012 } from '@/lib/findings/detectors'
import type { StationBundle } from '@/lib/findings/types'
import type { CrawlPageRecord } from '@/lib/tools/crawl-record'
import type { GSCRow } from '@/lib/tools-gsc'
import { toolOk } from '@/lib/tools/contract'
import { tornadoStations } from '@/fixtures/eval/tornado/stations'
import { healthyStations } from '@/fixtures/eval/healthy/stations'
import {
  contentToTemplateRatio,
  ctrFromTable,
  deriveTemplateKey,
  groupByUrlTemplate,
  opportunityByTemplateFamily,
  pct,
  sizeOpportunity,
  templateFixLeverage,
  uniqueShare,
  visibilityCohorts,
} from '@/lib/findings/analyses'

const tornado = tornadoStations()
const healthy = healthyStations()

const tornadoCrawl = tornado.crawl!.ok ? tornado.crawl!.data : { site: { robotsTxt: null, sitemapUrls: [] }, pages: [] }
const tornadoGsc: GSCRow[] = tornado.gsc!.ok ? tornado.gsc!.data : []
const healthyCrawl = healthy.crawl!.ok ? healthy.crawl!.data : { site: { robotsTxt: null, sitemapUrls: [] }, pages: [] }
const healthyGsc: GSCRow[] = healthy.gsc!.ok ? healthy.gsc!.data : []

const page = (over: Partial<CrawlPageRecord> & { url: string }): CrawlPageRecord => ({
  status: 200,
  title: 't',
  metaDescription: 'd',
  h1s: ['h'],
  canonical: over.url,
  robotsMeta: 'index,follow',
  hasViewportMeta: true,
  tapTargetsOk: true,
  analytics: { ga4: true, gtm: false },
  internalLinksOut: 10,
  internalLinksIn: 10,
  wordCount: 1000,
  uniqueWordCount: 900,
  templateGroup: null,
  targetGeo: null,
  ...over,
})

const gscRow = (over: Partial<GSCRow> & { page: string }): GSCRow => ({
  query: 'q',
  clicks: 1,
  impressions: 100,
  ctr: 1,
  position: 10,
  ...over,
})

// ── 1. Template grouping ──────────────────────────────────────────────────────

describe('deriveTemplateKey', () => {
  it('puts two /Service/ pages with different slugs in one family', () => {
    // The literal example from the spec.
    const a = deriveTemplateKey('https://x.com/Service/x-in-los-angeles-ca-0/')
    const b = deriveTemplateKey('https://x.com/Service/y-in-los-angeles-ca-1/')
    expect(a).toBe(b)
    expect(a).toBe('/service')
  })

  it('keeps the homepage alone', () => {
    expect(deriveTemplateKey('https://x.com/')).toBe('/')
    expect(deriveTemplateKey('https://x.com')).toBe('/')
  })

  it('keeps a root-level page out of a directory family of the same name', () => {
    // /blog/ is the archive template; /blog/post-1/ is the single-post template.
    expect(deriveTemplateKey('https://x.com/blog/')).toBe('/blog/')
    expect(deriveTemplateKey('https://x.com/blog/post-1/')).toBe('/blog')
  })

  it('gives each root-level page its own key, so one-offs never look like a family', () => {
    expect(deriveTemplateKey('https://x.com/attic-fan-install/')).not.toBe(
      deriveTemplateKey('https://x.com/duct-sealing/'),
    )
  })

  it('collapses numeric path segments so dated archives do not fragment', () => {
    expect(deriveTemplateKey('https://x.com/blog/2024/03/post/')).toBe('/blog/*/*')
    expect(deriveTemplateKey('https://x.com/blog/2019/11/other/')).toBe('/blog/*/*')
  })

  it('ignores query strings, fragments and trailing-slash differences', () => {
    expect(deriveTemplateKey('https://x.com/Service/a-0?utm=1#top')).toBe('/service')
    expect(deriveTemplateKey('/Service/a-0/')).toBe('/service')
  })
})

describe('template grouping on the tornado fixture', () => {
  const grouping = groupByUrlTemplate(tornadoCrawl.pages.map((p) => p.url))

  it('groups all 206 crawled URLs (§9)', () => {
    expect(tornadoCrawl.pages.length).toBe(206)
    expect(grouping.totalUrls).toBe(206)
  })

  it('finds the 130-page service family as the largest template (§9)', () => {
    expect(grouping.groups[0].key).toBe('/service')
    expect(grouping.groups[0].size).toBe(130)
    expect(grouping.groups[0].pattern).toBe('/Service/*')
  })

  it('finds exactly three template families and 16 one-off pages', () => {
    expect(grouping.families.map((g) => [g.key, g.size])).toEqual([
      ['/service', 130],
      ['/blog', 42],
      ['/areas-we-serve', 18],
    ])
    // The homepage plus the 15 hand-built legacy pages.
    expect(grouping.groups.filter((g) => g.size === 1).length).toBe(16)
  })

  it('agrees with the ingester-populated templateGroup field, derived independently', () => {
    const seen = new Map<string, Set<string>>()
    for (const p of tornadoCrawl.pages) {
      const label = p.templateGroup ?? '(none)'
      const keys = seen.get(label) ?? new Set<string>()
      keys.add(deriveTemplateKey(p.url))
      seen.set(label, keys)
    }
    expect(Array.from(seen.get('service-la')!)).toEqual(['/service'])
    expect(Array.from(seen.get('area')!)).toEqual(['/areas-we-serve'])
    expect(Array.from(seen.get('blog')!)).toEqual(['/blog'])
    // Pages the ingester calls one-offs derive 16 distinct keys — one each.
    expect(seen.get('(none)')!.size).toBe(16)
  })

  it('counts a duplicated URL once', () => {
    const g = groupByUrlTemplate([
      'https://x.com/blog/post-1/',
      'https://x.com/blog/post-1',
      'https://x.com/blog/post-2/',
    ])
    expect(g.totalUrls).toBe(2)
    expect(g.groups[0].size).toBe(2)
  })
})

describe('templateFixLeverage reproduces §9s one-template-fixes-191-pages finding', () => {
  const grouping = groupByUrlTemplate(tornadoCrawl.pages.map((p) => p.url))
  const missingH1 = tornadoCrawl.pages.filter((p) => p.h1s.length !== 1).map((p) => p.url)

  it('the defect touches 191 URLs (§9, and the tornado manifest)', () => {
    expect(missingH1.length).toBe(191)
  })

  it('collapses 191 page fixes into 3 template fixes plus 1 one-off', () => {
    const leverage = templateFixLeverage(missingH1, grouping)
    expect(leverage.affectedUrls).toBe(191)
    expect(leverage.familiesTouched).toBe(3)
    expect(leverage.oneOffUrls).toBe(1) // the homepage
  })

  it('names the 130-page service family as the single best fix (§9)', () => {
    const leverage = templateFixLeverage(missingH1, grouping)
    expect(leverage.largestFamily).not.toBeNull()
    expect(leverage.largestFamily!.pattern).toBe('/Service/*')
    expect(leverage.largestFamily!.affectedInFamily).toBe(130)
    expect(leverage.largestFamily!.familySize).toBe(130)
    expect(leverage.largestFamily!.coversWholeFamily).toBe(true)
    expect(leverage.detail).toContain('191 URLs')
    expect(leverage.detail).toContain('covers 130 of them')
  })

  it('reports a purely one-off defect as having no template leverage', () => {
    const leverage = templateFixLeverage(['https://tornadohvacca.com/'], grouping)
    expect(leverage.familiesTouched).toBe(0)
    expect(leverage.oneOffUrls).toBe(1)
    expect(leverage.largestFamily).toBeNull()
  })
})

describe('template grouping on the healthy fixture', () => {
  const grouping = groupByUrlTemplate(healthyCrawl.pages.map((p) => p.url))

  it('groups the 25 URLs into 3 families and 1 one-off, matching the ingester', () => {
    expect(grouping.totalUrls).toBe(25)
    expect(grouping.families.map((g) => [g.key, g.size])).toEqual([
      ['/blog', 11],
      ['/services', 10],
      ['/areas', 3],
    ])
    expect(grouping.groups.filter((g) => g.size === 1).map((g) => g.key)).toEqual(['/'])
  })
})

// ── 2. Visibility cohorts ─────────────────────────────────────────────────────

describe('visibility cohorts on the tornado fixture (impressions split)', () => {
  const analysis = visibilityCohorts(tornadoCrawl.pages, tornadoGsc)
  const by = (metric: string) => analysis.comparisons.find((c) => c.metric === metric)!

  it('splits 206 pages into 20 earning and 186 invisible', () => {
    expect(analysis.earningUrls.length).toBe(20)
    expect(analysis.invisibleUrls.length).toBe(186)
    expect(analysis.unmatchedGscUrls).toEqual([])
  })

  it('reproduces §9s ~186 median inbound internal links for BOTH cohorts', () => {
    const links = by('internalLinksIn')
    expect(links.earning.median).toBe(186)
    expect(links.invisible.median).toBe(186)
    expect(links.medianDelta).toBe(0)
    expect(links.medianGap).toBe(0)
    expect(links.indistinguishable).toBe(true)
  })

  it('reports the cohorts as indistinguishable on every measured signal — the §9 negative result', () => {
    expect(analysis.comparable).toBe(true)
    expect(analysis.separatingMetrics).toEqual([])
    expect(analysis.allIndistinguishable).toBe(true)
    expect(analysis.detail).toContain('indistinguishable on every measured signal')
    // The sentence that killed the internal-linking hypothesis.
    expect(analysis.detail).toContain('inbound internal links 186 vs 186')
  })

  it('finds near-identical content length between the cohorts', () => {
    const words = by('wordCount')
    expect(words.earning.median).toBe(1420)
    expect(words.invisible.median).toBe(1420)
    expect(words.indistinguishable).toBe(true)
  })
})

describe('visibility cohorts on the tornado fixture (clicks split)', () => {
  // §9 records the near-identical word counts as "1500 vs 1420". In this fixture
  // that exact pair falls out of a CLICKS split, not an impressions split: ten of
  // the templated /Service/ pages earn impressions (they are the cannibalisation
  // losers), which pulls the impression-earning cohort's median word count to the
  // template's own 1420. Both splits agree on §9's conclusion — the cohorts are
  // not separated by content length — and both are pinned so a fixture change
  // cannot move either quietly.
  const analysis = visibilityCohorts(tornadoCrawl.pages, tornadoGsc, { splitBy: 'clicks' })
  const by = (metric: string) => analysis.comparisons.find((c) => c.metric === metric)!

  it('reproduces §9s 1500 vs 1420 word counts, and calls them near-identical', () => {
    expect(analysis.earningUrls.length).toBe(13)
    expect(analysis.invisibleUrls.length).toBe(193)
    const words = by('wordCount')
    expect(words.earning.median).toBe(1500)
    expect(words.invisible.median).toBe(1420)
    expect(pct(words.medianGap)).toBe(5)
    expect(words.indistinguishable).toBe(true)
  })

  it('still separates the hand-built pages on inbound links, so sameness is not hardwired', () => {
    expect(analysis.separatingMetrics).toContain('internalLinksIn')
    expect(analysis.allIndistinguishable).toBe(false)
  })
})

describe('visibility cohorts can report a real difference', () => {
  // The control for the negative result: an analysis that could only ever say
  // "no difference" would have been useless. Healthy's blog posts genuinely are
  // shorter than its service pages, and the analysis says so.
  const analysis = visibilityCohorts(healthyCrawl.pages, healthyGsc)

  it('separates the healthy fixture on word count while pinning inbound links as identical', () => {
    expect(analysis.comparable).toBe(true)
    expect(analysis.earningUrls.length).toBe(6)
    expect(analysis.invisibleUrls.length).toBe(19)
    const links = analysis.comparisons.find((c) => c.metric === 'internalLinksIn')!
    expect(links.indistinguishable).toBe(true)
    const words = analysis.comparisons.find((c) => c.metric === 'wordCount')!
    expect(words.earning.median).toBe(1100)
    expect(words.invisible.median).toBe(950)
    expect(words.indistinguishable).toBe(false)
    expect(analysis.allIndistinguishable).toBe(false)
  })

  it('finds a large planted gap', () => {
    const pages = [
      page({ url: 'https://x.com/a/1/', internalLinksIn: 200 }),
      page({ url: 'https://x.com/a/2/', internalLinksIn: 200 }),
      page({ url: 'https://x.com/a/3/', internalLinksIn: 4 }),
      page({ url: 'https://x.com/a/4/', internalLinksIn: 4 }),
    ]
    const rows = [gscRow({ page: 'https://x.com/a/1/' }), gscRow({ page: 'https://x.com/a/2/' })]
    const analysis2 = visibilityCohorts(pages, rows)
    const links = analysis2.comparisons.find((c) => c.metric === 'internalLinksIn')!
    expect(links.earning.median).toBe(200)
    expect(links.invisible.median).toBe(4)
    expect(links.indistinguishable).toBe(false)
    expect(analysis2.allIndistinguishable).toBe(false)
  })
})

describe('visibility cohorts never call an empty cohort indistinguishable', () => {
  it('refuses to compare when no page earns anything', () => {
    const analysis = visibilityCohorts([page({ url: 'https://x.com/a/1/' })], [])
    expect(analysis.comparable).toBe(false)
    expect(analysis.comparisons).toEqual([])
    expect(analysis.allIndistinguishable).toBe(false)
    expect(analysis.detail).toContain('Cohorts not compared')
  })

  it('refuses to compare when every page earns something', () => {
    const analysis = visibilityCohorts(
      [page({ url: 'https://x.com/a/1/' })],
      [gscRow({ page: 'https://x.com/a/1/' })],
    )
    expect(analysis.comparable).toBe(false)
    expect(analysis.allIndistinguishable).toBe(false)
    expect(analysis.detail).toContain('no invisible cohort')
  })

  it('reports GSC URLs that matched no crawled page instead of dropping them', () => {
    const analysis = visibilityCohorts(
      [page({ url: 'https://x.com/a/1/' }), page({ url: 'https://x.com/a/2/' })],
      [gscRow({ page: 'https://x.com/a/1/' }), gscRow({ page: 'https://x.com/gone/9/' })],
    )
    expect(analysis.unmatchedGscUrls).toEqual(['x.com/gone/9'])
  })
})

// ── 3. Opportunity sizing ─────────────────────────────────────────────────────

describe('ctrFromTable', () => {
  const curve = ctrFromTable()

  it('reads the table at whole positions', () => {
    expect(curve(1)).toBeCloseTo(0.281, 6)
    expect(curve(3)).toBeCloseTo(0.11, 6)
    expect(curve(20)).toBeCloseTo(0.008, 6)
  })

  it('interpolates the fractional positions GSC actually reports', () => {
    // Position 17.9 sits nine tenths of the way from 0.011 to 0.010.
    expect(curve(17.9)).toBeCloseTo(0.0101, 6)
  })

  it('clamps above position one and flattens past the table', () => {
    expect(curve(0.4)).toBeCloseTo(0.281, 6)
    expect(curve(25)).toBeCloseTo(0.003, 6)
    expect(curve(Number.NaN)).toBeCloseTo(0.003, 6)
  })
})

describe('opportunity sizing on the tornado fixture', () => {
  const sizing = sizeOpportunity(tornadoGsc)

  it('states what it excluded rather than narrowing the pool silently', () => {
    expect(sizing.rows.length).toBe(16)
    expect(sizing.excluded.belowImpressionFloor).toBe(2) // 90 and 95 impressions
    expect(sizing.excluded.alreadyAtOrAboveTarget).toBe(2) // positions 1.2 and 1.0
  })

  it('sizes the 22,596-impression page at position 17.9 as the largest single pool', () => {
    const top = sizing.rows[0]
    expect(top.page).toBe('https://tornadohvacca.com/air-duct-cleaning/')
    expect(top.impressions).toBe(22596)
    expect(top.clicks).toBe(1)
    expect(top.position).toBeCloseTo(17.9, 6)
    expect(top.modelledCurrentCtr).toBeCloseTo(0.0101, 6)
    expect(top.targetCtr).toBeCloseTo(0.11, 6)
    expect(top.projectedClicks).toBe(2486)
    expect(top.incrementalClicks).toBe(2485)
  })

  it('totals the pool arithmetically', () => {
    expect(sizing.totalImpressions).toBe(25486)
    expect(sizing.totalCurrentClicks).toBe(18)
    expect(sizing.totalIncrementalClicks).toBe(2787)
    expect(sizing.detail).toContain('additional clicks')
  })

  it('takes the CTR curve by injection, so lib/scorings curve can replace the default', () => {
    const flat = sizeOpportunity(tornadoGsc, { curve: () => 0.1 })
    expect(flat.rows[0].targetCtr).toBe(0.1)
    expect(flat.rows[0].projectedClicks).toBe(2260)
    expect(flat.rows[0].incrementalClicks).toBe(2259)
    // Eligibility is positional, so the pool is unchanged by the curve.
    expect(flat.rows.length).toBe(16)
  })

  it('weights a multi-query pages position by impressions, not by row count', () => {
    const sized = sizeOpportunity(
      [
        gscRow({ page: 'https://x.com/a/1/', query: 'big', impressions: 900, clicks: 0, position: 8 }),
        gscRow({ page: 'https://x.com/a/1/', query: 'stray', impressions: 100, clicks: 0, position: 80 }),
      ],
      { minImpressions: 100 },
    )
    expect(sized.rows[0].impressions).toBe(1000)
    expect(sized.rows[0].position).toBeCloseTo(15.2, 6)
  })

  it('sizes nothing when every pool already ranks at or above target', () => {
    const sized = sizeOpportunity([gscRow({ page: 'https://x.com/a/1/', impressions: 500, position: 2 })])
    expect(sized.rows).toEqual([])
    expect(sized.totalIncrementalClicks).toBe(0)
    expect(sized.detail).toContain('no ranking-improvement opportunity')
  })
})

describe('opportunityByTemplateFamily rolls the sizing up to templates', () => {
  const grouping = groupByUrlTemplate(tornadoCrawl.pages.map((p) => p.url))
  const families = opportunityByTemplateFamily(sizeOpportunity(tornadoGsc), grouping)

  it('attributes the service familys pooled opportunity to the template', () => {
    const service = families.find((f) => f.key === '/service')!
    expect(service.familySize).toBe(130)
    expect(service.pagesInPool).toBe(10)
    expect(service.incrementalClicks).toBe(220)
  })

  it('ranks the single hand-built page above the family, because it is bigger', () => {
    expect(families[0].pattern).toBe('/air-duct-cleaning/')
    expect(families[0].familySize).toBe(1)
    expect(families[0].incrementalClicks).toBe(2485)
  })

  it('returns nothing for a query-keyed sizing, which has no URL to attribute', () => {
    expect(opportunityByTemplateFamily(sizeOpportunity(tornadoGsc, { unit: 'query' }), grouping)).toEqual([])
  })
})

// ── 4. Content-to-template ratio (ONPAGE-012) ─────────────────────────────────

describe('uniqueShare', () => {
  it('is the unique fraction of the page', () => {
    expect(uniqueShare(page({ url: 'https://x.com/a/1/', wordCount: 1420, uniqueWordCount: 412 }))).toBeCloseTo(
      0.2901,
      4,
    )
  })

  // Was: "treats a zero-word page as zero percent unique rather than skipping it".
  // 0/0 is undefined, and the detector returning 0 (maximally dominated) while the eval
  // predicate returned 1 (pristine) meant both invented a number, in opposite
  // directions. null forces every caller to decide explicitly.
  it('returns null when the crawl measured no words at all', () => {
    expect(uniqueShare(page({ url: 'https://x.com/a/1/', wordCount: 0, uniqueWordCount: 0 }))).toBeNull()
  })

  // The case the old rule was defending never needed defending: zero CONTENT words
  // behind a 3,551-word template is wordCount 3551, not 0.
  it('scores a content-less page behind a real template as near-zero, not null', () => {
    const share = uniqueShare(page({ url: 'https://x.com/a/1/', wordCount: 3551, uniqueWordCount: 0 }))
    expect(share).toBe(0)
  })
})

// Written from the ONPAGE-012 decision record and §9's documented data points, not from
// content-template-ratio.ts. The two implementations that used to disagree here were
// both written by the same author from the same misunderstanding, so a second
// implementation bought a disagreement rather than a cross-check; the independence now
// lives in this suite.
describe('ONPAGE-012 semantics: unmeasured pages are excluded, counted, and surfaced', () => {
  const fam = (n: number, wordCount: number, uniqueWordCount: number, from = 0) =>
    Array.from({ length: n }, (_, i) =>
      page({ url: `https://x.com/service/p${from + i}/`, wordCount, uniqueWordCount }),
    )

  it('fails a family at the documented Tornado ratio of 29% unique', () => {
    const a = contentToTemplateRatio(fam(6, 1420, 412), [])
    expect(a.dominated).toHaveLength(1)
    expect(a.dominatedPages).toBe(6)
  })

  it('passes a family of genuinely unique pages', () => {
    const a = contentToTemplateRatio(fam(6, 1000, 900), [])
    expect(a.dominated).toHaveLength(0)
    expect(a.unmeasuredInJudged).toBe(0)
  })

  it('does NOT let unmeasured pages drag a healthy family under the threshold', () => {
    // 8 real pages at 85% unique beside 8 unmeasured ones. Under the old
    // zero-word-is-0%-unique rule the median fell to 0.425 and all 16 pages fired.
    const a = contentToTemplateRatio([...fam(8, 1000, 850), ...fam(8, 0, 0, 8)], [])
    expect(a.dominatedPages).toBe(0)
    expect(a.unmeasuredInJudged).toBe(8)
  })

  it('does NOT let unmeasured pages manufacture a pass either', () => {
    // The mirror failure: 3 unmeasured + 3 genuine 60%-unique pages. Treating the
    // unmeasured as pristine medians the group to 0.80 and passes it.
    const a = contentToTemplateRatio([...fam(3, 0, 0), ...fam(3, 1000, 600, 3)], [])
    // Only 3 measured pages, below the floor of 5 — so it is not judged at all.
    expect(a.groups).toHaveLength(0)
    expect(a.unjudgeableGroups).toBe(1)
    expect(a.pagesUnjudgeable).toBe(6)
  })

  it('treats a group with too few MEASURED pages as unjudgeable, never as clean', () => {
    const a = contentToTemplateRatio([...fam(2, 1000, 900), ...fam(6, 0, 0, 2)], [])
    expect(a.groups).toHaveLength(0)
    expect(a.unjudgeableGroups).toBe(1)
    expect(a.dominatedPages).toBe(0)
  })

  it('does not judge an exact 50/50 group as dominated', () => {
    const a = contentToTemplateRatio(fam(6, 1000, 500), [])
    expect(a.dominated).toHaveLength(0)
  })

  it('fires at a median share of 0.42 — the band the two old thresholds straddled', () => {
    const a = contentToTemplateRatio(fam(6, 1000, 420), [])
    expect(a.dominatedPages).toBe(6)
  })

  it('groups by URL even when templateGroup is null, which is real-crawl shape', () => {
    const pages = fam(6, 1000, 200).map((p) => ({ ...p, templateGroup: null }))
    const a = contentToTemplateRatio(pages, [])
    expect(a.dominatedPages).toBe(6)
  })

  it('leaves a group of four below the floor rather than judging it', () => {
    const a = contentToTemplateRatio(fam(4, 1420, 412), [])
    expect(a.groups).toHaveLength(0)
    expect(a.pagesBelowGroupFloor).toBe(4)
    expect(a.unjudgeableGroups).toBe(0)
  })

  it('names the excluded pages in the detail rather than dropping them silently', () => {
    const a = contentToTemplateRatio([...fam(6, 1000, 850), ...fam(2, 0, 0, 6)], [])
    expect(a.detail).toMatch(/carried no word count/)
  })
})

describe('content-to-template ratio on the tornado fixture', () => {
  const analysis = contentToTemplateRatio(tornadoCrawl.pages, tornadoGsc)

  it('judges only the three groups above the size floor', () => {
    expect(analysis.groups.map((g) => [g.key, g.pages])).toEqual([
      ['/service', 130],
      ['/blog', 42],
      ['/areas-we-serve', 18],
    ])
    expect(analysis.pagesBelowGroupFloor).toBe(16)
  })

  it('reproduces §9s 29% unique / 71% boilerplate median', () => {
    expect(pct(analysis.medianUniqueShareOfDominated)).toBe(29)
    expect(pct(1 - analysis.medianUniqueShareOfDominated)).toBe(71)
    expect(analysis.detail).toContain('29% unique content, 71% shared boilerplate')
  })

  it('flags the two template-dominated groups covering 148 pages', () => {
    expect(analysis.dominated.map((g) => g.key)).toEqual(['/service', '/areas-we-serve'])
    expect(analysis.dominatedPages).toBe(148)
  })

  it('crosses the ratio with the impression-earning rate, as the rubric requires', () => {
    const service = analysis.groups.find((g) => g.key === '/service')!
    expect(service.earningPages).toBe(10)
    expect(service.impressionEarningRate).toBeCloseTo(10 / 130, 6)
    const areas = analysis.groups.find((g) => g.key === '/areas-we-serve')!
    expect(areas.earningPages).toBe(0)
    expect(analysis.dominatedEarningPages).toBe(10)
    expect(analysis.detail).toContain('earn impressions at 7% (10 of 148)')
  })

  it('does not flag the blog, whose pages are mostly their own content', () => {
    const blog = analysis.groups.find((g) => g.key === '/blog')!
    expect(blog.medianUniqueShare).toBeCloseTo(0.8, 6)
    expect(blog.templateDominated).toBe(false)
  })

  it('uses the median, so one long page cannot lift a thin family', () => {
    const pages = [
      ...Array.from({ length: 5 }, (_, i) =>
        page({ url: `https://x.com/t/${i}/`, wordCount: 1000, uniqueWordCount: 200 }),
      ),
      page({ url: 'https://x.com/t/rescue/', wordCount: 40000, uniqueWordCount: 40000 }),
    ]
    const a = contentToTemplateRatio(pages, [gscRow({ page: 'https://x.com/t/0/' })])
    expect(a.groups[0].medianUniqueShare).toBeCloseTo(0.2, 6)
    expect(a.dominated.length).toBe(1)
  })
})

describe('content-to-template ratio on the healthy fixture', () => {
  const analysis = contentToTemplateRatio(healthyCrawl.pages, healthyGsc)

  it('finds nothing template-dominated — the false-positive control', () => {
    expect(analysis.groups.map((g) => g.key)).toEqual(['/blog', '/services'])
    expect(analysis.dominated).toEqual([])
    expect(analysis.dominatedPages).toBe(0)
    expect(analysis.pagesBelowGroupFloor).toBe(4) // 3 area pages + the homepage
    expect(analysis.detail).toContain('majority-unique content')
  })
})

describe('ONPAGE-012 detector', () => {
  const findingFor = (stations: StationBundle) => runChecks([onpage012], stations)[0]

  it('fails the tornado fixture with 148 affected pages and readable evidence', () => {
    const f = findingFor(tornado)
    expect(f.status).toBe('fail')
    expect(f.checkId).toBe('ONPAGE-012')
    expect(f.source).toBe('derived')
    expect(f.evidence.affectedUrls).toBe(148)
    expect(f.evidence.detail).toContain('29% unique content, 71% shared boilerplate')
    expect(f.evidence.examples![0]).toBe(
      '/Service/* → 130 pages, 29% unique content, 8% earning impressions',
    )
  })

  it('passes the healthy fixture', () => {
    const f = findingFor(healthy)
    expect(f.status).toBe('pass')
    expect(f.evidence.value).toBe(2)
    expect(f.evidence.affectedUrls).toBeUndefined()
  })

  it('states no severity or score, only facts', () => {
    const f = findingFor(tornado)
    expect(Object.keys(f.evidence).sort()).toEqual(['affectedUrls', 'detail', 'examples'])
    expect(Object.keys(f)).not.toContain('severity')
    expect(Object.keys(f)).not.toContain('score')
  })

  it('is not_run without the GSC station the rubric crosses against', () => {
    const f = findingFor({ crawl: tornado.crawl })
    expect(f.status).toBe('not_run')
    expect(f.reason).toContain('gsc station not provided')
  })

  it('is not_run — never a vacuous pass — when no group is big enough to be a template', () => {
    const f = findingFor({
      crawl: toolOk(
        {
          site: { robotsTxt: null, sitemapUrls: [] },
          pages: [
            page({ url: 'https://x.com/a/1/', wordCount: 100, uniqueWordCount: 1 }),
            page({ url: 'https://x.com/a/2/', wordCount: 100, uniqueWordCount: 1 }),
            page({ url: 'https://x.com/b/1/', wordCount: 100, uniqueWordCount: 1 }),
          ],
        },
        { sources: ['crawl'] },
      ),
      gsc: toolOk([gscRow({ page: 'https://x.com/a/1/' })], { sources: ['gsc'] }),
    })
    expect(f.status).toBe('not_run')
    expect(f.reason).toContain('no template group of 5+ pages')
  })

  it('is capped at degraded when the crawl was partial', () => {
    const f = findingFor({
      crawl: toolOk(healthyCrawl, { sources: ['crawl'], degraded: true }),
      gsc: toolOk(healthyGsc, { sources: ['gsc'] }),
    })
    expect(f.status).toBe('degraded')
  })
})
