// Surface encodings: the several DIFFERENT ways one defect shows up in the data.
//
// Why this file exists, in one sentence: a frozen fixture set is a memorisation
// machine. If "missing H1" only ever means `h1s: []`, a detector written as
// `page.h1s.length === 0` scores 100% forever and then misses the real site whose
// theme renders `<h1></h1>` on every service page. So each defect carries several
// encodings and the generator picks among them by seed — a fresh seed produces a
// fresh combination, and a detector shaped to one encoding goes red.
//
// Every encoding's `note` states the real-world configuration it stands for, and
// every encoding is written from the rubric text quoted in predicates.ts. The
// near-miss encodings are the other half: for each defect, the LEGITIMATE
// configuration sitting right next to it. Those are what make the harness measure
// precision instead of only recall.

import type { CrawlPageRecord, CrawlSiteRecord, GbpProfileRecord } from '@/lib/tools/crawl-record'
import type { GSCRow } from '@/lib/tools-gsc'
import type { Rng } from './rng'

export type EncodingKind = 'defect' | 'near-miss'

interface EncodingMeta {
  id: string
  checkId: string
  kind: EncodingKind
  /** The real-world configuration this stands for. */
  note: string
}

export interface PageEncoding extends EncodingMeta {
  apply: (page: CrawlPageRecord, rng: Rng) => CrawlPageRecord
}

export interface GbpEncoding extends EncodingMeta {
  apply: (gbp: GbpProfileRecord, rng: Rng) => GbpProfileRecord
}

export interface SiteEncoding extends EncodingMeta {
  /** Path prefixes this robots.txt body is meant to block, for the caller's
   *  bookkeeping — the magnitude itself is always recomputed from the data. */
  blocks: string[]
  apply: (site: CrawlSiteRecord, rng: Rng) => CrawlSiteRecord
}

