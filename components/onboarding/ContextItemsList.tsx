'use client'

// The stored context for a client, with the retention controls.
//
// Retention policy: an item is purged 60 days after it was added unless it is
// pinned, in which case it is kept for the life of the client. This list is
// where that becomes visible and actionable — a policy nobody can see is one
// nobody can comply with, and these rows hold transcripts and email verbatim.
//
// Only a preview of each body is loaded (see listContextItems), so the whole
// confidential payload is never shipped to the page just to render a list.

import { useState, useTransition } from 'react'
import { Pin, PinOff, Trash2, Loader2 } from 'lucide-react'
import type { ContextItemKind } from '@/lib/onboarding/context-items'

export interface ContextItemRow {
  id: string
  kind: ContextItemKind
  title: string | null
  occurred_at: string | null
  created_at: string
  pinned: boolean
  preview: string
}

const KIND_LABELS: Record<ContextItemKind, string> = {
  meeting_transcript: 'Transcript',
  email: 'Email',
  note: 'Note',
  web_page: 'Web page',
}

/** Whole days until the 60-day purge; negative means it is already overdue. */
const RETENTION_DAYS = 60

function daysLeft(createdAt: string): number {
  const added = new Date(createdAt).getTime()
  if (Number.isNaN(added)) return RETENTION_DAYS
  const elapsed = (Date.now() - added) / 86_400_000
  return Math.ceil(RETENTION_DAYS - elapsed)
}

interface Props {
  items: ContextItemRow[]
  onSetPinned: (itemId: string, pinned: boolean) => Promise<{ error?: string }>
  onDelete: (itemId: string) => Promise<{ error?: string }>
}

export default function ContextItemsList({ items, onSetPinned, onDelete }: Props) {
  const [pending, startTransition] = useTransition()
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [confirmId, setConfirmId] = useState<string | null>(null)

  if (items.length === 0) return null

  const run = (id: string, fn: () => Promise<{ error?: string }>) => {
    setBusyId(id)
    setError(null)
    startTransition(async () => {
      const res = await fn()
      setBusyId(null)
      setConfirmId(null)
      if (res.error) setError(res.error)
    })
  }

  return (
    <div className="mt-6">
      <div className="flex items-baseline justify-between mb-2">
        <h3 className="text-surface-100 text-sm font-medium">Stored context</h3>
        <p className="text-[11px] text-surface-400">
          Kept {RETENTION_DAYS} days unless pinned
        </p>
      </div>

      {error && (
        <p className="mb-2 text-[11px]" style={{ color: 'var(--color-danger, #f87171)' }}>
          {error}
        </p>
      )}

      <ul className="divide-y divide-surface-800 rounded-sm border border-surface-800 bg-surface-950">
        {items.map((item) => {
          const left = daysLeft(item.created_at)
          const busy = busyId === item.id && pending
          return (
            <li key={item.id} className="flex items-start gap-3 px-3 py-2.5">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="rounded-sm bg-surface-800 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-surface-300">
                    {KIND_LABELS[item.kind]}
                  </span>
                  <span className="truncate text-xs text-surface-100">
                    {item.title || 'Untitled'}
                  </span>
                  {item.pinned ? (
                    <span className="text-[10px] text-brand-400">Kept for the life of the client</span>
                  ) : (
                    <span
                      className="text-[10px] text-surface-400"
                      title={`Added ${new Date(item.created_at).toLocaleDateString()}`}
                    >
                      {left > 0 ? `Expires in ${left}d` : 'Due for purge'}
                    </span>
                  )}
                </div>
                <p className="mt-1 truncate text-[11px] text-surface-400">{item.preview}</p>
              </div>

              <div className="flex shrink-0 items-center gap-1">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => run(item.id, () => onSetPinned(item.id, !item.pinned))}
                  aria-label={item.pinned ? 'Unpin — let this expire' : 'Pin — keep for the life of the client'}
                  title={item.pinned ? 'Unpin — let this expire' : 'Pin — keep for the life of the client'}
                  className="rounded-sm p-1.5 text-surface-400 transition-colors hover:bg-surface-850 hover:text-surface-100 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
                >
                  {busy ? (
                    <Loader2 size={13} className="animate-spin" />
                  ) : item.pinned ? (
                    <PinOff size={13} />
                  ) : (
                    <Pin size={13} />
                  )}
                </button>

                {confirmId === item.id ? (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => run(item.id, () => onDelete(item.id))}
                    className="rounded-sm px-2 py-1 text-[11px] font-medium transition-colors disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
                    style={{
                      color: 'var(--color-danger, #f87171)',
                      backgroundColor: 'color-mix(in srgb, var(--color-danger, #f87171) 12%, transparent)',
                    }}
                  >
                    Delete for good?
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => setConfirmId(item.id)}
                    aria-label="Delete this context now"
                    title="Delete this context now"
                    className="rounded-sm p-1.5 text-surface-400 transition-colors hover:bg-surface-850 hover:text-surface-100 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
                  >
                    <Trash2 size={13} />
                  </button>
                )}
              </div>
            </li>
          )
        })}
      </ul>

      <p className="mt-2 text-[11px] leading-relaxed text-surface-400">
        Deleting the source does not change any setting it was used to suggest — confirmed
        answers keep their own quoted evidence.
      </p>
    </div>
  )
}
