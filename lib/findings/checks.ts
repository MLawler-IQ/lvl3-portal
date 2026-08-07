// The first seven detector-backed checks. This is the beginning of phase 3's
// derived-analysis layer, landed with the eval harness because the harness needs
// real detectors to gate and the detectors need the harness's fixtures to be
// trustworthy — they keep each other honest.
//
// Detectors are written from docs/rubric/rubric.json's how-to-test text and the
// documented Tornado audit (AUTOMATION-CONTEXT.md §9), NOT from each other — that
// separation is half of the eval's circularity mitigation.
//
// A detector states facts with magnitudes; it does not decide importance. Severity
// lives in the rubric, prioritisation in the scoring stage.

import type { CheckDefinition, Finding, StationBundle } from './types'
// The derived-analysis detectors live in ./detectors and wrap pure functions from
// ./analyses. Registered here so the engine, the eval gate and the scoring stage
// all see one list of checks.
import { DERIVED_CHECKS } from './detectors'
import type { CrawlPageRecord } from '@/lib/tools/crawl-record'
// robots.txt semantics live in ONE place, shared with the eval predicates. The two
// implementations that used to exist disagreed on three probes; see
// docs/robots-parser-findings.md. Independence from the detector now lives in
// tests/unit/robots.test.ts, which is written from RFC 9309 rather than from the
// implementation — a spec-derived test suite, not a duplicate implementation.
import { blockedUrls, blocksSiteRoot, disallowPatterns } from '@/lib/robots'
import {
  coverageCaveat,
  coverageReason,
  coverageStatus,
  partitionMeasured,
} from './coverage'
import type { GSCRow } from '@/lib/tools-gsc'

const cap = <T>(arr: T[], n = 5): T[] => arr.slice(0, n)

// ── TECH-001: robots.txt does not block Googlebot ─────────────────────────────

const tech001: CheckDefinition = {
  id: 'TECH-001',
  requires: ['crawl'],
  evaluate: (s: StationBundle): Finding => {
    const data = s.crawl!.ok ? s.crawl!.data : null
    const site = data?.site ?? { robotsTxt: null, sitemapUrls: [], robotsTxtStatus: 'not-fetched' as const }
    const pages = data?.pages ?? []
    const txt = site.robotsTxt

    // "We never fetched it" is not "the site serves none". This returned `pass` for
    // both, so an ingester that could not reach robots.txt produced a clean bill of
    // health on a check that is critical and auto-tier.
    if (site.robotsTxtStatus === 'not-fetched') {
      return {
        checkId: 'TECH-001',
        status: 'not_run',
        evidence: { detail: 'robots.txt was never fetched, so nothing could be evaluated.' },
        source: 'crawl',
        reason: 'the crawl did not fetch robots.txt',
      }
    }

    if (txt == null) {
      // Fetched, and the site genuinely serves none. That blocks nothing.
      return {
        checkId: 'TECH-001',
        status: 'pass',
        evidence: { detail: 'No robots.txt served; nothing is blocked.' },
        source: 'crawl',
      }
    }

    // Which crawled URLs does a Googlebot-applicable Disallow actually block?
    //
    // This used to ask only whether the SITE ROOT was disallowed, so
    // `Disallow: /services/` passed — despite the rubric note naming money pages
    // explicitly ("No Disallow on money pages, CSS or JS for Googlebot"). It also
    // reported evidence.value = 1, a yes/no dressed as a magnitude, which no
    // rubric-derived magnitude assertion could ever match.
    //
    // Found by writing the eval injectors from the rubric text rather than from
    // this file. Now it reports the blocked-URL count, which is the magnitude the
    // rubric implies and the number a client can act on.
    // `patterns` describes, `blocked` decides — they are not the same question, because
    // an `Allow:` can override a Disallow that still belongs in the evidence string.
    const patterns = disallowPatterns(txt)
    const blocked = blockedUrls(txt, pages.map((p) => p.url))

    if (blocked.length > 0) {
      return {
        checkId: 'TECH-001',
        status: 'fail',
        evidence: {
          affectedUrls: blocked.length,
          detail: `robots.txt blocks Googlebot from ${blocked.length} of ${pages.length} crawled URLs (rules: ${patterns.join(', ')}).`,
          examples: cap(blocked),
        },
        source: 'crawl',
      }
    }

    // A root block with no pages to attribute it to is still a root block.
    if (blocksSiteRoot(txt)) {
      return {
        checkId: 'TECH-001',
        status: 'fail',
        evidence: {
          affectedUrls: pages.length,
          detail: 'robots.txt disallows the site root for Googlebot.',
        },
        source: 'crawl',
      }
    }

    return {
      checkId: 'TECH-001',
      status: 'pass',
      evidence: {
        detail:
          patterns.length > 0
            ? `robots.txt blocks no crawled URL (${patterns.length} Disallow rule(s), all scoped away from crawled paths).`
            : 'robots.txt contains no Googlebot-applicable Disallow rules.',
      },
      source: 'crawl',
    }
  },
}

