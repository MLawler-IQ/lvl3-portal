'use client'

// The stored context for a client, with the retention controls.
//
// Retention: context is kept for the life of the client. Nothing expires on a
// timer — a fact derived from a transcript points at that transcript, so deleting
// it on a schedule would leave the fact still claiming a source that no longer
// exists. Removal is a deliberate act instead, which is also the honest answer
// when a client asks for something to be deleted.
//
// Pinning no longer exempts anything from anything. It marks the items that
// matter most, so retrieval and summarisation can prefer them.
//
// Only a preview of each body is loaded (see listContextItems), so the whole
// confidential payload is never shipped to the page just to render a list.

import { useState, useTransition } from 'react'
import { Pin, PinOff, Trash2, Loader2 } from 'lucide-react'
import type { ContextItemKind } from '@/lib/onboarding/context-items'

/**
 * Deliberately shorter than CONTEXT_ITEM_KIND_LABELS. These sit in a badge beside
 * a title in a narrow list, where "Meeting transcript" wraps; the shared labels
 * are for the paste picker, which has room for the full phrase.
 *
 * The type annotation is the safeguard: it is Record<ContextItemKind, string>, so
 * adding a kind fails the build here rather than rendering `undefined`.
 */
const BADGE_LABELS: Record<ContextItemKind, string> = {
  meeting_transcript: 'Transcript',
  meeting_summary: 'Summary (AI)',
  email: 'Email',
  note: 'Note',
  web_page: 'Web page',
  audit_run: 'Audit',
}

export interface ContextItemRow {
  id: string
  kind: ContextItemKind
  title: string | null
  occurred_at: string | null
  created_at: string
  pinned: boolean
  preview: string
}

function addedOn(createdAt: string): string {
  const d = new Date(createdAt)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString()
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
        <p className="text-[11px] text-surface-400">Kept for the life of the client</p>
      </div>

      {error && (
        <p className="mb-2 text-[11px]" style={{ color: 'var(--color-danger, #f87171)' }}>
          {error}
        </p>
      )}

      <ul className="divide-y divide-surface-800 rounded-sm border border-surface-800 bg-surface-950">
        {items.map((item) => {
          const busy = busyId === item.id && pending
          return (
            <li key={item.id} className="flex items-start gap-3 px-3 py-2.5">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="rounded-sm bg-surface-800 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-surface-300">
                    {BADGE_LABELS[item.kind]}
                  </span>
                  <span className="truncate text-xs text-surface-100">
                    {item.title || 'Untitled'}
                  </span>
                  {item.pinned && (
                    <span className="text-[10px] text-brand-400">High signal</span>
                  )}
                  <span className="text-[10px] text-surface-400">
                    Added {addedOn(item.created_at)}
                  </span>
                </div>
                <p className="mt-1 truncate text-[11px] text-surface-400">{item.preview}</p>
              </div>

              <div className="flex shrink-0 items-center gap-1">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => run(item.id, () => onSetPinned(item.id, !item.pinned))}
                  aria-label={item.pinned ? 'Unmark as high signal' : 'Mark as high signal'}
                  title={item.pinned ? 'Unmark as high signal' : 'Mark as high signal'}
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
