// Magnitude predicates, derived from docs/rubric/rubric.json and §9 of
// docs/AUTOMATION-CONTEXT.md — NOT from lib/findings/checks.ts.
//
// This file is the circularity mitigation, so it is worth being explicit about
// the method. Every predicate below is written from the rubric row's `check`
// text, `howToTest` text and `notes`, quoted inline. None of them was written by
// reading a detector body. That matters because the eval's whole claim is that
// the fixtures and the detectors were derived independently and still agree; if
// the predicates were transcribed from the detectors, the green test would only
// prove that a file equals itself.
//
// These predicates have three consumers:
//   - the generator, which uses them to fill in the manifest's REQUIRED magnitude
//     from the data it just produced (a generator whose manifest disagrees with
//     its own data is worse than no fixture);
//   - lib/eval/lint.ts, which re-checks manifest magnitudes against station data;
//   - the tests, which assert the detectors reach the same numbers.
//
// Where a predicate is deliberately stricter than a detector currently is, the
// generator's encoding mix (encodings.ts) is what decides whether that stricter
// reading is exercised — the predicate itself stays faithful to the rubric.

import type {
  CrawlPageRecord,
  CrawlSiteRecord,
  CrawlStationData,
  GbpProfileRecord,
} from '@/lib/tools/crawl-record'
import type { GSCRow } from '@/lib/tools-gsc'

/** Which evidence field the manifest asserts for a given check. */
export type MagnitudeMetric = 'affectedUrls' | 'value'

export interface MagnitudeReading {
  metric: MagnitudeMetric
  /** The count the rubric text implies for this station data. */
  count: number
  /** Subjects behind the count — URLs, queries or GBP field names. */
  subjects: string[]
}

export interface PredicateInput {
  crawl?: CrawlStationData
  gsc?: GSCRow[]
  gbp?: GbpProfileRecord
}

// ---------------------------------------------------------------------------
// text helpers
// ---------------------------------------------------------------------------

/** Present-and-meaningful: a tag that exists but holds only whitespace is absent
 *  as far as any rubric text about *describing* something is concerned. */
function meaningful(value: string | null | undefined): boolean {
  return typeof value === 'string' && value.trim().length > 0
}

function normGeo(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLowerCase()
}

// ---------------------------------------------------------------------------
// ONPAGE-003 — "One H1 per page describing primary intent, logical heading
// hierarchy". howToTest: "Rendered-DOM heading tree".
//
// Two readings follow directly from "One H1 per page describing primary intent":
// a page with no usable H1 fails, and a page with more than one H1 fails. An H1
// element that renders as an empty or whitespace-only string is present in the
// DOM but describes no intent, so it counts as no usable H1 — which is why the
// injector ships absent / empty-string / whitespace-only as three surface
// encodings of the same defect.
// ---------------------------------------------------------------------------

export function usableH1Count(page: CrawlPageRecord): number {
  return page.h1s.filter(meaningful).length
}

/** Pages that do not have exactly one usable H1. */
export function missingH1(input: PredicateInput): MagnitudeReading {
  const pages = input.crawl?.pages ?? []
  const bad = pages.filter((p) => usableH1Count(p) !== 1)
  return { metric: 'affectedUrls', count: bad.length, subjects: bad.map((p) => p.url) }
}

/** The subset that fails for having several H1s rather than none. Split out so a
 *  test can report the two readings separately. */
export function multipleH1(input: PredicateInput): MagnitudeReading {
  const pages = input.crawl?.pages ?? []
  const bad = pages.filter((p) => usableH1Count(p) > 1)
  return { metric: 'affectedUrls', count: bad.length, subjects: bad.map((p) => p.url) }
}

/** Pages with no usable H1 at all. */
export function absentH1(input: PredicateInput): MagnitudeReading {
  const pages = input.crawl?.pages ?? []
  const bad = pages.filter((p) => usableH1Count(p) === 0)
  return { metric: 'affectedUrls', count: bad.length, subjects: bad.map((p) => p.url) }
}

