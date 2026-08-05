import React from 'react'

export type ColumnDef<T> = {
  key: string
  label: string
  align?: 'left' | 'right'
  render?: (value: unknown, row: T) => React.ReactNode
}

interface MetricTableProps<T extends Record<string, unknown>> {
  columns: ColumnDef<T>[]
  rows: T[]
  maxRows?: number
}

export default function MetricTable<T extends Record<string, unknown>>({
  columns,
  rows,
  maxRows,
}: MetricTableProps<T>) {
  const displayRows = maxRows ? rows.slice(0, maxRows) : rows

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-surface-700">
            {columns.map((col) => (
              <th
                key={col.key}
                className={`pb-2 text-xs font-medium uppercase tracking-wider text-surface-400 ${
                  col.align === 'right' ? 'text-right' : 'text-left'
                }`}
              >
                {col.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {displayRows.map((row, i) => (
            <tr key={i} className="border-b border-surface-700/50 hover:bg-surface-800/30 transition-colors">
              {columns.map((col) => (
                <td
                  key={col.key}
                  className={`py-2 ${col.align === 'right' ? 'text-right' : 'text-left'}`}
                >
                  {col.render
                    ? col.render(row[col.key], row)
                    : <span className="text-surface-300">{String(row[col.key] ?? '')}</span>}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