// ── ONPAGE-003: one H1 per page ───────────────────────────────────────────────

const onpage003: CheckDefinition = {
  id: 'ONPAGE-003',
  requires: ['crawl'],
  evaluate: (s): Finding => {
    const pages = s.crawl!.ok ? s.crawl!.data.pages : []
    // Count H1s that carry USABLE TEXT, not array entries.
    //
    // This counted h1s.length, so `[""]`, `["   "]` and an <h1> wrapping only an
    // image all read as one good heading and scored pass. Found by writing the
    // eval injectors from the rubric text instead of from this file — the exact
    // circularity the harness design exists to break. The rubric asks for "one H1
    // per page DESCRIBING PRIMARY INTENT"; an empty element describes nothing.
    const usableH1s = (p: { h1s: string[] }) => p.h1s.filter((h) => h.trim().length > 0).length
    const affected = pages.filter((p) => usableH1s(p) !== 1)
    if (affected.length === 0) {
      return {
        checkId: 'ONPAGE-003',
        status: 'pass',
        evidence: { detail: `All ${pages.length} pages carry exactly one H1 with text.` },
        source: 'crawl',
      }
    }
    // A fact with a magnitude; the scoring stage decides how loud 1-of-500 is.
    return {
      checkId: 'ONPAGE-003',
      status: 'fail',
      evidence: {
        affectedUrls: affected.length,
        detail: `${affected.length} of ${pages.length} pages do not have exactly one H1 with text.`,
        examples: cap(affected.map((p) => p.url)),
      },
      source: 'crawl',
    }
  },
}

// ── TECH-011: mobile-friendly rendering ───────────────────────────────────────

const tech011: CheckDefinition = {
  id: 'TECH-011',
  requires: ['crawl'],
  evaluate: (s): Finding => {
    const pages = s.crawl!.ok ? s.crawl!.data.pages : []
    // A page the crawl could not measure is excluded, counted and named — not scored as
    // passing. hasViewportMeta/tapTargetsOk used to be non-nullable, so an ingester that
    // cannot measure tap targets had to invent `true`, which reported `pass`.
    const { measured, unmeasured } = partitionMeasured(
      pages,
      (p) => p.hasViewportMeta !== null && p.tapTargetsOk !== null,
    )
    const affected = measured.filter((p) => !p.hasViewportMeta || !p.tapTargetsOk)
    const cov = { measured: measured.length, unmeasured: unmeasured.length, affected: affected.length }
    const caveat = coverageCaveat(unmeasured.length, pages.length, 'mobile-rendering data')
    const status = coverageStatus(cov)

    return {
      checkId: 'TECH-011',
      status,
      evidence:
        affected.length > 0
          ? {
              affectedUrls: affected.length,
              detail: `${affected.length} of ${measured.length} measured pages fail mobile viewport or tap-target sizing.${caveat}`,
              examples: cap(affected.map((p) => p.url)),
            }
          : {
              detail:
                measured.length > 0
                  ? `All ${measured.length} measured pages pass viewport and tap-target checks.${caveat}`
                  : `None of the ${pages.length} crawled pages carried mobile-rendering data.`,
            },
      source: 'crawl',
      ...(coverageReason(cov, 'mobile-rendering data') !== undefined
        ? { reason: coverageReason(cov, 'mobile-rendering data')! }
        : {}),
    }
  },
}

