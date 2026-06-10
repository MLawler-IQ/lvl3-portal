import * as cheerio from 'cheerio'
import { assertPublicHttpUrl } from '@/lib/url-guard'
import { connectorErr, connectorOk, type ConnectorResult } from './types'

export interface HeadingInfo {
  level: number
  text: string
}

export interface LinkInfo {
  href: string
  text: string
  isInternal: boolean
  isNofollow: boolean
}

export interface ImageInfo {
  src: string
  alt: string
  hasAlt: boolean
}

export interface StructuredDataItem {
  type: string
  raw: string
}

export interface ParsedPage {
  url: string
  statusCode: number
  title: string
  metaDescription: string
  canonical: string
  robots: string
  headings: HeadingInfo[]
  links: LinkInfo[]
  images: ImageInfo[]
  structuredData: StructuredDataItem[]
  wordCount: number
  bodyText: string
  contentToHtmlRatio: number
  ogTags: Record<string, string>
  hreflang: { lang: string; href: string }[]
}

function resolveUrl(base: string, relative: string): string | null {
  try {
    return new URL(relative, base).href
  } catch {
    return null
  }
}

function getHostname(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return ''
  }
}

export async function fetchAndParse(url: string): Promise<ConnectorResult<ParsedPage>> {
  let res: Response
  let html: string
  try {
    assertPublicHttpUrl(url)
    res = await fetch(url, {
      headers: {
        'User-Agent': 'LVL3-Portal-Crawler/1.0',
        Accept: 'text/html,application/xhtml+xml',
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(15000),
    })

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${res.statusText || 'Failed to fetch page'}`)
    }

    html = await res.text()
  } catch (err) {
    return connectorErr(err)
  }
  const $ = cheerio.load(html)
  const baseHost = getHostname(url)

  const title = $('title').first().text().trim()
  const metaDescription = $('meta[name="description"]').attr('content')?.trim() ?? ''
  const canonical = $('link[rel="canonical"]').attr('href')?.trim() ?? ''
  const robots = $('meta[name="robots"]').attr('content')?.trim() ?? ''

  const headings: HeadingInfo[] = []
  for (let level = 1; level <= 6; level++) {
    $(`h${level}`).each((_, el) => {
      headings.push({ level, text: $(el).text().trim() })
    })
  }

  const links: LinkInfo[] = []
  $('a[href]').each((_, el) => {
    const href = $(el).attr('href') ?? ''
    const resolved = resolveUrl(url, href)
    if (!resolved) return
    const linkHost = getHostname(resolved)
    links.push({
      href: resolved,
      text: $(el).text().trim(),
      isInternal: linkHost === baseHost,
      isNofollow: ($(el).attr('rel') ?? '').includes('nofollow'),
    })
  })

  const images: ImageInfo[] = []
  $('img').each((_, el) => {
    const src = $(el).attr('src') ?? ''
    const alt = $(el).attr('alt') ?? ''
    images.push({ src, alt, hasAlt: $(el).attr('alt') !== undefined })
  })

  const structuredData: StructuredDataItem[] = []
  $('script[type="application/ld+json"]').each((_, el) => {
    const raw = $(el).html()?.trim() ?? ''
    try {
      const parsed = JSON.parse(raw)
      const type = parsed['@type'] ?? (Array.isArray(parsed['@graph']) ? 'Graph' : 'Unknown')
      structuredData.push({ type: String(type), raw })
    } catch {
      structuredData.push({ type: 'ParseError', raw: raw.slice(0, 200) })
    }
  })

  const bodyText = $('body').text().replace(/\s+/g, ' ').trim()
  const wordCount = bodyText.split(/\s+/).filter((w) => w.length > 0).length
  const contentToHtmlRatio = html.length > 0 ? Math.round((bodyText.length / html.length) * 100) : 0

  const ogTags: Record<string, string> = {}
  $('meta[property^="og:"]').each((_, el) => {
    const prop = $(el).attr('property') ?? ''
    ogTags[prop] = $(el).attr('content') ?? ''
  })

  const hreflang: { lang: string; href: string }[] = []
  $('link[rel="alternate"][hreflang]').each((_, el) => {
    hreflang.push({
      lang: $(el).attr('hreflang') ?? '',
      href: $(el).attr('href') ?? '',
    })
  })

  return connectorOk({
    url,
    statusCode: res.status,
    title,
    metaDescription,
    canonical,
    robots,
    headings,
    links,
    images,
    structuredData,
    wordCount,
    bodyText,
    contentToHtmlRatio,
    ogTags,
    hreflang,
  })
}
