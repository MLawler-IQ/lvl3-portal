// Content-to-template ratio — the analysis behind rubric check ONPAGE-012.
//
// WHY THE CHECK EXISTS (§7, verbatim in the rubric's own notes): "ADDED AFTER
// PILOT. A similarity check passes AI content that is unique-but-worthless.
// Tornado median was 29% unique / 71% template."
//
// That is the whole design constraint. Tornado's 130 generated service pages
// PASSED a near-duplicate check — each one really did have its own sentences —
// while 71% of every page was the same header, mega-menu, service grid, trust
// badges and footer. Similarity detection asks "is this page a copy of that
// page". It cannot ask "is there a page here at all". The ratio can:
//
//     uniqueWordCount / wordCount, aggregated as a MEDIAN per template group,
//     with a group-size floor.
//
// Median, not mean, because one long genuine page in a family of thin ones must
// not lift the family's score. Group-size floor, because a template-dominated
// pair of pages is not a template problem, it is two pages.
//
// The rubric's howToTest is "Sitebulb content words vs template words, aggregated
// by template group, crossed with impression-earning rate". The earning rate is
// computed and REPORTED for every group, and it is not a second gate on firing:
// §7's lesson is that this check exists because an earlier check was too easy to
// pass, so a template-dominated family that happens to earn impressions still
// gets stated. The trigger is the ratio; the earning rate is corroboration in the
// evidence a reviewer reads.

import type { CrawlPageRecord } from '@/lib/tools/crawl-record'
import type { GSCRow } from '@/lib/tools-gsc'
import { median, pct } from './stats'
import type { TemplateGrouping } from './template-groups'
import { groupByUrlTemplate, normalizeUrlKey } from './template-groups'

export interface TemplateContentRatio {
  key: string
  pattern: string
  pages: number
  /** Median uniqueWordCount ÷ wordCount across the group, 0-1. */
  medianUniqueShare: number
  medianWordCount: number
  medianUniqueWordCount: number
  /** Pages of this group earning at least one GSC impression. */
  earningPages: number
  /** earningPages ÷ pages, 0-1. */
  impressionEarningRate: number
  /** medianUniqueShare is below the configured floor. */
  templateDominated: boolean
  urls: string[]
}

export interface ContentTemplateRatioAnalysis {
  minGroupSize: number
  minUniqueShare: number
  /** Groups at or above the size floor, largest first. */
  groups: TemplateContentRatio[]
  /** The subset that is template-dominated. */
  dominated: TemplateContentRatio[]
  /** Pages inside dominated groups — the affected-URL magnitude. */
  dominatedPages: number
  /** Page-weighted median unique share across the dominated groups, 0-1. */
  medianUniqueShareOfDominated: number
  /** Dominated pages earning at least one impression. */
  dominatedEarningPages: number
  /** Pages in groups too small to judge at template level. */
  pagesBelowGroupFloor: number
  /** Groups large enough to judge, but with too few MEASURED pages to judge. */
  unjudgeableGroups: number
  /** Pages inside those unjudgeable groups. */
  pagesUnjudgeable: number
  /** Unmeasured pages sitting inside groups that WERE judged. */
  unmeasuredInJudged: number
  /** URLs of dominated pages, for the finding's affected list. */
  dominatedUrls: string[]
  detail: string
}

export interface ContentTemplateRatioOptions {
  /**
   * Smallest group worth judging as a template.
   *
   * Five: below that, "fix the template" and "fix the pages" are the same amount
   * of work, so the finding has nothing to add. Above it, the ratio is a claim
   * about a generator rather than about a page.
   */
  minGroupSize?: number
  /**
   * The unique-content share at or above which a group is fine.
   *
   * NOT IN THE RUBRIC. OURS. See DEFAULT_MIN_UNIQUE_SHARE.
   */
  minUniqueShare?: number
  /** Reuse an existing grouping instead of deriving one. */
  grouping?: TemplateGrouping
}

/**
 * NOT IN THE RUBRIC. OURS.
 *
 * docs/rubric/rubric.json's ONPAGE-012 row carries no pass/fail criteria — no rubric
 * row does. Its `notes` give an OBSERVATION, "Tornado median was 29% unique / 71%
 * template", which is a value this check MUST CATCH, not a cutoff to sit on. It
 * constrains the threshold from below and says nothing more.
 *
 * 5 is the one floor both independent implementations reached unprompted, and §11 says
 * only "large".
 */
