// Causal scenario templates.
//
// The design rule, straight out of the adversarial critique of the approved plan:
// DO NOT sample checks independently. Independent sampling produces unphysical
// fixtures — GSC rows for URLs the crawl never saw, robots-blocked pages carrying
// rich impression data, a profile missing its phone number on a site whose call
// tracking works fine. Real sites do not break like that. Real sites break in
// CORRELATED CLUSTERS, because one cause (a template deploy, a bulk-generation
// run, a replatform, an unfinished profile) touches many checks at once.
//
// So a scenario is a STORY plus the cluster of checks that story necessarily
// violates. Every template below carries the real failure mode it encodes in its
// `story` field, and every defect it injects is a consequence of that story rather
// than a die roll.
//
// The stories are drawn from documented failure modes, not invented ones. §9 of
// docs/AUTOMATION-CONTEXT.md supplies three of the four directly: "191 of 206 URLs
// have no <h1> ... The template puts the topic in an <h2>. One template change, 191
// pages" (template-bug); "two complete generations of service page compete against
// each other" with 4/3/2 URLs per query (ai-page-spree); and "an SAB ranks by
// proximity to its real address, not its declared areas. The site has pages
// targeting Orange County (45-65 miles away)" plus the hidden-address false
// positive (gbp-misconfig). §9 also supplies the mega-menu detail behind the
// generated pages' 184 inbound/outbound links: "186 links on nearly every page
// means a footer or mega-menu links to everything".
//
// Each template also builds a NEAR-MISS variant: the same story's site with every
// cluster defect replaced by the legitimate configuration sitting adjacent to it.
// Those are how the harness measures precision instead of only recall — a detector
// that fires on the near-miss variant is producing exactly the kind of false
// positive that gets an audit tool distrusted (§9's documented example: docking a
// service-area business for a correctly hidden address).

import type { CrawlPageRecord, CrawlSiteRecord, GbpProfileRecord } from '@/lib/tools/crawl-record'
import type { GSCRow } from '@/lib/tools-gsc'
import {
  ANALYTICS_ENCODINGS,
  ANALYTICS_NEAR_MISS,
  CANNIBAL_ENCODINGS,
  CANNIBAL_NEAR_MISS,
  GBP_ENCODINGS,
  GBP_NEAR_MISS,
  GEO_ENCODINGS,
  H1_ENCODINGS,
  H1_NEAR_MISS,
  KNOWN_UNCOVERED_ENCODINGS,
  MOBILE_ENCODINGS,
  MOBILE_NEAR_MISS,
  ROBOTS_ENCODINGS,
  ROBOTS_NEAR_MISS,
  type GscClusterEncoding,
  type PageEncoding,
} from './encodings'
import { isUrlAllowed, parseRobotsTxt } from '@/lib/robots'
import type { Rng } from './rng'
import {
  QueryPool,
  VOCAB,
  citySlug,
  gscRow,
  healthyGbp,
  healthyPage,
  healthySite,
  type SiteVocab,
} from './site'

/** The seven check ids with registered detectors, in rubric order. */
export const REGISTERED_CHECK_IDS = [
  'TECH-001',
  'ONPAGE-003',
  'TECH-011',
  'MEAS-001',
  'ONPAGE-006',
  'LOCAL-016',
  'LOCAL-003',
] as const

export type Variant = 'defect' | 'near-miss'

/**
 * How much of the rubric a generated fixture is allowed to demand.
 *
 * 'detector-covered' — inject only defects and surface encodings a registered
 *   detector demonstrably catches at the rubric's own magnitude. These fixtures
 *   score green and are the ones a CI gate should run.
 *
 * 'rubric' — inject the full rubric reading, including the encodings and checks
 *   listed in KNOWN_UNCOVERED_ENCODINGS / rubricOnlyCluster. These fixtures LINT
 *   CLEAN (the manifest and the data agree) and score RED, because the detectors
 *   are laxer than the rubric. They are the tracked regression target, and the
 *   reason the injectors were written from the rubric rather than from the
 *   detectors: writing them the other way round could not have produced this
 *   fixture at all.
 */
export type EncodingScope = 'detector-covered' | 'rubric'

export interface BuildContext {
  rng: Rng
  variant: Variant
  scope: EncodingScope
}