export interface GscClusterEncoding extends EncodingMeta {
  queriesNeeded: number
  urlsNeeded: number
  build: (ctx: { queries: string[]; urls: string[]; rng: Rng }) => GSCRow[]
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function titleCase(slug: string): string {
  return slug
    .split('-')
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}

/** A plausible heading for a URL, so healthy pages don't all read the same.
 *  Returns '' for an origin-only URL, which lets callers fall back to the brand. */
export function headingFor(url: string): string {
  const m = /^[a-z][a-z0-9+.-]*:\/\/[^/]+(\/.*)?$/i.exec(url)
  const path = (m ? m[1] ?? '/' : url).replace(/[?#].*$/, '')
  const seg = path.split('/').filter(Boolean).pop()
  return seg ? titleCase(seg) : ''
}

function row(query: string, page: string, impressions: number, clicks: number, position: number): GSCRow {
  return {
    query,
    page,
    clicks,
    impressions,
    ctr: impressions > 0 ? Math.round((clicks / impressions) * 1000) / 10 : 0,
    position,
  }
}

// ---------------------------------------------------------------------------
// ONPAGE-003 — one H1 per page describing primary intent
// ---------------------------------------------------------------------------

export const H1_ENCODINGS: PageEncoding[] = [
  {
    id: 'h1-absent',
    checkId: 'ONPAGE-003',
    kind: 'defect',
    note: 'Template renders the page topic in a styled <div class="hero-title"> — no <h1> element in the rendered DOM at all.',
    apply: (page) => ({ ...page, h1s: [] }),
  },
  {
    id: 'h1-empty-string',
    checkId: 'ONPAGE-003',
    kind: 'defect',
    note: 'Template keeps <h1> but the field it interpolates is blank, so the element renders as <h1></h1>. Present in the heading tree, describes nothing.',
    apply: (page) => ({ ...page, h1s: [''] }),
  },
  {
    id: 'h1-whitespace-only',
    checkId: 'ONPAGE-003',
    kind: 'defect',
    note: 'The <h1> holds only layout whitespace/newlines from the template indentation (a common Elementor/Gutenberg wrapper artefact).',
    apply: (page, rng) => ({ ...page, h1s: [rng.pick(['   ', '\n  ', '\t', ' \n\t '])] }),
  },
  {
    id: 'h1-image-alt-only',
    checkId: 'ONPAGE-003',
    kind: 'defect',
    note: 'The <h1> wraps only the logo image; the rendered text content is empty even though the tag has children.',
    apply: (page) => ({ ...page, h1s: [''] }),
  },
  {
    id: 'h1-duplicated',
    checkId: 'ONPAGE-003',
    kind: 'defect',
    note: 'Both the hero partial and the sticky mobile header emit an <h1>, so every page in the group carries two. Violates "One H1 per page" by having too many rather than none — the other half of the rubric sentence.',
    apply: (page) => {
      const base = headingFor(page.url) || page.title.split('|')[0].trim() || 'Home'
      return { ...page, h1s: [base, `${base} Near Me`] }
    },
  },
]

export const H1_NEAR_MISS: PageEncoding[] = [
  {
    id: 'h1-single-verbose',
    checkId: 'ONPAGE-003',
    kind: 'near-miss',
    note: 'ONE long, keyword-rich H1 plus a deep H2/H3 tree. Ugly copy, correct structure — a length or keyword-density heuristic would flag it; the rubric would not.',
    apply: (page) => ({
      ...page,
      h1s: [`${headingFor(page.url)} Services — Licensed, Insured, Same-Day Appointments`],
    }),
  },
  {
    id: 'h1-with-padded-text',
    checkId: 'ONPAGE-003',
    kind: 'near-miss',
    note: 'A single H1 whose text carries the template\'s leading/trailing newlines around real words. Trimmed it is a perfectly good heading; an untrimmed equality test would call it blank.',
    apply: (page) => ({ ...page, h1s: [`\n  ${headingFor(page.url)}\n`] }),
  },
]

// ---------------------------------------------------------------------------
// TECH-011 — mobile-friendly rendering
// ---------------------------------------------------------------------------

export const MOBILE_ENCODINGS: PageEncoding[] = [
  {
    id: 'mobile-no-viewport',
    checkId: 'TECH-011',
    kind: 'defect',
    note: 'The mobile header partial lost <meta name="viewport">, so the page renders at desktop width on a phone. Tap targets are fine in CSS but unreachable in practice.',
    apply: (page) => ({ ...page, hasViewportMeta: false, tapTargetsOk: true }),
  },
  {
    id: 'mobile-tap-targets-small',
    checkId: 'TECH-011',
    kind: 'defect',
    note: 'Viewport meta present, but the call-now button and nav links render below the 48px minimum the rubric notes require.',
    apply: (page) => ({ ...page, hasViewportMeta: true, tapTargetsOk: false }),
  },
  {
    id: 'mobile-both',
    checkId: 'TECH-011',
    kind: 'defect',
    note: 'No viewport meta AND sub-48px tap targets — the shape a whole template group takes when the responsive stylesheet is dropped from the build.',
    apply: (page) => ({ ...page, hasViewportMeta: false, tapTargetsOk: false }),
  },
]

export const MOBILE_NEAR_MISS: PageEncoding[] = [
  {
    id: 'mobile-ok-dense',
    checkId: 'TECH-011',
    kind: 'near-miss',
    note: 'A link-dense comparison page: viewport present, tap targets padded to 48px. High link count is not a mobile-friendliness defect.',
    apply: (page) => ({
      ...page,
      hasViewportMeta: true,
      tapTargetsOk: true,
      internalLinksOut: 96,
    }),
  },
]

// ---------------------------------------------------------------------------
// MEAS-001 — analytics present and measurable
//
// Only ONE defect encoding exists here, and that is a property of the input, not
// an omission: CrawlPageRecord.analytics carries two booleans, so "no tag at all"
// is the only distinguishable surface form. Requirement: multiple encodings
// "where the check's input allows it".
// ---------------------------------------------------------------------------

export const ANALYTICS_ENCODINGS: PageEncoding[] = [
  {
    id: 'analytics-none',
    checkId: 'MEAS-001',
    kind: 'defect',
    note: 'Neither a GA4 snippet nor a GTM container in the served HTML — the page is invisible to measurement.',
    apply: (page) => ({ ...page, analytics: { ga4: false, gtm: false } }),
  },
]

export const ANALYTICS_NEAR_MISS: PageEncoding[] = [
  {
    id: 'analytics-gtm-only',
    checkId: 'MEAS-001',
    kind: 'near-miss',
    note: 'GA4 deployed THROUGH Tag Manager, so there is no hardcoded gtag.js. A detector looking only for the GA4 snippet would call a correctly measured site untagged.',
    apply: (page) => ({ ...page, analytics: { ga4: false, gtm: true } }),
  },
  {
    id: 'analytics-ga4-direct',
    checkId: 'MEAS-001',
    kind: 'near-miss',
    note: 'Hardcoded gtag.js and no container. Also correct; also must not fire.',
    apply: (page) => ({ ...page, analytics: { ga4: true, gtm: false } }),
  },
  {
    id: 'analytics-both',
    checkId: 'MEAS-001',
    kind: 'near-miss',
    note: 'GA4 snippet plus a GTM container that holds tags for other vendors. Measurable either way.',
    apply: (page) => ({ ...page, analytics: { ga4: true, gtm: true } }),
  },
]

// ---------------------------------------------------------------------------
// ONPAGE-006 — keyword cannibalisation
// ---------------------------------------------------------------------------

export const CANNIBAL_ENCODINGS: GscClusterEncoding[] = [
  {
    id: 'cannibal-pair',
    checkId: 'ONPAGE-006',
    kind: 'defect',
    queriesNeeded: 1,
    urlsNeeded: 2,
    note: 'Two pages built for the same keyword in different quarters, both surfacing for it and splitting the impressions.',
    build: ({ queries, urls, rng }) => {
      const primary = rng.int(240, 480)
      return [
        row(queries[0], urls[0], primary, rng.int(0, 3), rng.int(18, 40)),
        row(queries[0], urls[1], rng.int(110, 230), 0, rng.int(48, 84)),
      ]
    },
  },
  {
    id: 'cannibal-triple',
    checkId: 'ONPAGE-006',
    kind: 'defect',
    queriesNeeded: 1,
    urlsNeeded: 3,
    note: 'Three near-identical generated pages for one keyword — the shape a bulk-generation run leaves when the same topic appears three times in the source spreadsheet.',
    build: ({ queries, urls, rng }) => [
      row(queries[0], urls[0], rng.int(300, 520), rng.int(0, 2), rng.int(22, 38)),
      row(queries[0], urls[1], rng.int(150, 260), 0, rng.int(55, 78)),
      row(queries[0], urls[2], rng.int(100, 190), 0, rng.int(70, 95)),
    ],
  },
  {
    id: 'cannibal-legacy-vs-generated',
    checkId: 'ONPAGE-006',
    kind: 'defect',
    queriesNeeded: 1,
    urlsNeeded: 2,
    note: 'The documented Tornado shape: a hand-built legacy page that used to rank, now competing with its own bulk-generated replacement. The legacy page holds the better position and all the clicks.',
    build: ({ queries, urls, rng }) => [
      row(queries[0], urls[0], rng.int(140, 260), rng.int(2, 6), rng.int(12, 24)),
      row(queries[0], urls[1], rng.int(160, 300), rng.int(0, 1), rng.int(30, 52)),
    ],
  },
]

export const CANNIBAL_NEAR_MISS: GscClusterEncoding[] = [
  {
    id: 'distinct-intent-pair',
    checkId: 'ONPAGE-006',
    kind: 'near-miss',
    queriesNeeded: 2,
    urlsNeeded: 2,
    note: 'Two topically adjacent pages serving two DIFFERENT intents (repair vs installation): one URL per query, no overlap. A page-similarity detector would call this cannibalisation; the rubric\'s query-x-page test would not.',
    build: ({ queries, urls, rng }) => [
      row(queries[0], urls[0], rng.int(400, 900), rng.int(30, 70), rng.int(2, 6)),
      row(queries[1], urls[1], rng.int(300, 700), rng.int(20, 55), rng.int(2, 7)),
    ],
  },
  {
    id: 'long-tail-under-one-page',
    checkId: 'ONPAGE-006',
    kind: 'near-miss',
    queriesNeeded: 3,
    urlsNeeded: 1,
    note: 'One page ranking for three long-tail variants — many queries, ONE URL. The inverse shape, and the one a naive "multiple rows for this page" heuristic mistakes for a problem.',
    build: ({ queries, urls, rng }) => queries.map((q, i) =>
      row(q, urls[0], rng.int(120, 400), rng.int(4, 25), rng.int(3, 12) + i),
    ),
  },
]

// ---------------------------------------------------------------------------
// LOCAL-016 — service-area coherence
//
// All three defect encodings are "targetGeo outside the geography the profile can
// rank for"; they differ in how the incoherence LOOKS, which is what a
// distance-heuristic or a string-similarity detector would key off.
// ---------------------------------------------------------------------------

export interface GeoEncoding extends EncodingMeta {
  /** Cities this encoding draws from, as 'City, ST'. */
  cities: string[]
}

export const GEO_ENCODINGS: GeoEncoding[] = [
  {
    id: 'geo-far-metro',
    checkId: 'LOCAL-016',
    kind: 'defect',
    note: 'Location pages for a metro 45-65 miles away that the profile never declared — the documented Tornado defect (San Fernando Valley profile, Orange County pages).',
    cities: ['Anaheim, CA', 'Irvine, CA', 'Tustin, CA', 'Costa Mesa, CA', 'Fullerton, CA', 'Santa Ana, CA'],
  },
  {
    id: 'geo-adjacent-county',
    checkId: 'LOCAL-016',
    kind: 'defect',
    note: 'Pages for the next county over — close enough that a mileage heuristic would let them through, but outside the declared service areas, so the profile cannot rank for them.',
    cities: ['Oxnard, CA', 'Camarillo, CA', 'Simi Valley, CA', 'Thousand Oaks, CA', 'Moorpark, CA'],
  },
  {
    id: 'geo-state-hop',
    checkId: 'LOCAL-016',
    kind: 'defect',
    note: 'A page-generation run that read a national city list: targets in another state entirely. Unmistakable, and the one case any detector should catch — included so the mix always contains one easy positive.',
    cities: ['Henderson, NV', 'Las Vegas, NV', 'Mesa, AZ', 'Chandler, AZ', 'Reno, NV'],
  },
]

// ---------------------------------------------------------------------------
// LOCAL-003 — GBP completeness
// ---------------------------------------------------------------------------

export const GBP_ENCODINGS: GbpEncoding[] = [
  {
    id: 'gbp-no-hours',
    checkId: 'LOCAL-003',
    kind: 'defect',
    note: 'Hours never filled in — the profile shows no opening times at all.',
    apply: (gbp) => ({ ...gbp, hoursComplete: false }),
  },
  {
    id: 'gbp-description-null',
    checkId: 'LOCAL-003',
    kind: 'defect',
    note: 'The business description field was never written; the API returns it absent.',
    apply: (gbp) => ({ ...gbp, description: null }),
  },
  {
    id: 'gbp-description-blank',
    checkId: 'LOCAL-003',
    kind: 'defect',
    note: 'Second surface encoding of the same defect: the description exists but holds only whitespace, because a bulk importer wrote an empty cell into it.',
    apply: (gbp, rng) => ({ ...gbp, description: rng.pick(['', '   ', '\n']) }),
  },
  {
    id: 'gbp-no-photos',
    checkId: 'LOCAL-003',
    kind: 'defect',
    note: 'Zero photos — the profile shows the generic category placeholder in the local pack.',
    apply: (gbp) => ({ ...gbp, photoCount: 0 }),
  },
  {
    id: 'gbp-phone-null',
    checkId: 'LOCAL-003',
    kind: 'defect',
    note: 'No phone number on the profile, so the local pack shows no call button.',
    apply: (gbp) => ({ ...gbp, phone: null }),
  },
  {
    id: 'gbp-phone-blank',
    checkId: 'LOCAL-003',
    kind: 'defect',
    note: 'Second surface encoding: the phone field is an empty string rather than absent — what a CRM sync writes when its source column is blank.',
    apply: (gbp) => ({ ...gbp, phone: '' }),
  },
  {
    id: 'gbp-website-null',
    checkId: 'LOCAL-003',
    kind: 'defect',
    note: 'No website URI, so every profile visitor is a dead end.',
    apply: (gbp) => ({ ...gbp, websiteUri: null }),
  },
]

export const GBP_NEAR_MISS: GbpEncoding[] = [
  {
    id: 'gbp-sab-hidden-address',
    checkId: 'LOCAL-003',
    kind: 'near-miss',
    note: 'The documented real-world false positive: a service-area business with a deliberately hidden storefront address and every other field complete. Google TELLS service-area businesses to hide the address. Must pass.',
    apply: (gbp) => ({
      ...gbp,
      isServiceAreaBusiness: true,
      storefrontAddress: null,
      hoursComplete: true,
      photoCount: 22,
    }),
  },
  {
    id: 'gbp-terse-description',
    checkId: 'LOCAL-003',
    kind: 'near-miss',
    note: 'A short but real description (nine words). Present and meaningful — a minimum-length heuristic would flag it, the rubric\'s field audit would not.',
    apply: (gbp) => ({ ...gbp, description: 'Family-owned HVAC repair and installation since 1998.' }),
  },
  {
    id: 'gbp-few-photos',
    checkId: 'LOCAL-003',
    kind: 'near-miss',
    note: 'Three photos: not many, but the photos field is populated. A "photoCount < 10" heuristic fires here and should not.',
    apply: (gbp) => ({ ...gbp, photoCount: 3 }),
  },
]

// ---------------------------------------------------------------------------
// TECH-001 — robots.txt does not block important sections
// ---------------------------------------------------------------------------

/** Keep the sitemap directive pointing at the fixture's own origin. */
function body(site: CrawlSiteRecord, lines: string[]): string {
  const sitemap = site.sitemapUrls[0]
  return [...lines, ...(sitemap ? [`Sitemap: ${sitemap}`] : [])].join('\n') + '\n'
}

export const ROBOTS_ENCODINGS: SiteEncoding[] = [
  {
    id: 'robots-disallow-all',
    checkId: 'TECH-001',
    kind: 'defect',
    blocks: ['/'],
    note: 'The staging robots.txt shipped to production: Disallow: / for every agent. Not used by any scenario that also asserts a GSC-backed check — blocking every URL would leave no page that may legitimately carry impressions, and the linter rejects a blocked page with impressions.',
    apply: (site) => ({ ...site, robotsTxt: body(site, ['User-agent: *', 'Disallow: /']) }),
  },
  {
    id: 'robots-disallow-money-path',
    checkId: 'TECH-001',
    kind: 'defect',
    blocks: ['/services/'],
    note: 'A Disallow left on the money-page directory after it was used to hide the section during a rebuild. The rubric notes name exactly this: "No Disallow on money pages".',
    apply: (site) => ({
      ...site,
      robotsTxt: body(site, ['User-agent: *', 'Disallow: /wp-admin/', 'Disallow: /services/']),
    }),
  },
  {
    id: 'robots-disallow-googlebot-group',
    checkId: 'TECH-001',
    kind: 'defect',
    blocks: ['/services/'],
    note: 'The blocking Disallow sits in a Googlebot-specific group while the * group looks clean — a detector that only reads the * group sees nothing wrong.',
    apply: (site) => ({
      ...site,
      robotsTxt: body(site, [
        'User-agent: *',
        'Disallow: /wp-admin/',
        '',
        'User-agent: Googlebot',
        'Disallow: /services/',
      ]),
    }),
  },
  {
    id: 'robots-disallow-wildcard',
    checkId: 'TECH-001',
    kind: 'defect',
    blocks: ['/services/'],
    note: 'A hand-mangled wildcard rule (Disallow: /*ervices/) that a prefix-only robots matcher reads as harmless while Googlebot reads it as blocking the whole money-page section.',
    apply: (site) => ({
      ...site,
      robotsTxt: body(site, ['User-agent: *', 'Disallow: /*ervices/', 'Disallow: /wp-admin/']),
    }),
  },
  {
    id: 'robots-disallow-content-hub',
    checkId: 'TECH-001',
    kind: 'defect',
    blocks: ['/blog/'],
    note: 'The Disallow that hid the half-migrated blog during a rebuild, left in place afterwards. "Important sections" in the check text is broader than money pages, and losing the whole content hub is the version of this mistake that survives longest because nobody notices a section that was never meant to convert.',
    apply: (site) => ({
      ...site,
      robotsTxt: body(site, ['User-agent: *', 'Disallow: /wp-admin/', 'Disallow: /blog/']),
    }),
  },
  {
    id: 'robots-disallow-assets',
    checkId: 'TECH-001',
    kind: 'defect',
    blocks: ['/wp-content/'],
    note: 'Disallow on /wp-content/, blocking CSS and JS ("or CSS or JS for Googlebot"). Kept out of the must_find mix because a page-level magnitude cannot see it — a crawl of HTML URLs contains no stylesheets to count.',
    apply: (site) => ({
      ...site,
      robotsTxt: body(site, ['User-agent: *', 'Disallow: /wp-content/']),
    }),
  },
]

export const ROBOTS_NEAR_MISS: SiteEncoding[] = [
  {
    id: 'robots-admin-and-facets-only',
    checkId: 'TECH-001',
    kind: 'near-miss',
    blocks: [],
    note: 'The legitimate configuration: admin, cart, and internal-search facets disallowed, nothing a public crawl contains. An allowlist-free detector must score this zero.',
    apply: (site) => ({
      ...site,
      robotsTxt: body(site, [
        'User-agent: *',
        'Disallow: /wp-admin/',
        'Disallow: /cart/',
        'Disallow: /checkout/',
        'Disallow: /?s=',
        'Disallow: /*?add-to-cart=',
        'Allow: /wp-admin/admin-ajax.php',
      ]),
    }),
  },
  {
    id: 'robots-absent',
    checkId: 'TECH-001',
    kind: 'near-miss',
    blocks: [],
    note: 'robots.txt 404s. Nothing is blocked — an absent file is not a block, and treating null as "unknown, assume bad" is a false positive.',
    apply: (site) => ({ ...site, robotsTxt: null, robotsTxtStatus: 'not-found' as const }),
  },
  {
    id: 'robots-blocks-only-intentional-staging',
    checkId: 'TECH-001',
    kind: 'near-miss',
    blocks: ['/staging-preview/'],
    note: 'A Disallow on a staging path whose pages also carry an INTENTIONAL noindex and earn no impressions — the deliberate exclusion sitting right next to the accidental one. Scenarios that use this encoding put no /staging-preview/ URLs in the crawl, so the legitimate block costs nothing.',
    apply: (site) => ({
      ...site,
      robotsTxt: body(site, ['User-agent: *', 'Disallow: /wp-admin/', 'Disallow: /staging-preview/']),
    }),
  },
]

/**
 * Encodings the RUBRIC says are defective and no registered detector currently
 * catches. Measured, not guessed: each was fed to runChecks in isolation and the
 * detector returned `pass` while the rubric-derived predicate in predicates.ts
 * counted it. The generator's `scope: 'detector-covered'` excludes them so the
 * green gate stays green; `scope: 'rubric'` includes them and produces a fixture
 * that lints clean and scores RED — the tracked regression target.
 *
 * Every entry here is a detector gap the injectors found on their first run,
 * which is the whole argument for writing them from the rubric instead of from
 * lib/findings/checks.ts. Delete an entry when its detector catches up; a test in
 * tests/unit/eval-injectors.test.ts asserts each gap still exists, so a fixed
 * detector turns this list red rather than letting it rot.
 */
export const KNOWN_UNCOVERED_ENCODINGS: Record<string, string> = {
  // RETIRED 2026-08-06 — the integration pass FIXED both detector gaps this block
  // documented, which is exactly what it existed to force:
  //
  //   ONPAGE-003 now counts H1s carrying usable TEXT, not array entries, so
  //   h1-empty-string, h1-whitespace-only and h1-image-alt-only are covered.
  //
  //   TECH-001 now parses every Googlebot-applicable Disallow, matches it against
  //   crawled URLs (with * and $ support) and reports a blocked-URL COUNT, so the
  //   section-level, Googlebot-group, wildcard and content-hub encodings are
  //   covered and a rubric-derived magnitude is satisfiable.
  //
  // Finding them is the payoff of writing injectors from the rubric text instead
  // of from lib/findings/checks.ts. Keep that discipline.

  // Still genuinely uncovered — an INPUT gap, not a detector gap: CrawlStationData
  // models no stylesheet or script URLs, so an asset-only block has nothing to
  // count. Closing it needs a schema change, not a detector change.
  'robots-disallow-assets': 'no asset URLs exist in CrawlStationData to count as blocked',
}

/** Every encoding in the library, for coverage assertions. */
export const ALL_ENCODINGS: EncodingMeta[] = [
  ...H1_ENCODINGS,
  ...H1_NEAR_MISS,
  ...MOBILE_ENCODINGS,
  ...MOBILE_NEAR_MISS,
  ...ANALYTICS_ENCODINGS,
  ...ANALYTICS_NEAR_MISS,
  ...CANNIBAL_ENCODINGS,
  ...CANNIBAL_NEAR_MISS,
  ...GEO_ENCODINGS,
  ...GBP_ENCODINGS,
  ...GBP_NEAR_MISS,
  ...ROBOTS_ENCODINGS,
  ...ROBOTS_NEAR_MISS,
]
