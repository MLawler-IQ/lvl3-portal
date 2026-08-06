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
//
// ONE DELIBERATE EXCEPTION: robots.txt.
//
// `robotsBlockedPages` calls the same lib/robots module the TECH-001 detector calls,
// so for that one predicate the "two independent implementations" claim above does
// NOT hold. That is a considered trade, not an oversight.
//
// There genuinely were two independent robots implementations — this file's and the
// detector's. They disagreed on three probes (user-agent grouping, Googlebot-Image
// binding, query-string rules), and neither was right: between them they had six
// defects including a ReDoS that hung on a crafted robots.txt. See
// docs/robots-parser-findings.md. Duplicating an implementation only buys
// independence when the two authors reason differently; both of these were written
// by the same author from the same misunderstanding, so the duplication bought a
// disagreement instead of a cross-check, and a disagreeing gate carries no signal.
//
// Independence for robots now lives in tests/unit/robots.test.ts, which is written
// from RFC 9309 and Google's published matching rules rather than from lib/robots —
// a spec-derived test suite in place of a second implementation. If robots semantics
// are wrong, that suite is what catches it; this predicate no longer pretends to.

import type {
  CrawlPageRecord,
  CrawlStationData,
  GbpProfileRecord,
} from '@/lib/tools/crawl-record'
import type { GSCRow } from '@/lib/tools-gsc'
import { blockedUrls } from '@/lib/robots'
import { contentToTemplateRatio } from '@/lib/findings/analyses'

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

export function robotsBlockedPages(input: PredicateInput): MagnitudeReading {
  const pages = input.crawl?.pages ?? []
  const bad = blockedUrls(input.crawl?.site?.robotsTxt, pages.map((p) => p.url))
  return { metric: 'affectedUrls', count: bad.length, subjects: bad }
}

// ---------------------------------------------------------------------------
// registry
// ---------------------------------------------------------------------------

/**
 * Check id → the magnitude predicate.
 *
 * One entry per registered detector — currently eight.
 *
 * This doc comment previously said ONPAGE-012 "is deliberately absent: … no detector is
 * registered for it yet, so no manifest may reference it". Every clause was false by the
 * time anyone read it: the entry below registers it, DERIVED_CHECKS registers the
 * detector, and fixtures/eval/tornado/manifest.json references it. Kept as a note
 * because a JSDoc that contradicts the object it is attached to is worse than none.
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
 * A THIN WRAPPER over the detector's own analysis, deliberately. This used to be a
 * second, independent implementation, and the two disagreed on three separate axes:
 * threshold (0.35 `<=` here vs 0.5 strict `<` there), grouping (this one required
 * `page.templateGroup` and skipped every page without one, so it returned 0 forever on
 * any real crawl), and zero-word pages (this one scored them 1 = pristine, the detector
 * 0 = maximally dominated — exactly opposite).
 *
 * Duplication only buys independence when the two authors reason differently. Both of
 * these were written by the same author from the same misunderstanding, so it bought a
 * disagreement rather than a cross-check — and a gate whose two halves disagree carries
 * no signal. ONPAGE-012 is a WEAKER case for duplication than robots was: robots had an
 * external normative spec (RFC 9309) a second author could read independently, whereas
 * the ONPAGE-012 rubric row states no threshold at all, so a "second reading" cannot
 * converge, only diverge. It also never implemented the rubric's own howToTest — it took
 * no GSC input and computed no impression-earning rate.
 *
 * Independence now lives in tests/unit/derived-analyses.test.ts's spec-derived suite,
 * written from the decision record and §9's documented data points rather than from the
 * analysis code. What still carries signal in the gate is (a) the hand-derived
 * must_find magnitude in fixtures/eval/tornado/manifest.json, reviewed by a human, and
 * (b) scenario GENERATION staying independent of the analysis.
 */
export function templateDominatedPages(input: PredicateInput): MagnitudeReading {
  const analysis = contentToTemplateRatio(input.crawl?.pages ?? [], input.gsc ?? [])
  return {
    metric: 'affectedUrls',
    count: analysis.dominatedPages,
    subjects: analysis.dominatedUrls,
  }
}

export function readMagnitude(checkId: string, input: PredicateInput): MagnitudeReading | null {
  const fn = MAGNITUDE_PREDICATES[checkId]
  return fn ? fn(input) : null
}