/** Drop the encodings no registered detector catches, unless scope says otherwise. */
function forScope<T extends { id: string }>(pool: T[], scope: EncodingScope): T[] {
  if (scope === 'rubric') return pool
  const covered = pool.filter((e) => !(e.id in KNOWN_UNCOVERED_ENCODINGS))
  if (covered.length === 0) {
    throw new Error(
      `no detector-covered encoding available among [${pool.map((e) => e.id).join(', ')}]`,
    )
  }
  return covered
}

export interface FixtureData {
  site: CrawlSiteRecord
  pages: CrawlPageRecord[]
  gsc: GSCRow[]
  gbp: GbpProfileRecord
  /** check id → the surface encoding ids this build actually used. */
  encodingsUsed: Record<string, string[]>
  /**
   * Rubric checks this data violates that NO manifest may assert, because no
   * detector is registered for them (lib/eval/manifest.ts rejects such ids).
   * Recorded rather than dropped so the gap is visible instead of forgotten.
   */
  unassertable: string[]
}

export interface ScenarioTemplate {
  id: string
  /** The real-world failure mode this template encodes. */
  story: string
  /** Checks the story necessarily violates — the manifest's must_find cluster. */
  cluster: string[]
  /**
   * Further checks the RUBRIC says this story violates, which the registered
   * detector cannot currently satisfy at the rubric's magnitude. Injected and
   * asserted only under scope 'rubric'.
   */
  rubricOnlyCluster: string[]
  /**
   * The false-positive traps this fixture is specifically built to defend, drawn
   * from checks OUTSIDE the cluster. Every non-cluster check ends up in must_pass
   * regardless; these are additionally asserted as must_not_find, so a fired
   * finding is reported as a forbidden-finding rather than a soft must_pass miss.
   */
  fpTraps: string[]
  build: (ctx: BuildContext) => FixtureData
}

// ---------------------------------------------------------------------------
// shared build machinery
// ---------------------------------------------------------------------------

class Tracker {
  readonly used: Record<string, string[]> = {}
  note(checkId: string, encodingId: string): void {
    if (!this.used[checkId]) this.used[checkId] = []
    const list = this.used[checkId]
    if (!list.includes(encodingId)) list.push(encodingId)
  }
}

/** Apply one seeded encoding from `pool` to a page, recording which was used. */
function encode(
  page: CrawlPageRecord,
  pool: PageEncoding[],
  rng: Rng,
  tracker: Tracker,
): CrawlPageRecord {
  const enc = rng.pick(pool)
  tracker.note(enc.checkId, enc.id)
  return enc.apply(page, rng)
}

/**
 * H1 encodings for a build.
 *
 * Under 'rubric' scope all five defect encodings are in play: no <h1> at all, an
 * <h1> that renders as an empty string, one holding only template whitespace, one
 * wrapping just the logo image, and a page carrying two. Under 'detector-covered'
 * scope the three "tag present but textless" forms drop out, because the
 * registered detector counts h1s.length and reads them as one good heading — a
 * measured gap, recorded in KNOWN_UNCOVERED_ENCODINGS. Two encodings still remain
 * in the covered mix, so even the green fixtures are not shaped to a single
 * encoding of the defect.
 */
function h1Mix(ctx: BuildContext): PageEncoding[] {
  return ctx.variant === 'near-miss' ? H1_NEAR_MISS : forScope(H1_ENCODINGS, ctx.scope)
}

interface GscBuild {
  rows: GSCRow[]
  clusters: number
}

/**
 * Build GSC rows from cluster encodings.
 *
 * Every URL handed in must come from the crawl and must be indexable — the linter
 * rejects a GSC row for a URL the crawl never saw, and rejects impressions on a
 * robots-blocked or error page. Wiring that constraint into the builder rather
 * than checking it afterwards is what keeps the generator from producing the
 * unphysical fixtures the critique warned about.
 */
