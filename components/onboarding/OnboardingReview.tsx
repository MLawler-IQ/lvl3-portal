'use client'

// The checklist and the review form.
//
// This is what makes "the conversation replaces the form" safe: every value the
// model extracted appears in an editable field, and nothing reaches
// clients.ga4_property_id until an admin submits this. Generalizes the
// RecommendButton contract in ClientSettingsForm (AI fills, provenance shown,
// human edits, then saves).

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Check, CircleHelp, Circle, Loader2, Sparkles, RefreshCw } from 'lucide-react'
import {
  approveOnboardingSession,
  saveAnswerEdits,
} from '@/app/actions/onboarding'
import { runDiscovery } from '@/app/actions/onboarding-discover'
import type { Completeness, SlotStatus } from '@/lib/onboarding/completeness'
import type { Answers } from '@/lib/onboarding/schema'

export interface SlotMeta {
  id: string
  label: string
  group: string
  why: string
  required: boolean
  kind: 'text' | 'number' | 'list' | 'choice'
  choices: readonly string[] | null
}

interface Props {
  sessionId: string
  clientId: string
  slots: SlotMeta[]
  answers: Answers
  completeness: Completeness
}

const GROUP_LABELS: Record<string, string> = {
  business: 'Business reality',
  geography: 'Geography',
  operations: 'Operations',
  brand: 'Brand',
  access: 'Access & configuration',
}

function StateIcon({ state }: { state: SlotStatus['state'] }) {
  if (state === 'filled') return <Check size={13} className="text-brand-400 shrink-0" />
  if (state === 'unknown')
    return <CircleHelp size={13} className="shrink-0" style={{ color: 'var(--color-warning)' }} />
  return <Circle size={13} className="text-surface-600 shrink-0" />
}

function toDisplay(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (Array.isArray(value)) return value.join(', ')
  return String(value)
}

