import { describe, it, expect } from 'vitest'
import {
  pageSeoIssues,
  scoreContentQuality,
  fleschKincaidGrade,
  gradeToLabel,
} from '@/lib/tools/callable/page-audits'
import { classifyGaps, aggregateQueries } from '@/lib/tools/callable/content-gaps'
import type { ParsedPage } from '@/lib/connectors/crawler'

/** A page that passes every rule, so each test can break exactly one thing. */
function page(over: Partial<ParsedPage> = {}): ParsedPage {
  return {
    url: 'https://example.com/p',
    title: 'A good title',
    metaDescription: 'A good meta description.',
    headings: [{ level: 1, text: 'The one H1' }],
    images: [{ src: '/a.png', hasAlt: true, alt: 'a' }],
    links: [
      { href: '/x', isInternal: true, text: 'x' },
      { href: '/y', isInternal: true, text: 'y' },
      { href: '/z', isInternal: true, text: 'z' },
      { href: 'https://other.com', isInternal: false, text: 'o' },
    ],
    canonical: 'https://example.com/p',
    robots: 'index,follow',
    structuredData: [{ '@type': 'WebPage' }],
    wordCount: 1200,
    contentToHtmlRatio: 30,
    bodyText: 'Short words are easy to read. This is a plain sentence.',
    ...(over as object),
  } as ParsedPage
}

describe('pageSeoIssues', () => {
  it('reports nothing on a clean page', () => {
    expect(pageSeoIssues(page())).toEqual([])
  })

  it('catches each defect independently', () => {
    expect(pageSeoIssues(page({ title: '' }))).toContain('Missing title tag')
    expect(pageSeoIssues(page({ metaDescription: '' }))).toContain('Missing meta description')
    expect(pageSeoIssues(page({ headings: [] }))).toContain('Missing H1 tag')
    expect(pageSeoIssues(page({ canonical: '' }))).toContain('Missing canonical tag')
    expect(pageSeoIssues(page({ structuredData: [] }))).toContain('No structured data found')
    expect(pageSeoIssues(page({ robots: 'noindex,follow' }))).toContain('Page has noindex directive')
  })

  it('quotes the actual length so the fix is actionable', () => {
    const issues = pageSeoIssues(page({ title: 'x'.repeat(75) }))
    expect(issues.some((i) => i.includes('75') && i.includes('max 60'))).toBe(true)
  })

  it('treats multiple H1s and a missing H1 as different problems', () => {
    const two = pageSeoIssues(
      page({ headings: [{ level: 1, text: 'a' }, { level: 1, text: 'b' }] as ParsedPage['headings'] }),
    )
    expect(two).toContain('Multiple H1 tags (2)')
    expect(two).not.toContain('Missing H1 tag')
  })

  // 11 rules. The Ask LVL3 handler used to carry its own copy with only 7, so the
  // chat and the audit screen disagreed about the same page.
  it('covers all eleven rules on a maximally broken page', () => {
    const issues = pageSeoIssues(
      page({
        title: '',
        metaDescription: '',
        headings: [],
        images: [{ src: '/a.png', hasAlt: false, alt: '' }] as ParsedPage['images'],
        canonical: '',
        robots: 'noindex',
        structuredData: [],
        wordCount: 100,
      }),
    )
    expect(issues.length).toBeGreaterThanOrEqual(7)
    expect(issues).toContain('Thin content (100 words)')
    expect(issues).toContain('1 image(s) missing alt text')
  })
})

describe('scoreContentQuality', () => {
  it('scores a clean page at 100', () => {
    expect(scoreContentQuality('u', page()).score).toBe(100)
  })

  it('deducts more for thin than for light content, and never both', () => {
    const thin = scoreContentQuality('u', page({ wordCount: 100 }))
    const light = scoreContentQuality('u', page({ wordCount: 500 }))
    expect(thin.score).toBe(75)
    expect(light.score).toBe(90)
    expect(thin.issues.filter((i) => i.includes('content')).length).toBe(1)
  })

  it('never returns a negative score', () => {
    const awful = scoreContentQuality(
      'u',
      page({
        wordCount: 10,
        contentToHtmlRatio: 1,
        headings: [],
        images: [{ src: 'a', hasAlt: false, alt: '' }] as ParsedPage['images'],
        links: [],
      }),
    )
    expect(awful.score).toBeGreaterThanOrEqual(0)
  })

  it('treats a page with no images as full alt coverage, not zero', () => {
    const out = scoreContentQuality('u', page({ images: [] }))
    expect(out.imageAltCoverage.percent).toBe(100)
    expect(out.issues.some((i) => i.includes('alt text'))).toBe(false)
  })

  it('counts internal and external links separately', () => {
    const out = scoreContentQuality('u', page())
    expect(out.internalLinks).toBe(3)
    expect(out.externalLinks).toBe(1)
  })
})

