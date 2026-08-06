// Sitebulb export directory → CrawlStationData.
//
// This is the piece that turns three files of CSV readers into a wired station. Every
// mapping below is against the REAL tornadohvacca.com export, not against Sitebulb's
// documentation — see docs/sitebulb-audit-setup.md §8 for what that export taught us.
//
// TWO RULES GOVERN THIS FILE.
//
// 1. THE BACKBONE RULE (§11). `internal.csv` enumerates every crawled URL and is the
//    source of the page list. Hint CSVs only exist for TRIGGERED hints, so reading the
//    hints folder alone makes a `pass` indistinguishable from a `not_run` — absence of a
//    hint could mean "clean" or "never evaluated". Measured cost of getting this wrong on
//    the real export: the h1-missing hint lists 187 URLs while `No. H1s == 0` on the
//    backbone gives 191. The four missing are a 404, a `_wp_link_placeholder` artifact, an
//    old contact page and `/heating/` — Sitebulb suppresses hints for non-indexable URLs.
//    §9's documented figure of 191 only reproduces from the backbone.
//
// 2. NEVER INVENT A MEASUREMENT. Where the export does not carry a signal, the record
//    gets `null` (or 0 for word counts, which the analysis reads as unmeasured) and the
//    coverage report says so. A fabricated `true` for tap targets reports `pass`; a
//    fabricated `false` for analytics reports `fail`. Both were live defects until
//    lib/findings/coverage.ts; this file must not reintroduce them from the other side.
//
// WHAT THIS EXPORT CANNOT SUPPLY, and therefore reports as unmeasured:
//
//   robots.txt body     Sitebulb's CSV exports do not include it, so robotsTxtStatus is
//                       'not-fetched' and TECH-001 reports not_run rather than a
//                       cheerful "nothing is blocked".
//   outbound links      `No. Internal Linking URLs` is INBOUND. There is no outbound
//                       column in a URL-list export, so internalLinksOut is null.
//   sitemap URLs        `Crawl Source` was 'Crawler' for all 206 rows — no sitemap, GA or
//                       GSC source was configured, which is also why TECH-008 orphan
//                       detection is impossible on this crawl.
//   structured data     absent from this export entirely (TECH-013/014, GEO-006).
//   response vs render  absent (TECH-004, GEO-002).
//
// Those five are configuration gaps, not code gaps; the four settings to change on a
// re-run are listed in docs/sitebulb-audit-setup.md §8.

import type { CrawlPageRecord, CrawlStationData } from '@/lib/tools/crawl-record'
import { indexBy, num, text, yesNo, type CsvRow, type CsvTable } from './csv'
import { deriveTargetGeo, deriveTemplateGroup } from './geo'
import { readCsv, type CrawlExportSource } from './source'

/** Which signals this export actually backed, for the caller to report honestly. */
export interface SitebulbCoverage {
  /** URLs on the backbone, i.e. the page count. */
  urls: number
  /** Files that were found and read. */
  filesRead: string[]
  /** Files that were expected and absent — each one costs a signal. */
  filesMissing: string[]
  /** Signal name → how many pages it could NOT be measured for. */
  unmeasured: Record<string, number>
}

export interface SitebulbCrawlIngest {
  data: CrawlStationData
  coverage: SitebulbCoverage
}

/**
 * The files this ingester reads, and the signals each one backs.
 *
 * Exported because it is the complete vocabulary of `SitebulbCoverage.filesMissing`, and
 * lib/stations/degradation.ts keys the whole degradation rule off that array. A test pins
 * this set so adding a fourth file forces a look at the degradation notes.
 */
export const SOURCES = {
  internal: 'internal',
  indexability: 'indexability',
  mobile: 'mobile_friendly',
} as const

const HINT_NO_GA4 = 'url_contains_no_google_analytics_code'
const HINT_NO_GTM = 'url_contains_no_google_tag_manager_code'

