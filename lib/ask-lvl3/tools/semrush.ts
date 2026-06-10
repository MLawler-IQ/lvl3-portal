import {
  fetchSemrushBacklinksOverview,
  fetchSemrushDomainOrganic,
  fetchSemrushDomainRanks,
} from '@/lib/connectors/semrush-portal'
import { normalizeDomain } from '@/lib/normalize-domain'
import type { AskTool } from './types'

function clientDomain(gscSiteUrl: string | null): string {
  return gscSiteUrl ? normalizeDomain(gscSiteUrl) : ''
}

export const semrushTools: AskTool[] = [
  {
    status: 'Analyzing domain visibility…',
    definition: {
      name: 'get_domain_visibility',
      description: `Analyze a domain's organic search visibility via Semrush.
Returns organic keyword count, estimated organic traffic, organic traffic cost, and top ranking keywords.
Defaults to the current client's domain if no domain is specified.`,
      input_schema: {
        type: 'object' as const,
        properties: {
          domain: { type: 'string', description: 'Domain to analyze (defaults to client domain)' },
        },
        required: [],
      },
    },
    handler: async (input, ctx) => {
      const apiKey = process.env.SEMRUSH_API_KEY
      if (!apiKey) return 'Error: SEMRUSH_API_KEY is not configured.'
      const domain = (input.domain as string) || clientDomain(ctx.client.gsc_site_url)
      if (!domain) return 'Error: No domain specified and no client GSC site configured.'
      const [ranks, keywords] = await Promise.all([
        fetchSemrushDomainRanks(domain, apiKey),
        fetchSemrushDomainOrganic(domain, apiKey, 'us', 50),
      ])
      if (!ranks.ok) return `Error: Semrush domain ranks failed — ${ranks.error}`
      if (!keywords.ok) return `Error: Semrush organic keywords failed — ${keywords.error}`
      return JSON.stringify({ ranks: ranks.data, top_keywords: keywords.data })
    },
  },
  {
    status: 'Comparing competitor keywords…',
    definition: {
      name: 'get_competitor_gap',
      description: `Find keywords where a competitor ranks in the top 100 but you don't, using Semrush domain_organic.
Compares the competitor's keyword set against the client's, surfacing gap keywords sorted by volume.
Use this when the user asks about competitor keywords, keyword gaps, or competitive analysis.`,
      input_schema: {
        type: 'object' as const,
        properties: {
          competitor: { type: 'string', description: 'Competitor domain to compare against' },
          domain: { type: 'string', description: 'Your domain (defaults to client domain)' },
          limit: { type: 'number', description: 'Max keywords per domain (default 500)' },
        },
        required: ['competitor'],
      },
    },
    handler: async (input, ctx) => {
      const apiKey = process.env.SEMRUSH_API_KEY
      if (!apiKey) return 'Error: SEMRUSH_API_KEY is not configured.'
      const competitor = input.competitor as string
      const domain = (input.domain as string) || clientDomain(ctx.client.gsc_site_url)
      if (!domain) return 'Error: No domain specified and no client GSC site configured.'
      const limit = (input.limit as number) ?? 500
      const [clientKws, competitorKws] = await Promise.all([
        fetchSemrushDomainOrganic(domain, apiKey, 'us', limit),
        fetchSemrushDomainOrganic(competitor, apiKey, 'us', limit),
      ])
      if (!clientKws.ok) return `Error: Semrush lookup for ${domain} failed — ${clientKws.error}`
      if (!competitorKws.ok) return `Error: Semrush lookup for ${competitor} failed — ${competitorKws.error}`
      const clientSet = new Set(clientKws.data.map((r) => r.keyword.toLowerCase()))
      const gaps = competitorKws.data
        .filter((r) => !clientSet.has(r.keyword.toLowerCase()))
        .sort((a, b) => b.volume - a.volume)
        .slice(0, 100)
      return JSON.stringify({
        client_keywords: clientKws.data.length,
        competitor_keywords: competitorKws.data.length,
        gaps,
      })
    },
  },
  {
    status: 'Fetching backlink profile…',
    definition: {
      name: 'get_backlink_overview',
      description: `Get backlink profile overview for a domain via Semrush: total backlinks, referring domains, follow/nofollow ratio, and authority score.
Defaults to the current client's domain if no domain is specified.`,
      input_schema: {
        type: 'object' as const,
        properties: {
          domain: { type: 'string', description: 'Domain to analyze (defaults to client domain)' },
        },
        required: [],
      },
    },
    handler: async (input, ctx) => {
      const apiKey = process.env.SEMRUSH_API_KEY
      if (!apiKey) return 'Error: SEMRUSH_API_KEY is not configured.'
      const domain = (input.domain as string) || clientDomain(ctx.client.gsc_site_url)
      if (!domain) return 'Error: No domain specified and no client GSC site configured.'
      const overview = await fetchSemrushBacklinksOverview(domain, apiKey)
      if (!overview.ok) return `Error: Semrush backlinks lookup failed — ${overview.error}`
      if (!overview.data) return 'No backlink data found for this domain.'
      return JSON.stringify(overview.data)
    },
  },
]