function buildGsc(
  pool: QueryPool,
  candidates: string[],
  rng: Rng,
  tracker: Tracker,
  opts: {
    defectClusters: number
    nearMissClusters: number
    singles: number
    /** Named URL pairs to cannibalise, e.g. a surviving old URL and its
     *  replacement. Used where the STORY dictates which pages compete. */
    pairs?: Array<[string, string]>
  },
): GscBuild {
  if (candidates.length === 0) {
    throw new Error('buildGsc: no indexable crawl URLs to attribute impressions to')
  }
  const rows: GSCRow[] = []
  let clusters = 0
  const urls = rng.shuffle(candidates)
  let cursor = 0
  const takeUrls = (n: number): string[] => {
    const out: string[] = []
    for (let i = 0; i < n; i++) {
      out.push(urls[cursor % urls.length])
      cursor += 1
    }
    return out
  }

  const run = (enc: GscClusterEncoding, explicit?: string[]): void => {
    const queries = pool.take(enc.queriesNeeded)
    const chosen = explicit ?? takeUrls(enc.urlsNeeded)
    tracker.note(enc.checkId, enc.id)
    rows.push(...enc.build({ queries, urls: chosen, rng }))
    if (enc.kind === 'defect') clusters += enc.queriesNeeded
  }

  const twoUrlEncodings = CANNIBAL_ENCODINGS.filter((e) => e.urlsNeeded === 2)
  for (const pair of opts.pairs ?? []) run(rng.pick(twoUrlEncodings), pair)
  for (let i = 0; i < opts.defectClusters; i++) run(rng.pick(CANNIBAL_ENCODINGS))
  for (let i = 0; i < opts.nearMissClusters; i++) run(rng.pick(CANNIBAL_NEAR_MISS))
  for (let i = 0; i < opts.singles; i++) {
    const [query] = pool.take(1)
    const [url] = takeUrls(1)
    rows.push(gscRow(query, url, rng.int(120, 2400), rng.int(3, 90), rng.int(1, 14)))
  }
  return { rows, clusters }
}

/** Location pages for a subset of the DECLARED areas — coherent by construction. */
function coherentLocationPages(vocab: SiteVocab, rng: Rng, count: number): CrawlPageRecord[] {
  return rng.sample(vocab.served, count).map((area) =>
    healthyPage(vocab, {
      path: `/areas/${citySlug(area)}/`,
      templateGroup: 'area',
      targetGeo: area,
      override: { h1s: [`${vocab.category} in ${area.split(',')[0]}`] },
    }),
  )
}

/** Location pages targeting geography the profile cannot rank for. */
function incoherentLocationPages(
  vocab: SiteVocab,
  rng: Rng,
  tracker: Tracker,
  count: number,
): CrawlPageRecord[] {
  // Draw distinct (encoding, city) pairs so no two pages claim the same URL —
  // a duplicated crawl URL is physically impossible and the linter rejects it.
  const pool = GEO_ENCODINGS.flatMap((enc) => enc.cities.map((city) => ({ enc, city })))
  return rng.sample(pool, count).map(({ enc, city }) => {
    tracker.note(enc.checkId, enc.id)
    return healthyPage(vocab, {
      path: `/areas/${citySlug(city)}/`,
      templateGroup: 'area',
      targetGeo: city,
      override: { h1s: [`${vocab.category} in ${city.split(',')[0]}`] },
    })
  })
}

/**
 * The LOCAL-016 near-miss: a service page whose copy and title NAME a
 * neighbouring city while its targetGeo stays null.
 *
 * This is the adjacent-legitimate configuration — mentioning a city is not
 * targeting it, so a detector matching city names in titles fires here and must
 * not. Paired with `coherentLocationPages` covering only a SUBSET of the declared
 * areas, because under-coverage is not incoherence either.
 */
function geoMentionNearMiss(vocab: SiteVocab, rng: Rng, tracker: Tracker): CrawlPageRecord {
  tracker.note('LOCAL-016', 'geo-mentioned-not-targeted')
  const outside = rng.pick(GEO_ENCODINGS).cities[0]
  const service = vocab.services[0]
  return healthyPage(vocab, {
    path: `/services/${service}-service-area/`,
    templateGroup: 'service',
    targetGeo: null,
    override: {
      title: `${service.replace(/-/g, ' ')} — we also travel to ${outside.split(',')[0]} | ${vocab.brand}`,
      h1s: [`${service.replace(/-/g, ' ')} service area`],
    },
  })
}

/** Apply GBP completeness defects, one per distinct audited field. */
const GBP_FIELD_GROUPS: Record<string, string[]> = {
  hours: ['gbp-no-hours'],
  description: ['gbp-description-null', 'gbp-description-blank'],
  photos: ['gbp-no-photos'],
  phone: ['gbp-phone-null', 'gbp-phone-blank'],
  website: ['gbp-website-null'],
}

