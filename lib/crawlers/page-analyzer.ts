import * as cheerio from 'cheerio'
import { assertPublicHttpUrl } from '@/lib/url-guard'

export interface SchemaBlock {
  type: string
  raw: string
}

export interface PageAnalysis {
  url: string
  title: string | null
  metaDescription: string | null
  h1: string | null
  headings: Array<{ level: number; text: string }>
  wordCount: number
  schemaBlocks: SchemaBlock[]
  schemaTypes: string[]
  internalLinks: number
  externalLinks: number
  imagesWithoutAlt: number
  hasAuthorByline: boolean
  hasFaqSection: boolean
  hasHowToContent: boolean
  hasTldrSection: boolean
  hasDirectAnswerAboveFold: boolean
  ctaCount: number
  formCount: number
  trustSignals: string[]
  error?: string
}

export interface PsiResult {
  url: string
  lcp: number | null        // Largest Contentful Paint (ms)
  cls: number | null        // Cumulative Layout Shift
  fid: number | null        // First Input Delay (ms)
  ttfb: number | null       // Time to First Byte (ms)
  performanceScore: number | null  // 0-100
  error?: string
}

/** Extract hostname from URL for rate-limiting key */
export function getHost(url: string): string {
  try { return new URL(url).hostname } catch { return url }
}

/** Fetch and parse a page, returning structured analysis */
export async function analyzePage(url: string): Promise<PageAnalysis> {
  try {
    assertPublicHttpUrl(url)
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'LVL3-Crawler/1.0 (+https://lvl3-portal.vercel.app)',
        'Accept': 'text/html',
      },
      signal: AbortSignal.timeout(15000),
    })

    if (!res.ok) {
      return { url, title: null, metaDescription: null, h1: null, headings: [], wordCount: 0,
        schemaBlocks: [], schemaTypes: [], internalLinks: 0, externalLinks: 0,
        imagesWithoutAlt: 0, hasAuthorByline: false, hasFaqSection: false, hasHowToContent: false,
        hasTldrSection: false, hasDirectAnswerAboveFold: false, ctaCount: 0, formCount: 0,
        trustSignals: [], error: `HTTP ${res.status}` }
    }

    const html = await res.text()
    const $ = cheerio.load(html)

    // Remove script/style/nav from text analysis
    $('script, style, noscript, nav, footer, header').remove()

    const title = $('title').first().text().trim() || null
    const metaDescription = $('meta[name="description"]').attr('content')?.trim() || null
    const h1 = $('h1').first().text().trim() || null

    const headings: PageAnalysis['headings'] = []
    $('h1,h2,h3,h4,h5,h6').each((_, el) => {
      const level = parseInt((el as { name: string }).name.replace('h', ''))
      headings.push({ level, text: $(el).text().trim() })
    })

    const bodyText = $('body').text().replace(/\s+/g, ' ').trim()
    const wordCount = bodyText.split(' ').filter(Boolean).length

    // Schema extraction
    const schemaBlocks: SchemaBlock[] = []
    $('script[type="application/ld+json"]').each((_, el) => {
      const raw = $(el).html() ?? ''
      try {
        const parsed = JSON.parse(raw) as { '@type'?: string | string[]; '@graph'?: unknown[] }
        const type = parsed['@type'] ?? (Array.isArray(parsed['@graph']) ? 'Graph' : 'Unknown')
        schemaBlocks.push({ type: Array.isArray(type) ? type.join(',') : String(type), raw })
      } catch {
        schemaBlocks.push({ type: 'Invalid', raw })
      }
    })
    const schemaTypes = Array.from(new Set(schemaBlocks.map(s => s.type)))

    // Links
    const pageHost = getHost(url)
    let internalLinks = 0, externalLinks = 0
    $('a[href]').each((_, el) => {
      const href = $(el).attr('href') ?? ''
      if (href.startsWith('http') && !href.includes(pageHost)) externalLinks++
      else internalLinks++
    })

    // Images without alt
    let imagesWithoutAlt = 0
    $('img').each((_, el) => {
      if (!$(el).attr('alt')) imagesWithoutAlt++
    })

    // GEO signals
    const fullHtml = html.toLowerCase()
    const hasAuthorByline = fullHtml.includes('author') || fullHtml.includes('written by') || !!$('[class*="author"],[rel="author"],[itemprop="author"]').length
    const hasFaqSection = schemaTypes.some(t => t.includes('FAQ')) || fullHtml.includes('frequently asked') || !!$('[class*="faq"]').length
    const hasHowToContent = schemaTypes.some(t => t.includes('HowTo')) || fullHtml.includes('how to') || fullHtml.includes('step-by-step')
    const hasTldrSection = fullHtml.includes('tl;dr') || fullHtml.includes('tldr') || fullHtml.includes('summary') || !!$('[class*="summary"],[id*="summary"]').length
    const hasDirectAnswerAboveFold = !!$('p').first().text() && ($('p').first().text().length ?? 0) > 80

    // CTAs and forms
    const ctaCount = $('a[class*="btn"],a[class*="button"],button[type="submit"],.cta,[class*="cta"]').length
    const formCount = $('form').length

    // Trust signals (look for common patterns)
    const trustSignals: string[] = []
    if (fullHtml.includes('bbb') || fullHtml.includes('better business bureau')) trustSignals.push('BBB')
    if (fullHtml.includes('google') && (fullHtml.includes('rating') || fullHtml.includes('review'))) trustSignals.push('Google Reviews')
    if (fullHtml.includes('license') || fullHtml.includes('licensed')) trustSignals.push('Licensed')
    if (fullHtml.includes('insured')) trustSignals.push('Insured')
    if (fullHtml.includes('years') && (fullHtml.includes('experience') || fullHtml.includes('business'))) trustSignals.push('Years of Experience')
    if (fullHtml.includes('guarantee') || fullHtml.includes('warranty')) trustSignals.push('Guarantee/Warranty')

    return {
      url, title, metaDescription, h1, headings, wordCount,
      schemaBlocks, schemaTypes, internalLinks, externalLinks,
      imagesWithoutAlt, hasAuthorByline, hasFaqSection, hasHowToContent,
      hasTldrSection, hasDirectAnswerAboveFold, ctaCount, formCount,
      trustSignals,
    }
  } catch (err) {
    return {
      url, title: null, metaDescription: null, h1: null, headings: [], wordCount: 0,
      schemaBlocks: [], schemaTypes: [], internalLinks: 0, externalLinks: 0,
      imagesWithoutAlt: 0, hasAuthorByline: false, hasFaqSection: false, hasHowToContent: false,
      hasTldrSection: false, hasDirectAnswerAboveFold: false, ctaCount: 0, formCount: 0,
      trustSignals: [],
      error: err instanceof Error ? err.message : 'Unknown error',
    }
  }
}