/**
 * Sitebulb prefixes every export with the host, e.g. `tornadohvacca_com_internal.csv`,
 * so files are located by suffix rather than by exact name.
 *
 * `endsWith` tolerates the `hints/` prefix that a nested entry carries, which is why the
 * same matcher serves both the top-level reports and the hint files.
 */
async function readBySuffix(
  source: CrawlExportSource,
  files: readonly string[],
  suffix: string,
): Promise<CsvTable | null> {
  const match = files.find((f) => f.endsWith(`_${suffix}.csv`))
  if (!match) return null
  return readCsv(source, match)
}

/** A URL key that survives the trailing-slash and case differences between exports. */
function key(url: string): string {
  return url.trim().replace(/\/+$/, '').toLowerCase()
}

/**
 * H1 texts for a row.
 *
 * `No. H1s` is the authoritative COUNT — it is what reproduces §9's 191 — while the `H1`
 * column carries only the first one's text. So the count drives the array length and the
 * known text fills slot one. ONPAGE-003 counts entries with usable text, and a second H1
 * whose text this export does not carry is still a second H1, so the filler is a
 * non-empty placeholder rather than an empty string.
 */
function h1sFor(row: CsvRow): string[] {
  const count = num(row, 'No. H1s')
  const first = text(row, 'H1')
  if (count === null) return first ? [first] : []
  if (count <= 0) return []
  const out: string[] = [first ?? '(h1 text not in export)']
  while (out.length < count) out.push('(additional h1, text not in export)')
  return out
}

/** robots meta directives, rebuilt from indexability.csv's boolean columns. */
function robotsMetaFor(row: CsvRow | undefined): string {
  if (!row) return ''
  const parts: string[] = []
  if (yesNo(row, 'Noindex') === true) parts.push('noindex')
  if (yesNo(row, 'Nofollow') === true) parts.push('nofollow')
  return parts.join(',')
}

/**
 * Read a Sitebulb export into crawl-station shape.
 *
 * Takes a source rather than a directory so the same code reads a local fixture, an
 * uploaded zip's buffers, or a map built by a test. The listing comes from
 * `source.list()`, which is the ONLY authority on which files exist — an earlier version
 * took the listing as a second argument, which let a caller pass one that disagreed with
 * what the source actually held.
 *
 * Throws when the backbone is absent. The crawl station's `runGuarded` converts that into
 * a ToolErr; it stays a throw here so the rule has one expression rather than a union
 * every future caller has to re-handle.
 */
