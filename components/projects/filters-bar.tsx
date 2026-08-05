'use client'

import type { SheetRow } from '@/app/actions/projects'
import { getStatusStyle, getUniqueValues } from './project-helpers'

export default function FiltersBar({
  allRows,
  activeStatuses,
  onToggleStatus,
  onClearStatuses,
  activeCategory,
  onCategoryChange,
  viewMode,
  onViewModeChange,
}: {
  allRows: SheetRow[]
  activeStatuses: Set<string>
  onToggleStatus: (s: string) => void
  onClearStatuses: () => void
  activeCategory: string
  onCategoryChange: (c: string) => void
  viewMode: 'month' | 'category' | 'all'
  onViewModeChange: (m: 'month' | 'category' | 'all') => void
}) {
  const uniqueStatuses = ['Completed', 'In Progress', 'Blocked', 'Not Started'].filter(
    (s) => allRows.some((r) => r.status === s)
  )
  const categories = getUniqueValues(allRows, 'category').sort()
  const allActive = activeStatuses.size === 0

  return (
    <div className="flex flex-wrap items-center gap-3 py-3">
      {/* Status pills */}
      <div className="flex flex-wrap items-center gap-2 flex-1">
        <button
          onClick={onClearStatuses}
          className={`text-xs px-3 py-1 rounded-full border transition-colors ${allActive ? 'bg-surface-700 text-surface-100 border-surface-500' : 'bg-surface-800/50 text-surface-400 border-surface-600/50 hover:text-surface-200'}`}
        >
          All
        </button>
        {uniqueStatuses.map((s) => {
          const active = activeStatuses.has(s)
          return (
            <button
              key={s}
              onClick={() => onToggleStatus(s)}
              className={`text-xs px-3 py-1 rounded-full border transition-colors ${active ? getStatusStyle(s) + ' opacity-100' : 'bg-surface-800/50 text-surface-400 border-surface-600/50 hover:text-surface-200'}`}
            >
              {s}
            </button>
          )
        })}
      </div>

      {/* Category dropdown */}
      <select
        value={activeCategory}
        onChange={(e) => onCategoryChange(e.target.value)}
        className="bg-surface-800 border border-surface-600 text-surface-300 text-sm rounded-lg px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-surface-600"
      >
        <option value="">All Categories</option>
        {categories.map((c) => (
          <option key={c} value={c}>{c}</option>
        ))}
      </select>

      {/* View toggle */}
      <div className="flex rounded-lg overflow-hidden border border-surface-600">
        {([['month', 'By Month'], ['category', 'By Category'], ['all', 'All Tasks']] as const).map(
          ([mode, label]) => (
            <button
              key={mode}
              onClick={() => onViewModeChange(mode)}
              className={`px-3 py-1.5 text-xs font-medium transition-colors ${viewMode === mode ? 'bg-surface-700 text-surface-100' : 'bg-surface-800/50 text-surface-400 hover:text-surface-200'}`}
            >
              {label}
            </button>
          )
        )}
      </div>
    </div>
  )
}
