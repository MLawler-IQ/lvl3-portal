import MetricTable, { ColumnDef } from '@/components/analytics/shared/MetricTable'
import type { UrlRow } from '@/lib/google-search-console'
import { DELTA_TONE_TEXT, deltaTone } from '@/lib/delta-tone'

type Row = UrlRow & Record<string, unknown>

const columns: ColumnDef<Row>[] = [
  {
    key: 'page',
    label: 'Page',
    render: (v) => (
      <span className="text-surface-300 block max-w-xs truncate" title={String(v)}>
        {String(v).slice(0, 60)}
      </span>
    ),
  },
  {
    key: 'clicks',
    label: 'Clicks',
    align: 'right',
    render: (v) => <span className="text-surface-300">{Number(v).toLocaleString()}</span>,
  },
  {
    key: 'clicksDelta',
    label: 'Δ Clicks',
    align: 'right',
    render: (v) => {
      const n = Number(v)
      return (
        <span className={`text-xs ${DELTA_TONE_TEXT[deltaTone(n)]}`}>
          {n > 0 ? '+' : ''}{n.toLocaleString()}
        </span>
      )
    },
  },
  {
    key: 'impressions',
    label: 'Impressions',
    align: 'right',
    render: (v) => <span className="text-surface-300">{Number(v).toLocaleString()}</span>,
  },
  {
    key: 'position',
    label: 'Avg Pos.',
    align: 'right',
    render: (v) => <span className="text-surface-300">{Number(v).toFixed(1)}</span>,
  },
]

interface Props {
  rows: UrlRow[]
}

export default function GscUrlsTable({ rows }: Props) {
  return (
    <div className="bg-surface-900 border border-surface-700 rounded-xl p-5">
      <p className="text-sm font-semibold text-surface-100 mb-4">Top Pages</p>
      <MetricTable columns={columns} rows={rows as Row[]} maxRows={25} />
    </div>
  )
}
