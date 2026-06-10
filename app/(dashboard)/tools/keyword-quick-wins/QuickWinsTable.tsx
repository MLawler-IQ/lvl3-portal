'use client'

import { useState } from 'react'
import type { QuickWin } from '@/app/actions/tools'
import ExportTool from '@/components/tools/primitives/ExportTool'
import RunHistory, { type ToolRun } from '@/components/tools/RunHistory'

interface Props {
  wins: QuickWin[]
  clientId?: string | null
  runs?: ToolRun[]
}

export default function QuickWinsTable({ wins, clientId, runs = [] }: Props) {
  const [search, setSearch] = useState('')
  const [rows, setRows] = useState<QuickWin[]>(wins)

  const filtered = rows.filter((w) =>
    w.query.toLowerCase().includes(search.toLowerCase())
  )

  function handleLoadRun(run: ToolRun) {
    const output = run.output as { wins?: QuickWin[] } | null
    if (output?.wins) setRows(output.wins)
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <input
            type="text"
            placeholder="Filter keywords..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-64 bg-surface-800 border border-surface-600 text-surface-100 text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-400 placeholder-surface-500"
          />
          <p className="text-xs text-surface-500">{filtered.length} keywords</p>
        </div>
        <ExportTool
          toolSlug="keyword-quick-wins"
          clientId={clientId}
          input={{ clientId }}
          output={{ wins: rows }}
          filename={`keyword-quick-wins-${new Date().toISOString().slice(0, 10)}`}
          title="Keyword Quick Wins"
          data={{
            headers: ['Query', 'Position', 'Impressions', 'Clicks', 'CTR (%)', 'Est. Clicks @#3', 'Opportunity Score'],
            rows: rows.map((w) => [w.query, w.position, w.impressions, w.clicks, w.ctr, w.estimatedClicksAt3, w.opportunityScore]),
          }}
          formats={['csv', 'xlsx']}
        />
      </div>

      <div className="border border-surface-700 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-surface-700 bg-surface-800/50">
                <th className="text-left px-4 py-3 text-xs font-medium uppercase tracking-wide text-surface-400">Query</th>
                <th className="text-right px-4 py-3 text-xs font-medium uppercase tracking-wide text-surface-400">Pos</th>
                <th className="text-right px-4 py-3 text-xs font-medium uppercase tracking-wide text-surface-400">Impressions</th>
                <th className="text-right px-4 py-3 text-xs font-medium uppercase tracking-wide text-surface-400">Clicks</th>
                <th className="text-right px-4 py-3 text-xs font-medium uppercase tracking-wide text-surface-400">CTR</th>
                <th className="text-right px-4 py-3 text-xs font-medium uppercase tracking-wide text-surface-400">Est. Clicks @#3</th>
                <th className="text-right px-4 py-3 text-xs font-medium uppercase tracking-wide text-surface-400">Score</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-700">
              {filtered.map((w, i) => (
                <tr key={i} className="hover:bg-surface-800/40 transition-colors">
                  <td className="px-4 py-3 text-surface-100 font-medium max-w-xs truncate">{w.query}</td>
                  <td className="px-4 py-3 text-right">
                    <span
                      className="inline-block text-xs font-semibold px-2 py-0.5 rounded-full"
                      style={{
                        backgroundColor: w.position <= 10 ? 'var(--active-bg-bold)' : 'rgba(255,255,255,0.05)',
                        color: w.position <= 10 ? 'var(--color-accent)' : '#9ca3af',
                      }}
                    >
                      #{w.position}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right text-surface-300">{w.impressions.toLocaleString()}</td>
                  <td className="px-4 py-3 text-right text-surface-300">{w.clicks.toLocaleString()}</td>
                  <td className="px-4 py-3 text-right text-surface-400">{w.ctr}%</td>
                  <td className="px-4 py-3 text-right font-medium" style={{ color: 'var(--color-accent)' }}>
                    +{(w.estimatedClicksAt3 - w.clicks).toLocaleString()}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <span className="text-xs font-bold text-surface-100">{w.opportunityScore}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <p className="text-xs text-surface-500">
        Opportunity Score = estimated click gain x position weight. Higher = bigger win for less effort.
        Est. Clicks @#3 uses a 10.3% CTR benchmark.
      </p>

      {runs.length > 0 && (
        <div className="space-y-2 pt-2">
          <h2 className="text-xs font-medium uppercase tracking-wide text-surface-400">Recent Runs</h2>
          <RunHistory runs={runs} onLoad={handleLoadRun} />
        </div>
      )}
    </div>
  )
}
