'use client'

import { useEffect, useState, useTransition } from 'react'
import { fetchKeywordResearch } from '@/app/actions/tools-extended'
import type { KEKeywordRow } from '@/lib/connectors/keywords-everywhere'
import ExportTool from '@/components/tools/primitives/ExportTool'
import RunHistory, { type ToolRun } from '@/components/tools/RunHistory'
import { listToolRuns } from '@/app/actions/tool-runs'

export default function KeywordResearchClient() {
  const [input, setInput] = useState('')
  const [country, setCountry] = useState('us')
  const [rows, setRows] = useState<KEKeywordRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const [runs, setRuns] = useState<ToolRun[]>([])

  useEffect(() => {
    listToolRuns('keyword-research').then(setRuns)
  }, [])

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const keywords = input
      .split('\n')
      .map((k) => k.trim())
      .filter(Boolean)
    if (keywords.length === 0) return
    setError(null)
    setRows(null)
    startTransition(async () => {
      const res = await fetchKeywordResearch(keywords.slice(0, 100), country)
      if (res.error) setError(res.error)
      else if (res.data) setRows(res.data)
    })
  }

  function handleLoadRun(run: ToolRun) {
    const output = run.output as { rows?: KEKeywordRow[] } | null
    if (output?.rows) {
      setRows(output.rows)
      setError(null)
      const loadedInput = run.input as { keywords?: string[]; country?: string }
      if (loadedInput.keywords) setInput(loadedInput.keywords.join('\n'))
      if (loadedInput.country) setCountry(loadedInput.country)
    }
  }

  return (
    <div className="space-y-4">
      <form onSubmit={handleSubmit} className="space-y-3">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-[280px]">
            <label className="block text-xs text-surface-400 mb-1">Keywords (one per line, max 100)</label>
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={"best running shoes\nrunning shoes for flat feet\ntrail running shoes"}
              rows={5}
              required
              className="w-full bg-surface-800 border border-surface-600 text-surface-100 text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-400 placeholder-surface-500 resize-y"
            />
          </div>
          <div className="flex flex-col gap-3">
            <div>
              <label className="block text-xs text-surface-400 mb-1">Country</label>
              <select
                value={country}
                onChange={(e) => setCountry(e.target.value)}
                className="bg-surface-800 border border-surface-600 text-surface-100 text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-400"
              >
                <option value="us">US</option>
                <option value="uk">UK</option>
                <option value="ca">Canada</option>
                <option value="au">Australia</option>
              </select>
            </div>
            <button
              type="submit"
              disabled={isPending}
              className="bg-brand-500 hover:bg-brand-400 text-surface-100 text-sm font-medium px-5 py-2 rounded-lg disabled:opacity-50 transition-colors"
            >
              {isPending ? 'Researching...' : 'Research'}
            </button>
          </div>
        </div>
      </form>

      {error && (
        <div className="bg-surface-900 border border-surface-700 rounded-xl px-5 py-4">
          <p className="text-sm text-red-400">{error}</p>
        </div>
      )}

      {rows && rows.length === 0 && (
        <div className="bg-surface-900 border border-surface-700 rounded-xl px-5 py-4">
          <p className="text-sm text-surface-400">No keyword data returned.</p>
        </div>
      )}

      {rows && rows.length > 0 && (
        <ExportTool
          toolSlug="keyword-research"
          input={{ keywords: input.split('\n').map((k) => k.trim()).filter(Boolean), country }}
          output={{ rows }}
          filename={`keyword-research-${new Date().toISOString().slice(0, 10)}`}
          title="Keyword Research"
          data={{
            headers: ['Keyword', 'Volume', 'CPC', 'Competition'],
            rows: rows.map((r) => [r.keyword, r.vol, r.cpc.toFixed(2), r.competition.toFixed(2)]),
          }}
          formats={['csv', 'xlsx']}
          onSaved={() => listToolRuns('keyword-research').then(setRuns)}
        />
      )}

      {rows && rows.length > 0 && (
        <div className="border border-surface-700 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-surface-700 bg-surface-800/50">
                  <th className="text-left px-4 py-3 text-xs font-medium uppercase tracking-wide text-surface-400">Keyword</th>
                  <th className="text-right px-4 py-3 text-xs font-medium uppercase tracking-wide text-surface-400">Volume</th>
                  <th className="text-right px-4 py-3 text-xs font-medium uppercase tracking-wide text-surface-400">CPC</th>
                  <th className="text-right px-4 py-3 text-xs font-medium uppercase tracking-wide text-surface-400">Comp</th>
                  <th className="text-left px-4 py-3 text-xs font-medium uppercase tracking-wide text-surface-400">12-Month Trend</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-700">
                {rows.map((row, i) => (
                  <tr key={i} className="hover:bg-surface-800/40 transition-colors">
                    <td className="px-4 py-3 text-surface-100 font-medium max-w-xs truncate">{row.keyword}</td>
                    <td className="px-4 py-3 text-right" style={{ color: 'var(--color-accent)' }}>
                      {row.vol.toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-right text-surface-300">${row.cpc.toFixed(2)}</td>
                    <td className="px-4 py-3 text-right text-surface-300">{row.competition.toFixed(2)}</td>
                    <td className="px-4 py-3">
                      {row.trend.length > 0 ? (
                        <div className="flex items-end gap-0.5 h-4">
                          {row.trend.map((v, j) => {
                            const max = Math.max(...row.trend, 1)
                            const height = Math.max(2, (v / max) * 16)
                            return (
                              <div
                                key={j}
                                className="w-1.5 rounded-sm"
                                style={{
                                  height: `${height}px`,
                                  backgroundColor: 'var(--color-accent)',
                                  opacity: 0.4 + (j / row.trend.length) * 0.6,
                                }}
                              />
                            )
                          })}
                        </div>
                      ) : (
                        <span className="text-xs text-surface-500">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
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