/** Fetch PageSpeed Insights data for a URL */
export async function analyzePsi(url: string): Promise<PsiResult> {
  const apiKey = process.env.GOOGLE_PSI_API_KEY ?? process.env.NEXT_PUBLIC_GOOGLE_PSI_API_KEY ?? ''
  const endpoint = `https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=${encodeURIComponent(url)}&strategy=mobile&category=performance${apiKey ? `&key=${apiKey}` : ''}`

  try {
    const res = await fetch(endpoint, { signal: AbortSignal.timeout(30000) })
    if (!res.ok) return { url, lcp: null, cls: null, fid: null, ttfb: null, performanceScore: null, error: `HTTP ${res.status}` }

    const data = await res.json() as {
      lighthouseResult?: {
        categories?: { performance?: { score?: number } }
        audits?: {
          'largest-contentful-paint'?: { numericValue?: number }
          'cumulative-layout-shift'?: { numericValue?: number }
          'total-blocking-time'?: { numericValue?: number }
          'server-response-time'?: { numericValue?: number }
        }
      }
    }

    const lr = data.lighthouseResult
    return {
      url,
      lcp: lr?.audits?.['largest-contentful-paint']?.numericValue ?? null,
      cls: lr?.audits?.['cumulative-layout-shift']?.numericValue ?? null,
      fid: lr?.audits?.['total-blocking-time']?.numericValue ?? null,
      ttfb: lr?.audits?.['server-response-time']?.numericValue ?? null,
      performanceScore: lr?.categories?.performance?.score != null
        ? Math.round(lr.categories.performance.score * 100)
        : null,
    }
  } catch (err) {
    return { url, lcp: null, cls: null, fid: null, ttfb: null, performanceScore: null, error: err instanceof Error ? err.message : 'PSI error' }
  }
}