// ---------------------------------------------------------------------------
// TECH-011 — "Mobile-friendly rendering: viewport, tap targets, no horizontal
// scroll, legible fonts". notes: "Tap targets >=48px".
//
// The rubric lists four independent conditions joined by "and" in the affirmative,
// so the failure is the disjunction: a page fails mobile-friendly rendering if
// ANY one of them fails. CrawlPageRecord exposes two of the four, so the predicate
// is `!hasViewportMeta || !tapTargetsOk`.
// ---------------------------------------------------------------------------

export function mobileUnfriendly(input: PredicateInput): MagnitudeReading {
  const pages = input.crawl?.pages ?? []
  const bad = pages.filter((p) => !p.hasViewportMeta || !p.tapTargetsOk)
  return { metric: 'affectedUrls', count: bad.length, subjects: bad.map((p) => p.url) }
}

// ---------------------------------------------------------------------------
// MEAS-001 — "GA4 installed once, firing correctly, key events marked for calls
// and form submits". howToTest: "GA4 Admin + Data API, tag check, DebugView".
//
// The crawl-side half of that is the tag check, and §9 phrases the real finding as
// "No GA or GTM code detected on any of 187 HTML pages" — i.e. the unit is pages
// carrying neither signal. GA4 deployed *through* GTM is a correct install, so gtm
// alone is not a defect; the near-miss encodings lean on exactly that.
// ---------------------------------------------------------------------------

export function untaggedPages(input: PredicateInput): MagnitudeReading {
  const pages = input.crawl?.pages ?? []
  const bad = pages.filter((p) => !p.analytics.ga4 && !p.analytics.gtm)
  return { metric: 'affectedUrls', count: bad.length, subjects: bad.map((p) => p.url) }
}

// ---------------------------------------------------------------------------
// ONPAGE-006 — "No keyword cannibalization: multiple pages competing for one
// query". howToTest: "GSC query x page". notes: "Also detectable via multiple
// ranking URLs per keyword".
//
// So the unit is the QUERY CLUSTER, not the URL: one query served by two or more
// distinct URLs is one cannibalised cluster. That matches the tornado manifest's
// `value: 7` over 17 competing rows.
//
// The rubric states no impression floor, so this predicate applies none. The
// registered detector does apply one (its own evidence string names 50
// impressions), so the two readings could diverge on a query whose competing rows
// are tiny. Every cannibalisation encoding in encodings.ts puts >=90 impressions
// on every competing row for exactly that reason — the generated data stays out of
// the zone where the two definitions disagree, rather than the predicate being
// bent to match.
// ---------------------------------------------------------------------------

export function cannibalisedClusters(input: PredicateInput): MagnitudeReading {
  const rows = input.gsc ?? []
  const byQuery = new Map<string, Set<string>>()
  for (const row of rows) {
    const key = row.query.trim().toLowerCase()
    let pages = byQuery.get(key)
    if (!pages) {
      pages = new Set<string>()
      byQuery.set(key, pages)
    }
    pages.add(row.page)
  }
  const clusters = Array.from(byQuery.entries())
    .filter(([, pages]) => pages.size > 1)
    .map(([query]) => query)
    .sort()
  return { metric: 'value', count: clusters.length, subjects: clusters }
}

// ---------------------------------------------------------------------------
// LOCAL-016 — "Service-area radius coherence: location pages target geography
// the profile can rank for". howToTest: "GBP service areas + real business
// address vs geography targeted by location pages". notes: "ADDED AFTER PILOT.
// An SAB ranks by proximity to its real address, not declared areas. Detect
// service-area business first: a hidden address is correct config, not a defect".
//
// A location page is one with a non-null targetGeo. The only geography signal in
// the record set is the declared service-area list plus the business city, so
// "geography the profile can rank for" is that set; a page targeting anything
// outside it is incoherent. Under-coverage (declared areas with no page) is NOT a
// defect and the near-miss encoding relies on that.
// ---------------------------------------------------------------------------

export function incoherentLocationPages(input: PredicateInput): MagnitudeReading {
  const pages = input.crawl?.pages ?? []
  const gbp = input.gbp
  if (!gbp) return { metric: 'affectedUrls', count: 0, subjects: [] }
  const rankable = new Set(gbp.serviceAreas.map(normGeo))
  rankable.add(normGeo(gbp.businessCity))
  const bad = pages.filter((p) => p.targetGeo !== null && !rankable.has(normGeo(p.targetGeo)))
  return { metric: 'affectedUrls', count: bad.length, subjects: bad.map((p) => p.url) }
}

