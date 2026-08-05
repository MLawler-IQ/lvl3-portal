'use client'

import { useState, useRef } from 'react'
import ClientScopedTool from '@/components/tools/primitives/ClientScopedTool'
import BackgroundJobTool, { type JobStatus } from '@/components/tools/primitives/BackgroundJobTool'
import RunHistory, { type ToolRun } from '@/components/tools/RunHistory'
import { TrendingDown, ArrowRight, ExternalLink } from 'lucide-react'

interface RefreshCandidate {
  page: string
  currentImpressions: number
  priorImpressions: number
  impressionChange: number
  currentClicks: number
  priorClicks: number
  clickChange: number
  currentPosition: number
  priorPosition: number
  positionChange: number
  declineScore: number
}

interface Props {
  selectedClientId: string | null
  clientName: string | null
  gscSiteUrl: string | null
  brandContext: string | null
  recentRuns: ToolRun[]
}

export default function ContentRefreshFinderClient({
  selectedClientId,
  clientName,
  gscSiteUrl,
  brandContext,
  recentRuns,
}: Props) {
  const [tab, setTab] = useState<'run' | 'history'>('run')
  const [status, setStatus] = useState<JobStatus>('idle')
  const [progress, setProgress] = useState(0)
  const [logs, setLogs] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const [candidates, setCandidates] = useState<RefreshCandidate[]>([])
  const [briefs, setBriefs] = useState<Record<string, string>>({})
  const [expandedPage, setExpandedPage] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  async function handleRun() {
    setStatus('running')
    setProgress(0)
    setLogs([])
    setError(null)
    setCandidates([])
    setBriefs({})
    setExpandedPage(null)
    const abort = new AbortController()
    abortRef.current = abort

    try {
      const res = await fetch('/api/tools/content-refresh-finder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId: selectedClientId }),
        signal: abort.signal,
      })

      if (!res.ok || !res.body) {
        setStatus('failed')
        setError('Request failed')
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
          if (!line.trim()) continue
          try {
            const event = JSON.parse(line) as Record<string, unknown>
            if (event.type === 'progress') {
              setProgress(event.pct as number)
              setLogs(prev => [...prev, event.message as string])
            } else if (event.type === 'candidates') {
              setCandidates(event.candidates as RefreshCandidate[])
              setLogs(prev => [...prev, `Found ${(event.candidates as RefreshCandidate[]).length} candidates`])
            } else if (event.type === 'brief') {
              setBriefs(prev => ({ ...prev, [event.page as string]: event.brief as string }))
              setProgress(prev => Math.min(prev + 5, 90))
            } else if (event.type === 'complete') {
              setProgress(100)
              setStatus('complete')
            } else if (event.type === 'error') {
              setStatus('failed')
              setError(event.message as string)
            }
          } catch {
            /* skip malformed */
          }
        }
      }
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        setStatus('failed')
        setError(err instanceof Error ? err.message : 'Failed')
      }
    }
  }

  function handleCancel() {
    abortRef.current?.abort()
    setStatus('idle')
    setLogs([])
  }

  function renderResult() {
    return (
      <div className="space-y-4">
        {candidates.length === 0 ? (
          <p className="text-sm text-surface-400">
            No pages with significant decline found in the selected period.
          </p>
        ) : (
          <div className="space-y-2">
            {candidates.map(c => (
              <div
                key={c.page}
                className="bg-surface-900 border border-surface-700 rounded-xl overflow-hidden"
              >
                <div
                  className="flex items-center gap-3 px-4 py-3 cursor-pointer"
                  onClick={() => setExpandedPage(expandedPage === c.page ? null : c.page)}
                >
                  <TrendingDown size={14} className="text-error shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-surface-100 truncate">{c.page}</p>
                    <p className="text-xs text-surface-400">
                      {Math.round(c.impressionChange * 100)}% impressions &middot;{' '}
                      {c.currentImpressions.toLocaleString()} this period
                    </p>
                  </div>
                  <a
                    href={c.page}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={e => e.stopPropagation()}
                    className="text-surface-400 hover:text-surface-200"
                  >
                    <ExternalLink size={13} />
                  </a>
                </div>
                {expandedPage === c.page && briefs[c.page] && (
                  <div className="px-4 pb-4 border-t border-surface-800">
                    <p className="text-xs text-surface-400 mt-3 leading-relaxed whitespace-pre-wrap">
                      {briefs[c.page]}
                    </p>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    )
  }

  return (
    <ClientScopedTool
      selectedClientId={selectedClientId}
      clientName={clientName}
      gscSiteUrl={gscSiteUrl}
      brandContext={brandContext}
    >
      {/* Tab bar */}
      <div className="max-w-7xl mx-auto px-6 pt-2">
        <div className="flex gap-1 border-b border-surface-700">
          {(['run', 'history'] as const).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-4 py-2 text-sm font-medium transition-colors ${
                tab === t
                  ? 'text-surface-100 border-b-2 border-brand-400 -mb-px'
                  : 'text-surface-400 hover:text-surface-200'
              }`}
            >
              {t === 'run' ? 'Run' : 'History'}
            </button>
          ))}
        </div>
      </div>

      {tab === 'run' ? (
        <BackgroundJobTool
          status={status}
          progress={progress}
          logs={logs}
          error={error}
          onCancel={handleCancel}
          onReset={() => setStatus('idle')}
          renderResult={renderResult}
          resultLabel={`${candidates.length} pages need refreshing`}
        >
          {/* Idle form */}
          <div className="space-y-6 py-4">
            <p className="text-sm text-surface-400 max-w-xl">
              Compares the last 90 days vs. prior 90 days of Search Console data to surface pages
              with declining impressions or dropping positions — then generates AI refresh briefs
              for the top candidates.
            </p>
            {!gscSiteUrl ? (
              <p className="text-xs text-warning">
                No Search Console site configured for this client. Add it in client settings.
              </p>
            ) : (
              <button
                onClick={handleRun}
                className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-surface-950 transition-colors"
                style={{ backgroundColor: 'var(--color-primary)' }}
              >
                Find Refresh Candidates
                <ArrowRight size={14} />
              </button>
            )}
          </div>
        </BackgroundJobTool>
      ) : (
        <div className="max-w-7xl mx-auto px-6 py-6">
          <RunHistory runs={recentRuns} />
        </div>
      )}
    </ClientScopedTool>
  )
}