function damageGbp(
  gbp: GbpProfileRecord,
  rng: Rng,
  tracker: Tracker,
  fieldCount: number,
): GbpProfileRecord {
  let out = gbp
  const groups = rng.sample(Object.keys(GBP_FIELD_GROUPS).sort(), fieldCount)
  for (const group of groups) {
    const encId = rng.pick(GBP_FIELD_GROUPS[group])
    const enc = GBP_ENCODINGS.find((e) => e.id === encId)
    if (!enc) throw new Error(`unknown GBP encoding ${encId}`)
    tracker.note(enc.checkId, enc.id)
    out = enc.apply(out, rng)
  }
  return out
}

function healthyGbpWithNearMiss(
  vocab: SiteVocab,
  rng: Rng,
  tracker: Tracker,
): GbpProfileRecord {
  const enc = rng.pick(GBP_NEAR_MISS)
  tracker.note(enc.checkId, enc.id)
  return enc.apply(healthyGbp(vocab), rng)
}

/**
 * Choose a robots.txt.
 *
 * `defectIds` names the encodings whose blocked paths this scenario's crawl
 * actually contains. When none of them survives the scope filter — which is the
 * case for every TECH-001 encoding under 'detector-covered' scope — the site falls
 * back to a near-miss robots.txt, so the fixture is clean on TECH-001 rather than
 * carrying a defect its manifest cannot assert.
 */
function robots(
  site: CrawlSiteRecord,
  ctx: BuildContext,
  tracker: Tracker,
  defectIds: string[],
): CrawlSiteRecord {
  const wanted = ROBOTS_ENCODINGS.filter((e) => defectIds.includes(e.id))
  const available =
    ctx.variant === 'defect'
      ? wanted.filter((e) => ctx.scope === 'rubric' || !(e.id in KNOWN_UNCOVERED_ENCODINGS))
      : []
  const pool = available.length > 0 ? available : ROBOTS_NEAR_MISS
  const enc = ctx.rng.pick(pool)
  tracker.note(enc.checkId, enc.id)
  return enc.apply(site, ctx.rng)
}

// ---------------------------------------------------------------------------
// 1. template-bug
// ---------------------------------------------------------------------------

