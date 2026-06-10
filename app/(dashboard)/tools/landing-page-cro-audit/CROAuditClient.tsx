'use client'

import { useState, useRef } from 'react'
import { MousePointerClick } from 'lucide-react'
import UrlInputTool from '@/components/tools/primitives/UrlInputTool'
import BackgroundJobTool, { type JobStatus } from '@/components/tools/primitives/BackgroundJobTool'
import RunHistory, { type ToolRun } from '@/components/tools/RunHistory'
import { statusColor, statusTint, type StatusLevel } from '@/lib/status-color'

// ── Types (mirrored from API route) ──────────────────────────────────────────

interface CROAuditScore {
  score: number
  grade: 'A' | 'B' | 'C' | 'D' | 'F'
  issues: string[]
  suggestions: string[]
}

interface CROAudit {
  url: string
  overallScore: number
  sections: {
    formFriction: CROAuditScore
    ctaClarity: CROAuditScore
    valueProp: CROAuditScore
    trustSignals: CROAuditScore
    pageSpeed: CROAuditScore
  }
  topFixes: Array<{ priority: 1 | 2 | 3; fix: string; impact: 'high' | 'medium' | 'low' }>
}

type StreamEvent =
  | { type: 'progress'; message: string; pct: number }
  | { type: 'complete'; runId: string; audit: CROAudit }
  | { type: 'error'; message: string }

// ── Grade colours ─────────────────────────────────────────────────────────────

const GRADE_LEVEL: Record<CROAuditScore['grade'], StatusLevel> = {
  A: 'success',
  B: 'success',
  C: 'warning',
  D: 'error',
  F: 'error',
}

const GRADE_COLOR: Record<CROAuditScore['grade'], string> = {
  A: statusColor(GRADE_LEVEL.A),
  B: statusColor(GRADE_LEVEL.B),
  C: statusColor(GRADE_LEVEL.C),
  D: statusColor(GRADE_LEVEL.D),
  F: statusColor(GRADE_LEVEL.F),
}

const IMPACT_COLOR: Record<'high' | 'medium' | 'low', string> = {
  high: statusColor('error'),
  medium: statusColor('warning'),
  low: statusColor('success'),
}

// ── Sub-components ───────────────────────────────────────────────────────────

function GradeBadge({ grade }: { grade: CROAuditScore['grade'] }) {
  return (
    <span
      className="inline-flex items-center justify-center w-8 h-8 rounded-lg text-sm font-bold font-mono"
      style={{ backgroundColor: statusTint(GRADE_LEVEL[grade], 13), color: GRADE_COLOR[grade] }}
    >
      {grade}
    </span>
  )
}

