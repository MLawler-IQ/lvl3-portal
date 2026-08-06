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
   * A half. Under it, most of what the page serves is furniture — Tornado sat at
   * 29%. Set deliberately well clear of that so the threshold is a judgement
   * about page quality, not a number reverse-engineered from one audit.
   */
  minUniqueShare?: number
  /** Reuse an existing grouping instead of deriving one. */
  grouping?: TemplateGrouping
}

export const DEFAULT_MIN_GROUP_SIZE = 5
export const DEFAULT_MIN_UNIQUE_SHARE = 0.5

/**
 * A page's unique-content share.
 *
 * A zero-word page is 0% unique rather than excluded: a template family of empty
 * pages is the most template-dominated thing there is, and dropping those pages
 * would let the worst case vanish from the median.
 */
export function uniqueShare(page: CrawlPageRecord): number {
  if (page.wordCount <= 0) return 0
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

  for (const group of grouping.groups) {
    const members = group.urls
      .map((url) => pageByUrl.get(normalizeUrlKey(url)))
      .filter((p): p is CrawlPageRecord => Boolean(p))
    if (members.length === 0) continue
    if (members.length < minGroupSize) {
      pagesBelowGroupFloor += members.length
      continue
    }
    const medianUniqueShare = median(members.map(uniqueShare))
    const earningPages = members.filter(
      (p) => (impressionsByUrl.get(normalizeUrlKey(p.url)) ?? 0) > 0,
    ).length
    groups.push({
      key: group.key,
      pattern: group.pattern,
      pages: members.length,
      medianUniqueShare,
      medianWordCount: median(members.map((p) => p.wordCount)),
      medianUniqueWordCount: median(members.map((p) => p.uniqueWordCount)),
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
      .map(uniqueShare),
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
    dominatedUrls,
    detail: describe(
      groups,
      dominated,
      dominatedPages,
      dominatedEarningPages,
      medianUniqueShareOfDominated,
      minGroupSize,
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
): string {
  if (groups.length === 0) {
    return `No template group of ${minGroupSize} or more pages exists, so there is no template-level content ratio to aggregate.`
  }
  if (dominated.length === 0) {
    const worst = groups.reduce((lowest, g) =>
      g.medianUniqueShare < lowest.medianUniqueShare ? g : lowest,
    )
    return `All ${groups.length} template group${groups.length === 1 ? '' : 's'} of ${minGroupSize}+ pages carry majority-unique content; the thinnest is ${worst.pattern} at ${pct(worst.medianUniqueShare)}% unique.`
  }
  const earningRate = dominatedPages > 0 ? dominatedEarningPages / dominatedPages : 0
  return (
    `${dominatedPages} pages across ${dominated.length} template group${dominated.length === 1 ? '' : 's'} are template-dominated: ` +
    `median ${pct(medianShare)}% unique content, ${pct(1 - medianShare)}% shared boilerplate. ` +
    `Those pages earn impressions at ${pct(earningRate)}% (${dominatedEarningPages} of ${dominatedPages}).`
  )
}
