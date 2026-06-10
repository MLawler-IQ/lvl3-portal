'use client'

import { useEffect, useState, useTransition } from 'react'
import { fetchCoreWebVitals } from '@/app/actions/tools-extended'
import type { PageSpeedResult } from '@/lib/connectors/pagespeed'
import { statusColor, type StatusLevel } from '@/lib/status-color'
import ExportTool from '@/components/tools/primitives/ExportTool'
import RunHistory, { type ToolRun } from '@/components/tools/RunHistory'
import { listToolRuns } from '@/app/actions/tool-runs'

function categoryLevel(category: string | null): StatusLevel {
  if (category === 'FAST') return 'success'
  if (category === 'AVERAGE') return 'warning'
  if (category === 'SLOW') return 'error'
  return 'neutral'
}

function MetricBadge({ label, value, unit, category }: { label: string; value: number; unit: string; category: string | null }) {
  const color = statusColor(categoryLevel(category))

  return (
    <div className="bg-surface-800 rounded-lg p-4 space-y-1">
      <p className="text-xs text-surface-400 uppercase tracking-wide">{label}</p>
      <p className="text-lg font-bold" style={{ color }}>
        {value.toLocaleString()}
        <span className="text-xs font-normal ml-1">{unit}</span>
      </p>
      {category && <p className="text-xs font-medium" style={{ color }}>{category}</p>}
    </div>
  )
}

