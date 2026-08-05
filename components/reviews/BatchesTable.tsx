'use client'

import Link from 'next/link'
import { Images } from 'lucide-react'
import { reviewUrl } from '@/lib/review/helpers'
import type { BatchWithProgress } from '@/lib/review/types'
import CopyLinkButton from './CopyLinkButton'
import StatusPill from './StatusPill'

export default function BatchesTable({ batches }: { batches: BatchWithProgress[] }) {
  if (batches.length === 0) {
    return (
      <div className="bg-surface-900 border border-surface-700 rounded-xl p-10 text-center">
        <Images size={24} className="mx-auto mb-3 text-surface-400" />
        <p className="text-sm text-surface-300">No review batches yet.</p>
        <p className="mt-1 text-xs text-surface-400">
          Create one to share images with a client for approval.
        </p>
      </div>
    )
  }

  return (
    <div className="bg-surface-900 border border-surface-700 rounded-xl overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-surface-700 text-left">
            <th className="px-4 py-3 text-xs font-medium uppercase tracking-widest text-surface-400">Client</th>
            <th className="px-4 py-3 text-xs font-medium uppercase tracking-widest text-surface-400">Title</th>
            <th className="px-4 py-3 text-xs font-medium uppercase tracking-widest text-surface-400">Status</th>
            <th className="px-4 py-3 text-xs font-medium uppercase tracking-widest text-surface-400">Items</th>
            <th className="px-4 py-3 text-xs font-medium uppercase tracking-widest text-surface-400">Progress</th>
            <th className="px-4 py-3 text-xs font-medium uppercase tracking-widest text-surface-400">Created</th>
            <th className="px-4 py-3 text-xs font-medium uppercase tracking-widest text-surface-400 text-right">Actions</th>
          </tr>
        </thead>
        <tbody>
          {batches.map((batch) => (
            <tr
              key={batch.id}
              className="border-b border-surface-700/50 last:border-b-0 hover:bg-surface-850 transition-colors"
            >
              <td className="px-4 py-3 text-surface-100 font-medium whitespace-nowrap">
                {batch.client}
              </td>
              <td className="px-4 py-3 text-surface-300">
                <Link
                  href={`/reviews/${batch.id}`}
                  className="hover:text-surface-100 transition-colors"
                >
                  {batch.title}
                </Link>
              </td>
              <td className="px-4 py-3">
                <StatusPill status={batch.status} />
              </td>
              <td className="px-4 py-3 text-surface-300 tabular-nums">{batch.item_count}</td>
              <td className="px-4 py-3 whitespace-nowrap">
                <span className="text-surface-300 tabular-nums">
                  {batch.responded_count}/{batch.item_count}
                </span>
                <span className="ml-2 text-xs text-surface-400 tabular-nums">
                  <span className="text-emerald-400">{batch.approved_count} ✓</span>
                  {' · '}
                  <span className="text-rose-400">{batch.denied_count} ✗</span>
                </span>
              </td>
              <td className="px-4 py-3 text-surface-400 whitespace-nowrap">
                {new Date(batch.created_at).toLocaleDateString('en-US', {
                  month: 'short',
                  day: 'numeric',
                  year: 'numeric',
                })}
              </td>
              <td className="px-4 py-3">
                <div className="flex items-center justify-end gap-2">
                  <CopyLinkButton url={reviewUrl(batch.token)} />
                  <Link
                    href={`/reviews/${batch.id}`}
                    className="inline-flex items-center text-xs font-medium px-2.5 py-1.5 rounded-lg bg-brand-400 hover:bg-brand-300 text-surface-950 transition-colors"
                  >
                    View
                  </Link>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
