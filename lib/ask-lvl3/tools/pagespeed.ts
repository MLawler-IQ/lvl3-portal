import { fetchPageSpeedInsights } from '@/lib/connectors/pagespeed'
import type { AskTool } from './types'

export const pagespeedTools: AskTool[] = [
  {
    status: 'Running PageSpeed analysis…',
    definition: {
      name: 'get_core_web_vitals',
      description: `Measure Core Web Vitals and Lighthouse performance for a URL via PageSpeed Insights API.
Returns CrUX field data (LCP, CLS, INP, FCP, TTFB) and Lighthouse lab metrics, with pass/fail assessment.
Use this when the user asks about page speed, performance, or Core Web Vitals.`,
      input_schema: {
        type: 'object' as const,
        properties: {
          url: { type: 'string', description: 'Full URL to analyze' },
          strategy: { type: 'string', enum: ['mobile', 'desktop'], description: 'Device (default: mobile)' },
        },
        required: ['url'],
      },
    },
    handler: async (input) => {
      const url = input.url as string
      const strategy = (input.strategy as 'mobile' | 'desktop') ?? 'mobile'
      const apiKey = process.env.PAGESPEED_API_KEY
      const result = await fetchPageSpeedInsights(url, strategy, apiKey)
      if (!result.ok) return `Error: PageSpeed analysis failed — ${result.error}`
      return JSON.stringify(result.data)
    },
  },
]
