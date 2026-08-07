'use client'

// Paste a transcript, email or note as client context.
//
// The second intake path alongside the interview: instead of a strategist
// relaying a call answer by answer, they paste the call. What comes back is
// SUGGESTIONS — every extracted value carries source 'context', which
// isFilled() refuses to count at any confidence, so nothing pasted here can
// answer a slot, move a session to ready_for_review, or reach clients.*. The UI
// has to say that plainly, because a confident-looking suggestion that reads as
// an answer is the exact failure this design exists to prevent.
//
// INTEGRATION POINT — this component deliberately owns no server action.
// app/actions/* is written in the integration phase; the action there must
// implement `ContextPasteProps['onSubmit']` exactly as typed below (insert the
// row into public.client_context_items, run lib/onboarding/extract.ts, merge the
// result into the session draft as suggestions, and return the slot ids it
// suggested). Wire it as: <ContextPaste clientId={...} onSubmit={addClientContext} />

import { useState } from 'react'
import { FileText, Info, Loader2 } from 'lucide-react'
// Deliberately NOT from '@/lib/onboarding/extract' — that module imports the
// Anthropic SDK at module scope, and this is a client component.
import {
  CONTEXT_ITEM_KIND_LABELS,
  PASTEABLE_CONTEXT_ITEM_KINDS,
  type ContextItemKind,
} from '@/lib/onboarding/context-items'
import { SLOTS_BY_ID } from '@/lib/onboarding/schema'

/** What the integrating server action receives. */
export interface ContextPasteInput {
  clientId: string
  kind: ContextItemKind
  /** Null when the strategist did not name it. */
  title: string | null
  body: string
  /** ISO date (yyyy-mm-dd) of the meeting/email, or null. */
  occurredAt: string | null
}

/**
 * What it must return. `suggestedSlotIds` drives the confirmation notice; omit
 * it and the component simply says the context was saved.
 *
 * These are SUGGESTIONS, never answers — the action must write them with
 * source 'context' and must not mark anything as answered.
 */
export interface ContextPasteResult {
  error?: string
  suggestedSlotIds?: string[]
  /** True when the model replied but nothing survived validation. */
  nothingExtracted?: boolean
  /** Rendered by lib/onboarding/extract.ts so both intake paths word it alike. */
  extraction?: {
    outcome: string
    summary: string
    proposed: number
    accepted: number
    rejectedByReason: { reason: string; count: number; slotIds: string[]; phrase: string }[]
  }
  /**
   * True when the context was stored but there was no open setup session to
   * attach suggestions to. Distinct from nothingExtracted: nothing was read
   * because there was nothing to read FOR, which is not the same as reading it
   * and finding nothing.
   */
  noActiveSession?: boolean
}

export interface ContextPasteProps {
  clientId: string
  onSubmit: (input: ContextPasteInput) => Promise<ContextPasteResult>
}

const inputClass =
  'w-full rounded-sm border border-surface-800 bg-surface-950 px-3 py-2 text-sm text-surface-100 placeholder-surface-400 transition-colors hover:border-surface-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400'

