import Link from 'next/link'
import { Images, Plus } from 'lucide-react'
import { requireAdmin } from '@/lib/auth'
import { listBatches } from '@/app/actions/reviews'
import BatchesTable from '@/components/reviews/BatchesTable'

export const dynamic = 'force-dynamic'

export default async function ReviewsPage() {
  await requireAdmin()

  const { data: batches, error } = await listBatches()

  return (
    <div className="max-w-7xl mx-auto p-6 space-y-6 pb-8">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Images className="w-5 h-5 text-surface-400" />
          <div>
            <h1 className="text-xl font-semibold text-surface-100">Reviews</h1>
            <p className="mt-0.5 text-sm text-surface-400">
              Client image-review batches and shareable approval links
            </p>
          </div>
        </div>
        <Link
          href="/reviews/new"
          className="inline-flex items-center gap-1.5 text-sm font-medium px-3.5 py-2 rounded-lg bg-brand-500 hover:bg-brand-600 text-white transition-colors"
        >
          <Plus size={15} />
          New review
        </Link>
      </div>

      {error ? (
        <div className="bg-surface-900 border border-surface-700 rounded-xl p-6">
          <p className="text-sm text-rose-400">{error}</p>
        </div>
      ) : (
        <BatchesTable batches={batches ?? []} />
      )}
    </div>
  )
}
