// Visibility cohorts — split the crawled pages into the ones search actually
// shows and the ones it never does, then compare them on the signals we can
// measure.
//
// THE POINT OF THIS FILE IS THAT IT CAN RETURN "NO DIFFERENCE".
//
// §9's most useful output was a negative result. The working hypothesis going in
// was that Tornado's invisible pages were starved of internal links. The cohort
// split killed it: median inbound internal links were ~186 for BOTH cohorts, and
// content length was near-identical. That is not a failed analysis — it is what
// redirected the recommendation away from an internal-linking project (weeks of
// work, no mechanism) and towards consolidating a duplicated page generation. It
// also explained the shape of the site: a mega-menu linking everything to
// everything means internal linking signals no priority at all, so there is no
// priority to redistribute.
//
// So this analysis reports `indistinguishable` per metric and `allIndistinguishable`
// overall, as first-class results with the same standing as a difference. An
// analysis that could only report differences would have produced an internal
// linking project here, and it would have been wrong.
//
// One guard: a cohort with no pages in it proves nothing. `allIndistinguishable`
// is only ever true when BOTH cohorts have members and at least one metric was
// compared — the same rule the check engine applies to empty stations. "We
// couldn't look" must never render as "they're the same".

import type { CrawlPageRecord } from '@/lib/tools/crawl-record'
import type { GSCRow } from '@/lib/tools-gsc'
import { mean, median, pct, relativeGap } from './stats'
import { normalizeUrlKey } from './template-groups'

/** Which GSC number decides whether a page "earns" anything. */
export type CohortSplitMetric = 'impressions' | 'clicks'

/** One page-level signal the two cohorts get compared on. */
export interface CohortMetric {
  key: string
  /** Client-readable name, used verbatim in the detail string. */
  label: string
  of: (page: CrawlPageRecord) => number
}

export interface CohortStat {
  n: number
  median: number
  mean: number
  min: number
  max: number
}

export interface CohortComparison {
  metric: string
  label: string
  earning: CohortStat
  invisible: CohortStat
  /** earning − invisible, on medians. */
  medianDelta: number
  /** earning ÷ invisible, on medians. Null when the invisible median is 0. */
  medianRatio: number | null
  /** |delta| as a share of the larger median. 0 means literally identical. */
  medianGap: number
  /** True when the medians are closer than the configured threshold. */
  indistinguishable: boolean
}

export interface VisibilityCohortAnalysis {
  splitBy: CohortSplitMetric
  earningThreshold: number
  indistinguishableWithinPct: number
  /** Crawled URLs at or above the threshold on `splitBy`. */
  earningUrls: string[]
  /** Crawled URLs with nothing — absent from GSC, or present at zero. */
  invisibleUrls: string[]
  /** GSC URLs that matched no crawled page. Reported, never silently dropped. */
  unmatchedGscUrls: string[]
  comparisons: CohortComparison[]
  /** Metrics whose medians DO separate the cohorts. An empty list is a result. */
  separatingMetrics: string[]
  /**
   * Every compared metric is indistinguishable — the §9 negative result.
   * False whenever either cohort is empty, so absence never reads as sameness.
   */
  allIndistinguishable: boolean
  /** Whether the two cohorts could be compared at all. */
  comparable: boolean
  detail: string
}

export interface VisibilityCohortOptions {
  splitBy?: CohortSplitMetric
  /** A page joins the earning cohort at or above this total. */
  earningThreshold?: number
  /**
   * Medians within this percent of the larger value count as indistinguishable.
   *
   * Ten percent, because the question the cohort split answers is "is there a
   * mechanism here worth building a recommendation on", and a sub-10% median
   * difference in inbound links or word count cannot carry one. Tighter than
   * that starts calling sampling noise a finding; looser starts hiding a real
   * 1.5x gap.
   */
  indistinguishableWithinPct?: number
  metrics?: CohortMetric[]
}

export const DEFAULT_INDISTINGUISHABLE_WITHIN_PCT = 10

/**
 * The signals a crawl record can support a cohort comparison on.
 *
 * `internalLinksIn` is first because it is the one §9 tested and disproved, and
 * `uniqueWordCount` is here because raw length hid the real difference: the
 * templated pages were the same LENGTH as the hand-built ones and 71% of that
 * length was boilerplate.
 */
export const DEFAULT_COHORT_METRICS: readonly CohortMetric[] = [
  { key: 'internalLinksIn', label: 'inbound internal links', of: (p) => p.internalLinksIn },
  { key: 'wordCount', label: 'word count', of: (p) => p.wordCount },
  { key: 'uniqueWordCount', label: 'unique (non-boilerplate) words', of: (p) => p.uniqueWordCount },
  { key: 'internalLinksOut', label: 'outbound internal links', of: (p) => p.internalLinksOut },
]

