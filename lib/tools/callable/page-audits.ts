// The three URL-scoped page audits: Core Web Vitals, Page SEO, Content Quality.
//
// Grouped in one module because they share a shape — take a URL, hit one connector,
// apply a rule set — and because the rule sets are the part worth testing. Extracted
// from app/actions/tools-extended.ts.
//
// None of them requires a client, which is why `requires.client` is false: an
// orchestrator auditing a competitor's page has no client row for it.

import { fetchPageSpeedInsights, type PageSpeedResult } from '@/lib/connectors/pagespeed'
import { fetchAndParse, type ParsedPage } from '@/lib/connectors/crawler'
import { fetchKEKeywordData, type KEKeywordRow } from '@/lib/connectors/keywords-everywhere'
import {
  toolOk,
  toolErr,
  runGuarded,
  fromConnector,
  type CallableTool,
} from '../contract'

// ── Core Web Vitals ───────────────────────────────────────────────────────────

export interface CoreWebVitalsInput {
  url: string
  strategy?: 'mobile' | 'desktop'
}

export const coreWebVitalsTool: CallableTool<CoreWebVitalsInput, PageSpeedResult> = {
  slug: 'core-web-vitals',
  requires: {},
  run: (input) =>
    runGuarded(['psi'], async () => {
      if (!input.url) return toolErr<PageSpeedResult>('A URL is required.', { sources: ['psi'] })
      // PSI has a daily quota. The connector already reports exhaustion as an error
      // rather than an empty result, which §9 records as the correct behaviour — an
      // audit that silently skips CWV is worse than one that says it could not run.
      const result = await fetchPageSpeedInsights(
        input.url,
        input.strategy ?? 'mobile',
        process.env.PAGESPEED_API_KEY,
      )
      return fromConnector(result, ['psi'])
    }),
}

// ── Page SEO Audit ────────────────────────────────────────────────────────────

export type PageSeoResult = ParsedPage & { issues: string[] }

/**
 * The on-page rule set, as a pure function.
 *
 * Every rule states a fact about the page rather than a score, so a caller can decide
 * severity for itself — which is what the rubric's severity column is for.
 */
export function pageSeoIssues(page: ParsedPage): string[] {
  const issues: string[] = []
  if (!page.title) issues.push('Missing title tag')
  if (!page.metaDescription) issues.push('Missing meta description')
  if (page.title.length > 60) issues.push(`Title too long (${page.title.length} chars, max 60)`)
  if (page.metaDescription.length > 160)
    issues.push(`Meta description too long (${page.metaDescription.length} chars, max 160)`)
  const h1s = page.headings.filter((h) => h.level === 1)
  if (h1s.length === 0) issues.push('Missing H1 tag')
  if (h1s.length > 1) issues.push(`Multiple H1 tags (${h1s.length})`)
  const missingAlt = page.images.filter((i) => !i.hasAlt).length
  if (missingAlt > 0) issues.push(`${missingAlt} image(s) missing alt text`)
  if (page.robots.includes('noindex')) issues.push('Page has noindex directive')
  if (!page.canonical) issues.push('Missing canonical tag')
  if (page.structuredData.length === 0) issues.push('No structured data found')
  if (page.wordCount < 300) issues.push(`Thin content (${page.wordCount} words)`)
  return issues
}

export const pageSeoAuditTool: CallableTool<{ url: string }, PageSeoResult> = {
  slug: 'page-seo-audit',
  requires: {},
  run: (input) =>
    runGuarded(['crawl'], async () => {
      if (!input.url) return toolErr<PageSeoResult>('A URL is required.', { sources: ['crawl'] })
      const result = await fetchAndParse(input.url)
      if (!result.ok) return toolErr<PageSeoResult>(result.error, { sources: ['crawl'] })
      const page = result.data
      return toolOk(
        { ...page, issues: pageSeoIssues(page) },
        {
          sources: ['crawl'],
          // The crawler is a single cheerio fetch: no JS execution. For a
          // client-side-rendered page that is a real limitation, not a pass.
          degraded: true,
          notes: [
            'Fetched without executing JavaScript, so client-rendered content is not visible to this check.',
          ],
        },
      )
    }),
}

// ── Content Quality ───────────────────────────────────────────────────────────

export interface ContentQualityResult {
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

/** Flesch-Kincaid grade level. Syllables are approximated by vowel groups. */
export function fleschKincaidGrade(text: string): number {
  const sentences = text.split(/[.!?]+/).filter((s) => s.trim().length > 0).length || 1
  const words = text.split(/\s+/).filter((w) => w.length > 0)
  const wordCount = words.length || 1
  const syllables = words.reduce((total, word) => {
    const matches = word.toLowerCase().match(/[aeiouy]+/g)
    return total + (matches ? matches.length : 1)
  }, 0)
  return 0.39 * (wordCount / sentences) + 11.8 * (syllables / wordCount) - 15.59
}

export function gradeToLabel(grade: number): string {
  if (grade <= 6) return 'Easy (6th grade)'
  if (grade <= 8) return 'Standard (8th grade)'
  if (grade <= 10) return 'Moderate (10th grade)'
  if (grade <= 12) return 'Difficult (12th grade)'
  return 'Very Difficult (college level)'
}

/** The quality rule set and its 0-100 score, pure so the deductions are testable. */
export function scoreContentQuality(url: string, page: ParsedPage): ContentQualityResult {
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
  }
}

export const contentQualityTool: CallableTool<{ url: string }, ContentQualityResult> = {
  slug: 'content-quality',
  requires: {},
  run: (input) =>
    runGuarded(['crawl'], async () => {
      if (!input.url) return toolErr<ContentQualityResult>('A URL is required.', { sources: ['crawl'] })
      const result = await fetchAndParse(input.url)
      if (!result.ok) return toolErr<ContentQualityResult>(result.error, { sources: ['crawl'] })
      return toolOk(scoreContentQuality(input.url, result.data), {
        sources: ['crawl'],
        degraded: true,
        notes: [
          'Fetched without executing JavaScript, so client-rendered content is not counted.',
        ],
      })
    }),
}

// ── Keyword Research ──────────────────────────────────────────────────────────

export interface KeywordResearchInput {
  keywords: string[]
  country?: string
}

export const keywordResearchTool: CallableTool<KeywordResearchInput, KEKeywordRow[]> = {
  slug: 'keyword-research',
  requires: {},
  run: (input) =>
    runGuarded(['keywords-everywhere'], async () => {
      const apiKey = process.env.KEYWORDS_EVERYWHERE_API_KEY
      if (!apiKey)
        return toolErr<KEKeywordRow[]>('KEYWORDS_EVERYWHERE_API_KEY is not configured.', {
          sources: ['keywords-everywhere'],
        })
      if (!input.keywords?.length)
        return toolErr<KEKeywordRow[]>('At least one keyword is required.', {
          sources: ['keywords-everywhere'],
        })
      const rows = await fetchKEKeywordData(input.keywords, apiKey, input.country ?? 'us')
      return fromConnector(rows, ['keywords-everywhere'])
    }),
}
