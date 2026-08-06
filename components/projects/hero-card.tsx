'use client'

import type { SheetRow } from '@/app/actions/projects'
import { SEGMENT_DEFS, isCurrentMonth, type MonthGroup } from './project-helpers'
import TaskTable from './task-table'
import { STATUS_TONE } from '@/lib/status-tone'
import { PROJECT_STATUS_TONE } from './project-helpers'

function SegmentedProgressBar({ rows }: { rows: SheetRow[] }) {
  const total = rows.length
  const counts: Record<string, number> = {
    'Completed': 0, 'In Progress': 0, 'Blocked': 0, 'Not Started': 0,
  }
  for (const r of rows) {
    if (counts[r.status] !== undefined) counts[r.status]++
  }
  const active = SEGMENT_DEFS.filter((s) => counts[s.status] > 0)

  return (
    <div>
      <div className="flex h-3 rounded-full overflow-hidden bg-surface-800 gap-px">
        {active.map((s) => (
          <div
            key={s.status}
            className={`${s.color} transition-all`}
            style={{ width: `${total === 0 ? 0 : (counts[s.status] / total) * 100}%` }}
          />
        ))}
      </div>
      <div className="flex items-center gap-4 mt-2">
        {SEGMENT_DEFS.map((s) => (
          <span key={s.status} className="flex items-center gap-1.5 text-xs text-surface-400">
            <span className={`w-2 h-2 rounded-full ${s.color}`} />
            {s.label}: {counts[s.status]}
          </span>
        ))}
      </div>
    </div>
  )
}

function StatPills({
  rows,
  heroFilter,
  onToggle,
}: {
  rows: SheetRow[]
  heroFilter: Set<string>
  onToggle: (status: string) => void
}) {
  const counts: Record<string, number> = {
    'Completed': 0, 'In Progress': 0, 'Blocked': 0, 'Not Started': 0,
  }
  for (const r of rows) {
    if (counts[r.status] !== undefined) counts[r.status]++
  }

  // Selection is a stronger fill plus a ring, from the tone's own scale — it used to
  // be a jump between the -700 and -900 rungs of a raw palette family.
  const defs = (['Completed', 'In Progress', 'Blocked', 'Not Started'] as const).map((status) => {
    const tone = STATUS_TONE[PROJECT_STATUS_TONE[status]]
    return { status, active: tone.chipActive, inactive: tone.chip }
  })

  return (
    <div className="flex flex-wrap items-center gap-2">
      {defs.map((d) => {
        const isActive = heroFilter.has(d.status)
        return (
          <button
            key={d.status}
            onClick={() => onToggle(d.status)}
            className={`text-xs px-2.5 py-1 rounded-lg border transition-colors ${isActive ? d.active : d.inactive}`}
          >
            {d.status} <span className="font-semibold ml-0.5">{counts[d.status]}</span>
          </button>
        )
      })}
    </div>
  )
}

export default function HeroCard({
  group,
  heroFilter,
  onHeroFilterToggle,
  globalFilteredRows,
}: {
  group: MonthGroup
  heroFilter: Set<string>
  onHeroFilterToggle: (status: string) => void
  globalFilteredRows: SheetRow[]
}) {
  const isCurrent = isCurrentMonth(group.month)
  const heroRows = heroFilter.size > 0
    ? globalFilteredRows.filter((r) => heroFilter.has(r.status))
    : globalFilteredRows

  return (
    <div className="bg-surface-800 border border-surface-600 border-l-4 border-l-brand-400 rounded-lg overflow-hidden">
      <div className="px-5 pt-4 pb-3">
        <div className="flex items-start justify-between gap-4 mb-3">
          <div className="flex items-center gap-3">
            <span className="text-lg font-semibold text-surface-100">{group.month}</span>
            {isCurrent ? (
              <span className={`flex items-center gap-1.5 text-xs ${STATUS_TONE.success.text}`}>
                <span className={`w-2 h-2 rounded-full animate-pulse ${STATUS_TONE.success.bar}`} />
                This Month
              </span>
            ) : (
              <span className="flex items-center gap-1.5 text-xs text-surface-400">
                <span className="w-2 h-2 rounded-full bg-surface-500" />
                Latest
              </span>
            )}
          </div>
          <div className="w-52 flex-shrink-0">
            <SegmentedProgressBar rows={group.rows} />
          </div>
        </div>
        <StatPills rows={group.rows} heroFilter={heroFilter} onToggle={onHeroFilterToggle} />
      </div>
      <div className="overflow-x-auto border-t border-surface-600/50">
        <TaskTable rows={heroRows} />
      </div>
    </div>
  )
}
