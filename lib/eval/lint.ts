// The fixture linter: rejects PHYSICALLY IMPOSSIBLE eval fixtures.
//
// Why this file exists. The approved plan's first sketch generated fixtures by
// sampling independent checks to violate, and the adversarial critique of it found
// the flaw: independently sampled defects produce data no real site could emit —
// GSC rows for URLs the crawl never saw, robots-blocked pages carrying rich
// impression data, a 404 that is somehow still earning clicks. A detector tuned
// against impossible data is tuned against nothing, and worse, an impossible
// fixture makes a CORRECT pipeline look broken.
//
// The rule that matters most is the last family: MANIFEST-VS-DATA AGREEMENT. A
// generator whose manifest disagrees with its own station data is worse than no
// fixture at all — it turns the eval gate permanently red for reasons that have
// nothing to do with the pipeline, and permanently red gates get deleted rather
// than fixed. So the linter recomputes every asserted magnitude from the data with
// the rubric-derived predicates and refuses the fixture if they disagree.
//
// It returns structured violations and never throws: a linter that throws on the
// first problem reports one violation per run, and the caller wants the list.

import { CHECK_IDS } from '@/lib/findings/checks'
import type { StationBundle } from '@/lib/findings/types'
import type { CrawlPageRecord, CrawlStationData, GbpProfileRecord } from '@/lib/tools/crawl-record'
import type { GSCRow } from '@/lib/tools-gsc'
import type { EvalManifest } from './manifest'
import {
  googlebotDisallowRules,
  readMagnitude,
  robotsPathBlocked,
  type PredicateInput,
} from './injectors/predicates'

export type LintRule =
  | 'gsc-page-not-in-crawl'
  | 'gsc-row-impossible'
  | 'crawl-record-impossible'
  | 'blocked-page-has-impressions'
  | 'error-page-has-impressions'
  | 'duplicate-crawl-url'
  | 'same-origin-canonical-missing'
  | 'implausible-target-geo'
  | 'geo-page-without-profile'
  | 'magnitude-mismatch'
  | 'magnitude-unverifiable'
  | 'must-not-find-violated-by-data'
  | 'must-pass-violated-by-data'
  | 'unknown-check-id'
  | 'empty-must-not-find'
  | 'manifest-conflict'
  | 'crawl-station-unusable'

export interface LintViolation {
  rule: LintRule
  /** The URL, query, check id or field the violation is about. */
  subject: string
  detail: string
}

export interface LintReport {
  ok: boolean
  violations: LintViolation[]
  /** Rules that could not run because the station they read was absent or failed. */
  skipped: string[]
}

export interface LintInput {
  stations: StationBundle
  manifest: EvalManifest
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

/** 'City, ST' — the shape CrawlPageRecord.targetGeo and GBP service areas use. */
const CITY_STATE = /^[A-Z][A-Za-z.'’-]+(?: [A-Z][A-Za-z.'’-]+)*, [A-Z]{2}$/

function pathOf(url: string): string | null {
  const m = /^[a-z][a-z0-9+.-]*:\/\/[^/]+(\/[^\s]*)?$/i.exec(url)
  if (!m) return null
  return m[1] ?? '/'
}

function originOf(url: string): string | null {
  const m = /^([a-z][a-z0-9+.-]*:\/\/[^/]+)/i.exec(url)
  return m ? m[1] : null
}

/** Match GSC page URLs to crawl URLs tolerantly: fragments and a single trailing
 *  slash are not identity, but a different path is. */