export const DEFAULT_MIN_GROUP_SIZE = 5

/**
 * NOT IN THE RUBRIC. OURS.
 *
 * 0.5 is the one cutoff traceable to the rubric's own vocabulary: the check text says
 * groups must not be template-DOMINATED, and a template dominates when its words
 * outweigh the page's own. Strict `<` — an exact 50/50 group is not dominated, so the
 * constant reads as "content must be at least half".
 *
 * Measured 2026-08-06: 0.5 and the eval predicate's former 0.35 return IDENTICAL counts
 * on both hand-written fixtures and 160 generated ones (4 scenarios x 2 variants x 20
 * seeds). Nothing in the corpus discriminates them, so this is a reading, not a fit.
 *
 * 0.5 is only safe because of the unmeasured-page rule below. Under the old
 * zero-word-is-0%-unique rule, half a family of junk pages would drag a healthy group's
 * median under 0.5 and fire; excluded pages cannot drag a median.
 */
export const DEFAULT_MIN_UNIQUE_SHARE = 0.5

/** Did the crawl actually measure this page's words? */
export function isMeasured(page: CrawlPageRecord): boolean {
  return page.wordCount > 0
}

/**
 * A page's unique-content share, or null when the crawl measured nothing.
 *
 * `wordCount === 0` makes the ratio 0/0 — undefined. This used to return 0 (maximally
 * template-dominated) and the eval predicate used to return 1 (pristine); both invented
 * a number, in opposite directions.
 *
 * The case the old comment defended never needed defending: a page with zero CONTENT
 * words behind Tornado's 3,551-word template has wordCount 3551, scores 0.086, and is
 * caught under any reading. wordCount === 0 only arises when the crawl measured nothing
 * — a 404, a redirect, a PDF, the `_wp_link_placeholder` artifact — exactly the URLs
 * docs/sitebulb-audit-setup.md §8 documents Sitebulb suppressing hints for. Those are
 * not template-dominated pages; this check has no opinion about them.
 *
 * lib/ingest/sitebulb/csv.ts already settles the same question in prose: `num()` returns
 * null for `--`, because "`No. Words: --` defaulted to 0 makes a page read as 0% unique
 * content, which is a fabricated defect, whereas a 404's genuine `0` is a fact." Since
 * CrawlPageRecord.wordCount is non-nullable the analysis cannot tell those apart, so it
 * must claim neither. Returning null forces every caller to decide explicitly.
 */
export function uniqueShare(page: CrawlPageRecord): number | null {
  if (!isMeasured(page)) return null
  return Math.min(1, Math.max(0, page.uniqueWordCount / page.wordCount))
}

