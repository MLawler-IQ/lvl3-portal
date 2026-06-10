'use server'

import { requireAdmin } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/server'
import { fetchPageSpeedInsights } from '@/lib/connectors/pagespeed'
import type { PageSpeedResult } from '@/lib/connectors/pagespeed'
import { fetchAndParse } from '@/lib/connectors/crawler'
import type { ParsedPage } from '@/lib/connectors/crawler'
import { fetchKEKeywordData } from '@/lib/connectors/keywords-everywhere'
import type { KEKeywordRow } from '@/lib/connectors/keywords-everywhere'
import { fetchSemrushBacklinksOverview, fetchSemrushDomainRanks } from '@/lib/connectors/semrush-portal'
import type { SemrushBacklinksOverview, SemrushDomainRank } from '@/lib/connectors/semrush-portal'
import { normalizeDomain } from '@/lib/normalize-domain'
import { getAdminGBPOAuthClient } from '@/lib/gbp-auth'
import { listGBPAccounts } from '@/lib/connectors/gbp'
import type { GBPAccount } from '@/lib/connectors/gbp'

// ── Core Web Vitals ─────────────────────────────────────────────────────────

export async function fetchCoreWebVitals(
  url: string,
  strategy: 'mobile' | 'desktop' = 'mobile',
): Promise<{ data?: PageSpeedResult; error?: string }> {
  try {
    await requireAdmin()
    const apiKey = process.env.PAGESPEED_API_KEY
    const result = await fetchPageSpeedInsights(url, strategy, apiKey)
    if (!result.ok) return { error: result.error }
    return { data: result.data }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Failed to fetch Core Web Vitals' }
  }
}

// ── Page SEO Audit ──────────────────────────────────────────────────────────

export type PageSeoResult = ParsedPage & {
  issues: string[]
}

export async function fetchPageSeoAudit(
  url: string,
): Promise<{ data?: PageSeoResult; error?: string }> {
  try {
    await requireAdmin()
    const result = await fetchAndParse(url)
    if (!result.ok) return { error: result.error }
    const page = result.data

    const issues: string[] = []
    if (!page.title) issues.push('Missing title tag')
    if (!page.metaDescription) issues.push('Missing meta description')
    if (page.title.length > 60) issues.push(`Title too long (${page.title.length} chars, max 60)`)
    if (page.metaDescription.length > 160) issues.push(`Meta description too long (${page.metaDescription.length} chars, max 160)`)
    const h1s = page.headings.filter((h) => h.level === 1)
    if (h1s.length === 0) issues.push('Missing H1 tag')
    if (h1s.length > 1) issues.push(`Multiple H1 tags (${h1s.length})`)
    const missingAlt = page.images.filter((i) => !i.hasAlt).length
    if (missingAlt > 0) issues.push(`${missingAlt} image(s) missing alt text`)
    if (page.robots.includes('noindex')) issues.push('Page has noindex directive')
    if (!page.canonical) issues.push('Missing canonical tag')
    if (page.structuredData.length === 0) issues.push('No structured data found')
    if (page.wordCount < 300) issues.push(`Thin content (${page.wordCount} words)`)

    return { data: { ...page, issues } }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Failed to audit page' }
  }
}

// ── Keyword Research ────────────────────────────────────────────────────────

export async function fetchKeywordResearch(
  keywords: string[],
  country = 'us',
): Promise<{ data?: KEKeywordRow[]; error?: string }> {
  try {
    await requireAdmin()
    const apiKey = process.env.KEYWORDS_EVERYWHERE_API_KEY
    if (!apiKey) return { error: 'KEYWORDS_EVERYWHERE_API_KEY is not configured.' }
    const rows = await fetchKEKeywordData(keywords, apiKey, country)
    if (!rows.ok) return { error: rows.error }
    return { data: rows.data }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Failed to fetch keyword data' }
  }
}

// ── Backlink Overview ───────────────────────────────────────────────────────

export type BacklinkResult = {
  domain: string
  ranks: SemrushDomainRank | null
  backlinks: SemrushBacklinksOverview | null
}

