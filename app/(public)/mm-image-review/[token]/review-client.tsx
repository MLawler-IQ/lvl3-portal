'use client'

import { useCallback, useMemo, useRef, useState } from 'react'
import { answersFromResponses } from '@/lib/review/helpers'
import { findMissingDenyNotes } from '@/lib/review/schemas'
import { buildSummaryText, counts } from '@/lib/review/summary'
import type {
  ItemAnswers,
  ItemState,
  ReviewBatchStatus,
  ReviewItem,
  ReviewResponse,
} from '@/lib/review/types'
import { ReviewCard } from './review-card'
import { ReviewFooter } from './review-footer'
import { ReviewHeader } from './review-header'
import { Toast, type ToastState } from './toast'
import { useAutosave } from './use-autosave'

export type ReviewBatchForClient = {
  id: string
  client: string
  title: string
  status: ReviewBatchStatus
  submitted_at: string | null
}

type Props = {
  token: string
  batch: ReviewBatchForClient
  items: ReviewItem[]
  initialResponses: ReviewResponse[]
  readOnly: boolean
}

function toAnswers(states: Record<string, ItemState>): Record<string, ItemAnswers> {
  const out: Record<string, ItemAnswers> = {}
  for (const [id, state] of Array.from(Object.entries(states))) {
    out[id] = { rating: state.rating || null, decision: state.decision, note: state.note }
  }
  return out
}