const templateBug: ScenarioTemplate = {
  id: 'template-bug',
  story:
    'ONE BAD TEMPLATE DEPLOY. A theme update rewrote the service-page hero partial: ' +
    'the <h1> became a styled <div>, and the mobile header include that carried ' +
    '<meta name="viewport"> was dropped at the same time. The new 40px call-now button ' +
    'component shipped in the same release and is shared with the blog template, so tap ' +
    'targets fail on the blog too — wider than the H1 breakage, which is what makes the ' +
    'two magnitudes differ. The hand-built legacy pages predate the theme and are ' +
    'untouched, so the blast radius is provably template-scoped. This is the single most ' +
    'common way a whole site fails one on-page check overnight, and the rubric raises ' +
    'ONPAGE-003 above Sitebulb\'s Medium for exactly this reason: "template-level ' +
    'failures affect whole sites".',
  cluster: ['ONPAGE-003', 'TECH-011'],
  // A template group of near-identical service pages is precisely what makes a
  // similarity-based cannibalisation heuristic fire, and the profile carries the
  // documented hidden-address trap.
  fpTraps: ['ONPAGE-006', 'LOCAL-003'],
  rubricOnlyCluster: [],
  build: (ctx) => {
    const { rng, variant } = ctx
    const vocab = VOCAB.valleyair
    const tracker = new Tracker()
    const pages: CrawlPageRecord[] = []

    pages.push(healthyPage(vocab, { path: '/', wordCount: 900, override: { h1s: [vocab.brand] } }))

    // The broken template group.
    const serviceCount = rng.int(9, vocab.services.length)
    for (const service of rng.sample(vocab.services, serviceCount)) {
      const base = healthyPage(vocab, { path: `/services/${service}/`, templateGroup: 'service' })
      const withH1 = encode(base, h1Mix(ctx), rng, tracker)
      pages.push(
        encode(withH1, variant === 'defect' ? MOBILE_ENCODINGS : MOBILE_NEAR_MISS, rng, tracker),
      )
    }

    // The blog template shares only the button component: mobile-only breakage.
    const blogCount = rng.int(6, 14)
    for (let i = 0; i < blogCount; i++) {
      const base = healthyPage(vocab, {
        path: `/blog/post-${i + 1}/`,
        templateGroup: 'blog',
        wordCount: 780,
      })
      pages.push(
        variant === 'defect'
          ? encode(base, MOBILE_ENCODINGS.filter((e) => e.id === 'mobile-tap-targets-small'), rng, tracker)
          : encode(base, MOBILE_NEAR_MISS, rng, tracker),
      )
    }

    // Pre-theme hand-built pages: correct, and the proof the bug is scoped.
    const legacy = ['about', 'contact', 'financing', 'reviews', 'emergency-service']
    for (const slug of rng.sample(legacy, rng.int(3, legacy.length))) {
      pages.push(healthyPage(vocab, { path: `/${slug}/`, wordCount: 620 }))
    }

    // H1 near-miss pages inside a POSITIVE case: one long H1, and one whose text
    // is wrapped in template whitespace. Both are single usable H1s, so neither
    // may add to the ONPAGE-003 magnitude.
    for (const enc of H1_NEAR_MISS) {
      tracker.note(enc.checkId, enc.id)
      pages.push(enc.apply(healthyPage(vocab, { path: `/guides/${enc.id}/`, templateGroup: 'guide' }), rng))
    }

    pages.push(...coherentLocationPages(vocab, rng, rng.int(2, vocab.served.length)))
    pages.push(geoMentionNearMiss(vocab, rng, tracker))

    // Everything is measurable — MEAS-001 must pass — via a seeded mix of the
    // legitimate deployment shapes (GTM-only, gtag-only, both).
    const tagged = pages.map((p) => encode(p, ANALYTICS_NEAR_MISS, rng, tracker))

    const pool = new QueryPool(vocab, rng)
    const gsc = buildGsc(
      pool,
      tagged.filter((p) => p.status === 200).map((p) => p.url),
      rng,
      tracker,
      { defectClusters: 0, nearMissClusters: 2, singles: rng.int(5, 10) },
    )

    return {
      // TECH-001 is not part of this story: the robots.txt is the legitimate
      // configuration, so the check must PASS and is asserted as such.
      site: robots(healthySite(vocab), { ...ctx, variant: 'near-miss' }, tracker, []),
      pages: tagged,
      gsc: gsc.rows,
      gbp: healthyGbpWithNearMiss(vocab, rng, tracker),
      encodingsUsed: tracker.used,
      unassertable: [],
    }
  },
}

// ---------------------------------------------------------------------------
// 2. ai-page-spree
// ---------------------------------------------------------------------------

