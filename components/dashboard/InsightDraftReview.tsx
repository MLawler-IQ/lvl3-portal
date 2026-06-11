'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { AlertTriangle, Check, Trash2 } from 'lucide-react'
import {
  approveSnapshotInsightsDraft,
  discardSnapshotInsightsDraft,
  type SnapshotInsightsDraft,
} from '@/app/actions/analytics'

export interface InsightDraftReviewProps {
  clientId: string
  draft: SnapshotInsightsDraft
}

/** Render an ISO timestamp as a short relative time, falling back to a local date. */
function fmtGeneratedAt(iso: string | undefined): string {
  if (!iso) return 'just now'
  const then = new Date(iso).getTime()
  if (!Number.isFinite(then)) return 'just now'
  const diffMs = Date.now() - then
  const mins = Math.round(diffMs / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins} min${mins === 1 ? '' : 's'} ago`
  const hrs = Math.round(mins / 60)
  if (hrs < 24) return `${hrs} hour${hrs === 1 ? '' : 's'} ago`
  const days = Math.round(hrs / 24)
  if (days < 7) return `${days} day${days === 1 ? '' : 's'} ago`
  return new Date(iso).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

const inputClass =
  'w-full bg-surface-800 border border-surface-600 text-surface-100 text-sm rounded-lg px-3 py-2 placeholder:text-surface-500 focus:outline-none focus:border-surface-500 transition-colors'
const labelClass =
  'text-[11px] font-medium uppercase tracking-[0.14em] text-brand-500'

/**
 * Admin-facing review card for a pending LLM analytics draft. A later step renders
 * this admin-gated; the card itself is designed to read as obviously-internal
 * (amber "pending review" badge + explicit "not visible to the client" copy).
 *
 * Editing the fields and clicking "Approve & publish" submits the CURRENT values —
 * saving edits IS approval. With no edits, one click publishes the draft as-is.
 */
export default function InsightDraftReview({ clientId, draft }: InsightDraftReviewProps) {
  const router = useRouter()
  const [headline, setHeadline] = useState(draft.headline ?? '')
  const [summary, setSummary] = useState(draft.summary ?? '')
  const [takeaways, setTakeaways] = useState(draft.takeaways ?? '')
  const [anomalies, setAnomalies] = useState(draft.anomalies ?? '')
  const [opportunities, setOpportunities] = useState(draft.opportunities ?? '')

  const [approving, setApproving] = useState(false)
  const [discarding, setDiscarding] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const busy = approving || discarding

  async function handleApprove() {
    setApproving(true)
    setError(null)
    const result = await approveSnapshotInsightsDraft(clientId, {
      headline,
      summary,
      takeaways,
      anomalies,
      opportunities,
    })
    if (result.error) {
      setError(result.error)
      setApproving(false)
    } else {
      router.refresh()
    }
  }

  async function handleDiscard() {
    if (!window.confirm('Discard this draft? The generated insights will be deleted and nothing will be published.')) {
      return
    }
    setDiscarding(true)
    setError(null)
    const result = await discardSnapshotInsightsDraft(clientId)
    if (result.error) {
      setError(result.error)
      setDiscarding(false)
    } else {
      router.refresh()
    }
  }

  return (
    <div className="bg-surface-900 border border-surface-700 rounded-xl p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-400/40 bg-amber-400/10 px-2.5 py-0.5 text-[11px] font-medium uppercase tracking-[0.1em] text-amber-400">
            <AlertTriangle className="h-3 w-3" aria-hidden="true" />
            Draft — pending review
          </span>
          <span className="text-xs text-surface-500">Generated {fmtGeneratedAt(draft.generatedAt)}</span>
        </div>
      </div>

      <p className="mb-4 text-xs text-surface-400">
        Not visible to the client until approved. Review and edit the AI-generated copy below, then
        publish it to the client&rsquo;s dashboard, Home summary, and Insights page.
      </p>

      <div className="space-y-4">
        <div className="space-y-1.5">
          <label htmlFor="draft-headline" className={labelClass}>
            Headline
          </label>
          <input
            id="draft-headline"
            type="text"
            value={headline}
            onChange={(e) => setHeadline(e.target.value)}
            placeholder="One-line headline for this reporting window"
            disabled={busy}
            className={inputClass}
          />
        </div>

        <div className="space-y-1.5">
          <label htmlFor="draft-summary" className={labelClass}>
            Summary
          </label>
          <textarea
            id="draft-summary"
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            rows={5}
            placeholder="Client-friendly narrative summary"
            disabled={busy}
            className={inputClass}
          />
        </div>

        <div className="space-y-1.5">
          <label htmlFor="draft-takeaways" className={labelClass}>
            Takeaways
          </label>
          <textarea
            id="draft-takeaways"
            value={takeaways}
            onChange={(e) => setTakeaways(e.target.value)}
            rows={3}
            placeholder="Most notable positive results"
            disabled={busy}
            className={inputClass}
          />
        </div>

        <div className="space-y-1.5">
          <label htmlFor="draft-anomalies" className={labelClass}>
            Anomalies
          </label>
          <textarea
            id="draft-anomalies"
            value={anomalies}
            onChange={(e) => setAnomalies(e.target.value)}
            rows={3}
            placeholder="Unusual patterns or concerns"
            disabled={busy}
            className={inputClass}
          />
        </div>

        <div className="space-y-1.5">
          <label htmlFor="draft-opportunities" className={labelClass}>
            Opportunities
          </label>
          <textarea
            id="draft-opportunities"
            value={opportunities}
            onChange={(e) => setOpportunities(e.target.value)}
            rows={3}
            placeholder="Specific, actionable opportunities"
            disabled={busy}
            className={inputClass}
          />
        </div>
      </div>

      {error && <p className="mt-3 text-xs text-rose-400">{error}</p>}

      <div className="mt-5 flex items-center gap-3">
        <button
          type="button"
          onClick={handleApprove}
          disabled={busy}
          className="inline-flex items-center gap-1.5 rounded-lg bg-brand-500 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-600 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
        >
          <Check size={14} />
          {approving ? 'Publishing…' : 'Approve & publish'}
        </button>
        <button
          type="button"
          onClick={handleDiscard}
          disabled={busy}
          className="inline-flex items-center gap-1.5 rounded-lg border border-surface-600 bg-surface-800 px-4 py-2 text-sm font-medium text-surface-300 transition-colors hover:border-surface-500 hover:text-surface-100 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-surface-400"
        >
          <Trash2 size={14} />
          {discarding ? 'Discarding…' : 'Discard'}
        </button>
      </div>
    </div>
  )
}
