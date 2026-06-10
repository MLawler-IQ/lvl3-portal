import { fetchKEKeywordData, fetchKERelatedKeywords } from '@/lib/connectors/keywords-everywhere'
import type { AskTool } from './types'

export const keywordTools: AskTool[] = [
  {
    status: 'Looking up keyword data…',
    definition: {
      name: 'get_keyword_data',
      description: `Get search volume, CPC, competition, and 12-month trend data for specific keywords via Keywords Everywhere.
Use this when the user asks about keyword search volume, CPC, keyword difficulty, or monthly trends for specific terms.
Returns data for up to 100 keywords at once.`,
      input_schema: {
        type: 'object' as const,
        properties: {
          keywords: {
            type: 'array',
            items: { type: 'string' },
            description: 'List of keywords to look up (max 100)',
          },
          country: { type: 'string', description: 'Country code (default: us)' },
        },
        required: ['keywords'],
      },
    },
    handler: async (input) => {
      const keKey = process.env.KEYWORDS_EVERYWHERE_API_KEY
      if (!keKey) return 'Error: KEYWORDS_EVERYWHERE_API_KEY is not configured.'
      const keywords = input.keywords as string[]
      const country = (input.country as string) ?? 'us'
      const rows = await fetchKEKeywordData(keywords, keKey, country)
      return JSON.stringify(rows)
    },
  },
  {
    status: 'Finding related keywords…',
    definition: {
      name: 'get_related_keywords',
      description: `Find related keywords for a seed keyword via Keywords Everywhere.
Use this for keyword research, content ideation, or finding long-tail variations of a topic.
Returns related terms with search volume, CPC, and competition.`,
      input_schema: {
        type: 'object' as const,
        properties: {
          keyword: { type: 'string', description: 'Seed keyword' },
          country: { type: 'string', description: 'Country code (default: us)' },
          limit: { type: 'number', description: 'Max results (default 50, max 1000)' },
        },
        required: ['keyword'],
      },
    },
    handler: async (input) => {
      const keKey = process.env.KEYWORDS_EVERYWHERE_API_KEY
      if (!keKey) return 'Error: KEYWORDS_EVERYWHERE_API_KEY is not configured.'
      const keyword = input.keyword as string
      const country = (input.country as string) ?? 'us'
      const limit = (input.limit as number) ?? 50
      const rows = await fetchKERelatedKeywords(keyword, keKey, country, limit)
      return JSON.stringify(rows)
    },
  },
]