// ── MEAS-001: analytics installed and firing ──────────────────────────────────

const meas001: CheckDefinition = {
  id: 'MEAS-001',
  requires: ['crawl'],
  evaluate: (s): Finding => {
    const pages = s.crawl!.ok ? s.crawl!.data.pages : []
    // Where TECH-011 invented `true` and passed, this invented `false` and FAILED —
    // telling a client their measurement is off when nothing was checked. Same defect,
    // opposite direction; lib/findings/coverage.ts now settles both the same way.
    const { measured, unmeasured } = partitionMeasured(
      pages,
      (p) => p.analytics.ga4 !== null && p.analytics.gtm !== null,
    )
    const untagged = measured.filter((p) => !p.analytics.ga4 && !p.analytics.gtm)
    const caveat = coverageCaveat(unmeasured.length, pages.length, 'analytics-tag data')
    const cov = { measured: measured.length, unmeasured: unmeasured.length, affected: untagged.length }

    if (measured.length === 0) {
      return {
        checkId: 'MEAS-001',
        status: 'not_run',
        evidence: { detail: `None of the ${pages.length} crawled pages carried analytics-tag data.` },
        source: 'crawl',
        reason: 'the crawl measured no analytics tags',
      }
    }

    const share = measured.length > 0 ? untagged.length / measured.length : 0
    // Majority-untagged means measurement is broken site-wide, which gates every
    // outcome number the pipeline could ever report (the rubric weights this as
    // critical for exactly that reason).
    if (share > 0.5) {
      return {
        checkId: 'MEAS-001',
        status: 'fail',
        evidence: {
          affectedUrls: untagged.length,
          detail: `${untagged.length} of ${measured.length} measured pages carry no GA4 or GTM tag — measurement is effectively off.${caveat}`,
          examples: cap(untagged.map((p) => p.url)),
        },
        source: 'crawl',
      }
    }
    if (untagged.length > 0) {
      return {
        checkId: 'MEAS-001',
        status: 'fail',
        evidence: {
          affectedUrls: untagged.length,
          detail: `${untagged.length} of ${measured.length} measured pages are missing analytics tags.${caveat}`,
          examples: cap(untagged.map((p) => p.url)),
        },
        source: 'crawl',
      }
    }
    return {
      checkId: 'MEAS-001',
      status: coverageStatus(cov),
      evidence: { detail: `Analytics tags detected on all ${measured.length} measured pages.${caveat}` },
      source: 'crawl',
      ...(coverageReason(cov, 'analytics-tag data') !== undefined
        ? { reason: coverageReason(cov, 'analytics-tag data')! }
        : {}),
    }
  },
}

// ── ONPAGE-006: keyword cannibalisation ───────────────────────────────────────

/** Impressions below this are noise, not a competing ranking. */
const CANNIBAL_MIN_IMPRESSIONS = 50

const onpage006: CheckDefinition = {
  id: 'ONPAGE-006',
  requires: ['gsc'],
  // Zero rows must read as "couldn't look", never as "no cannibalisation" — the
  // engine's empty-station rule enforces that for every check.
  evaluate: (s): Finding => {
    const rows = s.gsc!.ok ? s.gsc!.data : []
    // Group ALL rows first, then apply the noise floor to the CLUSTER's strongest
    // row — not per row. Google suppresses the losing page in a cannibalised
    // pair, so the loser often sits below any per-row floor; dropping it row-by-
    // row hid exactly the page that proves the conflict.
    const byQuery = new Map<string, { pages: Set<string>; maxImpressions: number }>()
    for (const r of rows as GSCRow[]) {
      const q = r.query.trim().toLowerCase()
      const entry = byQuery.get(q) ?? { pages: new Set<string>(), maxImpressions: 0 }
      entry.pages.add(r.page)
      entry.maxImpressions = Math.max(entry.maxImpressions, r.impressions)
      byQuery.set(q, entry)
    }
    const clusters = Array.from(byQuery.entries()).filter(
      ([, e]) => e.pages.size >= 2 && e.maxImpressions >= CANNIBAL_MIN_IMPRESSIONS,
    )
    const worst = clusters.reduce((m, [, e]) => Math.max(m, e.pages.size), 0)
    // One 2-URL query can be a legitimate variant; a PATTERN of them — or a single
    // query with 3+ competing URLs (Tornado had one at four) — is two page
    // generations fighting.
    if (clusters.length >= 2 || worst >= 3) {
      return {
        checkId: 'ONPAGE-006',
        status: 'fail',
        evidence: {
          value: clusters.length,
          detail: `${clusters.length} queries have 2+ pages competing for the same intent (worst: ${worst} URLs on one query).`,
          examples: cap(clusters.map(([q, e]) => `"${q}" → ${e.pages.size} URLs`)),
        },
        source: 'gsc',
      }
    }
    return {
      checkId: 'ONPAGE-006',
      status: 'pass',
      evidence: {
        detail: `No pattern of queries above ${CANNIBAL_MIN_IMPRESSIONS} impressions ranks multiple URLs.`,
      },
      source: 'gsc',
    }
  },
}

