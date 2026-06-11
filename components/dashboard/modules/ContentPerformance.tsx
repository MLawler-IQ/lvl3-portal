import { EmptyState } from '@/components/ui/EmptyState'
import { FileText } from 'lucide-react'
import type { ContentUrlRow } from '@/lib/google-search-console'

export interface ContentPerformanceProps {
  /** Top content URLs by clicks (GSC), with impressions, CTR and avg position. */
  rows: ContentUrlRow[]
  /** Max rows to render. Defaults to 25. */
  maxRows?: number
}

/**
 * Presentational table of top-performing content URLs for a lead-gen client:
 * URL, clicks (with an inline proportional bar), impressions, CTR and average
 * search position. Renders a graceful empty state when there are no rows.
 */
export default function ContentPerformance({ rows, maxRows = 25 }: ContentPerformanceProps) {
  const display = rows.slice(0, maxRows)
  const maxClicks = display.reduce((m, r) => Math.max(m, r.clicks), 0)

  return (
    <div className="bg-surface-900 border border-surface-700 rounded-xl p-5">
      <p className="text-sm font-semibold text-surface-100 mb-4">Top Content</p>
      {display.length === 0 ? (
        <EmptyState
          icon={FileText}
          title="No content data"
          description="No search clicks were recorded for any pages in this period."
          compact
        />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-surface-700">
                <th className="pb-2 text-left text-xs font-medium uppercase tracking-wider text-surface-500">
                  Page
                </th>
                <th className="pb-2 text-right text-xs font-medium uppercase tracking-wider text-surface-500">
                  Clicks
                </th>
                <th className="pb-2 text-right text-xs font-medium uppercase tracking-wider text-surface-500">
                  Impressions
                </th>
                <th className="pb-2 text-right text-xs font-medium uppercase tracking-wider text-surface-500">
                  CTR
                </th>
                <th className="pb-2 text-right text-xs font-medium uppercase tracking-wider text-surface-500">
                  Avg Pos.
                </th>
              </tr>
            </thead>
            <tbody>
              {display.map((row, i) => (
                <tr
                  key={`${row.page}-${i}`}
                  className="border-b border-surface-700/50 hover:bg-surface-800/30 transition-colors"
                >
                  <td className="py-2 text-left">
                    <span
                      className="text-surface-300 block max-w-xs truncate"
                      title={row.page}
                    >
                      {row.page.slice(0, 60)}
                    </span>
                  </td>
                  <td className="py-2 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <span
                        className="h-1.5 rounded-full bg-brand-500"
                        style={{
                          width: `${maxClicks > 0 ? Math.max(2, (row.clicks / maxClicks) * 56) : 2}px`,
                        }}
                        aria-hidden="true"
                      />
                      <span className="text-surface-300">{row.clicks.toLocaleString()}</span>
                    </div>
                  </td>
                  <td className="py-2 text-right">
                    <span className="text-surface-300">{row.impressions.toLocaleString()}</span>
                  </td>
                  <td className="py-2 text-right">
                    <span className="text-surface-300">{row.ctr.toFixed(1)}%</span>
                  </td>
                  <td className="py-2 text-right">
                    <span className="text-surface-300">{row.position.toFixed(1)}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
