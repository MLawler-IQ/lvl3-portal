// One rule for "the crawl could not measure this", shared by every check that reads a
// signal an ingester might not be able to supply.
//
// WHY THIS EXISTS. A fresh verification pass found the four-state model was airtight at
// the STATION level — a failed or empty station correctly forces `not_run` — and leaking
// at the FIELD level, where a signal the crawl never measured is indistinguishable from a
// measured value. `hasViewportMeta` and `tapTargetsOk` were non-nullable booleans, so an
// ingester that cannot measure tap targets had to invent one, and `true` yields `pass`.
// `analytics.ga4`/`gtm` had the same shape pointing the other way: invented `false`
// yields `fail`.
//
// So the directions were inconsistent across checks for no stated reason — TECH-011
// defaulted to a false NEGATIVE (clean bill of health on unmeasured data, §17 failure
// mode 1) while MEAS-001 defaulted to a false POSITIVE (telling a client their analytics
// are broken when nobody looked). Both are wrong, and picking one direction site by site
// is how that inconsistency arose. The rule belongs in one place.
//
// THE RULE. Unmeasured pages are excluded from the judgement, counted, and named:
//
//   a real defect          -> `fail`. A found defect outranks a coverage caveat, and the
//                            caveat still rides in the evidence detail.
//   nothing measurable     -> `not_run`. Never `pass`: "we did not look" must not render
//                            as "it is fine".
//   clean, some unmeasured -> `degraded`. The ratio ran, but the coverage claim behind
//                            `pass` does not hold.
//   clean, all measured    -> `pass`. The only state that asserts full coverage.
//
// This is the same shape the ONPAGE-012 detector arrived at independently for its
// unmeasured word counts; generalised here so the next check does not have to re-derive
// it, and so the direction cannot silently differ between two checks again.

import type { FindingStatus } from './types'

export interface CoverageInput {
  /** Items the crawl actually measured. */
  measured: number
  /** Items it did not. Excluded from the judgement, never treated as a value. */
  unmeasured: number
  /** Measured items that fail the check. */
  affected: number
}

/**
 * The status a check should report given its measurement coverage.
 *
 * Order matters and is deliberate: a defect wins over a coverage caveat, and
 * nothing-measured wins over everything except a defect found in spite of it.
 */
export function coverageStatus(input: CoverageInput): FindingStatus {
  if (input.affected > 0) return 'fail'
  if (input.measured === 0) return 'not_run'
  if (input.unmeasured > 0) return 'degraded'
  return 'pass'
}

/**
 * The sentence naming the excluded items, or '' when nothing was excluded.
 *
 * Always appended rather than conditionally omitted: silently dropping unmeasured items
 * is the failure this module exists to prevent, so the count is part of the finding a
 * human reads, not an internal detail.
 */
export function coverageCaveat(unmeasured: number, total: number, what: string): string {
  if (unmeasured <= 0) return ''
  return ` ${unmeasured} of ${total} pages carried no ${what} and were excluded.`
}

/** The `reason` a degraded or not_run finding should carry. */
export function coverageReason(input: CoverageInput, what: string): string | undefined {
  if (input.affected > 0) return undefined
  if (input.measured === 0) return `no page carried ${what}, so nothing could be judged`
  if (input.unmeasured > 0) return `${input.unmeasured} page(s) carried no ${what}`
  return undefined
}

/** Split a list on whether the crawl measured the signal this check needs. */
export function partitionMeasured<T>(
  items: readonly T[],
  isMeasured: (item: T) => boolean,
): { measured: T[]; unmeasured: T[] } {
  const measured: T[] = []
  const unmeasured: T[] = []
  for (const item of items) (isMeasured(item) ? measured : unmeasured).push(item)
  return { measured, unmeasured }
}
