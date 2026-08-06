import { coreWebVitalsTool } from '@/lib/tools/callable/page-audits'
import type { ToolContext } from '@/lib/tools/contract'
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
    handler: async (input, ctx) => {
      // Delegates to the callable tool, so quota handling and the degraded-vs-failed
      // distinction live in one place rather than being duplicated per surface.
      const res = await coreWebVitalsTool.run(
        { url: input.url as string, strategy: (input.strategy as 'mobile' | 'desktop') ?? 'mobile' },
        ctx as unknown as ToolContext,
      )
      if (!res.ok) return `Error: PageSpeed analysis failed — ${res.error}`
      return JSON.stringify(res.data)
    },
  },
]
