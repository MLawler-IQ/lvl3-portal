'use client'

import { useEffect, useRef, useState } from 'react'
import { Loader2, CheckCircle2, XCircle, Clock, AlertTriangle } from 'lucide-react'
import type { TopicState } from '@/hooks/usePipelineStream'

interface PipelineProgressProps {
  topicTitles: string[]
  topicStates: Map<number, TopicState>
}

function StatusIcon({ status }: { status: TopicState['status'] }) {
  switch (status) {
    case 'running':
      return <Loader2 className="h-4 w-4 text-brand-500 animate-spin shrink-0" />
    case 'complete':
      return <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
    case 'failed':
      return <XCircle className="h-4 w-4 text-red-400 shrink-0" />
    case 'pending':
    default:
      return <Clock className="h-4 w-4 text-surface-500 shrink-0" />
  }
}

function stagePillColor(step: string): string {
  if (!step) return 'bg-surface-800 text-surface-500'
  const s = step.toLowerCase()
  if (s.includes('keyword') || s.includes('metric') || s.includes('cluster') || s.includes('finaliz'))
    return 'bg-red-100 text-red-700'
  if (s.includes('analyz')) return 'bg-sky-100 text-sky-700'
  if (s.includes('brief')) return 'bg-amber-100 text-amber-700'
  if (s.includes('writing draft')) return 'bg-emerald-100 text-emerald-700'
  if (s.includes('reviewing')) return 'bg-orange-100 text-orange-700'
  if (s.includes('revis')) return 'bg-rose-100 text-rose-700'
  if (s.includes('validat')) return 'bg-teal-100 text-teal-700'
  return 'bg-surface-800 text-surface-400'
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
          <h3 className="text-sm font-semibold text-surface-100 leading-tight line-clamp-2">
            {title}
          </h3>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {stagePill && state.status === 'running' && (
            <span
              className={`text-[10px] font-mono font-semibold px-1.5 py-0.5 rounded ${stagePillColor(stagePill)}`}
            >
              {stagePill}
            </span>
          )}
          {state.status === 'running' && (
            <span className="text-[11px] text-surface-500 font-mono tabular-nums">
              {elapsed}s
            </span>
          )}
        </div>
      </div>

      {/* Stuck warning */}
      {noActivity && (
        <div className="flex items-center gap-1.5 rounded-lg border border-amber-500/30 bg-amber-900/20 px-2.5 py-1.5">
          <AlertTriangle className="h-3.5 w-3.5 text-amber-400 shrink-0" />
          <span className="text-[11px] text-amber-300">
            No activity for {Math.floor((now - state.lastEventAt!) / 1000)}s
          </span>
        </div>
      )}

      {/* Phase error */}
      {(state.status === 'complete' || state.status === 'failed') && state.result?.error && (
        <div className="flex items-start gap-1.5 rounded-lg border border-red-500/30 bg-red-900/20 px-2.5 py-1.5">
          <XCircle className="h-3.5 w-3.5 text-red-400 shrink-0 mt-px" />
          <span className="text-[11px] text-red-300 leading-snug">{state.result.error}</span>
        </div>
      )}

      {/* Progress bar */}
      <div>
        <div className="flex items-center justify-between mb-0.5">
          <span className="text-[11px] font-medium text-surface-400 truncate max-w-[75%]">
            {state.currentStep || 'Waiting...'}
          </span>
          <span className="text-[11px] text-surface-500 tabular-nums">
            {Math.round(state.pct * 100)}%
          </span>
        </div>
        {/* Latest detail line */}
        {latestDetail && (
          <p className="text-[11px] text-surface-500 leading-snug mb-1.5">
            {latestDetail}
          </p>
        )}
        <div className="bg-surface-800 rounded-full h-1.5">
          <div
            className="bg-brand-500 rounded-full h-1.5 transition-all duration-500"
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
              <p className="text-[11px] text-surface-500 leading-snug">
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