const aiPageSpree: ScenarioTemplate = {
  id: 'ai-page-spree',
  story:
    'AI PAGE-GENERATION SPREE. An agency pointed a generator at a keyword export and ' +
    'shipped a /Service/<service>-in-<city>/ page for every row. The prompt put the topic ' +
    'in an H2 under a decorative hero, so not one generated page has an H1; the shared ' +
    'boilerplate is ~70% of every page (the documented Tornado median was 29% unique / ' +
    '71% template); and because the source export listed several near-duplicate keywords ' +
    'per service, two or three pages now surface for the SAME query and split its ' +
    'impressions — including against the hand-built legacy page that used to rank for it. ' +
    'This is the Tornado failure mode: mass unique-but-worthless content, which a ' +
    'near-duplicate similarity check passes and a content-to-template ratio catches.',
  cluster: ['ONPAGE-003', 'ONPAGE-006'],
  // The generated titles name cities the profile never declared while their
  // targetGeo stays null: naming a city is not targeting it.
  fpTraps: ['LOCAL-016', 'LOCAL-003'],
  rubricOnlyCluster: [],
  build: (ctx) => {
    const { rng, variant } = ctx
    const vocab = VOCAB.trident
    const tracker = new Tracker()
    const pages: CrawlPageRecord[] = []
    const generated: string[] = []
    const legacyUrls: string[] = []

    pages.push(healthyPage(vocab, { path: '/', wordCount: 940, override: { h1s: [vocab.brand] } }))

    // The generated corpus: several pages per service, one template.
    const perService = rng.int(2, 4)
    for (const service of vocab.services) {
      for (let n = 0; n < perService; n++) {
        const city = rng.pick(vocab.served).split(',')[0].toLowerCase().replace(/\s+/g, '-')
        const words = rng.int(1250, 1650)
        const base = healthyPage(vocab, {
          path: `/Service/${service}-in-${city}-${n}/`,
          templateGroup: 'service-generated',
          wordCount: words,
          // ONPAGE-012's signal: 26-33% unique. Generated, not asserted — see
          // `unassertable` below.
          uniqueWordCount: Math.round(words * (0.26 + rng.next() * 0.07)),
          override: {
            title: `${service.replace(/-/g, ' ')} in ${city.replace(/-/g, ' ')} | ${vocab.brand}`,
            internalLinksOut: 184, // the mega-menu that links everything to everything
            internalLinksIn: 184,
          },
        })
        const page = encode(base, h1Mix(ctx), rng, tracker)
        pages.push(page)
        generated.push(page.url)
      }
    }

    // The hand-built pages the generated corpus now competes with.
    for (const service of rng.sample(vocab.services, rng.int(4, 7))) {
      const page = healthyPage(vocab, {
        path: `/${service}/`,
        wordCount: 1480,
        uniqueWordCount: 1330,
      })
      pages.push(page)
      legacyUrls.push(page.url)
    }

    pages.push(...coherentLocationPages(vocab, rng, rng.int(2, vocab.served.length)))
    pages.push(geoMentionNearMiss(vocab, rng, tracker))

    const tagged = pages.map((p) => encode(p, ANALYTICS_NEAR_MISS, rng, tracker))

    const pool = new QueryPool(vocab, rng)
    const candidates = rng.shuffle([...generated, ...legacyUrls])
    const gsc = buildGsc(pool, candidates, rng, tracker, {
      defectClusters: variant === 'defect' ? rng.int(4, 9) : 0,
      nearMissClusters: 2,
      singles: rng.int(6, 12),
    })

    return {
      site: robots(healthySite(vocab), { ...ctx, variant: 'near-miss' }, tracker, []),
      pages: tagged,
      gsc: gsc.rows,
      gbp: healthyGbpWithNearMiss(vocab, rng, tracker),
      encodingsUsed: tracker.used,
      // The template-dominated corpus violates ONPAGE-012, which the rubric
      // defines but no detector implements. Recorded, never asserted: manifest.ts
      // rejects ids without a registered detector, and it is right to.
      unassertable: variant === 'defect' ? ['ONPAGE-012'] : [],
    }
  },
}

// ---------------------------------------------------------------------------
// 3. migration-gone-wrong
// ---------------------------------------------------------------------------

