'use client'

import { useEffect, useState, useTransition } from 'react'
import { fetchPageSeoAudit } from '@/app/actions/tools-extended'
import type { PageSeoResult } from '@/app/actions/tools-extended'
import ExportTool from '@/components/tools/primitives/ExportTool'
import RunHistory, { type ToolRun } from '@/components/tools/RunHistory'
import { listToolRuns } from '@/app/actions/tool-runs'

export default function PageSeoClient() {
  const [url, setUrl] = useState('')
  const [result, setResult] = useState<PageSeoResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const [runs, setRuns] = useState<ToolRun[]>([])

  useEffect(() => {
    listToolRuns('page-seo-audit').then(setRuns)
  }, [])

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!url.trim()) return
    setError(null)
    setResult(null)
    startTransition(async () => {
      const res = await fetchPageSeoAudit(url.trim())
      if (res.error) setError(res.error)
      else if (res.data) setResult(res.data)
    })
  }

  function handleLoadRun(run: ToolRun) {
    const output = run.output as { result?: PageSeoResult } | null
    if (output?.result) {
      setResult(output.result)
      setError(null)
      const loadedInput = run.input as { url?: string }
      if (loadedInput.url) setUrl(loadedInput.url)
    }
  }

  return (
    <div className="space-y-4">
      <form onSubmit={handleSubmit} className="flex items-end gap-3">
        <div className="flex-1 min-w-[280px]">
          <label className="block text-xs text-surface-400 mb-1">URL to audit</label>
          <input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://example.com/page"
            required
            className="w-full bg-surface-800 border border-surface-600 text-surface-100 text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-400 placeholder-surface-500"
          />
        </div>
        <button
          type="submit"
          disabled={isPending}
          className="bg-brand-500 hover:bg-brand-400 text-surface-100 text-sm font-medium px-5 py-2 rounded-lg disabled:opacity-50 transition-colors"
        >
          {isPending ? 'Auditing...' : 'Audit'}
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
            toolSlug="page-seo-audit"
            input={{ url: result.url }}
            output={{ result }}
            filename={`page-seo-audit-${new Date().toISOString().slice(0, 10)}`}
            title="Page SEO Audit"
            data={{
              headers: ['Field', 'Value'],
              rows: [
                ['URL', result.url],
                ['Title', result.title],
                ['Title Length', result.title.length],
                ['Meta Description', result.metaDescription],
                ['Meta Description Length', result.metaDescription.length],
                ['Canonical', result.canonical],
                ['Robots', result.robots],
                ['Word Count', result.wordCount],
                ['Content/HTML Ratio (%)', result.contentToHtmlRatio],
                ['Headings', result.headings.length],
                ['Images', result.images.length],
                ['Images Missing Alt', result.images.filter((i) => !i.hasAlt).length],
                ['Structured Data Blocks', result.structuredData.length],
                ...result.issues.map((issue, i) => [`Issue ${i + 1}`, issue]),
              ],
            }}
            formats={['csv', 'xlsx', 'docx']}
            onSaved={() => listToolRuns('page-seo-audit').then(setRuns)}
          />
          {/* Issues */}
          {result.issues.length > 0 && (
            <div className="bg-surface-900 border border-surface-700 rounded-xl p-5 space-y-2">
              <h2 className="text-sm font-semibold text-surface-100 uppercase tracking-wide">Issues ({result.issues.length})</h2>
              <ul className="space-y-1">
                {result.issues.map((issue, i) => (
                  <li key={i} className="text-sm text-red-400 flex items-start gap-2">
                    <span className="text-red-500 mt-0.5">&#x2022;</span>
                    {issue}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {result.issues.length === 0 && (
            <div className="bg-surface-900 border border-surface-700 rounded-xl px-5 py-4">
              <p className="text-sm text-success">No issues found.</p>
            </div>
          )}

          {/* Meta */}
          <div className="bg-surface-900 border border-surface-700 rounded-xl p-5 space-y-3">
            <h2 className="text-sm font-semibold text-surface-100 uppercase tracking-wide">Meta Tags</h2>
            <div className="space-y-2 text-sm">
              <div>
                <span className="text-surface-400">Title:</span>{' '}
                <span className="text-surface-100">{result.title || '(empty)'}</span>
                <span className="text-xs text-surface-500 ml-2">({result.title.length} chars)</span>
              </div>
              <div>
                <span className="text-surface-400">Meta Description:</span>{' '}
                <span className="text-surface-100">{result.metaDescription || '(empty)'}</span>
                <span className="text-xs text-surface-500 ml-2">({result.metaDescription.length} chars)</span>
              </div>
              <div>
                <span className="text-surface-400">Canonical:</span>{' '}
                <span className="text-surface-200">{result.canonical || '(none)'}</span>
              </div>
              <div>
                <span className="text-surface-400">Robots:</span>{' '}
                <span className="text-surface-200">{result.robots || '(none)'}</span>
              </div>
              <div>
                <span className="text-surface-400">Word Count:</span>{' '}
                <span className="text-surface-200">{result.wordCount.toLocaleString()}</span>
              </div>
              <div>
                <span className="text-surface-400">Content/HTML Ratio:</span>{' '}
                <span className="text-surface-200">{result.contentToHtmlRatio}%</span>
              </div>
            </div>
          </div>

          {/* Headings */}
          <div className="bg-surface-900 border border-surface-700 rounded-xl p-5 space-y-3">
            <h2 className="text-sm font-semibold text-surface-100 uppercase tracking-wide">Headings ({result.headings.length})</h2>
            {result.headings.length > 0 ? (
              <ul className="space-y-1">
                {result.headings.slice(0, 30).map((h, i) => (
                  <li key={i} className="text-sm text-surface-200" style={{ paddingLeft: `${(h.level - 1) * 16}px` }}>
                    <span className="text-surface-500 text-xs mr-2">H{h.level}</span>
                    {h.text}
                  </li>
                ))}
                {result.headings.length > 30 && (
                  <li className="text-xs text-surface-500">...and {result.headings.length - 30} more</li>
                )}
              </ul>
            ) : (
              <p className="text-sm text-surface-400">No headings found.</p>
            )}
          </div>

          {/* Images */}
          <div className="bg-surface-900 border border-surface-700 rounded-xl p-5 space-y-3">
            <h2 className="text-sm font-semibold text-surface-100 uppercase tracking-wide">Images ({result.images.length})</h2>
            {result.images.length > 0 ? (
              <>
                <p className="text-sm text-surface-300">
                  {result.images.filter((i) => i.hasAlt).length}/{result.images.length} have alt text
                </p>
                {result.images.filter((i) => !i.hasAlt).length > 0 && (
                  <ul className="space-y-1">
                    {result.images
                      .filter((i) => !i.hasAlt)
                      .slice(0, 10)
                      .map((img, i) => (
                        <li key={i} className="text-xs text-red-400 truncate">
                          Missing alt: {img.src}
                        </li>
                      ))}
                  </ul>
                )}
              </>
            ) : (
              <p className="text-sm text-surface-400">No images found.</p>
            )}
          </div>

          {/* Structured Data */}
          <div className="bg-surface-900 border border-surface-700 rounded-xl p-5 space-y-3">
            <h2 className="text-sm font-semibold text-surface-100 uppercase tracking-wide">Structured Data ({result.structuredData.length})</h2>
            {result.structuredData.length > 0 ? (
              <ul className="space-y-1">
                {result.structuredData.map((sd, i) => (
                  <li key={i} className="text-sm text-surface-200">
                    <span className="font-medium" style={{ color: 'var(--color-accent)' }}>{sd.type}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-surface-400">No structured data found.</p>
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