// ---------------------------------------------------------------------------
// LOCAL-003 — "GBP completeness: hours, phone, website, services, attributes,
// description, photos". howToTest: "GBP API field audit". notes on LOCAL-016 and
// the GbpProfileRecord doc comment both insist a hidden storefront address on a
// service-area business is correct configuration.
//
// The magnitude is the number of listed fields the profile is missing.
// GbpProfileRecord carries five of the seven listed fields (services and
// attributes are not modelled), so those five are what is audited; the storefront
// address is excluded for a service-area business, which is what makes the
// magnitude itself a false-positive guard.
// ---------------------------------------------------------------------------

const GBP_COMPLETENESS_FIELDS: Array<{
  field: string
  missing: (gbp: GbpProfileRecord) => boolean
}> = [
  { field: 'hours', missing: (g) => !g.hoursComplete },
  { field: 'phone', missing: (g) => !meaningful(g.phone) },
  { field: 'website', missing: (g) => !meaningful(g.websiteUri) },
  { field: 'description', missing: (g) => !meaningful(g.description) },
  { field: 'photos', missing: (g) => g.photoCount <= 0 },
  {
    field: 'storefrontAddress',
    // The documented false positive, encoded as a precondition rather than a
    // comment: a service-area business is SUPPOSED to hide its address.
    missing: (g) => !g.isServiceAreaBusiness && !meaningful(g.storefrontAddress),
  },
]

export function incompleteGbpFields(input: PredicateInput): MagnitudeReading {
  const gbp = input.gbp
  if (!gbp) return { metric: 'value', count: 0, subjects: [] }
  const missing = GBP_COMPLETENESS_FIELDS.filter((f) => f.missing(gbp)).map((f) => f.field)
  return { metric: 'value', count: missing.length, subjects: missing }
}

/** The GBP fields the completeness predicate audits, in audit order. */
export const GBP_AUDITED_FIELDS = GBP_COMPLETENESS_FIELDS.map((f) => f.field)

// ---------------------------------------------------------------------------
// TECH-001 — "robots.txt does not block Googlebot from important sections".
// howToTest: "Fetch /robots.txt + GSC robots report". notes: "No Disallow on
// money pages, CSS or JS for Googlebot".
//
// "Important sections" is measured against the crawl: the magnitude is how many
// CRAWLED URLs a Googlebot-applicable Disallow rule blocks. That reading is what
// makes the legitimate configuration pass for free — `Disallow: /wp-admin/` and
// `Disallow: /?s=` block nothing a crawl of the public site contains, so they
// score zero without needing an allowlist of "acceptable" disallows.
// ---------------------------------------------------------------------------

interface RobotsRule {
  /** The raw Disallow path pattern. */
  pattern: string
}

/** Disallow rules from the groups that apply to Googlebot ('*' or 'googlebot'). */
export function googlebotDisallowRules(site: CrawlSiteRecord | undefined): RobotsRule[] {
  const body = site?.robotsTxt
  if (!body) return [] // A 404 robots.txt blocks nothing — that is not a defect.
  const rules: RobotsRule[] = []
  let applies = false
  let inGroup = false
  for (const rawLine of body.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, '').trim()
    if (line === '') continue
    const sep = line.indexOf(':')
    if (sep < 0) continue
    const field = line.slice(0, sep).trim().toLowerCase()
    const value = line.slice(sep + 1).trim()
    if (field === 'user-agent') {
      // A new user-agent line after directives starts a new group.
      if (inGroup) {
        applies = false
        inGroup = false
      }
      const agent = value.toLowerCase()
      if (agent === '*' || agent === 'googlebot') applies = true
      continue
    }
    if (field === 'disallow') {
      inGroup = true
      if (applies && value !== '') rules.push({ pattern: value })
      continue
    }
    if (field === 'allow') {
      inGroup = true
      continue
    }
  }
  return rules
}

function pathOf(url: string): string {
  const m = /^[a-z]+:\/\/[^/]+(\/.*)?$/i.exec(url)
  const withQuery = m ? m[1] ?? '/' : url
  return withQuery
}

