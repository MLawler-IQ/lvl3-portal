import Link from 'next/link'
import { ArrowLeft, Images } from 'lucide-react'
import { requireAdmin } from '@/lib/auth'
import NewBatchForm from '@/components/reviews/NewBatchForm'

export default async function NewReviewPage() {
  await requireAdmin()

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-6 pb-8">
      <div>
        <Link
          href="/reviews"
          className="inline-flex items-center gap-1.5 text-xs text-surface-400 hover:text-surface-200 transition-colors"
        >
          <ArrowLeft size={13} />
          Back to reviews
        </Link>
        <div className="mt-3 flex items-center gap-3">
          <Images className="w-5 h-5 text-surface-400" />
          <div>
            <h1 className="text-xl font-medium text-surface-100">New review</h1>
            <p className="mt-0.5 text-sm text-surface-400">
              Create a batch, upload images, and share the link with the client
            </p>
          </div>
        </div>
      </div>

      <NewBatchForm />
    </div>
  )
}