export function ReviewClient({ token, batch, items, initialResponses, readOnly }: Props) {
  const [states, setStates] = useState<Record<string, ItemState>>(() => {
    const answers = answersFromResponses(initialResponses)
    const map: Record<string, ItemState> = {}
    for (const item of items) {
      const a = answers[item.id]
      map[item.id] = {
        rating: a?.rating ?? 0,
        decision: a?.decision ?? null,
        note: a?.note ?? '',
      }
    }
    return map
  })
  const [locked, setLocked] = useState(readOnly)
  const [submitting, setSubmitting] = useState(false)
  const [confirmPending, setConfirmPending] = useState(false)
  const [flaggedIds, setFlaggedIds] = useState<Set<string>>(new Set())
  const [localSubmittedAt, setLocalSubmittedAt] = useState<string | null>(null)
  const [toast, setToast] = useState<ToastState>(null)

  const statesRef = useRef(states)
  statesRef.current = states
  const cardRefs = useRef<Record<string, HTMLDivElement | null>>({})
  const noteRefs = useRef<Record<string, HTMLTextAreaElement | null>>({})
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const confirmTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const itemIds = useMemo(() => items.map((item) => item.id), [items])

  const showToast = useCallback((message: string, err = false) => {
    setToast({ message, err })
    if (toastTimer.current) clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(null), 2400)
  }, [])

  const onLocked = useCallback(() => {
    setLocked(true)
    showToast('This review has been submitted and is now locked.')
  }, [showToast])

  const onInvalid = useCallback(() => {
    setLocked(true)
    showToast('This link is no longer active', true)
  }, [showToast])

  const { queueSave, flushAll, saveState, errorItemIds } = useAutosave(token, {
    onLocked,
    onInvalid,
  })

  const progress = counts(itemIds, toAnswers(states))

  function handleChange(itemId: string, next: ItemState) {
    if (locked) return
    setStates((prev) => ({ ...prev, [itemId]: next }))
    statesRef.current = { ...statesRef.current, [itemId]: next }
    if (flaggedIds.has(itemId) && !(next.decision === 'deny' && next.note.trim() === '')) {
      setFlaggedIds((prev) => {
        const nextSet = new Set(prev)
        nextSet.delete(itemId)
        return nextSet
      })
    }
    queueSave(itemId, next)
  }

  async function copySummary() {
    try {
      await navigator.clipboard.writeText(
        buildSummaryText(batch, items, toAnswers(statesRef.current))
      )
      showToast('Summary copied')
    } catch {
      showToast('Copy failed', true)
    }
  }

  function highlightMissing(ids: string[]) {
    showToast('Add a note for each Denied image before sending', true)
    if (ids.length === 0) return
    setFlaggedIds(new Set(ids))
    const first = items.find((item) => ids.includes(item.id))
    if (!first) return
    cardRefs.current[first.id]?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    noteRefs.current[first.id]?.focus({ preventScroll: true })
  }

  async function handleSubmit() {
    if (locked || submitting) return
    setSubmitting(true)
    try {
      await flushAll()
      const answers = toAnswers(statesRef.current)
      const missing = findMissingDenyNotes(answers, itemIds)
      if (missing.length > 0) {
        highlightMissing(missing)
        return
      }
      if (counts(itemIds, answers).pending > 0 && !confirmPending) {
        setConfirmPending(true)
        if (confirmTimer.current) clearTimeout(confirmTimer.current)
        confirmTimer.current = setTimeout(() => setConfirmPending(false), 4000)
        return
      }
      if (confirmTimer.current) clearTimeout(confirmTimer.current)
      setConfirmPending(false)

      let res: Response
      try {
        res = await fetch(`/api/review/${token}/submit`, { method: 'POST' })
      } catch {
        showToast('Network error — your review was not sent. Please try again.', true)
        return
      }
      if (res.ok) {
        setLocalSubmittedAt(new Date().toISOString())
        setLocked(true)
        showToast('Review submitted — thank you.')
        return
      }
      if (res.status === 422) {
        const body = (await res.json().catch(() => null)) as { itemIds?: string[] } | null
        highlightMissing(
          body?.itemIds?.length
            ? body.itemIds
            : findMissingDenyNotes(toAnswers(statesRef.current), itemIds)
        )
        return
      }
      if (res.status === 409) {
        setLocked(true)
        showToast('This review was already submitted.')
        return
      }
      showToast('Something went wrong sending the review — please try again.', true)
    } finally {
      setSubmitting(false)
    }
  }

  const submittedAt = localSubmittedAt ?? batch.submitted_at
  const submittedDateText = submittedAt
    ? new Date(submittedAt).toLocaleDateString('en-US', {
        month: 'long',
        day: 'numeric',
        year: 'numeric',
      })
    : null

  const saveText =
    saveState === 'saving'
      ? 'Saving…'
      : saveState === 'saved'
        ? 'All changes saved'
        : saveState === 'error'
          ? 'Some changes failed to save'
          : ''

  return (
    <>
      <ReviewHeader
        approved={progress.approved}
        denied={progress.denied}
        pending={progress.pending}
      />
      <main>
        <div className="hero">
          <div className="eyebrow">{batch.client} · Content Review</div>
          <h1>
            Blog image review. <span className="soft">Approve or deny, rate each.</span>
          </h1>
          <p className="lead">
            For each blog hero image: give it a rating out of 10, then Approve or Deny. If you
            Deny, a note is required so we know what to fix. Hit Send&nbsp;to&nbsp;Matt at the
            bottom when you&apos;re done — every decision, rating, and note drops into one email.
          </p>
        </div>
        {locked && (
          <div className="lockbanner">
            <span className="locklabel">Review locked</span>
            <span className="locktext">
              {submittedDateText
                ? `Submitted ${submittedDateText} — this review is locked.`
                : 'This review has been submitted and is locked.'}
            </span>
          </div>
        )}
        <div className="rule" />
        <div>
          {items.map((item, index) => (
            <ReviewCard
              key={item.id}
              item={item}
              index={index}
              total={items.length}
              state={states[item.id]}
              locked={locked}
              flagged={flaggedIds.has(item.id)}
              saveError={errorItemIds.has(item.id)}
              onChange={(next) => handleChange(item.id, next)}
              cardRef={(el) => {
                cardRefs.current[item.id] = el
              }}
              noteRef={(el) => {
                noteRefs.current[item.id] = el
              }}
            />
          ))}
        </div>
      </main>
      <div className="submitbar">
        <div className="si">
          <div className="sleft">
            <div className="summary">
              {progress.reviewed} of {items.length} reviewed · {progress.pending} left
            </div>
            {!locked && (
              <div className={`savestat${saveState === 'error' ? ' err' : ''}`}>{saveText}</div>
            )}
          </div>
          <div className="actions">
            <button type="button" className="ghost" onClick={copySummary}>
              Copy summary
            </button>
            {!locked && (
              <button
                type="button"
                className="primary"
                onClick={handleSubmit}
                disabled={submitting}
              >
                {submitting
                  ? 'Sending…'
                  : confirmPending
                    ? `${progress.pending} pending — submit anyway?`
                    : 'Send to Matt →'}
              </button>
            )}
          </div>
        </div>
      </div>
      <ReviewFooter />
      <Toast toast={toast} />
    </>
  )
}