// ── LOCAL-016: service-area radius coherence ──────────────────────────────────
//
// THIS DETECTOR DOES NOT YET TEST WHAT ITS RUBRIC ROW SAYS, AND THAT IS RECORDED RATHER
// THAN QUIETLY LIVED WITH.
//
// The rubric's howToTest is "GBP service areas + real business address vs geography
// targeted by location pages", and its note — added after the pilot — is explicit: "An
// SAB ranks by proximity to its REAL address, not declared areas." The body below tests
// SET MEMBERSHIP against the declared areas, which is a different question. On the
// documented Tornado P1 (a Sherman Oaks profile serving pages for Orange County, 45-65
// miles away) a profile that had simply DECLARED Orange County would be reported as
// coherent — the check would turn one of §9's five P1s green. Declaring an area is a
// claim about intent; ranking is a fact about distance.
//
// WHAT A REAL PROXIMITY TEST WOULD NEED. Two of the three now exist; the blocker has
// moved, and pretending otherwise would send the next reader looking for a geocoder that
// is already here:
//   1. An anchor with coordinates. Location.storefrontAddress is a postal address, not a
//      lat/lng, and Google's own field doc says it "should not be set for locations of
//      type CUSTOMER_LOCATION_ONLY" — i.e. the address is structurally absent for exactly
//      the service-area businesses this check is about. Location.latlng is user-provided,
//      only returned when it was accepted at create time, and writable only by approved
//      clients, so it is not a substitute. STILL OPEN: for a hidden-address SAB there may
//      be no anchor to geocode at all, which is a not_run, not a distance.
//   2. Coordinates for each page's target. SOLVED, as of 2026-08-07: lib/geo/distance.ts
//      wraps the Geocoding and Distance Matrix APIs (both enabled on this Cloud project)
//      behind a discriminated union in which coordinates exist only on the `ok` branch, so
//      a failed or ambiguous lookup cannot become a number. It also reports a precision
//      scale, which matters more than it sounds: "Orange County, CA" geocodes to an AREA
//      centroid 46.4 miles from Sherman Oaks while Santa Ana — a city inside it — is 43.5,
//      so an `area` result must weaken or withhold a verdict rather than quote a confident
//      distance. haversineMiles() is free and screens; driveDistance() costs a request and
//      is reserved for pairs whose verdict turns on the number.
//   3. A way to get either into a check. STILL THE BLOCKER, and it is an interface change,
//      not a wiring one. `evaluate` is `(stations: StationBundle) => Finding`
//      (lib/findings/types.ts:64): synchronous, so it cannot geocode; and its only GBP
//      input is a `GbpProfileRecord` (lib/tools/crawl-record.ts:171), which has no
//      coordinate field and no per-page distance field to carry a precomputed answer. A
//      radius to compare against has the same shape of problem — `clients.service_radius`
//      exists, but no client fact can reach a detector at all (docs/CONTEXT-LIBRARY.md §1).
//      The honest place to do the measuring is lib/stations/gbp.ts, which is already async
//      and already talks to Google; it needs somewhere on the record to put the result.
//
// WHY THE SET-MEMBERSHIP BODY IS STILL HERE. Replacing it is a rubric decision
// (CONTEXT-LIBRARY §7 open decision 3) and the eval harness is the thing that encodes the
// rubric: fixtures/eval/healthy/manifest.json lists LOCAL-016 under must_pass with
// location pages targeting DECLARED areas, and fixtures/eval/tornado/manifest.json lists
// it under must_find with a magnitude computed by lib/eval/injectors/predicates.ts using
// the same membership rule. Any honest replacement changes both fixtures, two manifests
// and a scoring snapshot — and re-baselining those is a reviewed step, deliberately not an
// automatic one (AUTOMATION-PLAN.md slice 6). Changing the detector alone would leave the
// spec asserting one thing and the code doing another, which is worse than either.
//
// WHAT IS CLOSED HERE, AND WHY IT TOOK TWO GUARDS RATHER THAN ONE.
//
// Membership is only a question at all when the profile has actually stated a geography.
// It states one in exactly two places — the city it operates from, and the areas it
// declares — and the check needs BOTH, because each covers a hole the other leaves open:
//
//   NO BUSINESS CITY. The city is the only thing in the record that stands in for the real
//   address, and the rubric says proximity to that address is the whole test. It is empty
//   for a service-area business whose address the API does not expose, which is correct
//   configuration rather than a defect.
//
//   NO DECLARED SERVICE AREAS. This is the one that shipped a live fabricated fail, and it
//   is not an edge case: lib/connectors/gbp.ts:307 derives `serviceAreas` from
//   Location.serviceArea, and the Business Information API returns that object ONLY for a
//   service-area business — so `serviceAreas: []` is what EVERY storefront client produces.
//   With an empty set, "outside the service area" degenerates into "anywhere but the
//   business's own city", and a Pasadena plumber with pages for Glendale and Burbank —
//   eight and twelve miles away, both plainly rankable — scored a verticalCritical FAIL
//   with affectedUrls: 2 attached to make it look measured. An empty declaration is
//   "nothing was declared", never "serves nowhere"; Google also caps the list at 20 places,
//   so even a full list is a floor on coverage rather than a boundary.
//
// Both are `not_run` with their own sentence. Refusing here is the only place either can
// be caught: the station is `ok` and non-empty, so the engine's rules cannot see them.
//
// WHAT THIS CHECK STILL CANNOT DO, STATED SO NOBODY RE-DERIVES IT. The measuring
// instrument for the real test now exists — lib/geo/distance.ts exposes geocode(),
// haversineMiles() and driveDistance() with typed failures and a precision scale, and both
// Google APIs are enabled. It cannot be called from here. `evaluate` is
// `(stations: StationBundle) => Finding` (lib/findings/types.ts:64) — synchronous, and its
// only GBP input is a `GbpProfileRecord`, which carries no coordinates and no field a
// distance could be attached to. So a proximity test needs one of two interface changes,
// neither of which is a change to this file: an async check signature, or coordinates and
// per-page distances measured in lib/stations/gbp.ts and carried on the record. Until then
// this check measures declared-set membership and says so in its own evidence, rather than
// claiming a proximity result it did not compute.

