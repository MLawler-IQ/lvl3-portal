'use client'

import { useState, useTransition } from 'react'
import { Archive, Loader2, RefreshCw, RotateCcw } from 'lucide-react'
import { regenerateToken, updateBatchStatus } from '@/app/actions/reviews'
import type { ReviewBatchStatus } from '@/lib/review/types'

const BTN_CLASS =
  'inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-lg border border-surface-600 bg-surface-800 text-surface-300 hover:text-surface-100 hover:border-surface-500 transition-colors disabled:opacity-50'

export default function BatchActions({
  batchId,
  status,
}: {
  batchId: string
  status: ReviewBatchStatus
}) {
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function run(action: () => Promise<{ error?: string }>) {
    setError(null)
    startTransition(async () => {
      const result = await action()
      if (result.error) setError(result.error)
    })
  }

  function handleArchive() {
    if (!confirm('Archive this review batch? The client link will show it as closed.')) return
    run(() => updateBatchStatus(batchId, 'archived'))
  }

  function handleReopen() {
    if (!confirm('Reopen this review batch for the client?')) return
    run(() => updateBatchStatus(batchId, 'open'))
  }

  function handleRegenerate() {
    if (!confirm('Regenerate the share link? Old link stops working immediately.')) return
    run(() => regenerateToken(batchId))
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {status !== 'archived' && (
        <button type="button" onClick={handleArchive} disabled={isPending} className={BTN_CLASS}>
          <Archive size={12} />
          Archive
        </button>
      )}
      {(status === 'archived' || status === 'submitted') && (
        <button type="button" onClick={handleReopen} disabled={isPending} className={BTN_CLASS}>
          <RotateCcw size={12} />
          Reopen
        </button>
      )}
      <button type="button" onClick={handleRegenerate} disabled={isPending} className={BTN_CLASS}>
        <RefreshCw size={12} />
        Regenerate link
      </button>
      {isPending && <Loader2 size={13} className="animate-spin text-surface-400" />}
      {error && <p className="text-xs text-rose-400">{error}</p>}
    </div>
  )
}
