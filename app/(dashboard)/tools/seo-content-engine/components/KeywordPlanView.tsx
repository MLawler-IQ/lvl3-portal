'use client'

import { useState } from 'react'
import type { KeywordPlan } from '@/lib/seo-content-engine/types'

type SortField = 'keyword' | 'category' | 'msv' | 'cpc' | 'competition'
type SortDir = 'asc' | 'desc'
type Category = 'primary' | 'secondary' | 'supporting' | 'questions'

const CATEGORY_COLORS: Record<Category, string> = {
  primary: 'bg-red-500/15 text-red-600',
  secondary: 'bg-blue-500/15 text-blue-600',
  supporting: 'bg-emerald-500/15 text-emerald-600',
  questions: 'bg-amber-500/15 text-amber-600',
}

const CATEGORY_LABELS: Record<Category, string> = {
  primary: 'Primary',
  secondary: 'Secondary',
  supporting: 'Supporting',
  questions: 'Questions',
}

interface KeywordRow {
  keyword: string
  category: Category
  msv: number
  cpc: number
  competition: number
}

export default function KeywordPlanView({ plan }: { plan: KeywordPlan }) {
  const [sortField, setSortField] = useState<SortField>('msv')
  const [sortDir, setSortDir] = useState<SortDir>('desc')

  // Build flat rows from categorized keywords (guard against null arrays from DB JSON)
  // DB may store entries as objects {keyword, cpc, msv, ...} instead of plain strings
  const metrics = plan.metrics ?? {}
  const rows: KeywordRow[] = []
  const toStr = (entry: unknown): string =>
    typeof entry === 'string' ? entry : String((entry as Record<string, unknown>)?.keyword ?? entry)
  const addRows = (keywords: unknown[] | null | undefined, category: Category) => {
    for (const entry of keywords ?? []) {
      const kw = toStr(entry)
      const m = metrics[kw]
      // If entry is an object with inline metrics, use those as fallback
      const obj = typeof entry === 'object' && entry !== null ? (entry as Record<string, unknown>) : null
      rows.push({
        keyword: kw,
        category,
        msv: m?.msv ?? (obj?.msv as number | undefined) ?? 0,
        cpc: m?.cpc ?? (obj?.cpc as number | undefined) ?? 0,
        competition: m?.competition ?? (obj?.competition as number | undefined) ?? 0,
      })
    }
  }
  addRows(plan.primary, 'primary')
  addRows(plan.secondary, 'secondary')
  addRows(plan.supporting, 'supporting')
  addRows(plan.questions, 'questions')

  // Sort
  const sorted = [...rows].sort((a, b) => {
    const dir = sortDir === 'asc' ? 1 : -1
    if (sortField === 'keyword') return dir * a.keyword.localeCompare(b.keyword)
    if (sortField === 'category') return dir * a.category.localeCompare(b.category)
    return dir * ((a[sortField] as number) - (b[sortField] as number))
  })

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc')
    } else {
      setSortField(field)
      setSortDir(field === 'keyword' || field === 'category' ? 'asc' : 'desc')
    }
  }

  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortField !== field) return <span className="ml-1 opacity-30">↕</span>
    return <span className="ml-1">{sortDir === 'asc' ? '↑' : '↓'}</span>
  }

  return (
    <div className="space-y-6">
      {/* Table */}
      <div className="overflow-x-auto rounded-xl border border-surface-700">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-surface-800 text-surface-400 text-xs uppercase tracking-wider">
              {([
                ['keyword', 'Keyword'],
                ['category', 'Category'],
                ['msv', 'MSV'],
                ['cpc', 'CPC'],
                ['competition', 'Competition'],
              ] as [SortField, string][]).map(([field, label]) => (
                <th
                  key={field}
                  className="px-4 py-3 text-left font-medium cursor-pointer select-none hover:text-surface-300"
                  onClick={() => handleSort(field)}
                >
                  {label}
                  <SortIcon field={field} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map((row, i) => (
              <tr key={`${row.keyword}-${i}`} className="border-b border-surface-800 hover:bg-surface-850">
                <td className="px-4 py-2.5 text-surface-200">{row.keyword}</td>
                <td className="px-4 py-2.5">
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${CATEGORY_COLORS[row.category]}`}>
                    {CATEGORY_LABELS[row.category]}
                  </span>
                </td>
                <td className="px-4 py-2.5 text-surface-300 font-mono">{row.msv.toLocaleString()}</td>
                <td className="px-4 py-2.5 text-surface-300 font-mono">${row.cpc.toFixed(2)}</td>
                <td className="px-4 py-2.5 text-surface-300 font-mono">{row.competition.toFixed(2)}</td>
              </tr>
            ))}
            {sorted.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-surface-400">
                  No keywords in plan
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Rationale */}
      {plan.rationale && (
        <div className="bg-surface-900 border border-surface-700 rounded-xl p-4">
          <h4 className="text-xs font-medium uppercase tracking-wider text-brand-500 mb-2">Rationale</h4>
          <p className="text-sm text-surface-300 leading-relaxed">{plan.rationale}</p>
        </div>
      )}

      {/* Clusters */}
      {(plan.clusters ?? []).length > 0 && (
        <div className="bg-surface-900 border border-surface-700 rounded-xl p-4">
          <h4 className="text-xs font-medium uppercase tracking-wider text-brand-500 mb-3">Keyword Clusters</h4>
          <div className="space-y-3">
            {(plan.clusters ?? []).map((cluster, i) => (
              <div key={i}>
                <h5 className="text-sm font-semibold text-surface-200 mb-1">{cluster.cluster_name}</h5>
                {cluster.target_section && (
                  <p className="text-xs text-surface-400 mb-1">Target: {cluster.target_section}</p>
                )}
                <div className="flex flex-wrap gap-1.5">
                  {(cluster.keywords ?? []).map((kw, j) => (
                    <span
                      key={j}
                      className="px-2 py-0.5 rounded-full text-xs bg-surface-800 text-surface-400 border border-surface-700"
                    >
                      {toStr(kw)}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