const normGeo = (v: string): string => v.trim().toLowerCase()

const local016: CheckDefinition = {
  id: 'LOCAL-016',
  requires: ['crawl', 'gbp'],
  evaluate: (s): Finding => {
    const pages = s.crawl!.ok ? s.crawl!.data.pages : []
    const gbp = s.gbp!.ok ? s.gbp!.data : null
    const declared = (gbp?.serviceAreas ?? []).map(normGeo).filter((a) => a.length > 0)
    const served = new Set(declared)
    const home = normGeo(gbp?.businessCity ?? '')

    // NO STATED GEOGRAPHY, NO VERDICT — in either direction.
    if (home.length === 0 || served.size === 0) {
      const reason =
        home.length === 0 && served.size === 0
          ? 'the GBP profile exposes neither a business city nor a declared service area, so there is no proximity anchor and nothing to test page geography against'
          : home.length === 0
            ? 'the GBP profile exposes no business city, so there is no proximity anchor'
            : 'the GBP profile declares no service areas, so "outside the service area" would only mean "not the business\'s own city"'
      const detail =
        home.length === 0
          ? `The profile exposes no business city, so there is no real address to measure the ${pages.length} crawled URLs' target geography against.` +
            (served.size === 0
              ? ' It declares no service areas either, so the profile states no geography at all.'
              : ' Declared service areas alone are a claim about coverage, not evidence the profile can rank there.')
          : `The profile declares no service areas — the Business Information API returns them only for a service-area business, so this is the normal state for a storefront profile — leaving only the business's own city (${gbp?.businessCity}). Treating every other target as out of area would fault the ${pages.length} crawled URLs against a boundary nobody drew.`
      return {
        checkId: 'LOCAL-016',
        status: 'not_run',
        evidence: { detail },
        source: 'derived',
        reason,
      }
    }

    const locationPages = pages.filter((p): p is CrawlPageRecord & { targetGeo: string } =>
      Boolean(p.targetGeo),
    )
    const incoherent = locationPages.filter((p) => {
      const geo = normGeo(p.targetGeo)
      // Targeting the business's own city is always coherent, listed or not.
      return geo !== home && !served.has(geo)
    })

    // Nothing to test is NOT a clean bill of health.
    //
    // targetGeo is `string | null` and the only code that derives it is
    // lib/ingest/sitebulb/geo.ts, which is unwired — so on the first real crawl every
    // page has targetGeo: null, locationPages is empty, incoherent is empty, and this
    // returned `pass` with "No location pages found". That is §17 failure mode 1
    // exactly: "we did not look" rendered as "it is fine", on a check that is one of
    // §9's five documented Tornado P1s. The crawl station is non-empty, so the engine's
    // empty-station rule cannot catch this — it has to be caught in the check body.
    // Mirrors what the ONPAGE-012 detector already does for the same situation.
    if (locationPages.length === 0) {
      return {
        checkId: 'LOCAL-016',
        status: 'not_run',
        evidence: {
          detail: `No page carries a targetGeo, so none of the ${pages.length} crawled URLs could be tested against the profile's service area.`,
        },
        source: 'derived',
        reason: 'no page carries a targetGeo to compare against the service area',
      }
    }

    // THIS SENTENCE IS FROZEN, AND NOT BY PREFERENCE. It would read better as "target a
    // city the profile neither operates from nor lists among the N service areas it
    // declares" — "the profile's service area" invites a reader to hear a measured
    // coverage boundary where only a declaration was tested. But
    // fixtures/eval/tornado/scoring.snapshot.json stores this exact string and
    // tests/unit/eval-snapshot.test.ts asserts the serialized snapshot byte-for-byte, so
    // changing the wording re-baselines a gate — a reviewed step, deliberately not an
    // automatic one (AUTOMATION-PLAN.md slice 6). lib/eval/snapshot.ts:54 intends `detail`
    // to be un-asserted prose; the byte-identity test is stricter than that design, and
    // reconciling the two belongs with whoever owns the harness. The magnitude is real
    // either way, and the pass branch below — which no snapshot pins — says what was
    // actually measured.
    if (incoherent.length > 0) {
      return {
        checkId: 'LOCAL-016',
        status: 'fail',
        evidence: {
          affectedUrls: incoherent.length,
          detail: `${incoherent.length} of ${locationPages.length} location pages target geography outside the profile's service area.`,
          examples: cap(incoherent.map((p) => `${p.url} → ${p.targetGeo}`)),
        },
        source: 'derived',
      }
    }
    return {
      checkId: 'LOCAL-016',
      status: 'pass',
      evidence: {
        detail: `All ${locationPages.length} location pages target the business's own city or one of the ${served.size} areas the profile declares it serves. That is membership in a declaration, not a proximity measurement — it does not establish that the profile can rank in them.`,
      },
      source: 'derived',
    }
  },
}

