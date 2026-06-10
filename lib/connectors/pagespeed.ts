import { connectorErr, connectorOk, type ConnectorResult } from './types'

export interface CruxMetric {
  category: 'FAST' | 'AVERAGE' | 'SLOW' | 'NONE'
  percentile: number
}

export interface PageSpeedResult {
  url: string
  strategy: string
  lighthouse_score: number
  crux: {
    lcp: CruxMetric | null
    cls: CruxMetric | null
    inp: CruxMetric | null
    fid: CruxMetric | null
    fcp: CruxMetric | null
    ttfb: CruxMetric | null
  }
  lighthouse: {
    fcp_ms: number
    lcp_ms: number
    tbt_ms: number
    cls: number
    si_ms: number
    tti_ms: number
  }
  cwv_pass: boolean
}

export async function fetchPageSpeedInsights(
  url: string,
  strategy: 'mobile' | 'desktop' = 'mobile',
  apiKey?: string,
): Promise<ConnectorResult<PageSpeedResult>> {
  const params = new URLSearchParams({
    url,
    strategy,
    category: 'performance',
  })
  if (apiKey) params.set('key', apiKey)

  const endpoint = `https://www.googleapis.com/pagespeedonline/v5/runPagespeed?${params}`
  // Lighthouse/CrUX response is a large, loosely-specified third-party JSON
  // blob accessed via optional chaining below — typing it fully isn't worth it.
  let json: Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
  try {
    const res = await fetch(endpoint)
    json = await res.json()
    if (!res.ok) {
      throw new Error(`PageSpeed API error: ${json?.error?.message ?? res.status}`)
    }
  } catch (err) {
    return connectorErr(err)
  }

  const cruxMetrics = json.loadingExperience?.metrics ?? {}

  function extractCrux(key: string): CruxMetric | null {
    const m = cruxMetrics[key]
    if (!m) return null
    return {
      category: m.category ?? 'NONE',
      percentile: m.percentile ?? 0,
    }
  }

  const audits = json.lighthouseResult?.audits ?? {}
  const lighthouseScore = Math.round(
    (json.lighthouseResult?.categories?.performance?.score ?? 0) * 100,
  )

  const lcp = extractCrux('LARGEST_CONTENTFUL_PAINT_MS')
  const cls = extractCrux('CUMULATIVE_LAYOUT_SHIFT_SCORE')
  const inp = extractCrux('INTERACTION_TO_NEXT_PAINT')

  // Google's Core Web Vitals "good" status requires every metric in the FAST
  // bucket. AVERAGE is "needs improvement" and must NOT count as a pass.
  const cwvPass =
    (lcp === null || lcp.category === 'FAST') &&
    (cls === null || cls.category === 'FAST') &&
    (inp === null || inp.category === 'FAST')

  return connectorOk({
    url,
    strategy,
    lighthouse_score: lighthouseScore,
    crux: {
      lcp,
      cls,
      inp,
      fid: extractCrux('FIRST_INPUT_DELAY_MS'),
      fcp: extractCrux('FIRST_CONTENTFUL_PAINT_MS'),
      ttfb: extractCrux('EXPERIMENTAL_TIME_TO_FIRST_BYTE'),
    },
    lighthouse: {
      fcp_ms: parseFloat(audits['first-contentful-paint']?.numericValue ?? '0'),
      lcp_ms: parseFloat(audits['largest-contentful-paint']?.numericValue ?? '0'),
      tbt_ms: parseFloat(audits['total-blocking-time']?.numericValue ?? '0'),
      cls: parseFloat(audits['cumulative-layout-shift']?.numericValue ?? '0'),
      si_ms: parseFloat(audits['speed-index']?.numericValue ?? '0'),
      tti_ms: parseFloat(audits['interactive']?.numericValue ?? '0'),
    },
    cwv_pass: cwvPass,
  })
}
