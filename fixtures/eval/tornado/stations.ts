// The tornado fixture: station data transcribed from the documented Tornado HVAC
// audit (AUTOMATION-CONTEXT.md §9) — ground truth that was written down BEFORE any
// pipeline code existed, which is what makes it uncircular.
//
// Magnitudes are exact where the manifest asserts them:
//   206 URLs · 191 missing H1 · 92 failing mobile viewport/tap targets ·
//   187 pages without an analytics tag · 7 cannibalised query clusters ·
//   8 location pages targeting Orange County geography the profile cannot serve.
//
// Built by deterministic loops, not 206 hand-written literals, so the numbers
// above are auditable at a glance. No randomness, no dates.
//
// This hand-built version is scheduled to be REPLACED by record-and-replay
// snapshots of the real Tornado stations once the pipeline runs live (the plan's
// L2). The manifest stays; only the station data gets realer.

import type { StationBundle } from '@/lib/findings/types'
import type { CrawlPageRecord, CrawlStationData, GbpProfileRecord } from '@/lib/tools/crawl-record'
import type { GSCRow } from '@/lib/tools-gsc'
import { toolOk } from '@/lib/tools/contract'

const SITE = 'https://tornadohvacca.com'

/** The 10 San Fernando Valley areas the GBP profile actually declares. */
const SERVED = [
  'Van Nuys, CA',
  'Studio City, CA',
  'North Hollywood, CA',
  'Encino, CA',
  'Tarzana, CA',
  'Burbank, CA',
  'Glendale, CA',
  'Woodland Hills, CA',
  'Reseda, CA',
  'Canoga Park, CA',
]

/** Orange County targets 45-65 miles from the real address — the LOCAL-016 defect. */
const NOT_SERVED = [
  'Anaheim, CA',
  'Irvine, CA',
  'Orange, CA',
  'Tustin, CA',
  'Costa Mesa, CA',
  'Fullerton, CA',
  'Santa Ana, CA',
  'Huntington Beach, CA',
]

const SERVICES = [
  'air-duct-cleaning', 'dryer-vent-cleaning', 'hvac-repair', 'ac-installation',
  'heater-repair', 'furnace-installation', 'heat-pump-installation', 'mini-split-installation',
  'thermostat-installation', 'attic-insulation', 'water-heater-installation', 'hvac-inspection',
  'dustless-duct-cleaning',
]

function page(over: Partial<CrawlPageRecord> & { url: string }): CrawlPageRecord {
  return {
    status: 200,
    title: 'Tornado HVAC | Los Angeles Heating & Cooling',
    metaDescription: 'HVAC and duct cleaning services in Los Angeles.',
    h1s: [],
    canonical: over.url,
    robotsMeta: 'index,follow',
    hasViewportMeta: true,
    tapTargetsOk: true,
    analytics: { ga4: false, gtm: false },
    internalLinksOut: 186, // §9: the mega-menu links everything to everything
    internalLinksIn: 186, // §9: median identical for earning and invisible pages
    wordCount: 1420,
    // §9: the AI-generated pages are 71% boilerplate — 29% unique of 1420.
    uniqueWordCount: 412,
    templateGroup: null,
    targetGeo: null,
    ...over,
  }
}

function buildCrawl(): CrawlStationData {
  const pages: CrawlPageRecord[] = []

  // 1. Homepage — topic lives in an H2; no H1 (§9, "including the homepage").
  pages.push(page({ url: `${SITE}/`, wordCount: 900 }))

  // 2. 130 AI-generated /Service/ pages, one template. No H1. The first 74 also
  //    fail mobile viewport (74 + the 18 area pages = the 92 §9 counts).
  for (let i = 0; i < 130; i++) {
    const service = SERVICES[i % SERVICES.length]
    pages.push(
      page({
        url: `${SITE}/Service/${service}-in-los-angeles-ca-${Math.floor(i / SERVICES.length)}/`,
        templateGroup: 'service-la',
        hasViewportMeta: i >= 74,
        tapTargetsOk: i >= 74,
      }),
    )
  }

  // 3. 18 area pages: 8 target Orange County (incoherent), 10 target served
  //    areas. All fail viewport; none has an H1.
  const geos = [...NOT_SERVED, ...SERVED.slice(0, 10)]
  for (let i = 0; i < 18; i++) {
    pages.push(
      page({
        url: `${SITE}/areas-we-serve/${geos[i].split(',')[0].toLowerCase().replace(/\s+/g, '-')}/`,
        templateGroup: 'area',
        targetGeo: geos[i],
        hasViewportMeta: false,
        tapTargetsOk: false,
      }),
    )
  }

  // 4. 42 misc/blog pages, no H1; 4 of them carry a GTM tag (with the 15 legacy
  //    pages below, that makes 19 tagged, 187 untagged — §9's exact number).
  for (let i = 0; i < 42; i++) {
    pages.push(
      page({
        url: `${SITE}/blog/post-${i + 1}/`,
        templateGroup: 'blog',
        wordCount: 650,
        uniqueWordCount: 520,
        analytics: { ga4: false, gtm: i < 4 },
      }),
    )
  }

  // 5. 15 legacy hand-built pages — the site's best assets (§9: /attic-fan-install/
  //    ranks #1). Proper single H1, tagged. These are the 15 of 206 with a
  //    correct H1.
  const legacy = [
    'attic-fan-install', 'heat-pump-install', 'furnace-install', 'air-duct-cleaning',
    'water-heater-repair', 'ac-repair', 'thermostat-install', 'hvac-tune-up',
    'dryer-vent-cleaning', 'mini-split-repair', 'insulation-removal', 'air-quality-testing',
    'commercial-hvac', 'emergency-hvac', 'duct-sealing',
  ]
  for (const slug of legacy) {
    pages.push(
      page({
        url: `${SITE}/${slug}/`,
        h1s: [slug.replace(/-/g, ' ')],
        analytics: { ga4: false, gtm: true },
        wordCount: 1500,
        uniqueWordCount: 1350, // hand-built: little shared boilerplate
        internalLinksOut: 24,
        internalLinksIn: 31,
      }),
    )
  }

  return {
    site: {
      robotsTxt: 'User-agent: *\nAllow: /\nSitemap: https://tornadohvacca.com/sitemap.xml',
      robotsTxtStatus: 'ok',
      // Not measured on the pilot crawl, and no check reads it yet.
      llmsTxt: null,
      llmsTxtStatus: 'not-fetched',
      sitemapUrls: [`${SITE}/sitemap.xml`],
    },
    pages,
  }
}

