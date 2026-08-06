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
  hasViewportMeta: boolean
  tapTargetsOk: boolean
  /** MEAS-001 signals: analytics tags detected in the served HTML. */
  analytics: {
    ga4: boolean
    gtm: boolean
  }
  /** Outbound internal links from this page. */
  internalLinksOut: number
  /**
   * INBOUND internal links to this page.
   *
   * The signal behind §9's most useful negative result: earning and invisible
   * Tornado pages both had a median of ~186 inbound links, which killed the
   * internal-linking hypothesis and revealed a mega-menu linking everything to
   * everything — i.e. internal linking signalling no priority at all.
   */
  internalLinksIn: number
  wordCount: number
  /**
   * Words on this page that are NOT shared boilerplate with its template
   * siblings (Sitebulb's near-duplicate / "Check Similar" data supplies this).
   *
   * ONPAGE-012 exists because a pure near-duplicate check PASSED Tornado while
   * its pages were 71% boilerplate: similarity detection cannot catch content
   * that is unique-but-worthless. uniqueWordCount / wordCount is the ratio that
   * can.
   */
  uniqueWordCount: number
  /**
   * Template family this URL belongs to (path-pattern clustering), e.g.
   * 'service-la' for /Service/x-in-los-angeles-ca/. Null for one-off pages.
   * Feeds the template-grouping analysis and ONPAGE-012.
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
  /** Raw robots.txt body, null when the fetch 404'd. */
  robotsTxt: string | null
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
