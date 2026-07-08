import type { ReviewItem, ReviewResponse } from '@/lib/review/types'

function DecisionPill({ decision }: { decision: ReviewResponse['decision'] | undefined }) {
  const base =
    'inline-flex items-center text-[10px] font-medium uppercase tracking-[0.1em] px-2 py-0.5 rounded-full border'
  if (decision === 'approve') {
    return (
      <span className={`${base} bg-brand-400/15 text-brand-400 border-brand-400/20`}>
        Approved
      </span>
    )
  }
  if (decision === 'deny') {
    return (
      <span className={`${base} bg-rose-500/10 text-rose-400 border-rose-500/20`}>Denied</span>
    )
  }
  return (
    <span className={`${base} bg-surface-800 text-surface-500 border-surface-700`}>Pending</span>
  )
}

function formatUpdated(iso: string | undefined): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

export default function ResponsesTable({
  items,
  responses,
}: {
  items: ReviewItem[]
  responses: ReviewResponse[]
}) {
  if (items.length === 0) {
    return (
      <div className="bg-surface-900 border border-surface-700 rounded-xl p-10 text-center">
        <p className="text-sm text-surface-300">No items in this batch yet.</p>
      </div>
    )
  }

  const byItem = new Map(responses.map((r) => [r.item_id, r]))
  const ordered = [...items].sort((a, b) => a.sort_order - b.sort_order)

  return (
    <div className="bg-surface-900 border border-surface-700 rounded-xl overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-surface-700 text-left">
            <th className="px-4 py-3 text-xs font-medium uppercase tracking-widest text-surface-500">Image</th>
            <th className="px-4 py-3 text-xs font-medium uppercase tracking-widest text-surface-500">#</th>
            <th className="px-4 py-3 text-xs font-medium uppercase tracking-widest text-surface-500">Title</th>
            <th className="px-4 py-3 text-xs font-medium uppercase tracking-widest text-surface-500">Rating</th>
            <th className="px-4 py-3 text-xs font-medium uppercase tracking-widest text-surface-500">Decision</th>
            <th className="px-4 py-3 text-xs font-medium uppercase tracking-widest text-surface-500">Note</th>
            <th className="px-4 py-3 text-xs font-medium uppercase tracking-widest text-surface-500">Updated</th>
          </tr>
        </thead>
        <tbody>
          {ordered.map((item, i) => {
            const response = byItem.get(item.id)
            return (
              <tr
                key={item.id}
                className="border-b border-surface-700/50 last:border-b-0 hover:bg-surface-850 transition-colors"
              >
                <td className="px-4 py-3">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={item.image_url}
                    alt={item.title}
                    className="h-12 w-20 object-cover rounded border border-surface-700"
                  />
                </td>
                <td className="px-4 py-3 text-surface-400 tabular-nums">{i + 1}</td>
                <td className="px-4 py-3 text-surface-100 min-w-[200px]">{item.title}</td>
                <td className="px-4 py-3 text-surface-300 tabular-nums whitespace-nowrap">
                  {response?.rating ? `${response.rating}/10` : '—'}
                </td>
                <td className="px-4 py-3">
                  <DecisionPill decision={response?.decision} />
                </td>
                <td className="px-4 py-3 text-surface-400">
                  {response?.note ? (
                    <span title={response.note} className="block max-w-[280px] truncate">
                      {response.note}
                    </span>
                  ) : (
                    <span className="text-surface-600">—</span>
                  )}
                </td>
                <td className="px-4 py-3 text-surface-400 whitespace-nowrap">
                  {formatUpdated(response?.updated_at)}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
