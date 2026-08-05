'use client'

import { ExternalLink } from 'lucide-react'
import type { SheetRow } from '@/app/actions/projects'
import { getStatusStyle, formatFee } from './project-helpers'

function NoteCell({ note }: { note: string | null }) {
  if (!note) return <span className="text-surface-400">—</span>
  if (note.startsWith('http')) {
    return (
      <a href={note} target="_blank" rel="noopener noreferrer"
        className="text-brand-400 hover:text-brand-300 inline-flex items-center gap-1">
        Link <ExternalLink className="w-3 h-3" />
      </a>
    )
  }
  return <span className="text-surface-400">{note}</span>
}

export default function TaskTable({
  rows,
  showMonth = false,
  sortConfig = null,
  onSort,
}: {
  rows: SheetRow[]
  showMonth?: boolean
  sortConfig?: { col: string; dir: 'asc' | 'desc' } | null
  onSort?: (col: string) => void
}) {
  const cols = [
    ...(showMonth ? [{ key: 'month', label: 'Month' }] : []),
    { key: 'category', label: 'Category' },
    { key: 'task', label: 'Task' },
    { key: 'status', label: 'Status' },
    { key: 'fee', label: 'Fee' },
    { key: 'note', label: 'Note' },
  ]

  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b border-surface-700">
          {cols.map((c) => (
            <th
              key={c.key}
              className={`text-left px-4 py-2 text-surface-400 font-medium ${onSort && c.key !== 'note' ? 'cursor-pointer hover:text-surface-200 select-none' : ''}`}
              onClick={() => onSort && c.key !== 'note' && onSort(c.key)}
            >
              <span className="inline-flex items-center gap-1">
                {c.label}
                {sortConfig?.col === c.key && (
                  <span className="text-surface-400">{sortConfig.dir === 'asc' ? '↑' : '↓'}</span>
                )}
              </span>
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.length === 0 ? (
          <tr>
            <td colSpan={cols.length} className="px-4 py-8 text-center text-surface-400 text-xs">
              No tasks match the current filters.
            </td>
          </tr>
        ) : (
          rows.map((row, i) => (
            <tr key={i} className="border-b border-surface-800/50 last:border-0 hover:bg-surface-800/30 transition-colors">
              {showMonth && <td className="px-4 py-3 text-surface-400 text-xs">{row.month}</td>}
              <td className="px-4 py-3 text-surface-400">{row.category || '—'}</td>
              <td className="px-4 py-3 text-surface-100">{row.task}</td>
              <td className="px-4 py-3">
                <span className={`inline-block text-xs px-2 py-0.5 rounded-full ${getStatusStyle(row.status)}`}>
                  {row.status || 'Unknown'}
                </span>
              </td>
              <td className="px-4 py-3 text-surface-400 whitespace-nowrap">{formatFee(row.fee)}</td>
              <td className="px-4 py-3"><NoteCell note={row.note} /></td>
            </tr>
          ))
        )}
      </tbody>
    </table>
  )
}