// ── LOCAL-003: GBP completeness ───────────────────────────────────────────────

const local003: CheckDefinition = {
  id: 'LOCAL-003',
  requires: ['gbp'],
  evaluate: (s): Finding => {
    const gbp = s.gbp!.ok ? s.gbp!.data : null
    if (!gbp) {
      return {
        checkId: 'LOCAL-003',
        status: 'not_run',
        evidence: { detail: 'GBP profile unavailable.' },
        source: 'gbp',
        reason: 'GBP profile unavailable',
      }
    }
    // trim(): an ingester that defaults absent API fields to '' or '  ' must not
    // read as complete. Real placeholder validation ('N/A') belongs to the
    // phase-3 ingest boundary; whitespace is the cheap floor we hold here.
    const blank = (v: string | null) => !v || v.trim().length === 0
    const missing: string[] = []
    if (!gbp.hoursComplete) missing.push('hours')
    if (blank(gbp.phone)) missing.push('phone')
    if (blank(gbp.websiteUri)) missing.push('website')
    if (blank(gbp.description)) missing.push('description')
    // THIS CLAUSE NOW HAS A LIVE SOURCE, and the correction is worth recording because
    // the comment that used to sit here asserted the opposite as established fact.
    //
    // It said photos "are behind the Media API, which this portal is not authorised for",
    // and lib/stations/gbp.ts recorded `photoCount` as unobtainable on that basis and
    // refused to emit any record at all. That was never checked: the Google My Business
    // v4 API is enabled on this Cloud project with 250,000 requests/day granted and the
    // OAuth token already carries business.manage — verified in the console 2026-08-07.
    // lib/connectors/gbp-reviews.ts reads it (media.list, counting mediaFormat === 'PHOTO',
    // NOT totalMediaItemCount, which includes videos).
    //
    // What has NOT changed is why the station still refuses when that read fails: a
    // placeholder count would make this line report "missing photos" about a client whose
    // photos nobody looked at — a fabricated fail dressed in a real magnitude. The gate
    // moved from "no API supplies this" to "this run did not read it"; the rule is the same.
    //
    // Deleting the clause would be worse in a different way: it silently narrows a rubric
    // criterion that names photos, and lib/eval/injectors/predicates.ts counts photos when
    // computing this check's expected magnitude, so the eval harness and the detector would
    // disagree about what LOCAL-003 means. The narrowing belongs in the criterion
    // declaration slice 5 adds (CheckDefinition.criteria), where it is stated rather than
    // inferred.
    if (gbp.photoCount < 3) missing.push('photos')
    // THE §9 FALSE POSITIVE, FIXED AT THE DETECTOR: a service-area business with a
    // hidden storefront address is configured CORRECTLY — Google tells SABs to
    // hide it. Docking completeness for it faulted a client for doing the right
    // thing, and "an automated audit that faults correct configuration destroys
    // trust in every other finding." Only a storefront business missing its
    // address is incomplete. The healthy fixture pins this behaviour.
    if (!gbp.isServiceAreaBusiness && !gbp.storefrontAddress) missing.push('storefront address')

    if (missing.length > 0) {
      return {
        checkId: 'LOCAL-003',
        status: 'fail',
        evidence: {
          value: missing.length,
          detail: `GBP profile incomplete: missing ${missing.join(', ')}.`,
        },
        source: 'gbp',
      }
    }
    return {
      checkId: 'LOCAL-003',
      status: 'pass',
      evidence: {
        detail: gbp.isServiceAreaBusiness
          ? 'GBP profile complete (service-area business; hidden address is correct).'
          : 'GBP profile complete.',
      },
      source: 'gbp',
    }
  },
}

/** Every detector-backed check. The eval manifest loader validates against this. */
export const CHECKS: CheckDefinition[] = [
  tech001,
  onpage003,
  tech011,
  meas001,
  onpage006,
  local016,
  local003,
  // ONPAGE-012 (content-to-template ratio). Registering it changes the findings
  // set for every fixture, which deliberately invalidates the scoring snapshots —
  // re-baselining them is a reviewed step, not an automatic one.
  ...DERIVED_CHECKS,
]

export const CHECK_IDS = new Set(CHECKS.map((c) => c.id))

// A duplicated check id would let scoring's byId map silently keep only the last
// finding — a benign duplicate could mask a real fail. Refuse to load instead.
if (CHECK_IDS.size !== CHECKS.length) {
  throw new Error('Duplicate check id registered in lib/findings/checks.ts')
}
