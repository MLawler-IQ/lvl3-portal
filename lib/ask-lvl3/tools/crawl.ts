import { fetchAndParse } from '@/lib/connectors/crawler'
import type { AskTool } from './types'

export const crawlTools: AskTool[] = [
  {
    status: 'Crawling page for SEO audit…',
    definition: {
      name: 'crawl_page_seo',
      description: `Crawl a single web page and extract SEO elements: title, meta description, headings (H1-H6), canonical, robots meta, images (alt text audit), structured data, word count, Open Graph tags, and hreflang.
Use this when the user asks about on-page SEO for a specific URL, or wants a page audit.`,
      input_schema: {
        type: 'object' as const,
        properties: {
          url: { type: 'string', description: 'Full URL to crawl (e.g., https://example.com/page)' },
        },
        required: ['url'],
      },
    },
    handler: async (input) => {
      const url = input.url as string
      const result = await fetchAndParse(url)
      if (!result.ok) return `Error: Failed to crawl ${url} — ${result.error}`
      const page = result.data
      const issues: string[] = []
      if (!page.title) issues.push('Missing title tag')
      if (!page.metaDescription) issues.push('Missing meta description')
      if (page.title.length > 60) issues.push('Title too long (>60 chars)')
      if (page.metaDescription.length > 160) issues.push('Meta description too long (>160 chars)')
      const h1s = page.headings.filter((h) => h.level === 1)
      if (h1s.length === 0) issues.push('Missing H1')
      if (h1s.length > 1) issues.push(`Multiple H1 tags (${h1s.length})`)
      const missingAlt = page.images.filter((i) => !i.hasAlt).length
      if (missingAlt > 0) issues.push(`${missingAlt} images missing alt text`)
      return JSON.stringify({ ...page, issues })
    },
  },
]