export default function CoreWebVitalsClient() {
  const [url, setUrl] = useState('')
  const [strategy, setStrategy] = useState<'mobile' | 'desktop'>('mobile')
  const [result, setResult] = useState<PageSpeedResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const [runs, setRuns] = useState<ToolRun[]>([])

  useEffect(() => {
    listToolRuns('core-web-vitals').then(setRuns)
  }, [])

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!url.trim()) return
    setError(null)
    setResult(null)
    startTransition(async () => {
      const res = await fetchCoreWebVitals(url.trim(), strategy)
      if (res.error) setError(res.error)
      else if (res.data) setResult(res.data)
    })
  }

  function handleLoadRun(run: ToolRun) {
    const output = run.output as { result?: PageSpeedResult } | null
    if (output?.result) {
      setResult(output.result)
      setError(null)
      const loadedInput = run.input as { url?: string; strategy?: 'mobile' | 'desktop' }
      if (loadedInput.url) setUrl(loadedInput.url)
      if (loadedInput.strategy) setStrategy(loadedInput.strategy)
    }
  }

  const exportRows: unknown[][] = result
    ? [
        ['Lighthouse Score', result.lighthouse_score, ''],
        ['CWV Assessment', result.cwv_pass ? 'PASS' : 'FAIL', ''],
        ...(['lcp', 'cls', 'inp', 'fcp', 'ttfb'] as const)
          .filter((k) => result.crux[k])
          .map((k) => [
            `CrUX ${k.toUpperCase()}`,
            k === 'cls' ? result.crux[k]!.percentile / 100 : result.crux[k]!.percentile,
            result.crux[k]!.category,
          ]),
        ['Lab FCP (ms)', Math.round(result.lighthouse.fcp_ms), ''],
        ['Lab LCP (ms)', Math.round(result.lighthouse.lcp_ms), ''],
        ['Lab TBT (ms)', Math.round(result.lighthouse.tbt_ms), ''],
        ['Lab CLS', Math.round(result.lighthouse.cls * 1000) / 1000, ''],
        ['Lab Speed Index (ms)', Math.round(result.lighthouse.si_ms), ''],
        ['Lab TTI (ms)', Math.round(result.lighthouse.tti_ms), ''],
      ]
    : []

  return (
    <div className="space-y-4">
      <form onSubmit={handleSubmit} className="flex flex-wrap items-end gap-3">
        <div className="flex-1 min-w-[280px]">
          <label className="block text-xs text-surface-400 mb-1">URL</label>
          <input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://example.com"
            required
            className="w-full bg-surface-800 border border-surface-600 text-surface-100 text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-400 placeholder-surface-500"
          />
        </div>
        <div>
          <label className="block text-xs text-surface-400 mb-1">Strategy</label>
          <select
            value={strategy}
            onChange={(e) => setStrategy(e.target.value as 'mobile' | 'desktop')}
            className="bg-surface-800 border border-surface-600 text-surface-100 text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-400"
          >
            <option value="mobile">Mobile</option>
            <option value="desktop">Desktop</option>
          </select>
        </div>
        <button
          type="submit"
          disabled={isPending}
          className="bg-brand-500 hover:bg-brand-400 text-surface-100 text-sm font-medium px-5 py-2 rounded-lg disabled:opacity-50 transition-colors"
        >
          {isPending ? 'Analyzing...' : 'Analyze'}
        </button>
      </form>

      {error && (
        <div className="bg-surface-900 border border-surface-700 rounded-xl px-5 py-4">
          <p className="text-sm text-red-400">{error}</p>
        </div>
      )}

      {result && (
        <div className="space-y-4">
          <ExportTool
            toolSlug="core-web-vitals"
            input={{ url: result.url, strategy: result.strategy }}
            output={{ result }}
            filename={`core-web-vitals-${new Date().toISOString().slice(0, 10)}`}
            title="Core Web Vitals"
            data={{ headers: ['Metric', 'Value', 'Category'], rows: exportRows }}
            formats={['csv', 'xlsx']}
            onSaved={() => listToolRuns('core-web-vitals').then(setRuns)}
          />
          <div className="bg-surface-900 border border-surface-700 rounded-xl p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-surface-100 uppercase tracking-wide">Lighthouse Score</h2>
              <span
                className="text-2xl font-bold"
                style={{ color: statusColor(result.lighthouse_score >= 90 ? 'success' : result.lighthouse_score >= 50 ? 'warning' : 'error') }}
              >
                {result.lighthouse_score}/100
              </span>
            </div>
            <div
              className="text-xs font-medium px-2 py-1 rounded-full inline-block"
              style={{
                color: statusColor(result.cwv_pass ? 'success' : 'error'),
                backgroundColor: result.cwv_pass ? 'var(--color-success-bg, rgba(34,197,94,0.12))' : 'var(--color-error-bg, rgba(239,68,68,0.12))',
              }}
            >
              CWV Assessment: {result.cwv_pass ? 'PASS' : 'FAIL'}
            </div>
          </div>

          <div className="bg-surface-900 border border-surface-700 rounded-xl p-5 space-y-3">
            <h2 className="text-sm font-semibold text-surface-100 uppercase tracking-wide">Field Data (CrUX)</h2>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              {result.crux.lcp && <MetricBadge label="LCP" value={result.crux.lcp.percentile} unit="ms" category={result.crux.lcp.category} />}
              {result.crux.cls && <MetricBadge label="CLS" value={result.crux.cls.percentile / 100} unit="" category={result.crux.cls.category} />}
              {result.crux.inp && <MetricBadge label="INP" value={result.crux.inp.percentile} unit="ms" category={result.crux.inp.category} />}
              {result.crux.fcp && <MetricBadge label="FCP" value={result.crux.fcp.percentile} unit="ms" category={result.crux.fcp.category} />}
              {result.crux.ttfb && <MetricBadge label="TTFB" value={result.crux.ttfb.percentile} unit="ms" category={result.crux.ttfb.category} />}
            </div>
            {!result.crux.lcp && !result.crux.cls && !result.crux.inp && (
              <p className="text-xs text-surface-400">No field data available for this URL. CrUX requires sufficient real-user traffic.</p>
            )}
          </div>

          <div className="bg-surface-900 border border-surface-700 rounded-xl p-5 space-y-3">
            <h2 className="text-sm font-semibold text-surface-100 uppercase tracking-wide">Lab Data (Lighthouse)</h2>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              <MetricBadge label="FCP" value={Math.round(result.lighthouse.fcp_ms)} unit="ms" category={null} />
              <MetricBadge label="LCP" value={Math.round(result.lighthouse.lcp_ms)} unit="ms" category={null} />
              <MetricBadge label="TBT" value={Math.round(result.lighthouse.tbt_ms)} unit="ms" category={null} />
              <MetricBadge label="CLS" value={Math.round(result.lighthouse.cls * 1000) / 1000} unit="" category={null} />
              <MetricBadge label="Speed Index" value={Math.round(result.lighthouse.si_ms)} unit="ms" category={null} />
              <MetricBadge label="TTI" value={Math.round(result.lighthouse.tti_ms)} unit="ms" category={null} />
            </div>
          </div>
        </div>
      )}

      {runs.length > 0 && (
        <div className="space-y-2">
          <h2 className="text-xs font-medium uppercase tracking-wide text-surface-400">Recent Runs</h2>
          <RunHistory runs={runs} onLoad={handleLoadRun} />
        </div>
      )}
    </div>
  )
}
