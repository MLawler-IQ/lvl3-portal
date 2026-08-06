'use client'

import { useEffect, useRef, useState } from 'react'
import { Loader2, CheckCircle2, XCircle, Clock, AlertTriangle } from 'lucide-react'
import type { TopicState } from '@/hooks/usePipelineStream'
import { STATUS_TONE } from '@/lib/status-tone'

interface PipelineProgressProps {
  topicTitles: string[]
  topicStates: Map<number, TopicState>
}

function StatusIcon({ status }: { status: TopicState['status'] }) {
  switch (status) {
    case 'running':
      return <Loader2 className="h-4 w-4 text-brand-500 animate-spin shrink-0" />
    case 'complete':
      return <CheckCircle2 className={`h-4 w-4 shrink-0 ${STATUS_TONE.success.text}`} />
    case 'failed':
      return <XCircle className={`h-4 w-4 shrink-0 ${STATUS_TONE.error.text}`} />
    case 'pending':
    default:
      return <Clock className="h-4 w-4 text-surface-400 shrink-0" />
  }
}

/**
 * Stage pill styling.
 *
 * This used to map seven stage names to seven hues by substring match, as
 * `bg-{c}-100 text-{c}-700` — a LIGHT-theme pairing that rendered as near-white
 * pills once the app went to ink. It was also categorical colour, which the palette
 * only validates four of, and the spec's "no new colours" rules out inventing three
 * more.
 *
 * The stage name is already the label, so the hue carried no information the text
 * didn't. One neutral pill.
 */
function stagePillColor(): string {
  return STATUS_TONE.neutral.chip
}

function formatElapsed(ms: number): string {
  const s = Math.floor(ms / 1000)
  if (s < 60) return `+${s}s`
  return `+${Math.floor(s / 60)}m${s % 60}s`
}

function TopicCard({ title, state }: { title: string; state: TopicState }) {
  const [now, setNow] = useState(() => Date.now())
  const logEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (state.status !== 'running') return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [state.status])

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }, [state.stageLog.length])

  const elapsed = state.startedAt ? Math.floor((now - state.startedAt) / 1000) : 0
  const noActivity =
    state.status === 'running' &&
    state.lastEventAt != null &&
    now - state.lastEventAt > 60_000

  const stagePill = state.currentStep.split(':')[1]?.trim() ?? state.currentStep.split(':')[0]?.trim() ?? ''
  const latestDetail = state.stageLog.at(-1)?.detail ?? ''

  const borderColor =
    state.status === 'running'
      ? noActivity
        ? 'border-l-amber-400'
        : 'border-l-brand-500'
      : state.status === 'complete'
        ? 'border-l-emerald-400'
        : state.status === 'failed'
          ? 'border-l-red-400'
          : 'border-l-surface-600'

  return (
    <div
      className={`bg-surface-900 border border-surface-700 border-l-4 ${borderColor} rounded-xl p-4 space-y-3`}
    >
      {/* Header row */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-start gap-2 min-w-0">
          <StatusIcon status={state.status} />
          <h3 className="text-sm font-medium text-surface-100 leading-tight line-clamp-2">
            {title}
          </h3>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {stagePill && state.status === 'running' && (
            <span
              className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${stagePillColor()}`}
            >
              {stagePill}
            </span>
          )}
          {state.status === 'running' && (
            <span className="text-[11px] text-surface-400 font-serif tabular-nums">
              {elapsed}s
            </span>
          )}
        </div>
      </div>

      {/* Stuck warning */}
      {noActivity && (
        <div className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 ${STATUS_TONE.warning.row}`}>
          <AlertTriangle className={`h-3.5 w-3.5 shrink-0 ${STATUS_TONE.warning.text}`} />
          <span className="text-[11px] text-surface-100">
            No activity for {Math.floor((now - state.lastEventAt!) / 1000)}s
          </span>
        </div>
      )}

      {/* Phase error */}
      {(state.status === 'complete' || state.status === 'failed') && state.result?.error && (
        <div className={`flex items-start gap-1.5 rounded-lg border px-2.5 py-1.5 ${STATUS_TONE.error.row}`}>
          <XCircle className={`h-3.5 w-3.5 shrink-0 mt-px ${STATUS_TONE.error.text}`} />
          <span className="text-[11px] text-surface-100 leading-snug">{state.result.error}</span>
        </div>
      )}

      {/* Progress bar */}
      <div>
        <div className="flex items-center justify-between mb-0.5">
          <span className="text-[11px] font-medium text-surface-400 truncate max-w-[75%]">
            {state.currentStep || 'Waiting...'}
          </span>
          <span className="text-[11px] text-surface-400 tabular-nums">
            {Math.round(state.pct * 100)}%
          </span>
        </div>
        {/* Latest detail line */}
        {latestDetail && (
          <p className="text-[11px] text-surface-400 leading-snug mb-1.5">
            {latestDetail}
          </p>
        )}
        <div className="bg-surface-800 rounded-full h-1.5">
          <div
            className="bg-brand-400 rounded-full h-1.5 transition-all duration-500"
            style={{ width: `${Math.min(100, Math.max(0, state.pct * 100))}%` }}
          />
        </div>
      </div>

      {/* Stage log */}
      {state.stageLog.length > 0 && (
        <div className="max-h-40 overflow-y-auto space-y-1 pr-1">
          {state.stageLog.map((entry, i) => (
            <div key={i} className="flex items-start gap-1.5">
              <span className="text-[10px] font-mono text-surface-600 shrink-0 tabular-nums w-10 text-right pt-px">
                {formatElapsed(entry.elapsed)}
              </span>
              <p className="text-[11px] text-surface-400 leading-snug">
                <span className="text-surface-400 font-medium">{entry.step}</span>
                {entry.detail ? ` — ${entry.detail}` : ''}
              </p>
            </div>
          ))}
          <div ref={logEndRef} />
        </div>
      )}

      {/* Pending state */}
      {state.status === 'pending' && state.stageLog.length === 0 && (
        <p className="text-[11px] text-surface-600">Waiting to start...</p>
      )}
    </div>
  )
}

export default function PipelineProgress({ topicTitles, topicStates }: PipelineProgressProps) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      {topicTitles.map((title, index) => {
        const state = topicStates.get(index) ?? {
          status: 'pending' as const,
          currentStep: '',
          pct: 0,
          logs: [],
          startedAt: null,
          lastEventAt: null,
          stageLog: [],
          dataAvailability: {},
          result: null,
        }

        return <TopicCard key={index} title={title} state={state} />
      })}
    </div>
  )
}