export async function fetchBacklinkOverview(
  clientId: string,
): Promise<{ data?: BacklinkResult; error?: string }> {
  try {
    await requireAdmin()
    const apiKey = process.env.SEMRUSH_API_KEY
    if (!apiKey) return { error: 'SEMRUSH_API_KEY is not configured.' }

    const service = await createServiceClient()
    const { data: client } = await service
      .from('clients')
      .select('gsc_site_url')
      .eq('id', clientId)
      .single()

    if (!client?.gsc_site_url) {
      return { error: 'No GSC site configured for this client.' }
    }

    const domain = normalizeDomain(client.gsc_site_url)
    const [ranks, backlinks] = await Promise.all([
      fetchSemrushDomainRanks(domain, apiKey),
      fetchSemrushBacklinksOverview(domain, apiKey),
    ])

    // API failure ≠ "no data": surface the connector error so a broken key
    // doesn't render as an empty result.
    if (!ranks.ok) return { error: ranks.error }
    if (!backlinks.ok) return { error: backlinks.error }

    return { data: { domain, ranks: ranks.data, backlinks: backlinks.data } }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Failed to fetch backlink overview' }
  }
}

// ── Content Quality ─────────────────────────────────────────────────────────

export type ContentQualityResult = {
  url: string
  wordCount: number
  readingLevel: string
  contentToHtmlRatio: number
  headingStructure: { level: number; text: string }[]
  imageAltCoverage: { total: number; withAlt: number; percent: number }
  internalLinks: number
  externalLinks: number
  issues: string[]
  score: number
}

function fleschKincaidGrade(text: string): number {
  const sentences = text.split(/[.!?]+/).filter((s) => s.trim().length > 0).length || 1
  const words = text.split(/\s+/).filter((w) => w.length > 0)
  const wordCount = words.length || 1
  const syllables = words.reduce((total, word) => {
    const matches = word.toLowerCase().match(/[aeiouy]+/g)
    return total + (matches ? matches.length : 1)
  }, 0)
  return 0.39 * (wordCount / sentences) + 11.8 * (syllables / wordCount) - 15.59
}

function gradeToLabel(grade: number): string {
  if (grade <= 6) return 'Easy (6th grade)'
  if (grade <= 8) return 'Standard (8th grade)'
  if (grade <= 10) return 'Moderate (10th grade)'
  if (grade <= 12) return 'Difficult (12th grade)'
  return 'Very Difficult (college level)'
}

export async function fetchContentQuality(
  url: string,
): Promise<{ data?: ContentQualityResult; error?: string }> {
  try {
    await requireAdmin()
    const result = await fetchAndParse(url)
    if (!result.ok) return { error: result.error }
    const page = result.data

    const grade = fleschKincaidGrade(page.bodyText || page.headings.map((h) => h.text).join('. '))

    const withAlt = page.images.filter((i) => i.hasAlt).length
    const internalLinks = page.links.filter((l) => l.isInternal).length
    const externalLinks = page.links.filter((l) => !l.isInternal).length

    const issues: string[] = []
    let score = 100

    if (page.wordCount < 300) {
      issues.push(`Thin content: ${page.wordCount} words (recommend 800+)`)
      score -= 25
    } else if (page.wordCount < 800) {
      issues.push(`Light content: ${page.wordCount} words (recommend 800+)`)
      score -= 10
    }

    if (page.contentToHtmlRatio < 10) {
      issues.push(`Low content-to-HTML ratio: ${page.contentToHtmlRatio}%`)
      score -= 10
    }

    const h1s = page.headings.filter((h) => h.level === 1)
    if (h1s.length === 0) {
      issues.push('Missing H1 tag')
      score -= 15
    }
    if (h1s.length > 1) {
      issues.push(`Multiple H1 tags (${h1s.length})`)
      score -= 5
    }

    const altPercent = page.images.length > 0 ? Math.round((withAlt / page.images.length) * 100) : 100
    if (altPercent < 80) {
      issues.push(`Only ${altPercent}% of images have alt text`)
      score -= 10
    }

    if (internalLinks < 3) {
      issues.push(`Low internal linking: ${internalLinks} links (recommend 3+)`)
      score -= 10
    }

    return {
      data: {
        url,
        wordCount: page.wordCount,
        readingLevel: gradeToLabel(grade),
        contentToHtmlRatio: page.contentToHtmlRatio,
        headingStructure: page.headings,
        imageAltCoverage: { total: page.images.length, withAlt, percent: altPercent },
        internalLinks,
        externalLinks,
        issues,
        score: Math.max(0, score),
      },
    }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Failed to analyze content quality' }
  }
}

// ── GBP Accounts ─────────────────────────────────────────────────────────────

export async function fetchGBPAccounts(): Promise<{ data?: GBPAccount[]; error?: string }> {
  try {
    await requireAdmin()
    const auth = await getAdminGBPOAuthClient()
    const accounts = await listGBPAccounts(auth)
    return { data: accounts }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Failed to list GBP accounts' }
  }
}
