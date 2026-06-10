'use client'

import { useState } from 'react'
import type { ContentGap } from '@/app/actions/tools'
import ExportTool from '@/components/tools/primitives/ExportTool'
import RunHistory, { type ToolRun } from '@/components/tools/RunHistory'

const GAP_TYPE_LABELS: Record<ContentGap['gapType'], { label: string; className: string }> = {
  'high-impression-no-clicks': {
    label: 'No clicks',
    className: 'bg-red-500/15 text-red-400 border-red-500/20',
  },
  'near-page-one': {
    label: 'Near page 1',
    className: 'bg-amber-500/15 text-amber-400 border-amber-500/20',
  },
  'ranking-but-weak': {
    label: 'Weak CTR',
    className: 'bg-brand-500/15 text-brand-400 border-brand-500/20',
  },
}

interface Props {
  gaps: ContentGap[]
  clientId?: string | null
  runs?: ToolRun[]
}

export default function ContentGapsTable({ gaps, clientId, runs = [] }: Props) {
  const [expanded, setExpanded] = useState<number | null>(null)
  const [filter, setFilter] = useState<ContentGap['gapType'] | 'all'>('all')
  const [rows, setRows] = useState<ContentGap[]>(gaps)

  const filtered = filter === 'all' ? rows : rows.filter((g) => g.gapType === filter)

  function handleLoadRun(run: ToolRun) {
    const output = run.output as { gaps?: ContentGap[] } | null
    if (output?.gaps) {
      setRows(output.gaps)
      setExpanded(null)
      setFilter('all')
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 flex-wrap">
          {(['all', 'high-impression-no-clicks', 'near-page-one', 'ranking-but-weak'] as const).map(
            (f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
                  filter === f
                    ? 'border-brand-400 text-brand-400 bg-brand-400/10'
                    : 'border-surface-600 text-surface-400 hover:border-surface-500'
                }`}
              >
                {f === 'all'
                  ? `All (${rows.length})`
                  : GAP_TYPE_LABELS[f].label}
              </button>
            )
          )}
        </div>
        <ExportTool
          toolSlug="content-gaps"
          clientId={clientId}
          input={{ clientId }}
          output={{ gaps: rows }}
          filename={`content-gaps-${new Date().toISOString().slice(0, 10)}`}
          title="Content Gap Finder"
          data={{
            headers: ['Query', 'Gap Type', 'Impressions', 'Clicks', 'CTR (%)', 'Position', 'Recommendation'],
            rows: rows.map((g) => [g.query, GAP_TYPE_LABELS[g.gapType].label, g.impressions, g.clicks, g.ctr, g.position, g.recommendation]),
          }}
          formats={['csv', 'xlsx']}
        />
      </div>

      <div className="space-y-2">
        {filtered.map((gap, i) => {
          const { label, className } = GAP_TYPE_LABELS[gap.gapType]
          const isOpen = expanded === i
          return (
            <div
              key={i}
              className="bg-surface-900 border border-surface-700 rounded-xl overflow-hidden"
            >
              <button
                onClick={() => setExpanded(isOpen ? null : i)}
                className="w-full flex items-center gap-4 px-5 py-3.5 text-left hover:bg-surface-800/40 transition-colors"
              >
                <span
                  className={`text-xs font-medium px-2 py-0.5 rounded-full border shrink-0 ${className}`}
                >
                  {label}
                </span>
                <span className="flex-1 text-sm font-medium text-surface-100 truncate">
                  {gap.query}
                </span>
                <div className="flex items-center gap-4 shrink-0 text-xs text-surface-400">
                  <span>{gap.impressions.toLocaleString()} imp</span>
                  <span>{gap.clicks.toLocaleString()} clicks</span>
                  <span>#{gap.position}</span>
                  <span className={`transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`}>
                    ▾
                  </span>
                </div>
              </button>
              {isOpen && (
                <div className="px-5 pb-4 border-t border-surface-700 pt-3">
                  <p className="text-xs text-surface-300 leading-relaxed mb-2">
                    {gap.recommendation}
                  </p>
                  <div className="flex gap-4 text-xs text-surface-500">
                    <span>CTR: {gap.ctr}%</span>
                    <span>Position: #{gap.position}</span>
                    <span>Impressions: {gap.impressions.toLocaleString()}</span>
                    <span>Clicks: {gap.clicks.toLocaleString()}</span>
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>

      {runs.length > 0 && (
        <div className="space-y-2 pt-2">
          <h2 className="text-xs font-medium uppercase tracking-wide text-surface-400">Recent Runs</h2>
          <RunHistory runs={runs} onLoad={handleLoadRun} />
        </div>
      )}
    </div>
  )
}
