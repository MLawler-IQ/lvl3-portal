import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { requireAdmin } from '@/lib/auth'
import { getBatchWithResponses } from '@/app/actions/reviews'
import { batchProgress, reviewUrl } from '@/lib/review/helpers'
import BatchActions from '@/components/reviews/BatchActions'
import CopyLinkButton from '@/components/reviews/CopyLinkButton'
import ExportCsvButton from '@/components/reviews/ExportCsvButton'
import ResponsesTable from '@/components/reviews/ResponsesTable'
import StatusPill from '@/components/reviews/StatusPill'

export const dynamic = 'force-dynamic'

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

export default async function ReviewBatchPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  await requireAdmin()
  const { id } = await params

  const { data, error } = await getBatchWithResponses(id)
  if (error === 'Review batch not found') notFound()
  if (error || !data) {
    return (
      <div className="max-w-7xl mx-auto p-6">
        <div className="bg-surface-900 border border-surface-700 rounded-xl p-6">
          <p className="text-sm text-rose-400">{error ?? 'Failed to load batch'}</p>
        </div>
      </div>
    )
  }

  const { batch, items, responses } = data
  const progress = batchProgress(items, responses)
  const shareUrl = reviewUrl(batch.token)

  return (
    <div className="max-w-7xl mx-auto p-6 space-y-6 pb-8">
      <div>
        <Link
          href="/reviews"
          className="inline-flex items-center gap-1.5 text-xs text-surface-500 hover:text-surface-200 transition-colors"
        >
          <ArrowLeft size={13} />
          Back to reviews
        </Link>

        <div className="mt-3 flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-xl font-semibold text-surface-100">{batch.title}</h1>
              <StatusPill status={batch.status} />
            </div>
            <p className="mt-1 text-sm text-surface-400">
              {batch.client}
              <span className="mx-2 text-surface-600">·</span>
              Created {formatDate(batch.created_at)}
              {batch.submitted_at && (
                <>
                  <span className="mx-2 text-surface-600">·</span>
                  Submitted {formatDate(batch.submitted_at)}
                </>
              )}
            </p>
          </div>
          <BatchActions batchId={batch.id} status={batch.status} />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 bg-surface-900 border border-surface-700 rounded-xl px-4 py-3">
        <span className="text-xs text-surface-400">Share link</span>
        <code className="text-xs text-brand-400 break-all">{shareUrl}</code>
        <CopyLinkButton url={shareUrl} />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-surface-400">
          <span className="text-surface-100 font-medium tabular-nums">
            {progress.responded}/{items.length}
          </span>{' '}
          reviewed
          <span className="mx-2 text-surface-600">·</span>
          <span className="text-emerald-400 tabular-nums">{progress.approved} approved</span>
          <span className="mx-2 text-surface-600">·</span>
          <span className="text-rose-400 tabular-nums">{progress.denied} denied</span>
          <span className="mx-2 text-surface-600">·</span>
          <span className="tabular-nums">{progress.pending} pending</span>
        </p>
        <ExportCsvButton client={batch.client} items={items} responses={responses} />
      </div>

      <ResponsesTable items={items} responses={responses} />
    </div>
  )
}