describe('readability', () => {
  it('rates simple prose easier than dense prose', () => {
    const simple = fleschKincaidGrade('The cat sat. The dog ran. It was fun.')
    const dense = fleschKincaidGrade(
      'Notwithstanding the aforementioned considerations, the implementation necessitates extraordinary deliberation.',
    )
    expect(simple).toBeLessThan(dense)
  })

  it('does not divide by zero on empty text', () => {
    expect(Number.isFinite(fleschKincaidGrade(''))).toBe(true)
  })

  it('labels every band', () => {
    expect(gradeToLabel(5)).toMatch(/Easy/)
    expect(gradeToLabel(8)).toMatch(/Standard/)
    expect(gradeToLabel(10)).toMatch(/Moderate/)
    expect(gradeToLabel(12)).toMatch(/Difficult/)
    expect(gradeToLabel(18)).toMatch(/Very Difficult/)
  })
})

describe('content gaps', () => {
  const row = (over: Partial<{ query: string; impressions: number; clicks: number; position: number }> = {}) => ({
    query: 'q',
    impressions: 300,
    clicks: 0,
    position: 12,
    ...over,
  })

  it('averages position across a query\'s pages', () => {
    const agg = aggregateQueries([
      row({ query: 'shared', position: 10 }),
      row({ query: 'shared', position: 20 }),
    ])
    expect(agg.get('shared')!.position).toBe(15)
    expect(agg.get('shared')!.impressions).toBe(600)
  })

  it('flags high impressions with no clicks', () => {
    const [g] = classifyGaps([row({ impressions: 5000, clicks: 1, position: 18 })])
    expect(g.gapType).toBe('high-impression-no-clicks')
  })

  it('flags just-off-page-one', () => {
    const [g] = classifyGaps([row({ impressions: 200, clicks: 20, position: 14 })])
    expect(g.gapType).toBe('near-page-one')
  })

  it('flags ranking-but-weak and names the position in the advice', () => {
    // CTR 3% — above the 1% floor that would make this "high impressions, no clicks",
    // but below the 8% expected at position 3.
    const [g] = classifyGaps([row({ impressions: 1000, clicks: 30, position: 3 })])
    expect(g.gapType).toBe('ranking-but-weak')
    expect(g.recommendation).toContain('#3')
  })

  // The buckets are ordered and first-match-wins, which is load-bearing: a page at
  // position 3 with almost no clicks is the no-clicks problem, not a CTR-tuning
  // problem, and the advice differs accordingly.
  it('prefers the no-clicks bucket when a top-ranking page gets almost none', () => {
    const [g] = classifyGaps([row({ impressions: 1000, clicks: 1, position: 3 })])
    expect(g.gapType).toBe('high-impression-no-clicks')
  })

  it('applies a position-dependent CTR expectation', () => {
    // 3% clears the 2% expected below position 5, so this is not a gap...
    expect(classifyGaps([row({ impressions: 1000, clicks: 30, position: 8 })])).toEqual([])
    // ...but the same 3% falls short of the 8% expected at position 2.
    expect(classifyGaps([row({ impressions: 1000, clicks: 30, position: 2 })])[0].gapType).toBe(
      'ranking-but-weak',
    )
  })

  it('says nothing about a query that is already performing', () => {
    expect(classifyGaps([row({ impressions: 1000, clicks: 200, position: 2 })])).toEqual([])
  })

  it('ignores queries below the impression floor', () => {
    expect(classifyGaps([row({ impressions: 20, clicks: 0, position: 12 })])).toEqual([])
  })

  it('ranks by impressions and caps at 50', () => {
    const many = Array.from({ length: 80 }, (_, i) =>
      row({ query: `q${i}`, impressions: 1000 + i, clicks: 0, position: 15 }),
    )
    const out = classifyGaps(many)
    expect(out).toHaveLength(50)
    expect(out[0].impressions).toBeGreaterThan(out[49].impressions)
  })
})