function urlKeys(url: string): string[] {
  const noFragment = url.replace(/#.*$/, '')
  const trimmed = noFragment.replace(/\/+$/, '')
  return trimmed === '' ? [noFragment] : [noFragment, trimmed, `${trimmed}/`]
}

function unwrap<T>(result: StationBundle[keyof StationBundle] | undefined): T | null {
  if (!result || !result.ok) return null
  return result.data as unknown as T
}

// ---------------------------------------------------------------------------
// the linter
// ---------------------------------------------------------------------------

export function lintFixture(input: LintInput): LintReport {
  const violations: LintViolation[] = []
  const skipped: string[] = []
  const push = (rule: LintRule, subject: string, detail: string): void => {
    violations.push({ rule, subject, detail })
  }

  const crawl = unwrap<CrawlStationData>(input.stations.crawl)
  const gsc = unwrap<GSCRow[]>(input.stations.gsc)
  const gbp = unwrap<GbpProfileRecord>(input.stations.gbp)
  const { manifest } = input

  // ---- manifest self-coherence (cheap, and mirrors the loader's rules) ----

  const findIds = manifest.must_find.map((e) => e.id)
  for (const [name, list] of [
    ['must_find', findIds],
    ['must_not_find', manifest.must_not_find],
    ['must_pass', manifest.must_pass],
  ] as const) {
    for (const id of list) {
      if (list.indexOf(id) !== list.lastIndexOf(id)) {
        push('manifest-conflict', id, `appears more than once in ${name}`)
        break
      }
    }
  }
  for (const id of findIds) {
    if (manifest.must_not_find.includes(id)) {
      push('manifest-conflict', id, 'is in both must_find and must_not_find — unsatisfiable')
    }
    if (manifest.must_pass.includes(id)) {
      push('manifest-conflict', id, 'is in both must_find and must_pass — unsatisfiable')
    }
  }
  if (manifest.must_not_find.length === 0) {
    push(
      'empty-must-not-find',
      manifest.case,
      'every fixture must carry at least one false-positive assertion',
    )
  }
  for (const id of [...findIds, ...manifest.must_not_find, ...manifest.must_pass]) {
    if (!CHECK_IDS.has(id)) {
      push('unknown-check-id', id, 'no registered detector — a manifest may never demand what nothing can produce')
    }
  }

  // ---- crawl-side physical plausibility ----

  if (!crawl || crawl.pages.length === 0) {
    push(
      'crawl-station-unusable',
      manifest.case,
      'the crawl station is absent, failed, or has no pages — nothing about this fixture can be verified',
    )
    skipped.push('all crawl-dependent rules')
    return { ok: violations.length === 0, violations, skipped }
  }

  const seenUrls = new Set<string>()
  const crawlIndex = new Map<string, CrawlPageRecord>()
  for (const page of crawl.pages) {
    if (seenUrls.has(page.url)) {
      push('duplicate-crawl-url', page.url, 'the same URL appears twice in the crawl')
    }
    seenUrls.add(page.url)
    for (const key of urlKeys(page.url)) crawlIndex.set(key, page)
  }

  const disallow = googlebotDisallowRules(crawl.site)
  const blocked = new Set<string>()
  for (const page of crawl.pages) {
    const path = pathOf(page.url)
    if (path === null) continue
    if (disallow.length > 0 && robotsPathBlocked(path, disallow)) blocked.add(page.url)
    if (/\bnoindex\b/i.test(page.robotsMeta)) blocked.add(page.url)
  }

  for (const page of crawl.pages) {
    if (page.targetGeo !== null) {
      if (!CITY_STATE.test(page.targetGeo)) {
        push(
          'implausible-target-geo',
          page.url,
          `targetGeo "${page.targetGeo}" is not a plausible 'City, ST' string`,
        )
      }
      if (!gbp) {
        push(
          'geo-page-without-profile',
          page.url,
          'a location page targets a geography, but the fixture carries no GBP profile to judge coherence against',
        )
      }
    }
    if (page.canonical !== null) {
      const sameOrigin = originOf(page.canonical) === originOf(page.url)
      // A cross-origin canonical is physically real (a botched migration leaves
      // canonicals on the retired domain), so only same-origin ones must resolve.
      if (sameOrigin && !urlKeys(page.canonical).some((k) => crawlIndex.has(k))) {
        push(
          'same-origin-canonical-missing',
          page.url,
          `canonical ${page.canonical} is on this origin but is not in the crawl`,
        )
      }
    }
    if (page.uniqueWordCount > page.wordCount) {
      push(
        'crawl-record-impossible',
        page.url,
        `uniqueWordCount ${page.uniqueWordCount} exceeds wordCount ${page.wordCount}`,
      )
    }
  }

  // ---- GSC-side physical plausibility ----

  if (!gsc) {
    skipped.push('gsc rules (station absent or failed)')
  } else {
    for (const row of gsc) {
      const found = urlKeys(row.page).some((k) => crawlIndex.has(k))
      if (!found) {
        push(
          'gsc-page-not-in-crawl',
          row.page,
          `GSC row for query "${row.query}" points at a URL the crawl never saw — no real site emits impressions for a page that does not exist`,
        )
        continue
      }
      if (row.impressions < 0 || row.clicks < 0) {
        push('gsc-row-impossible', row.page, `negative clicks/impressions for "${row.query}"`)
      }
      if (row.clicks > row.impressions) {
        push(
          'gsc-row-impossible',
          row.page,
          `${row.clicks} clicks on ${row.impressions} impressions for "${row.query}"`,
        )
      }
      if (row.position < 1) {
        push('gsc-row-impossible', row.page, `position ${row.position} for "${row.query}" is below 1`)
      }
      if (row.impressions <= 0) continue

      const page = urlKeys(row.page)
        .map((k) => crawlIndex.get(k))
        .find((p): p is CrawlPageRecord => p !== undefined)
      if (page && blocked.has(page.url)) {
        push(
          'blocked-page-has-impressions',
          row.page,
          `robots-blocked or noindexed, yet carries ${row.impressions} impressions for "${row.query}"`,
        )
      }
      if (page && page.status >= 400) {
        push(
          'error-page-has-impressions',
          row.page,
          `crawled as HTTP ${page.status}, yet carries ${row.impressions} impressions for "${row.query}"`,
        )
      }
    }
  }

  // ---- manifest vs data: the rule this linter exists for ----

  const predicateInput: PredicateInput = {
    crawl,
    ...(gsc ? { gsc } : {}),
    ...(gbp ? { gbp } : {}),
  }

  for (const entry of manifest.must_find) {
    const reading = readMagnitude(entry.id, predicateInput)
    if (!reading) {
      push(
        'magnitude-unverifiable',
        entry.id,
        'no rubric-derived predicate for this check, so its asserted magnitude cannot be checked against the data',
      )
      continue
    }
    if (reading.metric !== entry.magnitude.metric) {
      push(
        'magnitude-mismatch',
        entry.id,
        `manifest asserts evidence.${entry.magnitude.metric}, but the rubric's natural unit for this check is ${reading.metric}`,
      )
      continue
    }
    const band = Math.abs((entry.magnitude.expected * entry.magnitude.tolerancePct) / 100)
    const within =
      reading.count >= entry.magnitude.expected - band &&
      reading.count <= entry.magnitude.expected + band
    if (!within) {
      push(
        'magnitude-mismatch',
        entry.id,
        `manifest asserts ${entry.magnitude.metric} ≈ ${entry.magnitude.expected} ±${entry.magnitude.tolerancePct}%, but the station data contains ${reading.count} (${reading.subjects.slice(0, 3).join(', ')}${reading.subjects.length > 3 ? ', …' : ''})`,
      )
    }
  }

  // A must_not_find / must_pass whose defect is actually PRESENT in the data is
  // the same class of error in the other direction: the manifest demands a clean
  // result from dirty data, which no correct pipeline can deliver.
  for (const id of manifest.must_not_find) {
    const reading = readMagnitude(id, predicateInput)
    if (reading && reading.count > 0) {
      push(
        'must-not-find-violated-by-data',
        id,
        `listed as must_not_find, but the data genuinely violates it ${reading.count}x (${reading.subjects.slice(0, 3).join(', ')})`,
      )
    }
  }
  for (const id of manifest.must_pass) {
    if (manifest.must_not_find.includes(id)) continue // already reported above
    const reading = readMagnitude(id, predicateInput)
    if (reading && reading.count > 0) {
      push(
        'must-pass-violated-by-data',
        id,
        `listed as must_pass, but the data genuinely violates it ${reading.count}x (${reading.subjects.slice(0, 3).join(', ')})`,
      )
    }
  }

  return { ok: violations.length === 0, violations, skipped }
}

/** Convenience for test output and CI logs. */
export function formatLintReport(report: LintReport): string {
  if (report.ok) return 'fixture lint: clean'
  return report.violations.map((v) => `[${v.rule}] ${v.subject}: ${v.detail}`).join('\n')
}
