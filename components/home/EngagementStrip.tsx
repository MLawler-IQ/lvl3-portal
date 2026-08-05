import Link from 'next/link'

interface EngagementStripProps {
  projectProgress: { completed: number; total: number } | null
  unviewedCount: number
  openThreadCount: number
}

export default function EngagementStrip({
  projectProgress,
  unviewedCount,
  openThreadCount,
}: EngagementStripProps) {
  const hasTasks = projectProgress !== null && projectProgress.total > 0
  const hasReview = unviewedCount > 0
  const hasThreads = openThreadCount > 0

  return (
    <div className="bg-surface-850 border border-surface-700 rounded-xl px-5 py-3 flex flex-col sm:flex-row items-start sm:items-center gap-3 sm:gap-0 justify-between">
      {/* Stats */}
      <div className="flex flex-wrap items-center gap-4">
        {hasTasks && (
          <div className="flex items-center gap-2">
            <div className="w-24 h-1.5 bg-surface-700 rounded-full overflow-hidden">
              <div
                className="h-full bg-brand-400 rounded-full transition-all"
                style={{
                  width: `${Math.round((projectProgress!.completed / projectProgress!.total) * 100)}%`,
                }}
              />
            </div>
            <span className="text-xs text-surface-300 tabular-nums">
              {projectProgress!.completed}/{projectProgress!.total} tasks
            </span>
          </div>
        )}
        {hasReview && (
          <span className="text-xs font-medium text-amber-400 bg-amber-400/10 border border-amber-400/20 px-2 py-0.5 rounded-full">
            {unviewedCount} to review
          </span>
        )}
        {hasThreads && (
          <span className="text-xs font-medium text-amber-400 bg-amber-400/10 border border-amber-400/20 px-2 py-0.5 rounded-full">
            {openThreadCount} open {openThreadCount === 1 ? 'thread' : 'threads'}
          </span>
        )}
        {!hasTasks && !hasReview && !hasThreads && (
          <span className="text-xs text-surface-400">All caught up</span>
        )}
      </div>

      {/* CTAs */}
      <div className="flex items-center gap-2 shrink-0">
        <Link
          href="/projects"
          className="text-xs px-3 py-1.5 rounded-lg border border-surface-600 bg-surface-800 text-surface-200 hover:bg-surface-850 hover:text-surface-100 transition-colors"
        >
          View Projects
        </Link>
        {hasReview && (
          <Link
            href="/deliverables"
            className="text-xs px-3 py-1.5 rounded-lg bg-brand-400 hover:bg-brand-300 text-surface-950 font-semibold transition-colors"
          >
            Review Deliverables
          </Link>
        )}
      </div>
    </div>
  )
}