function statOf(values: number[]): CohortStat {
  if (values.length === 0) return { n: 0, median: 0, mean: 0, min: 0, max: 0 }
  return {
    n: values.length,
    median: median(values),
    mean: mean(values),
    min: Math.min(...values),
    max: Math.max(...values),
  }
}

/**
 * Split crawled pages by whether they earn search visibility, and compare them.
 *
 * Pure. `pages` is the crawl station's page list; `gscRows` the GSC station's
 * rows. A crawled page absent from GSC is invisible, which is the whole point —
 * absence from the GSC export is the strongest possible zero.
 */
export function visibilityCohorts(
  pages: readonly CrawlPageRecord[],
  gscRows: readonly GSCRow[],
  options: VisibilityCohortOptions = {},
): VisibilityCohortAnalysis {
  const splitBy = options.splitBy ?? 'impressions'
  const earningThreshold = options.earningThreshold ?? 1
  const withinPct = options.indistinguishableWithinPct ?? DEFAULT_INDISTINGUISHABLE_WITHIN_PCT
  const metrics = options.metrics ?? [...DEFAULT_COHORT_METRICS]

  // Totals per URL, because GSC is one row per query × page and the cohort
  // question is about the page.
  const earnedByUrl = new Map<string, number>()
  for (const row of gscRows) {
    const identity = normalizeUrlKey(row.page)
    const amount = splitBy === 'clicks' ? row.clicks : row.impressions
    earnedByUrl.set(identity, (earnedByUrl.get(identity) ?? 0) + amount)
  }

  const earning: CrawlPageRecord[] = []
  const invisible: CrawlPageRecord[] = []
  const matched = new Set<string>()
  for (const page of pages) {
    const identity = normalizeUrlKey(page.url)
    const earned = earnedByUrl.get(identity)
    if (earned !== undefined) matched.add(identity)
    if (earned !== undefined && earned >= earningThreshold) earning.push(page)
    else invisible.push(page)
  }

  const unmatchedGscUrls = Array.from(earnedByUrl.keys()).filter((k) => !matched.has(k))

  const comparable = earning.length > 0 && invisible.length > 0 && metrics.length > 0
  const comparisons: CohortComparison[] = comparable
    ? metrics.map((metric) => {
        const earningStat = statOf(earning.map(metric.of))
        const invisibleStat = statOf(invisible.map(metric.of))
        const gap = relativeGap(earningStat.median, invisibleStat.median)
        return {
          metric: metric.key,
          label: metric.label,
          earning: earningStat,
          invisible: invisibleStat,
          medianDelta: earningStat.median - invisibleStat.median,
          medianRatio: invisibleStat.median === 0 ? null : earningStat.median / invisibleStat.median,
          medianGap: gap,
          indistinguishable: gap <= withinPct / 100,
        }
      })
    : []

  const separatingMetrics = comparisons.filter((c) => !c.indistinguishable).map((c) => c.metric)
  const allIndistinguishable = comparable && comparisons.length > 0 && separatingMetrics.length === 0

  return {
    splitBy,
    earningThreshold,
    indistinguishableWithinPct: withinPct,
    earningUrls: earning.map((p) => p.url),
    invisibleUrls: invisible.map((p) => p.url),
    unmatchedGscUrls,
    comparisons,
    separatingMetrics,
    allIndistinguishable,
    comparable,
    detail: describe(
      earning.length,
      invisible.length,
      splitBy,
      comparable,
      comparisons,
      allIndistinguishable,
    ),
  }
}

function describe(
  earningCount: number,
  invisibleCount: number,
  splitBy: CohortSplitMetric,
  comparable: boolean,
  comparisons: CohortComparison[],
  allIndistinguishable: boolean,
): string {
  const head = `${earningCount} pages earn ${splitBy}; ${invisibleCount} earn none.`
  if (!comparable) {
    // Never "they look the same" — that is a claim, and there is nothing here to
    // base it on.
    const why =
      earningCount === 0
        ? 'no page earns anything, so there is no cohort to compare against'
        : invisibleCount === 0
          ? 'every page earns something, so there is no invisible cohort'
          : 'no metrics were supplied to compare'
    return `${head} Cohorts not compared: ${why}.`
  }
  const summarise = (c: CohortComparison) =>
    `${c.label} ${Math.round(c.earning.median)} vs ${Math.round(c.invisible.median)} (median, ${pct(c.medianGap)}% apart)`
  if (allIndistinguishable) {
    return (
      `${head} The two cohorts are indistinguishable on every measured signal — ` +
      `${comparisons.map(summarise).join('; ')}. ` +
      `Whatever separates visible from invisible pages here, it is not one of these.`
    )
  }
  const separating = comparisons.filter((c) => !c.indistinguishable)
  const same = comparisons.filter((c) => c.indistinguishable)
  const parts = [`${head} Cohorts differ on ${separating.map(summarise).join('; ')}`]
  if (same.length > 0) {
    parts.push(`and are indistinguishable on ${same.map(summarise).join('; ')}`)
  }
  return `${parts.join(', ')}.`
}
