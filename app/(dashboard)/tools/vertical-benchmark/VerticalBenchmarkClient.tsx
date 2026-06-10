'use client'

import { useState, useRef } from 'react'
import BackgroundJobTool, { type JobStatus } from '@/components/tools/primitives/BackgroundJobTool'
import RunHistory, { type ToolRun } from '@/components/tools/RunHistory'
import { ArrowRight, Plus, X } from 'lucide-react'

// ── Types ─────────────────────────────────────────────────────────────────────

interface CompetitorProfile {
  domain: string
  pagesAnalyzed: number
  avgWordCount: number
  schemaTypes: string[]
  hasAuthorBylines: boolean
  hasFaqSections: boolean
  hasHowToContent: boolean
  trustSignals: string[]
  avgCtaCount: number
  avgFormCount: number
}

interface BenchmarkReport {
  vertical: string
  competitors: CompetitorProfile[]
  tableStakes: string[]
  differentiators: string[]
  citationFrequency: Record<string, number>
  clientGaps: string[]
  generatedAt: string
}

interface CitationResult {
  question: string
  citedDomains: string[]
}

interface Props {
  selectedClientId: string | null
  clientName: string | null
  clientDomain: string | null
  recentRuns: ToolRun[]
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function VerticalBenchmarkClient({
  selectedClientId,
  clientName,
  clientDomain,
  recentRuns,
}: Props) {
  const [tab, setTab] = useState<'run' | 'history'>('run')
  const [vertical, setVertical] = useState('')
  const [competitorInput, setCompetitorInput] = useState('')
  const [competitors, setCompetitors] = useState<string[]>([])
  const [status, setStatus] = useState<JobStatus>('idle')
  const [progress, setProgress] = useState(0)
  const [logs, setLogs] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const [report, setReport] = useState<BenchmarkReport | null>(null)
  const [citationResults, setCitationResults] = useState<CitationResult[]>([])
  const abortRef = useRef<AbortController | null>(null)

  function addCompetitor() {
    const domain = competitorInput
      .trim()
      .replace(/^https?:\/\//, '')
      .replace(/\/$/, '')
      .toLowerCase()
    if (domain && !competitors.includes(domain)) {
      setCompetitors(prev => [...prev, domain])
      setCompetitorInput('')
    }
  }

  function removeCompetitor(domain: string) {
    setCompetitors(prev => prev.filter(d => d !== domain))
  }

  async function handleRun() {
    if (!vertical.trim()) return
    setStatus('running')
    setProgress(0)
    setLogs([])
    setError(null)
    setReport(null)
    setCitationResults([])

    const abort = new AbortController()
    abortRef.current = abort

    try {
      const res = await fetch('/api/tools/vertical-benchmark', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          vertical: vertical.trim(),
          clientId: selectedClientId,
          competitorDomains: competitors.length > 0 ? competitors : undefined,
        }),
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
            } else if (event.type === 'competitors_discovered') {
              setLogs(prev => [
                ...prev,
                `Discovered ${(event.competitors as string[]).length} competitors`,
              ])
            } else if (event.type === 'page_crawled') {
              setProgress(event.pct as number)
              setLogs(prev => [...prev, `Crawled ${event.url as string}`])
            } else if (event.type === 'citation_result') {
              setCitationResults(prev => [
                ...prev,
                {
                  question: event.question as string,
                  citedDomains: event.citedDomains as string[],
                },
              ])
            } else if (event.type === 'complete') {
              setReport(event.report as BenchmarkReport)
              setProgress(100)
              setStatus('complete')
            } else if (event.type === 'error') {
              setStatus('failed')
              setError(event.message as string)
            }
          } catch {
            /* skip malformed line */
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

  function renderResult() {
    if (!report) return null

    const citationTotal = citationResults.length || 1

    return (
      <div className="space-y-6">
        {/* Competitors analyzed */}
        <div className="space-y-2">
          <p className="text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--color-primary)' }}>
            Competitors Analyzed
          </p>
          <div className="flex flex-wrap gap-2">
            {report.competitors.map(c => (
              <span
                key={c.domain}
                className="px-3 py-1 text-xs rounded-full bg-surface-800 border border-surface-700 text-surface-300"
              >
                {c.domain}
                {c.pagesAnalyzed > 0 && (
                  <span className="ml-1 text-surface-500">({c.pagesAnalyzed}p)</span>
                )}
              </span>
            ))}
          </div>
        </div>

        {/* Table stakes */}
        {report.tableStakes.length > 0 && (
          <div className="bg-surface-900 border border-surface-700 rounded-xl p-5 space-y-3">
            <p className="text-sm font-semibold text-surface-100">
              Table Stakes{' '}
              <span className="text-xs font-normal text-surface-500">(60%+ of competitors)</span>
            </p>
            <ul className="space-y-1.5">
              {report.tableStakes.map((s, i) => (
                <li key={i} className="text-xs text-surface-400 flex gap-2">
                  <span style={{ color: 'var(--color-success)' }}>✓</span>
                  {s}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Differentiators */}
        {report.differentiators.length > 0 && (
          <div className="bg-surface-900 border border-surface-700 rounded-xl p-5 space-y-3">
            <p className="text-sm font-semibold text-surface-100">
              Differentiators{' '}
              <span className="text-xs font-normal text-surface-500">(top performers only)</span>
            </p>
            <ul className="space-y-1.5">
              {report.differentiators.map((d, i) => (
                <li key={i} className="text-xs text-surface-400 flex gap-2">
                  <span style={{ color: 'var(--color-accent)' }}>★</span>
                  {d}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Citation frequency */}
        {Object.keys(report.citationFrequency).length > 0 && (
          <div className="bg-surface-900 border border-surface-700 rounded-xl p-5 space-y-3">
            <p className="text-sm font-semibold text-surface-100">AI Citation Frequency</p>
            <div className="space-y-2">
              {Object.entries(report.citationFrequency)
                .sort((a, b) => b[1] - a[1])
                .map(([domain, count]) => (
                  <div key={domain} className="flex items-center gap-3 text-xs">
                    <span className="text-surface-300 flex-1">{domain}</span>
                    <div className="flex items-center gap-2">
                      <div className="w-24 h-1 bg-surface-800 rounded-full overflow-hidden">
                        <div
                          className="h-full rounded-full"
                          style={{
                            width: `${(count / citationTotal) * 100}%`,
                            backgroundColor: 'var(--color-accent)',
                          }}
                        />
                      </div>
                      <span className="text-surface-500 w-16 text-right">
                        {count}/{citationTotal} q
                      </span>
                    </div>
                  </div>
                ))}
            </div>
          </div>
        )}

        {/* Competitor detail table */}
        <div className="bg-surface-900 border border-surface-700 rounded-xl p-5 space-y-3 overflow-x-auto">
          <p className="text-sm font-semibold text-surface-100">Competitor Detail</p>
          <table className="w-full text-xs text-surface-400 border-collapse">
            <thead>
              <tr className="text-left text-surface-500 border-b border-surface-700">
                <th className="pb-2 pr-4 font-medium">Domain</th>
                <th className="pb-2 pr-4 font-medium">Avg Words</th>
                <th className="pb-2 pr-4 font-medium">Schema</th>
                <th className="pb-2 pr-4 font-medium">Author</th>
                <th className="pb-2 pr-4 font-medium">FAQ</th>
                <th className="pb-2 pr-4 font-medium">HowTo</th>
                <th className="pb-2 font-medium">Trust Signals</th>
              </tr>
            </thead>
            <tbody>
              {report.competitors.map(c => (
                <tr key={c.domain} className="border-b border-surface-800 last:border-0">
                  <td className="py-2 pr-4 text-surface-300 font-medium">{c.domain}</td>
                  <td className="py-2 pr-4">{c.avgWordCount.toLocaleString()}</td>
                  <td className="py-2 pr-4">
                    {c.schemaTypes.length > 0
                      ? c.schemaTypes.slice(0, 2).join(', ')
                      : '—'}
                  </td>
                  <td className="py-2 pr-4">
                    {c.hasAuthorBylines ? (
                      <span style={{ color: 'var(--color-success)' }}>Yes</span>
                    ) : (
                      <span className="text-surface-600">No</span>
                    )}
                  </td>
                  <td className="py-2 pr-4">
                    {c.hasFaqSections ? (
                      <span style={{ color: 'var(--color-success)' }}>Yes</span>
                    ) : (
                      <span className="text-surface-600">No</span>
                    )}
                  </td>
                  <td className="py-2 pr-4">
                    {c.hasHowToContent ? (
                      <span style={{ color: 'var(--color-success)' }}>Yes</span>
                    ) : (
                      <span className="text-surface-600">No</span>
                    )}
                  </td>
                  <td className="py-2">
                    {c.trustSignals.length > 0
                      ? c.trustSignals.slice(0, 2).join(', ')
                      : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Client gaps */}
        {report.clientGaps.length > 0 && (
          <div className="bg-surface-900 border border-surface-700 rounded-xl p-5 space-y-3">
            <p className="text-sm font-semibold text-surface-100">
              Gaps for {clientName ?? 'Your Client'}
            </p>
            <ul className="space-y-1.5">
              {report.clientGaps.map((g, i) => (
                <li key={i} className="text-xs text-surface-400 flex gap-2">
                  <span style={{ color: 'var(--color-warning)' }}>△</span>
                  {g}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    )
  }

  return (
    <div>
      {/* Tabs */}
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
          onCancel={() => {
            abortRef.current?.abort()
            setStatus('idle')
          }}
          onReset={() => setStatus('idle')}
          renderResult={renderResult}
          resultLabel="Benchmark Report"
        >
          <div className="space-y-6 py-4">
            <p className="text-sm text-surface-400 max-w-xl">
              Discovers top-ranking competitors for any vertical, crawls their pages, and extracts
              SEO + GEO patterns. Runs citation probing to see which domains AI systems mention when
              asked vertical questions.
              {selectedClientId && clientName && (
                <> Includes gap analysis for <strong className="text-surface-300">{clientName}</strong>
                {clientDomain && <> ({clientDomain})</>}.</>
              )}
            </p>

            {/* Vertical input */}
            <div className="space-y-2 max-w-md">
              <label className="text-xs font-medium uppercase tracking-wider text-surface-400">
                Vertical
              </label>
              <input
                value={vertical}
                onChange={e => setVertical(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && vertical.trim()) handleRun()
                }}
                placeholder="e.g. residential plumbing services"
                className="w-full bg-surface-800 border border-surface-700 rounded-lg px-3 py-2 text-sm text-surface-100 placeholder-surface-500 focus:outline-none focus:border-surface-600"
              />
            </div>

            {/* Optional competitors */}
            <div className="space-y-2 max-w-md">
              <label className="text-xs font-medium uppercase tracking-wider text-surface-400">
                Competitor Domains <span className="normal-case text-surface-600">(optional — auto-discovered if blank)</span>
              </label>
              <div className="flex gap-2">
                <input
                  value={competitorInput}
                  onChange={e => setCompetitorInput(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      addCompetitor()
                    }
                  }}
                  placeholder="example.com"
                  className="flex-1 bg-surface-800 border border-surface-700 rounded-lg px-3 py-2 text-sm text-surface-100 placeholder-surface-500 focus:outline-none focus:border-surface-600"
                />
                <button
                  onClick={addCompetitor}
                  className="p-2 rounded-lg bg-surface-800 border border-surface-700 text-surface-400 hover:text-surface-200 transition-colors"
                >
                  <Plus size={14} />
                </button>
              </div>
              {competitors.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {competitors.map(d => (
                    <span
                      key={d}
                      className="flex items-center gap-1 px-2 py-0.5 text-xs rounded-full bg-surface-800 border border-surface-700 text-surface-300"
                    >
                      {d}
                      <button
                        onClick={() => removeCompetitor(d)}
                        className="text-surface-500 hover:text-surface-300"
                      >
                        <X size={10} />
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </div>

            <button
              onClick={handleRun}
              disabled={!vertical.trim()}
              className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              style={{ backgroundColor: 'var(--color-primary)' }}
              onMouseEnter={e => {
                if (vertical.trim()) {
                  ;(e.currentTarget as HTMLButtonElement).style.backgroundColor = 'rgb(var(--brand-600))'
                }
              }}
              onMouseLeave={e => {
                ;(e.currentTarget as HTMLButtonElement).style.backgroundColor = 'var(--color-primary)'
              }}
            >
              Run Benchmark
              <ArrowRight size={14} />
            </button>
          </div>
        </BackgroundJobTool>
      ) : (
        <div className="max-w-7xl mx-auto px-6 py-6">
          <RunHistory runs={recentRuns} />
        </div>
      )}
    </div>
  )
}
