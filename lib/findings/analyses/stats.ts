// Tiny numeric helpers shared by the derived analyses.
//
// Deliberately local rather than a dependency: median-of-a-number-array is four
// lines, and the repo rule is no new npm packages.

/** Median of a numeric list. Even lengths average the two middle values. */
export function median(values: number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

/** Arithmetic mean. Zero for an empty list. */
export function mean(values: number[]): number {
  if (values.length === 0) return 0
  return values.reduce((sum, v) => sum + v, 0) / values.length
}

/** A share (0-1) as a whole percentage, for the human-readable detail strings. */
export function pct(share: number): number {
  return Math.round(share * 100)
}

/**
 * Fraction by which two values differ, relative to the larger magnitude.
 *
 * Symmetric on purpose: "the earning cohort's median is 8% away from the
 * invisible cohort's" must mean the same thing whichever cohort is named first,
 * because the question being asked is whether the two are distinguishable, not
 * which is bigger. Two zeros are identical, not undefined.
 */
export function relativeGap(a: number, b: number): number {
  const scale = Math.max(Math.abs(a), Math.abs(b))
  if (scale === 0) return 0
  return Math.abs(a - b) / scale
}