const migrationGoneWrong: ScenarioTemplate = {
  id: 'migration-gone-wrong',
  story:
    'REPLATFORM WEEKEND. The site moved to a new stack on a Friday night and four things ' +
    'went out together, because they all rode the same build. (1) The GTM container never ' +
    'made it into the new global layout, so measurement went dark at cutover on every page ' +
    'the new build serves; a handful of pages are still served from the old CDN and still ' +
    'carry the old container, which is why the analytics magnitude is most-but-not-all of ' +
    'the site. (2) The redirect map missed a batch of old locale-prefixed URLs, which are ' +
    'still live at 200 with self-canonicals — so the old URL and its replacement now both ' +
    'surface for the same query and split it, which is migration cannibalisation rather ' +
    'than a content-strategy problem. (3) Another batch of old URLs points nowhere and 404s ' +
    'with canonicals still on the retired domain. (4) The STAGING robots.txt shipped with ' +
    'its Disallow still on the content hub. Item 4 is asserted only under scope "rubric": ' +
    'the registered TECH-001 detector asks only whether the site ROOT is disallowed, so it ' +
    'cannot see a section-level block at the rubric\'s magnitude. Blocked and 404 pages ' +
    'carry NO impressions here — the crawl and the GSC window are both post-cutover, and ' +
    'the linter rejects the physically impossible alternative.',
  // TECH-001 promoted out of rubricOnlyCluster: its detector now parses every
  // Googlebot-applicable Disallow, matches it against crawled URLs, and reports a
  // blocked-URL count — so the staging robots.txt this scenario ships is asserted
  // at default scope rather than excluded.
  cluster: ['MEAS-001', 'ONPAGE-006', 'TECH-001'],
  rubricOnlyCluster: [],
  // The migration broke plumbing, not copy. A detector that concludes "the site
  // is broken" and fires everything must go red here.
  fpTraps: ['ONPAGE-003', 'LOCAL-003'],
  build: (ctx) => {
    const { rng, variant } = ctx
    const vocab = VOCAB.northstar
    const tracker = new Tracker()
    const newBuild: CrawlPageRecord[] = []

    newBuild.push(healthyPage(vocab, { path: '/', wordCount: 880, override: { h1s: [vocab.brand] } }))

    for (const service of vocab.services) {
      newBuild.push(healthyPage(vocab, { path: `/services/${service}/`, templateGroup: 'service' }))
    }
    const blogCount = rng.int(8, 16)
    for (let i = 0; i < blogCount; i++) {
      newBuild.push(
        healthyPage(vocab, { path: `/blog/post-${i + 1}/`, templateGroup: 'blog', wordCount: 810 }),
      )
    }
    for (const slug of ['about', 'contact', 'financing']) {
      newBuild.push(healthyPage(vocab, { path: `/${slug}/`, wordCount: 560 }))
    }
    newBuild.push(...coherentLocationPages(vocab, rng, rng.int(2, vocab.served.length)))

    // The redirect map's live half: old locale-prefixed URLs still serving 200
    // with self-canonicals, next to their replacements. Each pair is one query
    // with two competing URLs — the cannibalisation the migration created.
    const survivors: Array<[string, string]> = []
    for (const service of rng.sample(vocab.services, rng.int(3, 6))) {
      const old = healthyPage(vocab, { path: `/en/${service}/`, templateGroup: 'legacy-locale' })
      newBuild.push(old)
      survivors.push([`${vocab.origin}/services/${service}/`, old.url])
    }

    // The redirect map's dead half: 404, canonical still on the retired domain. A
    // cross-origin canonical is physically real, so the linter permits it; a
    // same-origin canonical pointing at nothing would not be.
    const orphaned: CrawlPageRecord[] = []
    for (let i = 0; i < rng.int(3, 9); i++) {
      const slug = rng.pick(vocab.services)
      orphaned.push(
        healthyPage(vocab, {
          path: `/old/${slug}-${i}/`,
          override: {
            status: 404,
            h1s: ['Page Not Found'],
            canonical: `https://legacy-${vocab.brand.split(' ')[0].toLowerCase()}.example/${slug}/`,
            wordCount: 90,
            uniqueWordCount: 70,
            internalLinksOut: 3,
            internalLinksIn: 0,
          },
        }),
      )
    }

    // Still on the old CDN, still tagged.
    const legacyCdn: CrawlPageRecord[] = []
    for (let i = 0; i < rng.int(2, 5); i++) {
      legacyCdn.push(
        healthyPage(vocab, { path: `/legacy/guide-${i + 1}/`, templateGroup: 'legacy', wordCount: 1240 }),
      )
    }

    // The new build lost the container; the CDN pages kept it.
    const analyticsPool = variant === 'defect' ? ANALYTICS_ENCODINGS : ANALYTICS_NEAR_MISS
    const pages = [
      ...newBuild.map((p) => encode(p, analyticsPool, rng, tracker)),
      ...orphaned.map((p) => encode(p, analyticsPool, rng, tracker)),
      ...legacyCdn.map((p) => encode(p, ANALYTICS_NEAR_MISS, rng, tracker)),
    ]

    // Under 'rubric' scope the staging robots.txt blocks the content hub, which
    // carries no impressions by construction; `robots()` falls back to a
    // near-miss robots.txt under 'detector-covered' scope, where TECH-001 cannot
    // be asserted at all.
    const site = robots(healthySite(vocab), ctx, tracker, ['robots-disallow-content-hub'])

    // GSC candidates: 200, and not blocked by whichever robots.txt was chosen —
    // computed from the robots.txt itself rather than a hardcoded prefix, so the
    // fixture stays physical whichever encoding the seed draws.
    const robotsGroups = site.robotsTxt ? parseRobotsTxt(site.robotsTxt) : []
    const indexable = (url: string): boolean => isUrlAllowed(url, robotsGroups)
    const candidates = pages.filter((p) => p.status === 200 && indexable(p.url)).map((p) => p.url)
    const pairs = survivors.filter(([a, b]) => indexable(a) && indexable(b))

    const pool = new QueryPool(vocab, rng)
    const gsc = buildGsc(pool, candidates, rng, tracker, {
      pairs: variant === 'defect' ? pairs : [],
      defectClusters: 0,
      nearMissClusters: 2,
      singles: rng.int(5, 9),
    })

    return {
      site,
      pages,
      gsc: gsc.rows,
      gbp: healthyGbpWithNearMiss(vocab, rng, tracker),
      encodingsUsed: tracker.used,
      unassertable: [],
    }
  },
}