/** Median unique-content share per template group, crossed with earning rate. Pure. */
export function contentToTemplateRatio(
  pages: readonly CrawlPageRecord[],
  gscRows: readonly GSCRow[],
  options: ContentTemplateRatioOptions = {},
): ContentTemplateRatioAnalysis {
  const minGroupSize = options.minGroupSize ?? DEFAULT_MIN_GROUP_SIZE
  const minUniqueShare = options.minUniqueShare ?? DEFAULT_MIN_UNIQUE_SHARE
  const grouping = options.grouping ?? groupByUrlTemplate(pages.map((p) => p.url))

  const pageByUrl = new Map<string, CrawlPageRecord>()
  for (const page of pages) pageByUrl.set(normalizeUrlKey(page.url), page)

  const impressionsByUrl = new Map<string, number>()
  for (const row of gscRows) {
    const identity = normalizeUrlKey(row.page)
    impressionsByUrl.set(identity, (impressionsByUrl.get(identity) ?? 0) + row.impressions)
  }

  const groups: TemplateContentRatio[] = []
  let pagesBelowGroupFloor = 0
  let unjudgeableGroups = 0
  let pagesUnjudgeable = 0
  let unmeasuredInJudged = 0

  for (const group of grouping.groups) {
    const members = group.urls
      .map((url) => pageByUrl.get(normalizeUrlKey(url)))
      .filter((p): p is CrawlPageRecord => Boolean(p))
    if (members.length === 0) continue
    if (members.length < minGroupSize) {
      pagesBelowGroupFloor += members.length
      continue
    }
    // The floor applies to MEASURED pages, not to members. Plain exclusion is not
    // enough on its own: 10 healthy pages beside 10 unmeasured ones would silently drop
    // the unmeasured cohort and report a clean pass on half a group.
    const measured = members.filter(isMeasured)
    if (measured.length < minGroupSize) {
      unjudgeableGroups += 1
      pagesUnjudgeable += members.length
      continue
    }
    unmeasuredInJudged += members.length - measured.length
    const shares = measured
      .map(uniqueShare)
      .filter((s): s is number => s !== null)
    const medianUniqueShare = median(shares)
    const earningPages = members.filter(
      (p) => (impressionsByUrl.get(normalizeUrlKey(p.url)) ?? 0) > 0,
    ).length
    groups.push({
      key: group.key,
      pattern: group.pattern,
      pages: members.length,
      medianUniqueShare,
      medianWordCount: median(measured.map((p) => p.wordCount)),
      medianUniqueWordCount: median(measured.map((p) => p.uniqueWordCount)),
      earningPages,
      impressionEarningRate: earningPages / members.length,
      templateDominated: medianUniqueShare < minUniqueShare,
      urls: members.map((p) => p.url),
    })
  }

  groups.sort((a, b) => b.pages - a.pages || a.key.localeCompare(b.key))

  const dominated = groups.filter((g) => g.templateDominated)
  const dominatedUrls = dominated.flatMap((g) => g.urls)
  const dominatedPages = dominatedUrls.length
  const dominatedEarningPages = dominated.reduce((sum, g) => sum + g.earningPages, 0)
  // Page-weighted so a 130-page family is not averaged against an 18-page one as
  // though they were the same size.
  const dominatedShares = dominated.flatMap((g) =>
    g.urls
      .map((url) => pageByUrl.get(normalizeUrlKey(url)))
      .filter((p): p is CrawlPageRecord => Boolean(p))
      .map(uniqueShare)
      .filter((s): s is number => s !== null),
  )
  const medianUniqueShareOfDominated = median(dominatedShares)

  return {
    minGroupSize,
    minUniqueShare,
    groups,
    dominated,
    dominatedPages,
    medianUniqueShareOfDominated,
    dominatedEarningPages,
    pagesBelowGroupFloor,
    unjudgeableGroups,
    pagesUnjudgeable,
    unmeasuredInJudged,
    dominatedUrls,
    detail: describe(
      groups,
      dominated,
      dominatedPages,
      dominatedEarningPages,
      medianUniqueShareOfDominated,
      minGroupSize,
      unjudgeableGroups,
      pagesUnjudgeable,
      unmeasuredInJudged,
    ),
  }
}

function describe(
  groups: TemplateContentRatio[],
  dominated: TemplateContentRatio[],
  dominatedPages: number,
  dominatedEarningPages: number,
  medianShare: number,
  minGroupSize: number,
  unjudgeableGroups: number,
  pagesUnjudgeable: number,
  unmeasuredInJudged: number,
): string {
  // Unmeasured pages are always NAMED. Silently dropping them is how absent data turns
  // into a clean pass, which is the failure this whole rule exists to prevent.
  const caveat =
    unmeasuredInJudged > 0
      ? ` ${unmeasuredInJudged} page${unmeasuredInJudged === 1 ? '' : 's'} in judged groups carried no word count and were excluded.`
      : ''

  if (groups.length === 0) {
    if (unjudgeableGroups > 0) {
      return (
        `No template group could be judged: ${unjudgeableGroups} group${unjudgeableGroups === 1 ? '' : 's'} ` +
        `(${pagesUnjudgeable} pages) had fewer than ${minGroupSize} pages with a word count.`
      )
    }
    return `No template group of ${minGroupSize} or more pages exists, so there is no template-level content ratio to aggregate.`
  }
  if (dominated.length === 0) {
    const worst = groups.reduce((lowest, g) =>
      g.medianUniqueShare < lowest.medianUniqueShare ? g : lowest,
    )
    return `All ${groups.length} template group${groups.length === 1 ? '' : 's'} of ${minGroupSize}+ pages carry majority-unique content; the thinnest is ${worst.pattern} at ${pct(worst.medianUniqueShare)}% unique.${caveat}`
  }
  const earningRate = dominatedPages > 0 ? dominatedEarningPages / dominatedPages : 0
  return (
    `${dominatedPages} pages across ${dominated.length} template group${dominated.length === 1 ? '' : 's'} are template-dominated: ` +
    `median ${pct(medianShare)}% unique content, ${pct(1 - medianShare)}% shared boilerplate. ` +
    `Those pages earn impressions at ${pct(earningRate)}% (${dominatedEarningPages} of ${dominatedPages}).${caveat}`
  )
}
