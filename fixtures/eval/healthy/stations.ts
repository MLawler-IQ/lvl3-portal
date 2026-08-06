// The healthy fixture: a correctly configured site and profile with ZERO defects.
// This is the false-positive control — a pipeline that fires on this data is
// wrong, and the manifest's must_pass list is the positive evidence that every
// check actually RAN and cleared it (a pipeline that finds nothing because it
// looked at nothing cannot pass this case; not_run fails must_pass).
//
// It deliberately includes the configuration behind the one documented real-world
// false positive: a service-area business with a hidden storefront address, which
// an earlier audit tool docked as "No storefront address". That is CORRECT SAB
// configuration. If anyone ever removes the SAB precondition from the LOCAL-003
// detector, this fixture goes red.

import type { StationBundle } from '@/lib/findings/types'
import type { CrawlPageRecord, CrawlStationData, GbpProfileRecord } from '@/lib/tools/crawl-record'
import type { GSCRow } from '@/lib/tools-gsc'
import { toolOk } from '@/lib/tools/contract'

const SITE = 'https://example-plumbing.com'

const SERVED = ['Pasadena, CA', 'Altadena, CA', 'San Marino, CA']

function page(over: Partial<CrawlPageRecord> & { url: string; h1: string }): CrawlPageRecord {
  const { h1, ...rest } = over
  return {
    status: 200,
    title: `${h1} | Example Plumbing`,
    metaDescription: `Professional ${h1.toLowerCase()} across Pasadena and the San Gabriel Valley.`,
    h1s: [h1],
    canonical: over.url,
    robotsMeta: 'index,follow',
    hasViewportMeta: true,
    tapTargetsOk: true,
    analytics: { ga4: true, gtm: false },
    internalLinksOut: 14,
    internalLinksIn: 9,
    wordCount: 1100,
    uniqueWordCount: 940, // ~85% unique: a real page, not a template fill
    templateGroup: null,
    targetGeo: null,
    ...rest,
  }
}

function buildCrawl(): CrawlStationData {
  const pages: CrawlPageRecord[] = [
    page({ url: `${SITE}/`, h1: 'Pasadena Plumbing Experts' }),
  ]
  const services = [
    'drain-cleaning', 'water-heater-repair', 'leak-detection', 'repiping',
    'sewer-line-repair', 'tankless-water-heaters', 'gas-line-services',
    'bathroom-plumbing', 'kitchen-plumbing', 'emergency-plumbing',
  ]
  for (const s of services) {
    pages.push(
      page({
        url: `${SITE}/services/${s}/`,
        h1: s.replace(/-/g, ' '),
        templateGroup: 'service',
      }),
    )
  }
  // Location pages target only geography the profile genuinely serves.
  for (const area of SERVED) {
    pages.push(
      page({
        url: `${SITE}/areas/${area.split(',')[0].toLowerCase().replace(/\s+/g, '-')}/`,
        h1: `Plumber in ${area.split(',')[0]}`,
        templateGroup: 'area',
        targetGeo: area,
      }),
    )
  }
  for (let i = 0; i < 11; i++) {
    pages.push(
      page({
        url: `${SITE}/blog/post-${i + 1}/`,
        h1: `Plumbing guide ${i + 1}`,
        templateGroup: 'blog',
        wordCount: 950,
        uniqueWordCount: 880,
      }),
    )
  }
  return {
    site: {
      robotsTxt: 'User-agent: *\nDisallow: /wp-admin/\nSitemap: https://example-plumbing.com/sitemap.xml',
      sitemapUrls: [`${SITE}/sitemap.xml`],
    },
    pages, // 25 total
  }
}

function buildGsc(): GSCRow[] {
  // One ranking URL per query — no cannibalisation anywhere.
  const rows: Array<[string, string, number, number, number]> = [
    ['drain cleaning pasadena', '/services/drain-cleaning/', 900, 62, 3.1],
    ['water heater repair pasadena', '/services/water-heater-repair/', 700, 48, 2.4],
    ['leak detection', '/services/leak-detection/', 450, 12, 6.8],
    ['emergency plumber pasadena', '/services/emergency-plumbing/', 1200, 95, 1.8],
    ['repiping cost', '/blog/post-3/', 300, 9, 8.2],
    ['example plumbing', '/', 600, 210, 1.0],
  ]
  return rows.map(([query, path, impressions, clicks, position]) => ({
    query,
    page: `${SITE}${path}`,
    clicks,
    impressions,
    ctr: Math.round((clicks / impressions) * 1000) / 10,
    position,
  }))
}

const gbp: GbpProfileRecord = {
  name: 'Example Plumbing',
  primaryCategory: 'Plumber',
  // The false-positive trap, preserved on purpose: SAB, hidden address, and
  // everything else complete. LOCAL-003 must PASS here.
  isServiceAreaBusiness: true,
  storefrontAddress: null,
  businessCity: 'Pasadena, CA',
  serviceAreas: SERVED,
  hoursComplete: true,
  phone: '+1-626-555-0166',
  websiteUri: SITE,
  description: 'Family-owned plumbing serving the San Gabriel Valley since 1998.',
  photoCount: 18,
  rating: 4.9,
  reviewCount: 84,
}

export function healthyStations(): StationBundle {
  return {
    crawl: toolOk(buildCrawl(), { sources: ['crawl'] }),
    gsc: toolOk(buildGsc(), { sources: ['gsc'] }),
    gbp: toolOk(gbp, { sources: ['gbp'] }),
  }
}
