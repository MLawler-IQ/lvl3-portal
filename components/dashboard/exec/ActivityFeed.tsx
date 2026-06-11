import { FileText } from 'lucide-react'
import type { ActivityItem } from './ExecutiveSummaryBand'

/** Format an ISO/`YYYY-MM-DD` date into a short, human "Mon D" label. Falls back to raw. */
function formatDate(raw: string): string {
  const d = new Date(raw)
  if (Number.isNaN(d.getTime())) return raw
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

/**
 * "What we did → what happened" feed: a compact list of recent deliverables /
 * milestones. Each row shows the activity title, an optional type tag, and date.
 */
export default function ActivityFeed({ items }: { items: ActivityItem[] }) {
  if (!items.length) return null

  return (
    <ul className="space-y-2.5">
      {items.map((item, i) => (
        <li key={`${item.title}-${i}`} className="flex items-start gap-3">
          <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-surface-700 text-surface-400">
            <FileText className="h-3.5 w-3.5" aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm text-surface-200">{item.title}</p>
            <div className="mt-0.5 flex items-center gap-2">
              {item.type && (
                <span className="text-[10px] font-medium uppercase tracking-widest text-surface-500">
                  {item.type}
                </span>
              )}
              <span className="text-xs text-surface-500">{formatDate(item.date)}</span>
            </div>
          </div>
        </li>
      ))}
    </ul>
  )
}
