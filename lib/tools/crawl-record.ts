// The crawl station's output type — designed BEFORE the Sitebulb ingester exists.
//
// This inversion is deliberate (it came out of the eval-harness critique): the
// eval fixtures and the phase-3 derived analyses are written against this type
// now, and the ingester's job later is to conform to it. The alternative — fixtures
// mimicking raw Sitebulb exports — coupled everything to an export format we don't
// control and that changes with Sitebulb versions.
//
// Kept to what the rubric's auto-tier and detector-backed checks actually read.
// Fields are added when a check needs them, not speculatively.

/** One crawled URL, reduced to the signals the rubric checks consume. */
export interface CrawlPageRecord {
  url: string
  /** HTTP status of the final response (after redirects). */
  status: number
  title: string
  metaDescription: string
  /** Text of every H1 on the page. The ONPAGE-003 signal is this array's length. */
  h1s: string[]
  canonical: string | null
  /** Content of the robots meta tag, '' when absent. */
  robotsMeta: string
  /** TECH-011 signals, as Sitebulb's mobile-friendly hints report them. */
  /**
   * TECH-011 signals. `null` means THE CRAWL DID NOT MEASURE THIS, not `false`.
   *
   * These were non-nullable, so an ingester that cannot measure tap targets had to
   * invent a value — and `true` yields `pass`, i.e. a clean bill of health over data
   * nobody looked at. See lib/findings/coverage.ts for the rule that replaced it.
   */
  hasViewportMeta: boolean | null
  tapTargetsOk: boolean | null
  /**
   * MEAS-001 signals: analytics tags detected in the served HTML. `null` means not
   * measured.
   *
   * Same shape as above, pointing the other way: an invented `false` yields `fail`,
   * telling a client their analytics are broken when nothing was checked.
   */
  analytics: {
    ga4: boolean | null
    gtm: boolean | null
  }
  /**
   * Outbound internal links from this page. `null` means not measured.
   *
   * A Sitebulb URL-list export carries `No. Internal Linking URLs` (INBOUND) but no
   * outbound count, so an ingester working from one cannot supply this. Nullable rather
   * than defaulted to 0, because a 0 here is a real signal — an orphaned dead end — and
   * must not be manufactured out of a missing column.
   */
  internalLinksOut: number | null
  /**
   * INBOUND internal links to this page.
   *
   * The signal behind §9's most useful negative result: earning and invisible
   * Tornado pages both had a median of ~186 inbound links, which killed the
   * internal-linking hypothesis and revealed a mega-menu linking everything to
   * everything — i.e. internal linking signalling no priority at all.
   */
  internalLinksIn: number
  /**
   * TOTAL words on the page: content PLUS template.
   *
   * INGESTER CONTRACT, and getting it wrong silently disables ONPAGE-012 forever:
   *
   *     wordCount       = Sitebulb `No. Content Words` + `No. Template Words`
   *     uniqueWordCount = Sitebulb `No. Content Words`
   *
   * Map wordCount to a content-only column and uniqueShare becomes 1.0 on every page,
   * the ratio never crosses any threshold, and the check reports a clean pass on every
   * site with no error anywhere. There is no assertion that can catch that downstream —
   * the numbers are individually plausible. It has to be right here.
   *
   * Zero means UNMEASURED, and the analysis treats it as such rather than as 0% unique;
   * see uniqueShare in lib/findings/analyses/content-template-ratio.ts. An ingester that
   * defaults Sitebulb's `--` to 0 fabricates a defect, which is why
   * lib/ingest/sitebulb/csv.ts returns null for it.
   */
  wordCount: number
  /**
   * The page's OWN words — content words, not shared with its template siblings.
   *
   * NOT from Sitebulb's near-duplicate / "Check Similar" report. An earlier version of
   * this comment said it was; docs/sitebulb-audit-setup.md §8 revised that against the
   * real export: ONPAGE-012 reads the content/template word split, which ships on every
   * row with no extra configuration, and "does not depend on" Check Similar. On the
   * pilot site `URLs with Similar Content` was 0 everywhere and it barely mattered.
   *
   * ONPAGE-012 exists because a pure near-duplicate check PASSED Tornado while its pages
   * were 71% boilerplate: similarity detection cannot catch content that is
   * unique-but-worthless. uniqueWordCount / wordCount is the ratio that can.
   */
  uniqueWordCount: number
  /**
   * Template family this URL belongs to, or null for a one-off page.
   *
   * The only implementation is deriveTemplateGroup in lib/ingest/sitebulb/geo.ts, which
   * returns the lowercased FIRST path segment — so /Service/x-in-los-angeles-ca/ yields
   * 'service', not 'service-la' as this comment used to claim. Only the eval fixtures
   * ever produced the hyphenated form.
   *
   * Reported as a cross-check, never load-bearing: ONPAGE-012 derives its own grouping
   * from URL paths and does NOT gate on this field. It used to, and since nothing
   * constructs a CrawlPageRecord yet, that made the check return 0 on any real crawl.
   */
  templateGroup: string | null
  /**
   * The geography this page targets, when it is a location page ('Anaheim, CA').
   * Null for non-location pages. Feeds LOCAL-016 against the GBP service areas.
   */
  targetGeo: string | null
}

/** Site-level facts that don't belong to any single URL. */
export interface CrawlSiteRecord {
  /**
   * Raw robots.txt body. Null when there is no body to hold — see robotsTxtStatus for
   * WHY, because "the site serves none" and "we never asked" are different facts and
   * this field alone cannot tell them apart.
   */
  robotsTxt: string | null
  /**
   * Why robotsTxt is null, when it is.
   *
   * Required, not optional, and deliberately so: an ingester that forgets to set it will
   * not compile. Previously null meant "the fetch 404'd" by convention, so a station
   * that never attempted the fetch was indistinguishable from a site serving no
   * robots.txt — and TECH-001 returned `pass` for both.
   *
   *   'ok'          a body was fetched and is in robotsTxt
   *   'not-found'   fetched, and the site genuinely serves none. Blocks nothing: pass.
   *   'not-fetched' never attempted, or the attempt failed. TECH-001 reports not_run.
   */
  robotsTxtStatus: 'ok' | 'not-found' | 'not-fetched'
  sitemapUrls: string[]
}

/** What the crawl station hands downstream. */
export interface CrawlStationData {
  site: CrawlSiteRecord
  pages: CrawlPageRecord[]
}

/**
 * The GBP profile as the checks consume it.
 *
 * `isServiceAreaBusiness` + `storefrontAddress: null` is a CORRECT configuration —
 * the documented §9 false positive was an audit docking a service-area business
 * for hiding its address, which is exactly what Google tells SABs to do. Every
 * completeness/NAP check must treat that pairing as fine, and the healthy fixture
 * exists to fail the build if one ever stops doing so.
 */
export interface GbpProfileRecord {
  name: string
  primaryCategory: string
  isServiceAreaBusiness: boolean
  /** Street address, null when hidden (correct for a SAB). */
  storefrontAddress: string | null
  /** City the business actually operates from. */
  businessCity: string
  /** Declared GBP service areas, as 'City, ST' strings. */
  serviceAreas: string[]
  hoursComplete: boolean
  phone: string | null
  websiteUri: string | null
  description: string | null
  photoCount: number
  rating: number | null
  reviewCount: number
}
