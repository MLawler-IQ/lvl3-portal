'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { ChevronRight } from 'lucide-react'
import { setSelectedClient } from '@/app/actions/client-selection'
import type { TriageRow } from '@/app/actions/admin-triage'
import { DELTA_TONE_TEXT, deltaTone } from '@/lib/delta-tone'
import { GRADE_CHIP } from '@/lib/grade-tone'

const MONO = { fontFamily: 'var(--font-newsreader), Georgia, serif', fontVariantNumeric: 'tabular-nums' }


function fmtNum(n: number): string {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`
  return n.toLocaleString()
}

function SessionsDelta({ delta }: { delta: number }) {
  const tone = deltaTone(delta)
  const arrow = tone === 'flat' ? '→' : delta > 0 ? '↑' : '↓'
  return (
    <span className={`inline-flex items-center gap-0.5 text-xs ${DELTA_TONE_TEXT[tone]}`}>
      <span aria-hidden="true">{arrow}</span>
      {Math.abs(delta)}%
    </span>
  )
}

/**
 * Compact cross-client triage scanner — one dense row per client: name, GBP
 * audit grade, pacing-behind badge, sessions + delta. Clicking a row selects
 * that client and opens its dashboard.
 */
export default function AdminTriageStrip({ rows }: { rows: TriageRow[] }) {
  const router = useRouter()
  const [pendingId, setPendingId] = useState<string | null>(null)

  async function handleSelect(clientId: string) {
    setPendingId(clientId)
    try {
      await setSelectedClient(clientId)
      router.push('/dashboard')
      router.refresh()
    } catch {
      setPendingId(null)
    }
  }

  if (rows.length === 0) return null

  return (
    <div className="overflow-hidden rounded-xl border border-surface-700 bg-surface-900 divide-y divide-surface-700/50">
      {rows.map((row) => (
        <button
          key={row.clientId}
          onClick={() => handleSelect(row.clientId)}
          disabled={pendingId !== null}
          aria-label={`Open ${row.name} dashboard`}
          className={`flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-surface-850 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-400 disabled:cursor-wait ${
            pendingId === row.clientId ? 'opacity-60' : pendingId ? 'opacity-80' : ''
          }`}
        >
          <span className="min-w-0 flex-1 truncate text-sm font-medium text-surface-200">
            {row.name}
          </span>

          {row.error && (
            <span className="shrink-0 text-[11px] italic text-surface-400">
              data unavailable
            </span>
          )}

          {row.pacing.configured ? (
            row.pacing.behindCount > 0 && (
              <span
                className="shrink-0 rounded-full border border-error/40 bg-error/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.1em] text-error"
                title={`${row.pacing.behindCount} monthly ${row.pacing.behindCount === 1 ? 'goal' : 'goals'} pacing behind`}
              >
                {row.pacing.behindCount} behind
              </span>
            )
          ) : (
            <span className="hidden shrink-0 text-[11px] text-surface-600 sm:inline">
              no goals set
            </span>
          )}

          {row.gbp.configured && row.gbp.grade && (
            <span
              className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-md border text-[10px] font-bold ${GRADE_CHIP[row.gbp.grade]}`}
              style={MONO}
              title={`GBP profile health${typeof row.gbp.score === 'number' ? ` ${row.gbp.score}/100` : ''}`}
              aria-label={`GBP grade ${row.gbp.grade}`}
            >
              {row.gbp.grade}
            </span>
          )}

          <span
            className="w-16 shrink-0 text-right text-sm font-semibold text-surface-100"
            style={MONO}
          >
            {row.sessions !== null ? fmtNum(row.sessions) : <span className="text-surface-600">—</span>}
          </span>
          <span className="w-14 shrink-0 text-right">
            {row.sessionsDelta !== null && <SessionsDelta delta={row.sessionsDelta} />}
          </span>

          <ChevronRight className="h-3.5 w-3.5 shrink-0 text-surface-600" aria-hidden="true" />
        </button>
      ))}
    </div>
  )
}