function gscRow(query: string, path: string, impressions: number, clicks: number, position: number): GSCRow {
  return {
    query,
    page: `${SITE}${path}`,
    clicks,
    impressions,
    ctr: impressions > 0 ? Math.round((clicks / impressions) * 1000) / 10 : 0,
    position,
  }
}

function buildGsc(): GSCRow[] {
  return [
    // §9's seven cannibalised clusters: two page generations fighting.
    gscRow('dustless duct cleaning', '/Service/dustless-duct-cleaning-in-los-angeles-ca-0/', 400, 2, 35),
    gscRow('dustless duct cleaning', '/Service/dustless-duct-cleaning-in-los-angeles-ca-1/', 220, 0, 70),
    gscRow('dustless duct cleaning', '/Service/dustless-duct-cleaning-in-los-angeles-ca-2/', 150, 0, 82),
    gscRow('dustless duct cleaning', '/duct-sealing/', 90, 0, 90),
    gscRow('water heater installation', '/Service/water-heater-installation-in-los-angeles-ca-0/', 300, 1, 28),
    gscRow('water heater installation', '/water-heater-repair/', 260, 3, 22),
    gscRow('water heater installation', '/Service/water-heater-installation-in-los-angeles-ca-1/', 120, 0, 55),
    gscRow('thermostat installation', '/Service/thermostat-installation-in-los-angeles-ca-0/', 180, 1, 31),
    gscRow('thermostat installation', '/thermostat-install/', 140, 2, 19),
    gscRow('hvac inspection', '/Service/hvac-inspection-in-los-angeles-ca-0/', 160, 0, 41),
    gscRow('hvac inspection', '/hvac-tune-up/', 110, 1, 26),
    gscRow('heat pump installation', '/Service/heat-pump-installation-in-los-angeles-ca-0/', 210, 1, 38),
    gscRow('heat pump installation', '/heat-pump-install/', 190, 4, 15),
    gscRow('furnace installation', '/Service/furnace-installation-in-los-angeles-ca-0/', 170, 0, 44),
    gscRow('furnace installation', '/furnace-install/', 150, 2, 21),
    gscRow('mini split installation', '/Service/mini-split-installation-in-los-angeles-ca-0/', 130, 0, 49),
    gscRow('mini split installation', '/mini-split-repair/', 95, 1, 33),
    // Singles — real signal, no cannibalisation.
    gscRow('air duct cleaning', '/air-duct-cleaning/', 22596, 1, 17.9),
    gscRow('attic fan installation near me', '/attic-fan-install/', 1450, 210, 1.2),
    gscRow('tornado hvac', '/', 800, 122, 1.0),
  ]
}

const gbp: GbpProfileRecord = {
  name: 'Tornado HVAC',
  primaryCategory: 'HVAC contractor',
  // The real Tornado configuration: a service-area business with a hidden
  // address. CORRECT setup — the §9 false positive was an audit docking it.
  isServiceAreaBusiness: true,
  storefrontAddress: null,
  businessCity: 'Sherman Oaks, CA',
  serviceAreas: SERVED,
  hoursComplete: true, // Open 24 hours (§9)
  phone: '+1-818-555-0100',
  websiteUri: SITE,
  description: '24/7 HVAC repair, installation and duct cleaning in the San Fernando Valley.',
  photoCount: 25,
  rating: 5.0,
  reviewCount: 129,
}

/** The tornado station bundle, ToolResult-shaped exactly as live stations return. */
export function tornadoStations(): StationBundle {
  return {
    crawl: toolOk(buildCrawl(), { sources: ['crawl'] }),
    gsc: toolOk(buildGsc(), { sources: ['gsc'] }),
    gbp: toolOk(gbp, { sources: ['gbp'] }),
  }
}