/** robots.txt prefix matching with `*` wildcards and a trailing `$` anchor. */
export function robotsPathBlocked(path: string, rules: RobotsRule[]): boolean {
  return rules.some((rule) => {
    const anchored = rule.pattern.endsWith('$')
    const raw = anchored ? rule.pattern.slice(0, -1) : rule.pattern
    const escaped = raw.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')
    const re = new RegExp(`^${escaped}${anchored ? '$' : ''}`)
    return re.test(path)
  })
}

export function robotsBlockedPages(input: PredicateInput): MagnitudeReading {
  const pages = input.crawl?.pages ?? []
  const rules = googlebotDisallowRules(input.crawl?.site)
  if (rules.length === 0) return { metric: 'affectedUrls', count: 0, subjects: [] }
  const bad = pages.filter((p) => robotsPathBlocked(pathOf(p.url), rules))
  return { metric: 'affectedUrls', count: bad.length, subjects: bad.map((p) => p.url) }
}

// ---------------------------------------------------------------------------
// registry
// ---------------------------------------------------------------------------

/**
 * Check id → the rubric-derived magnitude predicate.
 *
 * Keyed by the seven check ids that have registered detectors. ONPAGE-012
 * (content-to-template ratio) is deliberately absent: the rubric defines it, the
 * ai-page-spree scenario generates data that violates it, but no detector is
 * registered for it yet, so no manifest may reference it (lib/eval/manifest.ts
 * enforces that) and no predicate here would have a consumer.
 */
export const MAGNITUDE_PREDICATES: Record<string, (input: PredicateInput) => MagnitudeReading> = {
  'TECH-001': robotsBlockedPages,
  'ONPAGE-003': missingH1,
  'TECH-011': mobileUnfriendly,
  'MEAS-001': untaggedPages,
  'ONPAGE-006': cannibalisedClusters,
  'LOCAL-016': incoherentLocationPages,
  'LOCAL-003': incompleteGbpFields,
  'ONPAGE-012': templateDominatedPages,
}

/**
 * ONPAGE-012 — pages in template-DOMINATED groups.
 *
 * Written from the rubric text alone, deliberately not from
 * lib/findings/detectors/onpage-012.ts, so the two are independent readings of the
 * same requirement and a magnitude assertion means something:
 *
 *   check:     "Content-to-template ratio: page groups are not template-dominated"
 *   howToTest: "Sitebulb content words vs template words, aggregated by template
 *               group, crossed with impression-earning rate"
 *   notes:     "A similarity check passes AI content that is unique-but-worthless.
 *               Tornado median was 29% unique / 71% template"
 *
 * So: group by template, take the MEDIAN unique share per group (the rubric says
 * median, and one rewritten page must not rescue a group of 130), and count the
 * pages in every group whose median falls at or below the 29%/71% split the note
 * names. Groups smaller than GROUP_FLOOR are excluded — a two-page family sharing
 * a header is a layout, not a content-farm.
 */
const TEMPLATE_DOMINATED_MAX_UNIQUE_SHARE = 0.35
const GROUP_FLOOR = 5

export function templateDominatedPages(input: PredicateInput): MagnitudeReading {
  const pages = input.crawl?.pages ?? []
  const groups = new Map<string, typeof pages>()
  for (const page of pages) {
    if (!page.templateGroup) continue
    const bucket = groups.get(page.templateGroup) ?? []
    bucket.push(page)
    groups.set(page.templateGroup, bucket)
  }
  const affected: string[] = []
  for (const [, members] of Array.from(groups.entries())) {
    if (members.length < GROUP_FLOOR) continue
    const shares = members
      .map((m) => (m.wordCount > 0 ? m.uniqueWordCount / m.wordCount : 1))
      .sort((a, b) => a - b)
    const mid = Math.floor(shares.length / 2)
    const median =
      shares.length % 2 === 0 ? (shares[mid - 1] + shares[mid]) / 2 : shares[mid]
    if (median <= TEMPLATE_DOMINATED_MAX_UNIQUE_SHARE) {
      for (const m of members) affected.push(m.url)
    }
  }
  return { metric: 'affectedUrls', count: affected.length, subjects: affected }
}

export function readMagnitude(checkId: string, input: PredicateInput): MagnitudeReading | null {
  const fn = MAGNITUDE_PREDICATES[checkId]
  return fn ? fn(input) : null
}