export default function ContextPaste({ clientId, onSubmit }: ContextPasteProps) {
  const [kind, setKind] = useState<ContextItemKind>('meeting_transcript')
  const [title, setTitle] = useState('')
  const [occurredAt, setOccurredAt] = useState('')
  const [body, setBody] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<ContextPasteResult | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (body.trim().length === 0 || busy) return

    setBusy(true)
    setError(null)
    setResult(null)

    const res = await onSubmit({
      clientId,
      kind,
      title: title.trim() || null,
      body,
      occurredAt: occurredAt || null,
    })

    setBusy(false)
    if (res.error) {
      setError(res.error)
      return
    }
    setResult(res)
    setBody('')
    setTitle('')
    setOccurredAt('')
  }

  const suggested = result?.suggestedSlotIds ?? []

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="flex items-start gap-2">
        <FileText size={14} className="mt-0.5 shrink-0 text-brand-400" />
        <div className="min-w-0">
          <h3 className="text-[13px] font-medium text-surface-100">Paste context</h3>
          <p className="mt-0.5 text-[11px] leading-relaxed text-surface-400">
            A call transcript, an email thread, a note. Anything here is read for
            suggestions only — nothing pasted can answer a question on its own.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <label className="block">
          <span className="mb-1 block text-[11px] font-medium uppercase tracking-[0.14em] text-surface-400">
            Kind
          </span>
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value as ContextItemKind)}
            className={`${inputClass} cursor-pointer`}
          >
            {PASTEABLE_CONTEXT_ITEM_KINDS.map((k) => (
              <option key={k} value={k}>
                {CONTEXT_ITEM_KIND_LABELS[k]}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="mb-1 block text-[11px] font-medium uppercase tracking-[0.14em] text-surface-400">
            Title
          </span>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Optional"
            className={inputClass}
          />
        </label>

        <label className="block">
          <span className="mb-1 block text-[11px] font-medium uppercase tracking-[0.14em] text-surface-400">
            Date
          </span>
          <input
            type="date"
            value={occurredAt}
            onChange={(e) => setOccurredAt(e.target.value)}
            className={inputClass}
          />
        </label>
      </div>

      <label className="block">
        <span className="mb-1 block text-[11px] font-medium uppercase tracking-[0.14em] text-surface-400">
          Content
        </span>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={10}
          placeholder="Paste the transcript, email or note here…"
          className={`${inputClass} resize-y font-mono text-[12px] leading-relaxed`}
        />
      </label>

      {error && (
        <p
          role="alert"
          className="rounded-sm px-3 py-2 text-xs"
          style={{
            color: 'var(--color-error)',
            backgroundColor: 'color-mix(in srgb, var(--color-error) 10%, transparent)',
            borderWidth: 1,
            borderStyle: 'solid',
            borderColor: 'color-mix(in srgb, var(--color-error) 25%, transparent)',
          }}
        >
          {error}
        </p>
      )}

      {result && !error && (
        <div
          className="rounded-sm border border-surface-800 bg-surface-900 px-3 py-2.5"
          role="status"
        >
          {suggested.length > 0 ? (
            <>
              <p className="flex items-start gap-1.5 text-[11px] leading-relaxed text-surface-300">
                <Info size={11} className="mt-0.5 shrink-0 text-brand-400" />
                <span>
                  <span className="font-medium text-surface-100">
                    {suggested.length} suggestion{suggested.length === 1 ? '' : 's'}, pending your
                    confirmation.
                  </span>{' '}
                  These are pre-filled in the review pane with the quote they came from. They do
                  not count as answered until you confirm each one.
                </span>
              </p>
              <ul className="mt-2 flex flex-wrap gap-1.5">
                {suggested.map((id) => (
                  <li
                    key={id}
                    className="rounded-sm border border-surface-700 px-2 py-0.5 text-[11px] text-surface-300"
                  >
                    {SLOTS_BY_ID.get(id)?.label ?? id}
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className="text-[11px] leading-relaxed text-surface-400">
              Context saved.{' '}
              {result.noActiveSession
                ? 'There is no setup session open, so nothing was read from it yet — start one above and it will be used.'
                : (result.extraction?.summary ??
                  'No suggestions were made from it.')}
            </p>
          )}
        </div>
      )}

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={busy || body.trim().length === 0}
          className="inline-flex items-center gap-1.5 rounded-sm bg-brand-400 px-4 py-2 text-sm font-semibold text-surface-950 transition-colors hover:bg-brand-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {busy && <Loader2 size={14} className="animate-spin" />}
          {busy ? 'Reading…' : 'Add context'}
        </button>
        <span className="text-[11px] text-surface-400">
          Stored against this client and read for suggestions.
        </span>
      </div>
    </form>
  )
}