// ---------------------------------------------------------------------------
// 4. gbp-misconfig
// ---------------------------------------------------------------------------

const gbpMisconfig: ScenarioTemplate = {
  id: 'gbp-misconfig',
  story:
    'UNFINISHED FRANCHISE PROFILE. A lead-gen vendor created the new location\'s Google ' +
    'Business Profile, typed in the name and the primary category, pasted a metro-wide city ' +
    'list into the service areas, and never went back: no hours, no description, no photos ' +
    'depending on which fields the spreadsheet happened to fill. Meanwhile the site\'s ' +
    '/areas/ pages were generated from a DIFFERENT, wider city list than the profile ever ' +
    'declared, so the pages target geography the profile cannot rank for. One cause, two ' +
    'checks: an unowned profile and a page set built from the wrong source of truth. The ' +
    'profile is a service-area business with a correctly hidden storefront address, so the ' +
    'magnitude here is itself the false-positive guard — it must equal the count of ' +
    'genuinely missing fields and not one more.',
  cluster: ['LOCAL-003', 'LOCAL-016'],
  fpTraps: ['ONPAGE-006', 'TECH-001'],
  rubricOnlyCluster: [],
  build: (ctx) => {
    const { rng, variant } = ctx
    const vocab = VOCAB.brightpath
    const tracker = new Tracker()
    const pages: CrawlPageRecord[] = []

    pages.push(healthyPage(vocab, { path: '/', wordCount: 910, override: { h1s: [vocab.brand] } }))
    for (const service of vocab.services) {
      pages.push(healthyPage(vocab, { path: `/services/${service}/`, templateGroup: 'service' }))
    }
    for (let i = 0; i < rng.int(5, 11); i++) {
      pages.push(
        healthyPage(vocab, { path: `/blog/post-${i + 1}/`, templateGroup: 'blog', wordCount: 760 }),
      )
    }

    // Under-coverage of the declared areas is NOT a defect: only a subset of the
    // declared cities gets a page, in both variants.
    pages.push(...coherentLocationPages(vocab, rng, rng.int(2, 4)))
    pages.push(geoMentionNearMiss(vocab, rng, tracker))
    if (variant === 'defect') {
      pages.push(...incoherentLocationPages(vocab, rng, tracker, rng.int(3, 9)))
    }

    const tagged = pages.map((p) => encode(p, ANALYTICS_NEAR_MISS, rng, tracker))

    const gbp =
      variant === 'defect'
        ? damageGbp(healthyGbp(vocab), rng, tracker, rng.int(2, 4))
        : healthyGbpWithNearMiss(vocab, rng, tracker)

    const pool = new QueryPool(vocab, rng)
    const gsc = buildGsc(
      pool,
      tagged.filter((p) => p.status === 200).map((p) => p.url),
      rng,
      tracker,
      { defectClusters: 0, nearMissClusters: 2, singles: rng.int(5, 10) },
    )

    return {
      site: robots(healthySite(vocab), { ...ctx, variant: 'near-miss' }, tracker, []),
      pages: tagged,
      gsc: gsc.rows,
      gbp,
      encodingsUsed: tracker.used,
      unassertable: [],
    }
  },
}

export const SCENARIOS: ScenarioTemplate[] = [
  templateBug,
  aiPageSpree,
  migrationGoneWrong,
  gbpMisconfig,
]

export const SCENARIO_IDS = SCENARIOS.map((s) => s.id)

export function scenario(id: string): ScenarioTemplate {
  const found = SCENARIOS.find((s) => s.id === id)
  if (!found) throw new Error(`unknown scenario "${id}" — known: ${SCENARIO_IDS.join(', ')}`)
  return found
}
