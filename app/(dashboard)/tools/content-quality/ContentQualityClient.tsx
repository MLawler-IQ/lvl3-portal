'use client'

import { useEffect, useState, useTransition } from 'react'
import { fetchContentQuality } from '@/app/actions/tools-extended'
import type { ContentQualityResult } from '@/app/actions/tools-extended'
import { statusColor } from '@/lib/status-color'
import ExportTool from '@/components/tools/primitives/ExportTool'
import RunHistory, { type ToolRun } from '@/components/tools/RunHistory'
import { listToolRuns } from '@/app/actions/tool-runs'

export default function ContentQualityClient() {
  const [url, setUrl] = useState('')
  const [result, setResult] = useState<ContentQualityResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const [runs, setRuns] = useState<ToolRun[]>([])

  useEffect(() => {
    listToolRuns('content-quality').then(setRuns)
  }, [])

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!url.trim()) return
    setError(null)
    setResult(null)
    startTransition(async () => {
      const res = await fetchContentQuality(url.trim())
      if (res.error) setError(res.error)
      else if (res.data) setResult(res.data)
    })
  }

  function handleLoadRun(run: ToolRun) {
    const output = run.output as { result?: ContentQualityResult } | null
    if (output?.result) {
      setResult(output.result)
      setError(null)
      const loadedInput = run.input as { url?: string }
      if (loadedInput.url) setUrl(loadedInput.url)
    }
  }

  const scoreColor = statusColor(
    result && result.score >= 80 ? 'success' : result && result.score >= 50 ? 'warning' : 'error',
  )

  return (
    <div className="space-y-4">
      <form onSubmit={handleSubmit} className="flex items-end gap-3">
        <div className="flex-1 min-w-[280px]">
          <label className="block text-xs text-surface-400 mb-1">URL to analyze</label>
          <input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://example.com/blog/post"
            required
            className="w-full bg-surface-800 border border-surface-600 text-surface-100 text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-400 placeholder-surface-500"
          />
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
            toolSlug="content-quality"
            input={{ url: result.url }}
            output={{ result }}
            filename={`content-quality-${new Date().toISOString().slice(0, 10)}`}
            title="Content Quality"
            data={{
              headers: ['Field', 'Value'],
              rows: [
                ['URL', result.url],
                ['Score', result.score],
                ['Word Count', result.wordCount],
                ['Reading Level', result.readingLevel],
                ['Content/HTML Ratio (%)', result.contentToHtmlRatio],
                ['Image Alt Coverage (%)', result.imageAltCoverage.percent],
                ['Internal Links', result.internalLinks],
                ['External Links', result.externalLinks],
                ...result.issues.map((issue, i) => [`Issue ${i + 1}`, issue]),
              ],
            }}
            formats={['csv', 'xlsx', 'docx']}
            onSaved={() => listToolRuns('content-quality').then(setRuns)}
          />
          {/* Score + Issues */}
          <div className="bg-surface-900 border border-surface-700 rounded-xl p-5 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-surface-100 uppercase tracking-wide">Content Score</h2>
              <span className="text-2xl font-bold" style={{ color: scoreColor }}>{result.score}/100</span>
            </div>
            {result.issues.length > 0 && (
              <ul className="space-y-1">
                {result.issues.map((issue, i) => (
                  <li key={i} className="text-sm text-red-400 flex items-start gap-2">
                    <span className="text-red-500 mt-0.5">&#x2022;</span>
                    {issue}
                  </li>
                ))}
              </ul>
            )}
            {result.issues.length === 0 && <p className="text-sm text-success">No issues found.</p>}
          </div>

          {/* Metrics */}
          <div className="bg-surface-900 border border-surface-700 rounded-xl p-5 space-y-3">
            <h2 className="text-sm font-semibold text-surface-100 uppercase tracking-wide">Metrics</h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div>
                <p className="text-xs text-surface-400">Word Count</p>
                <p className="text-lg font-bold" style={{ color: 'var(--color-accent)' }}>
                  {result.wordCount.toLocaleString()}
                </p>
              </div>
              <div>
                <p className="text-xs text-surface-400">Reading Level</p>
                <p className="text-sm font-medium text-surface-100">{result.readingLevel}</p>
              </div>
              <div>
                <p className="text-xs text-surface-400">Content/HTML Ratio</p>
                <p className="text-lg font-bold text-surface-100">{result.contentToHtmlRatio}%</p>
              </div>
              <div>
                <p className="text-xs text-surface-400">Image Alt Coverage</p>
                <p className="text-lg font-bold text-surface-100">
                  {result.imageAltCoverage.withAlt}/{result.imageAltCoverage.total}{' '}
                  <span className="text-xs font-normal text-surface-400">({result.imageAltCoverage.percent}%)</span>
                </p>
              </div>
            </div>
          </div>

          {/* Links */}
          <div className="bg-surface-900 border border-surface-700 rounded-xl p-5 space-y-3">
            <h2 className="text-sm font-semibold text-surface-100 uppercase tracking-wide">Links</h2>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-xs text-surface-400">Internal Links</p>
                <p className="text-lg font-bold text-surface-100">{result.internalLinks}</p>
              </div>
              <div>
                <p className="text-xs text-surface-400">External Links</p>
                <p className="text-lg font-bold text-surface-100">{result.externalLinks}</p>
              </div>
            </div>
          </div>

          {/* Heading Structure */}
          <div className="bg-surface-900 border border-surface-700 rounded-xl p-5 space-y-3">
            <h2 className="text-sm font-semibold text-surface-100 uppercase tracking-wide">
              Heading Structure ({result.headingStructure.length})
            </h2>
            {result.headingStructure.length > 0 ? (
              <ul className="space-y-1">
                {result.headingStructure.slice(0, 20).map((h, i) => (
                  <li key={i} className="text-sm text-surface-200" style={{ paddingLeft: `${(h.level - 1) * 16}px` }}>
                    <span className="text-surface-500 text-xs mr-2">H{h.level}</span>
                    {h.text}
                  </li>
                ))}
                {result.headingStructure.length > 20 && (
                  <li className="text-xs text-surface-500">...and {result.headingStructure.length - 20} more</li>
                )}
              </ul>
            ) : (
              <p className="text-sm text-surface-400">No headings found.</p>
            )}
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
