import type { ReviewBatchStatus } from '@/lib/review/types'
import { STATUS_TONE } from '@/lib/status-tone'

const STATUS_CLASSES: Record<ReviewBatchStatus, string> = {
  draft: 'bg-surface-700 text-surface-300 border-surface-600',
  open: 'bg-brand-400/10 text-brand-400 border-brand-400/20',
  submitted: STATUS_TONE.success.chip,
  archived: 'bg-surface-800 text-surface-400 border-surface-700',
}

const STATUS_LABELS: Record<ReviewBatchStatus, string> = {
  draft: 'Draft',
  open: 'Open',
  submitted: 'Submitted',
  archived: 'Archived',
}

export default function StatusPill({
  status,
  className = '',
}: {
  status: ReviewBatchStatus
  className?: string
}) {
  return (
    <span
      className={`inline-flex items-center text-[10px] font-medium uppercase tracking-[0.1em] px-2 py-0.5 rounded-full border ${STATUS_CLASSES[status]} ${className}`}
    >
      {STATUS_LABELS[status]}
    </span>
  )
}
