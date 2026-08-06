// Shared site skeleton: the HEALTHY baseline every scenario starts from.
//
// Scenarios inject defects by replacing parts of this baseline, which is what
// keeps a scenario's blast radius honest: if a template-scoped bug is supposed to
// touch one page group, the rest of the site is provably untouched because it came
// from here unmodified.
//
// The baseline deliberately includes the documented real-world false positive in
// its DEFAULT GBP profile: a service-area business with a hidden storefront
// address. Every generated fixture therefore carries the trap, including the ones
// asserting a GBP defect — where it shows up as the magnitude having to equal the
// count of genuinely-missing fields and not one more.

import type {
  CrawlPageRecord,
  CrawlSiteRecord,
  GbpProfileRecord,
} from '@/lib/tools/crawl-record'
import type { GSCRow } from '@/lib/tools-gsc'
import { headingFor } from './encodings'
import type { Rng } from './rng'

export interface SiteVocab {
  origin: string
  brand: string
  category: string
  /** Where the business actually operates from, 'City, ST'. */
  businessCity: string
  /** Declared GBP service areas, 'City, ST'. */
  served: string[]
  /** Service slugs the site's money pages are built from. */
  services: string[]
}

export const VOCAB: Record<string, SiteVocab> = {
  valleyair: {
    origin: 'https://valleyair-hvac.example',
    brand: 'ValleyAir Heating & Air',
    category: 'HVAC contractor',
    businessCity: 'Sherman Oaks, CA',
    served: [
      'Van Nuys, CA',
      'Studio City, CA',
      'North Hollywood, CA',
      'Encino, CA',
      'Tarzana, CA',
      'Burbank, CA',
    ],
    services: [
      'ac-repair',
      'ac-installation',
      'furnace-repair',
      'furnace-installation',
      'heat-pump-installation',
      'mini-split-installation',
      'duct-cleaning',
      'duct-sealing',
      'thermostat-installation',
      'attic-insulation',
      'indoor-air-quality',
      'hvac-maintenance',
    ],
  },
  trident: {
    origin: 'https://trident-plumbing.example',
    brand: 'Trident Plumbing',
    category: 'Plumber',
    businessCity: 'Culver City, CA',
    served: ['Santa Monica, CA', 'Venice, CA', 'Mar Vista, CA', 'Palms, CA', 'Del Rey, CA'],
    services: [
      'drain-cleaning',
      'water-heater-repair',
      'water-heater-installation',
      'leak-detection',
      'repiping',
      'sewer-line-repair',
      'tankless-water-heaters',
      'gas-line-services',
      'slab-leak-repair',
      'hydro-jetting',
    ],
  },
  northstar: {
    origin: 'https://northstar-roofing.example',
    brand: 'Northstar Roofing',
    category: 'Roofing contractor',
    businessCity: 'Aurora, CO',
    served: ['Denver, CO', 'Lakewood, CO', 'Centennial, CO', 'Littleton, CO', 'Englewood, CO'],
    services: [
      'roof-replacement',
      'roof-repair',
      'hail-damage-repair',
      'gutter-installation',
      'siding-replacement',
      'skylight-repair',
      'flat-roofing',
      'roof-inspection',
    ],
  },
  brightpath: {
    origin: 'https://brightpath-electric.example',
    brand: 'Brightpath Electric',
    category: 'Electrician',
    businessCity: 'Sherman Oaks, CA',
    served: [
      'Van Nuys, CA',
      'Reseda, CA',
      'Northridge, CA',
      'Canoga Park, CA',
      'Woodland Hills, CA',
      'Winnetka, CA',
      'Chatsworth, CA',
    ],
    services: [
      'panel-upgrade',
      'ev-charger-installation',
      'rewiring',
      'lighting-installation',
      'generator-installation',
      'electrical-inspection',
      'ceiling-fan-installation',
      'outlet-installation',
    ],
  },
}

export function urlFor(vocab: SiteVocab, path: string): string {
  return `${vocab.origin}${path}`
}

export function citySlug(cityState: string): string {
  return cityState.split(',')[0].trim().toLowerCase().replace(/\s+/g, '-')
}

export interface PageSeed {
  path: string
  templateGroup?: string | null
  targetGeo?: string | null
  wordCount?: number
  uniqueWordCount?: number
  /** Overrides for anything else — used sparingly, by scenarios only. */
  override?: Partial<CrawlPageRecord>
}

