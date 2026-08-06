// Template grouping — the derived analysis the other three stand on.
//
// WHY IT EXISTS. §9's best impact-to-effort finding was structural, not per-page:
// 191 of Tornado's 206 URLs had no H1, and they had no H1 because ONE WordPress
// template omitted it. The fix was one template edit, not 191 page edits. Nothing
// in a per-page record says that. It only appears when URLs are clustered by the
// path pattern that betrays a shared template — which is what this file does, and
// what `templateFixLeverage` turns into the sentence a client reads.
//
// WHY IT DERIVES THE GROUPING ITSELF when CrawlPageRecord already carries a
// `templateGroup` the ingester fills in: the two are deliberately independent.
// The ingester's value comes out of Sitebulb and is therefore only as good as
// that crawl's configuration (§9's audit shipped with Check Similar off, which is
// how a whole class of finding went missing). This function needs nothing but a
// list of URL strings, so it works on a partial crawl, on a GSC-only page list,
// and — most usefully — as a cross-check on the ingester. Both eval fixtures
// agree with it exactly today; a future divergence is a signal, not noise.
//
// This states structure with magnitudes. It never decides whether a group matters.

/** One cluster of URLs that a single template edit can plausibly reach. */
export interface TemplateGroup {
  /** Match key, lowercased. Directory keys carry no trailing slash: '/service'. */
  key: string
  /** Readable pattern in the site's own casing, e.g. '/Service/*'. */
  pattern: string
  /** Member URLs, in input order, as they were supplied. */
  urls: string[]
  size: number
}

export interface TemplateGrouping {
  /** Every group, largest first, ties broken by key for stable output. */
  groups: TemplateGroup[]
  /** Groups at or above `minFamilySize` — the ones a template edit pays off on. */
  families: TemplateGroup[]
  /** Normalised URL → group key. Lets a defect's URL list be looked up directly. */
  byUrl: Map<string, string>
  /** Distinct URLs grouped. Duplicates in the input are counted once. */
  totalUrls: number
  minFamilySize: number
}

export interface TemplateGroupingOptions {
  /**
   * Smallest group that counts as a template FAMILY.
   *
   * Two is the floor because two pages sharing a directory already share a
   * template in every CMS worth naming; below that there is no leverage to
   * report, only a page.
   */
  minFamilySize?: number
}

export const DEFAULT_MIN_FAMILY_SIZE = 2

/** Where a defect's URLs sit relative to the site's template families. */
export interface TemplateLeverage {
  /** Distinct affected URLs considered. */
  affectedUrls: number
  /** How many template families the defect touches. */
  familiesTouched: number
  /** The single biggest one-change fix, or null when every hit is a one-off. */
  largestFamily: {
    key: string
    pattern: string
    /** Affected URLs inside this family. */
    affectedInFamily: number
    /** The family's total size on the site. */
    familySize: number
    /** True when every page of the family is affected. */
    coversWholeFamily: boolean
  } | null
  /** Affected URLs belonging to no family — genuine per-page fixes. */
  oneOffUrls: number
  detail: string
}

const PURE_DIGITS = /^\d+$/

/**
 * The path of a URL, tolerant of bare paths.
 *
 * GSC hands back absolute URLs and a crawl hands back absolute URLs, but a
 * caller passing '/service/x/' should not silently produce a wrong group.
 */
function pathOf(url: string): string {
  const raw = url.trim()
  try {
    return new URL(raw).pathname
  } catch {
    const cut = raw.split('#')[0].split('?')[0]
    return cut.startsWith('/') ? cut : `/${cut}`
  }
}

function segmentsOf(url: string): string[] {
  return pathOf(url)
    .split('/')
    .filter((s) => s.length > 0)
}

/**
 * A path segment reduced to its template-relevant shape.
 *
 * Only pure-numeric segments collapse, so /blog/2024/03/post/ and
 * /blog/2019/11/post/ land in one family instead of fragmenting per month. Slug
 * segments are left alone: they are the thing that distinguishes a family from
 * its sibling family, and guessing at "slug-shaped" text is how a grouping
 * starts merging /services/ with /locations/.
 */
function normalizeSegment(segment: string): string {
  const lower = segment.toLowerCase()
  return PURE_DIGITS.test(lower) ? '*' : lower
}

/**
 * The template key for one URL.
 *
 * The rule is the directory prefix, because the directory is the shared-template
 * evidence a URL actually carries:
 *
 *   /                               → '/'            the homepage, always alone
 *   /attic-fan-install/             → '/attic-fan-install/'   root-level page
 *   /Service/duct-cleaning-la-0/    → '/service'
 *   /Service/hvac-repair-la-3/      → '/service'     …same family
 *   /blog/2024/03/post/             → '/blog/[*]/[*]'  numeric segments collapse
 *
 * Root-level pages get a key of their own rather than sharing one "root" bucket.
 * They are the hand-built top-level pages — on Tornado, the 15 legacy pages that
 * were the site's best assets — and asserting they share a template would let a
 * group-size floor fire a template-level finding on a pile of unrelated one-offs.
 * The ingester independently marks exactly those pages `templateGroup: null`,
 * which is the corroboration.
 *
 * The trailing slash on a root-level key is what keeps '/blog/' (the archive
 * page) out of the '/blog' family (its posts) — two different templates.
 */
export function deriveTemplateKey(url: string): string {
  const segments = segmentsOf(url)
  if (segments.length === 0) return '/'
  if (segments.length === 1) return `/${normalizeSegment(segments[0])}/`
  return `/${segments.slice(0, -1).map(normalizeSegment).join('/')}`
}