export default function OnboardingReview({
  sessionId,
  clientId,
  slots,
  answers: initialAnswers,
  completeness,
}: Props) {
  const router = useRouter()
  const [answers, setAnswers] = useState<Answers>(initialAnswers)
  const [busy, setBusy] = useState<'save' | 'approve' | 'detect' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  const statusById = useMemo(
    () => new Map(completeness.slots.map((s) => [s.id, s])),
    [completeness],
  )

  const grouped = useMemo(() => {
    const out = new Map<string, SlotMeta[]>()
    for (const slot of slots) {
      const list = out.get(slot.group) ?? []
      list.push(slot)
      out.set(slot.group, list)
    }
    return Array.from(out.entries())
  }, [slots])

  function setValue(slot: SlotMeta, raw: string) {
    setSaved(false)
    setAnswers((prev) => ({
      ...prev,
      [slot.id]: {
        value: slot.kind === 'list' ? raw.split(',').map((s) => s.trim()).filter(Boolean) : raw,
        unknown: false,
        recordedAt: prev[slot.id]?.recordedAt,
        // Typing over an auto-matched value makes it the human's answer, so the
        // "auto-detected" provenance is dropped rather than left to mislead.
        source: 'interview',
      },
    }))
  }

  function toggleUnknown(slot: SlotMeta, unknown: boolean) {
    setSaved(false)
    setAnswers((prev) => ({
      ...prev,
      [slot.id]: unknown
        ? {
            value: null,
            unknown: true,
            // Pre-filled rather than blank: an unknown with no reason does not
            // count as a gap, so a blank default would silently keep the slot
            // empty and block approval with no visible cause.
            reason: prev[slot.id]?.reason?.trim() || 'Client could not answer',
          }
        : { value: '', unknown: false },
    }))
  }

  function setReason(slot: SlotMeta, reason: string) {
    setSaved(false)
    setAnswers((prev) => ({
      ...prev,
      [slot.id]: { value: null, unknown: true, reason },
    }))
  }

  async function handleSave() {
    setBusy('save')
    setError(null)
    const res = await saveAnswerEdits(sessionId, answers)
    setBusy(null)
    if (res.error) setError(res.error)
    else {
      setSaved(true)
      router.refresh()
    }
  }

  async function handleDetect() {
    setBusy('detect')
    setError(null)
    const res = await runDiscovery(sessionId)
    setBusy(null)
    if (res.error) setError(res.error)
    else {
      if (res.answers) setAnswers(res.answers)
      router.refresh()
    }
  }

  async function handleApprove() {
    setBusy('approve')
    setError(null)
    const res = await approveOnboardingSession(sessionId, answers)
    setBusy(null)
    if (res.error) setError(res.error)
    else router.push(`/clients/${clientId}`)
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Coverage summary */}
      <div className="shrink-0 border-b border-surface-800 px-5 py-4">
        <div className="flex items-baseline justify-between gap-3 mb-2">
          <h2 className="font-serif text-lg text-surface-100">Coverage</h2>
          {/*
            Coverage over EVERY slot, not just the required three. Showing the
            required percentage here would read 100% on a session where three
            Google ids were auto-discovered and nine questions were never asked —
            technically true, and an invitation to approve an interview nobody
            has had. The approve gate is still required-only; this is the picture
            of what we actually know.
          */}
          <span className="font-serif tabular-nums text-2xl text-brand-400">
            {completeness.totalPct}%
          </span>
        </div>
        <div className="h-1 w-full bg-surface-800 rounded-full overflow-hidden">
          <div
            className="h-full bg-brand-400 transition-all"
            style={{ width: `${completeness.totalPct}%` }}
          />
        </div>
        <p className="mt-2 text-xs text-surface-400">
          {completeness.missing.length > 0
            ? `${completeness.missing.length} required topic${completeness.missing.length === 1 ? '' : 's'} still to cover.`
            : completeness.unknown.length > 0
              ? `Ready to review, with ${completeness.unknown.length} recorded gap${completeness.unknown.length === 1 ? '' : 's'}.`
              : 'Every required topic answered.'}
          {completeness.optionalMissing.length > 0 && (
            <>
              {' '}
              <span className="text-surface-300">
                {completeness.optionalMissing.length} more worth capturing before you approve.
              </span>
            </>
          )}
        </p>
      </div>

      {/* Editable slots */}
      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-6 min-h-0">
        {grouped.map(([group, groupSlots]) => (
          <section key={group}>
            <h3 className="text-[11px] font-medium uppercase tracking-[0.14em] text-surface-400 mb-3">
              {GROUP_LABELS[group] ?? group}
            </h3>
            <div className="space-y-4">
              {groupSlots.map((slot) => {
                const status = statusById.get(slot.id)
                const answer = answers[slot.id]
                const isUnknown = answer?.unknown === true

                return (
                  <div key={slot.id} className="border-b border-surface-800 pb-4 last:border-0">
                    <div className="flex items-start gap-2 mb-1.5">
                      <span className="mt-1">
                        <StateIcon state={status?.state ?? 'empty'} />
                      </span>
                      <div className="min-w-0 flex-1">
                        <label
                          htmlFor={`slot-${slot.id}`}
                          className="block text-[13px] font-medium text-surface-100"
                        >
                          {slot.label}
                          {slot.required && (
                            <span className="ml-1 text-brand-400" aria-label="required">
                              *
                            </span>
                          )}
                        </label>
                        <p className="text-[11px] text-surface-400 leading-relaxed mt-0.5">
                          {slot.why}
                        </p>
                      </div>
                    </div>

                    {isUnknown ? (
                      <input
                        id={`slot-${slot.id}`}
                        type="text"
                        value={answer?.reason ?? ''}
                        onChange={(e) => setReason(slot, e.target.value)}
                        placeholder="Why is this unknown? (required)"
                        className="w-full rounded-sm border border-surface-800 bg-surface-950 px-3 py-2 text-sm text-surface-100 placeholder-surface-400 transition-colors hover:border-surface-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
                      />
                    ) : slot.kind === 'choice' ? (
                      <select
                        id={`slot-${slot.id}`}
                        value={toDisplay(answer?.value)}
                        onChange={(e) => setValue(slot, e.target.value)}
                        className="w-full rounded-sm border border-surface-800 bg-surface-950 px-3 py-2 text-sm text-surface-100 cursor-pointer transition-colors hover:border-surface-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
                      >
                        <option value="">Not set</option>
                        {slot.choices?.map((c) => (
                          <option key={c} value={c}>
                            {c}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <textarea
                        id={`slot-${slot.id}`}
                        value={toDisplay(answer?.value)}
                        onChange={(e) => setValue(slot, e.target.value)}
                        rows={slot.kind === 'list' ? 2 : 3}
                        placeholder={slot.kind === 'list' ? 'Comma separated' : ''}
                        className="w-full resize-y rounded-sm border border-surface-800 bg-surface-950 px-3 py-2 text-sm text-surface-100 placeholder-surface-400 transition-colors hover:border-surface-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
                      />
                    )}

                    {answer?.source === 'auto' && answer.evidence && (
                      <p className="mt-1.5 flex items-start gap-1.5 text-[11px] leading-relaxed text-surface-400">
                        <Sparkles
                          size={11}
                          className={`mt-0.5 shrink-0 ${answer.confidence === 'low' ? '' : 'text-brand-400'}`}
                          style={answer.confidence === 'low' ? { color: 'var(--color-warning)' } : undefined}
                        />
                        <span>
                          <span className="font-medium text-surface-300">
                            {answer.confidence === 'low' ? 'Best guess — confirm: ' : 'Auto-detected: '}
                          </span>
                          {answer.evidence}
                        </span>
                      </p>
                    )}

                    <label className="mt-2 inline-flex items-center gap-2 text-[11px] text-surface-400 cursor-pointer transition-colors hover:text-surface-100">
                      <input
                        type="checkbox"
                        checked={isUnknown}
                        onChange={(e) => toggleUnknown(slot, e.target.checked)}
                        className="rounded-sm border-surface-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
                      />
                      Client couldn&apos;t answer — record as a known gap
                    </label>
                  </div>
                )
              })}
            </div>
          </section>
        ))}
      </div>

      {/* Actions */}
      <div className="shrink-0 border-t border-surface-800 px-5 py-4 space-y-3">
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
        {saved && !error && (
          <p className="text-xs" style={{ color: 'var(--color-success)' }}>
            Draft saved.
          </p>
        )}

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleDetect}
            disabled={busy !== null}
            title="Re-check the connected Google accounts for this client's domain"
            className="inline-flex items-center gap-1.5 rounded-sm border border-surface-800 px-3 py-2 text-sm font-medium text-surface-100 transition-colors hover:bg-surface-850 hover:border-surface-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {busy === 'detect' ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <RefreshCw size={14} />
            )}
            Re-detect
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={busy !== null}
            className="inline-flex items-center gap-1.5 rounded-sm border border-surface-800 px-4 py-2 text-sm font-medium text-surface-100 transition-colors hover:bg-surface-850 hover:border-surface-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {busy === 'save' && <Loader2 size={14} className="animate-spin" />}
            Save draft
          </button>
          <button
            type="button"
            onClick={handleApprove}
            disabled={busy !== null || !completeness.readyForReview}
            title={
              completeness.readyForReview
                ? undefined
                : `Still missing: ${completeness.missing.join(', ')}`
            }
            className="inline-flex items-center gap-1.5 rounded-sm bg-brand-400 px-4 py-2 text-sm font-semibold text-surface-950 transition-colors hover:bg-brand-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {busy === 'approve' && <Loader2 size={14} className="animate-spin" />}
            Approve &amp; apply
          </button>
        </div>
        <p className="text-[11px] text-surface-400 leading-relaxed">
          Approving writes these values to the client record, including the GA4 property,
          Search Console property and dashboard type. Nothing is applied until you do.
        </p>
      </div>
    </div>
  )
}