export async function ingestSitebulbCrawl(
  source: CrawlExportSource,
): Promise<SitebulbCrawlIngest> {
  const files = await source.list()
  const filesRead: string[] = []
  const filesMissing: string[] = []

  const internal = await readBySuffix(source, files, SOURCES.internal)
  if (internal === null) {
    throw new Error(
      `Sitebulb export at ${source.label} has no *_internal.csv. That file is the backbone: ` +
        `without it the page list would come from triggered hints only, and a pass would ` +
        `be indistinguishable from a check that never ran.`,
    )
  }
  filesRead.push(SOURCES.internal)

  const indexability = await readBySuffix(source, files, SOURCES.indexability)
  ;(indexability ? filesRead : filesMissing).push(SOURCES.indexability)
  const mobile = await readBySuffix(source, files, SOURCES.mobile)
  ;(mobile ? filesRead : filesMissing).push(SOURCES.mobile)

  const idxByUrl = indexability ? indexBy(indexability, 'URL') : new Map<string, CsvRow>()
  const mobByUrl = mobile ? indexBy(mobile, 'URL') : new Map<string, CsvRow>()

  // Hint files carry INVERTED logic: a URL listed in `..._no_google_analytics_code.csv`
  // is one that LACKS the tag. An absent hint file means the hint never triggered, so
  // every URL has the tag — which is only a safe reading because the backbone gives us
  // the full URL list to compare against.
  const noGa4 = await readHintUrlSet(source, files, HINT_NO_GA4)
  const noGtm = await readHintUrlSet(source, files, HINT_NO_GTM)
  if (noGa4) filesRead.push(HINT_NO_GA4)
  if (noGtm) filesRead.push(HINT_NO_GTM)

  const unmeasured: Record<string, number> = {}
  const bump = (signal: string) => {
    unmeasured[signal] = (unmeasured[signal] ?? 0) + 1
  }

  const pages: CrawlPageRecord[] = internal.rows.map((row) => {
    const url = text(row, 'URL') ?? ''
    const k = key(url)
    const idx = idxByUrl.get(url) ?? idxByUrl.get(k)
    const mob = mobByUrl.get(url) ?? mobByUrl.get(k)

    // THE PINNED CONTRACT (lib/tools/crawl-record.ts):
    //   wordCount       = No. Content Words + No. Template Words
    //   uniqueWordCount = No. Content Words
    // Mapping wordCount to a content-only column makes uniqueShare 1.0 on every page and
    // silently disables ONPAGE-012 forever, so both components must be present or the
    // page counts as unmeasured (0) rather than half-measured.
    const content = num(row, 'No. Content Words')
    const template = num(row, 'No. Template Words')
    const measuredWords = content !== null && template !== null
    if (!measuredWords) bump('wordCount')

    const hasViewportMeta = mob ? invert(yesNo(mob, 'Missing Viewport')) : null
    const tapTargetsOk = mob ? invert(yesNo(mob, 'Small Tap Targets')) : null
    if (hasViewportMeta === null) bump('hasViewportMeta')
    if (tapTargetsOk === null) bump('tapTargetsOk')

    const ga4 = noGa4 === null ? null : !noGa4.has(k)
    const gtm = noGtm === null ? null : !noGtm.has(k)
    if (ga4 === null) bump('analytics.ga4')
    if (gtm === null) bump('analytics.gtm')

    if (!idx) bump('canonical')
    bump('internalLinksOut') // no outbound column exists in this export shape

    const title = text(row, 'Title') ?? ''

    return {
      url,
      status: num(row, 'HTTP Status Code') ?? 0,
      title,
      metaDescription: text(row, 'Meta Description') ?? '',
      h1s: h1sFor(row),
      canonical: idx ? text(idx, 'Canonical URL') : null,
      robotsMeta: robotsMetaFor(idx),
      hasViewportMeta,
      tapTargetsOk,
      analytics: { ga4, gtm },
      internalLinksOut: null,
      internalLinksIn: num(row, 'No. Internal Linking URLs') ?? 0,
      wordCount: measuredWords ? content! + template! : 0,
      uniqueWordCount: measuredWords ? content! : 0,
      templateGroup: deriveTemplateGroup(url),
      targetGeo: deriveTargetGeo(url, title),
    }
  })

  return {
    data: {
      site: {
        robotsTxt: null,
        // NOT 'not-found'. A CSV export carries no robots.txt body, so we did not look —
        // and TECH-001 must say not_run rather than "nothing is blocked". The robots
        // station fetches these over the network and merges them in; an export alone
        // cannot supply either file.
        robotsTxtStatus: 'not-fetched',
        llmsTxt: null,
        llmsTxtStatus: 'not-fetched',
        sitemapUrls: [],
      },
      pages,
    },
    coverage: { urls: pages.length, filesRead, filesMissing, unmeasured },
  }
}

/** `false` -> true, `true` -> false, unknown -> null. Sitebulb states these negatively. */
function invert(value: boolean | null): boolean | null {
  return value === null ? null : !value
}

/** The URL set from a hint file, or null when the hint file is absent entirely. */
async function readHintUrlSet(
  source: CrawlExportSource,
  files: readonly string[],
  suffix: string,
): Promise<Set<string> | null> {
  const match = files.find((f) => f.endsWith(`_${suffix}.csv`))
  if (!match) return null
  const table = await readCsv(source, match)
  const set = new Set<string>()
  for (const row of table.rows) {
    const url = text(row, 'URL')
    if (url) set.add(key(url))
  }
  return set
}