/** The same key, in the site's own casing, with the varying leaf shown as '*'. */
export function deriveTemplatePattern(url: string): string {
  const segments = segmentsOf(url)
  if (segments.length === 0) return '/'
  if (segments.length === 1) return `/${segments[0]}/`
  const dirs = segments.slice(0, -1).map((s) => (PURE_DIGITS.test(s) ? '*' : s))
  return `/${dirs.join('/')}/*`
}

/**
 * Normalised identity for a URL, so the same page written two ways matches.
 *
 * Host is lowercased and de-www'd; the trailing slash goes. The PATH keeps its
 * casing — /Service/ and /service/ can be two different pages on a case-sensitive
 * server, and merging them would understate a defect's URL count.
 */
export function normalizeUrlKey(url: string): string {
  const raw = url.trim()
  try {
    const parsed = new URL(raw)
    const path = parsed.pathname.replace(/\/+$/, '') || '/'
    return `${parsed.host.toLowerCase().replace(/^www\./, '')}${path}`
  } catch {
    const cut = raw.split('#')[0].split('?')[0]
    return cut.replace(/\/+$/, '') || '/'
  }
}

/** Cluster URLs into template families by path pattern. Pure. */
export function groupByUrlTemplate(
  urls: readonly string[],
  options: TemplateGroupingOptions = {},
): TemplateGrouping {
  const minFamilySize = options.minFamilySize ?? DEFAULT_MIN_FAMILY_SIZE
  const byKey = new Map<string, { key: string; pattern: string; urls: string[] }>()
  const byUrl = new Map<string, string>()

  for (const url of urls) {
    const identity = normalizeUrlKey(url)
    // The same page listed twice is one page. Counting it twice would inflate
    // every magnitude downstream, including the "how many pages does one
    // template fix cover" number that makes this analysis worth having.
    if (byUrl.has(identity)) continue
    const key = deriveTemplateKey(url)
    const existing = byKey.get(key)
    if (existing) existing.urls.push(url)
    else byKey.set(key, { key, pattern: deriveTemplatePattern(url), urls: [url] })
    byUrl.set(identity, key)
  }

  const groups: TemplateGroup[] = Array.from(byKey.entries())
    .map(([, group]) => ({
      key: group.key,
      pattern: group.pattern,
      urls: group.urls,
      size: group.urls.length,
    }))
    .sort((a, b) => b.size - a.size || a.key.localeCompare(b.key))

  return {
    groups,
    families: groups.filter((g) => g.size >= minFamilySize),
    byUrl,
    totalUrls: byUrl.size,
    minFamilySize,
  }
}

/** Look a URL's group up, falling back to deriving its key. Pure. */
export function groupKeyFor(url: string, grouping: TemplateGrouping): string {
  return grouping.byUrl.get(normalizeUrlKey(url)) ?? deriveTemplateKey(url)
}

/**
 * Given the URLs one defect touches, how a template-level fix maps onto them.
 *
 * This is the §9 sentence, computed: "191 URLs span 3 template families plus 1
 * one-off page; the largest single template fix covers 130 of them." A finding
 * that says only "191 pages" invites 191 tickets.
 */
export function templateFixLeverage(
  affected: readonly string[],
  grouping: TemplateGrouping,
): TemplateLeverage {
  const groupByKey = new Map(grouping.groups.map((g) => [g.key, g]))
  const hitsPerFamily = new Map<string, number>()
  const seen = new Set<string>()
  let affectedUrls = 0
  let oneOffUrls = 0

  for (const url of affected) {
    const identity = normalizeUrlKey(url)
    if (seen.has(identity)) continue
    seen.add(identity)
    affectedUrls += 1
    const key = groupKeyFor(url, grouping)
    const group = groupByKey.get(key)
    if (!group || group.size < grouping.minFamilySize) {
      oneOffUrls += 1
      continue
    }
    hitsPerFamily.set(key, (hitsPerFamily.get(key) ?? 0) + 1)
  }

  const ranked = Array.from(hitsPerFamily.entries()).sort((a, b) => {
    if (b[1] !== a[1]) return b[1] - a[1]
    const sizeA = groupByKey.get(a[0])?.size ?? 0
    const sizeB = groupByKey.get(b[0])?.size ?? 0
    return sizeB - sizeA || a[0].localeCompare(b[0])
  })

  const top = ranked[0]
  const topGroup = top ? groupByKey.get(top[0]) : undefined
  const largestFamily =
    top && topGroup
      ? {
          key: topGroup.key,
          pattern: topGroup.pattern,
          affectedInFamily: top[1],
          familySize: topGroup.size,
          coversWholeFamily: top[1] === topGroup.size,
        }
      : null

  const familiesTouched = hitsPerFamily.size
  const clauses: string[] = [
    `${affectedUrls} URL${affectedUrls === 1 ? ' spans' : 's span'} ${familiesTouched} template famil${familiesTouched === 1 ? 'y' : 'ies'}`,
  ]
  if (oneOffUrls > 0) {
    clauses.push(`plus ${oneOffUrls} one-off page${oneOffUrls === 1 ? '' : 's'}`)
  }
  let detail = `${clauses.join(' ')}.`
  if (largestFamily) {
    const scope = largestFamily.coversWholeFamily
      ? `the whole ${largestFamily.pattern} family`
      : `${largestFamily.affectedInFamily} of ${largestFamily.familySize} pages under ${largestFamily.pattern}`
    detail += ` The largest single template fix covers ${largestFamily.affectedInFamily} of them (${scope}).`
  }

  return { affectedUrls, familiesTouched, largestFamily, oneOffUrls, detail }
}
