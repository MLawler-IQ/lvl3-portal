import MetricTable, { ColumnDef } from '@/components/analytics/shared/MetricTable'
import { EmptyState } from '@/components/ui/EmptyState'
import { Target } from 'lucide-react'
import type { ConvertingPageRow } from '@/lib/google-analytics'

type Row = ConvertingPageRow & Record<string, unknown>

const columns: ColumnDef<Row>[] = [
  {
    key: 'page',
    label: 'Landing Page',
    render: (v) => (
      <span className="text-surface-300 block max-w-xs truncate" title={String(v)}>
        {String(v).slice(0, 60)}
      </span>
    ),
  },
  {
    key: 'conversions',
    label: 'Conversions',
    align: 'right',
    render: (v) => (
      <span
        className="text-accent-400"
        style={{ fontFamily: 'var(--font-jetbrains-mono), monospace' }}
      >
        {Number(v).toLocaleString()}
      </span>
    ),
  },
  {
    key: 'sessions',
    label: 'Sessions',
    align: 'right',
    render: (v) => <span className="text-surface-300">{Number(v).toLocaleString()}</span>,
  },
  {
    key: 'conversionRate',
    label: 'Conv. Rate',
    align: 'right',
    render: (v) => <span className="text-surface-300">{Number(v).toFixed(1)}%</span>,
  },
]

export interface ConvertingPagesProps {
  /** Top converting landing pages, ranked by conversions (GA4 key events). */
  rows: ConvertingPageRow[]
  /** Max rows to render. Defaults to 25. */
  maxRows?: number
}

/**
 * Presentational table of the top converting landing pages for a lead-gen client:
 * page, conversions (GA4 key events), sessions, and conversion rate. Renders a
 * graceful empty state when there are no rows.
 */
export default function ConvertingPages({ rows, maxRows = 25 }: ConvertingPagesProps) {
  return (
    <div className="bg-surface-900 border border-surface-700 rounded-xl p-5">
      <p className="text-sm font-semibold text-surface-100 mb-4">Top Converting Pages</p>
      {rows.length === 0 ? (
        <EmptyState
          icon={Target}
          title="No conversions yet"
          description="No key events were recorded for landing pages in this period."
          compact
        />
      ) : (
        <MetricTable columns={columns} rows={rows as Row[]} maxRows={maxRows} />
      )}
    </div>
  )
}