/**
 * A page with every rubric-relevant signal in its CORRECT state.
 *
 * Any defect in a generated fixture therefore traces to exactly one injector
 * call, which is what makes the manifest's magnitudes auditable by reading the
 * scenario rather than the data.
 */
export function healthyPage(vocab: SiteVocab, seed: PageSeed): CrawlPageRecord {
  const url = urlFor(vocab, seed.path)
  const heading = headingFor(url) || vocab.brand
  const wordCount = seed.wordCount ?? 1120
  return {
    url,
    status: 200,
    title: `${heading} | ${vocab.brand}`,
    metaDescription: `${heading} from ${vocab.brand}, serving ${vocab.businessCity.split(',')[0]} and the surrounding area.`,
    h1s: [heading],
    canonical: url,
    robotsMeta: 'index,follow',
    hasViewportMeta: true,
    tapTargetsOk: true,
    analytics: { ga4: true, gtm: false },
    internalLinksOut: 16,
    internalLinksIn: 11,
    wordCount,
    uniqueWordCount: seed.uniqueWordCount ?? Math.round(wordCount * 0.84),
    templateGroup: seed.templateGroup ?? null,
    targetGeo: seed.targetGeo ?? null,
    ...seed.override,
  }
}

/** A robots.txt that blocks nothing a public crawl contains. */
export function healthySite(vocab: SiteVocab): CrawlSiteRecord {
  return {
    robotsTxt: `User-agent: *\nDisallow: /wp-admin/\nSitemap: ${vocab.origin}/sitemap.xml\n`,
    sitemapUrls: [`${vocab.origin}/sitemap.xml`],
  }
}

/**
 * A complete profile — including the SAB-with-hidden-address configuration that
 * an earlier audit tool wrongly docked. LOCAL-003 must pass on this.
 */
export function healthyGbp(vocab: SiteVocab): GbpProfileRecord {
  return {
    name: vocab.brand,
    primaryCategory: vocab.category,
    isServiceAreaBusiness: true,
    storefrontAddress: null,
    businessCity: vocab.businessCity,
    serviceAreas: vocab.served.slice(),
    hoursComplete: true,
    phone: '+1-555-0100',
    websiteUri: vocab.origin,
    description: `${vocab.brand} provides ${vocab.category.toLowerCase()} services across ${vocab.served.length} communities.`,
    photoCount: 24,
    rating: 4.8,
    reviewCount: 96,
  }
}

// ---------------------------------------------------------------------------
// query pool
// ---------------------------------------------------------------------------

/**
 * A pool of distinct GSC queries, handed out one at a time.
 *
 * Uniqueness is load-bearing, not tidiness: ONPAGE-006's magnitude is the number
 * of queries served by more than one URL, so if a cannibalisation cluster and a
 * near-miss cluster accidentally drew the same query string they would merge and
 * the near-miss precision guard would silently become another positive.
 */
export class QueryPool {
  private readonly queue: string[]
  private handed = 0

  constructor(vocab: SiteVocab, rng: Rng) {
    const modifiers = ['', ' near me', ' cost', ' company', ' service', ' quote', ' prices']
    const cities = ['', ...vocab.served.map((s) => ` ${s.split(',')[0].toLowerCase()}`)]
    const all: string[] = []
    for (const service of vocab.services) {
      const base = service.replace(/-/g, ' ')
      for (const city of cities) {
        for (const mod of modifiers) {
          const q = `${base}${city}${mod}`.trim()
          if (q !== base || city === '') all.push(q)
        }
      }
    }
    this.queue = rng.shuffle(Array.from(new Set(all)))
  }

  take(n: number): string[] {
    if (this.handed + n > this.queue.length) {
      throw new Error(`QueryPool exhausted: asked for ${n}, ${this.queue.length - this.handed} left`)
    }
    const out = this.queue.slice(this.handed, this.handed + n)
    this.handed += n
    return out
  }
}

export function gscRow(
  query: string,
  page: string,
  impressions: number,
  clicks: number,
  position: number,
): GSCRow {
  return {
    query,
    page,
    clicks,
    impressions,
    ctr: impressions > 0 ? Math.round((clicks / impressions) * 1000) / 10 : 0,
    position,
  }
}
