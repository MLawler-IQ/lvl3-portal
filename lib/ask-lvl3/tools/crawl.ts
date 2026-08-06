import { fetchAndParse } from '@/lib/connectors/crawler'
import { pageSeoIssues } from '@/lib/tools/callable/page-audits'
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
      // Same rule set the Page SEO Audit tool uses. This handler previously carried
      // its own copy with SEVEN rules where that one has eleven — no noindex,
      // canonical, structured-data or thin-content check, and different wording for
      // the ones it shared. So Ask LVL3 and the audit screen gave different answers
      // about the same page. One implementation now.
      const issues = pageSeoIssues(page)
      return JSON.stringify({ ...page, issues })
    },
  },
]