function SectionCard({ title, data }: { title: string; data: CROAuditScore }) {
  return (
    <div className="bg-surface-900 border border-surface-700 rounded-xl p-5 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-surface-100">{title}</h3>
        <div className="flex items-center gap-2">
          <GradeBadge grade={data.grade} />
          <span className="text-lg font-bold font-mono" style={{ color: 'var(--color-accent)' }}>
            {data.score}
          </span>
        </div>
      </div>

      {data.issues.length > 0 && (
        <div className="space-y-1">
          <p className="text-xs uppercase tracking-widest font-medium text-surface-500">Issues</p>
          <ul className="space-y-1">
            {data.issues.map((issue, i) => (
              <li key={i} className="flex items-start gap-2 text-xs text-surface-300">
                <span className="mt-0.5 shrink-0" style={{ color: 'var(--color-error)' }}>&#x2022;</span>
                {issue}
              </li>
            ))}
          </ul>
        </div>
      )}

      {data.suggestions.length > 0 && (
        <div className="space-y-1">
          <p className="text-xs uppercase tracking-widest font-medium text-surface-500">Suggestions</p>
          <ul className="space-y-1">
            {data.suggestions.map((s, i) => (
              <li key={i} className="flex items-start gap-2 text-xs text-surface-400">
                <span className="mt-0.5 shrink-0" style={{ color: 'var(--color-accent)' }}>&#x2192;</span>
                {s}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

function AuditResult({ audit }: { audit: CROAudit }) {
  const sectionLabels: Record<keyof CROAudit['sections'], string> = {
    formFriction: 'Form Friction',
    ctaClarity: 'CTA Clarity',
    valueProp: 'Value Proposition',
    trustSignals: 'Trust Signals',
    pageSpeed: 'Page Speed',
  }

  return (
    <div className="space-y-6">
      {/* Overall score */}
      <div className="bg-surface-900 border border-surface-700 rounded-xl p-6 flex items-center gap-6">
        <div className="text-center">
          <p className="text-xs uppercase tracking-widest font-medium text-surface-500 mb-1">Overall Score</p>
          <p
            className="text-5xl font-bold font-mono"
            style={{ color: 'var(--color-accent)' }}
          >
            {audit.overallScore}
          </p>
          <p className="text-xs text-surface-500 mt-1">/100</p>
        </div>
        <div className="border-l border-surface-700 pl-6 min-w-0">
          <p className="text-xs uppercase tracking-widest font-medium text-surface-500 mb-1">URL</p>
          <a
            href={audit.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm text-surface-200 hover:text-surface-100 truncate block transition-colors"
            style={{ maxWidth: '480px' }}
          >
            {audit.url}
          </a>
        </div>
      </div>

      {/* Section cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {(Object.keys(audit.sections) as Array<keyof CROAudit['sections']>).map(key => (
          <SectionCard key={key} title={sectionLabels[key]} data={audit.sections[key]} />
        ))}
      </div>

      {/* Top fixes */}
      {audit.topFixes.length > 0 && (
        <div className="bg-surface-900 border border-surface-700 rounded-xl p-5 space-y-3">
          <p className="text-xs uppercase tracking-widest font-medium" style={{ color: 'var(--color-primary)' }}>
            Top Priority Fixes
          </p>
          <ol className="space-y-3">
            {audit.topFixes.map(fix => (
              <li key={fix.priority} className="flex items-start gap-3">
                <span
                  className="shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold font-mono"
                  style={{ backgroundColor: 'var(--active-bg)', color: 'var(--color-accent)' }}
                >
                  {fix.priority}
                </span>
                <div className="flex-1 min-w-0">
                  <span className="text-sm text-surface-200">{fix.fix}</span>
                  <span
                    className="ml-2 text-xs font-medium uppercase"
                    style={{ color: IMPACT_COLOR[fix.impact] }}
                  >
                    {fix.impact}
                  </span>
                </div>
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

interface Props {
  recentRuns: ToolRun[]
}

export default function CROAuditClient({ recentRuns }: Props) {
  const [activeTab, setActiveTab] = useState<'run' | 'history'>('run')
  const [jobStatus, setJobStatus] = useState<JobStatus>('idle')
  const [progress, setProgress] = useState(0)
  const [logs, setLogs] = useState<string[]>([])
  const [jobError, setJobError] = useState<string | null>(null)
  const [audit, setAudit] = useState<CROAudit | null>(null)

  const abortRef = useRef<AbortController | null>(null)

  function reset() {
    abortRef.current?.abort()
    abortRef.current = null
    setJobStatus('idle')
    setProgress(0)
    setLogs([])
    setJobError(null)
    setAudit(null)
  }

  async function handleSubmit(url: string) {
    reset()
    setJobStatus('running')

    const abort = new AbortController()
    abortRef.current = abort

    try {
      const res = await fetch('/api/tools/landing-page-cro-audit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
        signal: abort.signal,
      })

      if (!res.ok || !res.body) {
        setJobStatus('failed')
        setJobError(`Server error: ${res.status}`)
        return
      }

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''

        for (const line of lines) {
          const trimmed = line.trim()
          if (!trimmed) continue
          try {
            const event = JSON.parse(trimmed) as StreamEvent
            if (event.type === 'progress') {
              setProgress(event.pct)
              setLogs(prev => [...prev, event.message])
            } else if (event.type === 'complete') {
              setProgress(100)
              setAudit(event.audit)
              setJobStatus('complete')
            } else if (event.type === 'error') {
              setJobStatus('failed')
              setJobError(event.message)
            }
          } catch {
            // malformed line — ignore
          }
        }
      }
    } catch (err) {
      if ((err as Error).name === 'AbortError') return
      setJobStatus('failed')
      setJobError(err instanceof Error ? err.message : 'Unknown error')
    }
  }

  function handleLoad(run: ToolRun) {
    if (!run.output) return
    const output = run.output as { audit?: CROAudit }
    if (!output.audit) return
    setAudit(output.audit)
    setJobStatus('complete')
    setProgress(100)
    setLogs([])
    setJobError(null)
    setActiveTab('run')
  }

  const tabs: Array<{ id: 'run' | 'history'; label: string }> = [
    { id: 'run', label: 'Run' },
    { id: 'history', label: 'History' },
  ]

  return (
    <div className="max-w-7xl mx-auto p-6 space-y-6 pb-8">
      {/* Header */}
      <div className="flex items-center gap-3">
        <MousePointerClick className="w-5 h-5 text-surface-400" />
        <div>
          <h1 className="text-xl font-semibold text-surface-100">Landing Page CRO Audit</h1>
          <p className="mt-0.5 text-sm text-surface-400">
            Score any landing page on form friction, CTA clarity, trust signals, and page speed.
          </p>
        </div>
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 border-b border-surface-700">
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px ${
              activeTab === tab.id
                ? 'border-brand-500 text-surface-100'
                : 'border-transparent text-surface-400 hover:text-surface-200'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Run tab */}
      {activeTab === 'run' && (
        <BackgroundJobTool
          status={jobStatus}
          progress={progress}
          logs={logs}
          error={jobError}
          onCancel={() => {
            abortRef.current?.abort()
            setJobStatus('idle')
          }}
          onReset={reset}
          renderResult={audit ? () => <AuditResult audit={audit} /> : undefined}
          resultLabel="CRO Audit"
        >
          <div className="space-y-4">
            <p
              className="text-xs uppercase tracking-widest font-medium"
              style={{ color: 'var(--color-primary)' }}
            >
              Landing Page CRO Audit
            </p>
            <UrlInputTool
              onSubmit={handleSubmit}
              isRunning={jobStatus === 'running'}
              placeholder="https://example.com/landing-page"
              label="Landing page URL"
              description="Enter the full URL of the landing page you want to audit. The tool will crawl the page, fetch performance data, and score it across 5 CRO dimensions."
            />
          </div>
        </BackgroundJobTool>
      )}

      {/* History tab */}
      {activeTab === 'history' && (
        <div className="max-w-7xl mx-auto px-6 py-2">
          <RunHistory
            runs={recentRuns}
            onLoad={handleLoad}
            emptyMessage="No previous CRO audits. Run your first audit above."
          />
        </div>
      )}
    </div>
  )
}
