'use client'

import { useState, useRef } from 'react'
import RunHistory, { type ToolRun } from '@/components/tools/RunHistory'
import { CheckCircle, AlertCircle, XCircle, ExternalLink, Download } from 'lucide-react'
import { statusColor, statusTint, scoreLevel } from '@/lib/status-color'
import type { GBPAccount, LocationAudit } from '@/lib/connectors/gbp'

interface Props {
  selectedClientId: string | null
  clientName: string | null
  accounts: GBPAccount[]
  accountsError: string | null
  recentRuns: ToolRun[]
}

type JobStatus = 'idle' | 'running' | 'complete' | 'error'

function ScoreBadge({ score }: { score: number }) {
  const level = scoreLevel(score)
  return (
    <span
      className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold border"
      style={{
        color: statusColor(level),
        backgroundColor: statusTint(level, 10),
        borderColor: statusTint(level, 20),
      }}
    >
      {score}
    </span>
  )
}

function StatusIcon({ status }: { status: LocationAudit['openStatus'] }) {
  if (status === 'OPEN') return <CheckCircle className="w-3.5 h-3.5 text-success" />
  if (status === 'CLOSED_PERMANENTLY') return <XCircle className="w-3.5 h-3.5 text-error" />
  if (status === 'CLOSED_TEMPORARILY') return <AlertCircle className="w-3.5 h-3.5 text-warning" />
  return <AlertCircle className="w-3.5 h-3.5 text-surface-500" />
}

export default function GBPAuditClient({
  selectedClientId,
  clientName,
  accounts,
  accountsError,
  recentRuns,
}: Props) {
  const [tab, setTab] = useState<'run' | 'history'>('run')
  const [status, setStatus] = useState<JobStatus>('idle')
  const [progress, setProgress] = useState(0)
  const [logs, setLogs] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const [locations, setLocations] = useState<LocationAudit[]>([])
  const [avgScore, setAvgScore] = useState<number | null>(null)
  const [selectedAccount, setSelectedAccount] = useState<string>(accounts[0]?.name ?? '')
  const [expandedSlug, setExpandedSlug] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  async function handleRun() {
    if (!selectedAccount) return
    setStatus('running')
    setProgress(0)
    setLogs([])
    setError(null)
    setLocations([])
    setAvgScore(null)

    const abort = new AbortController()
    abortRef.current = abort

    try {
      const res = await fetch('/api/tools/gbp-audit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId: selectedClientId, accountName: selectedAccount }),
        signal: abort.signal,
      })

      if (!res.ok || !res.body) {
        const text = await res.text().catch(() => '')
        throw new Error(text || `HTTP ${res.status}`)
      }

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buf = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buf += decoder.decode(value, { stream: true })
        const lines = buf.split('\n')
        buf = lines.pop() ?? ''
        for (const line of lines) {
          if (!line.trim()) continue
          try {
            const event = JSON.parse(line)
            if (event.type === 'progress') {
              setProgress(event.pct)
              setLogs((prev) => [...prev, event.message])
            } else if (event.type === 'location') {
              setLocations((prev) => [...prev, event.location])
            } else if (event.type === 'complete') {
              setAvgScore(event.avgScore)
              setProgress(100)
              setStatus('complete')
            } else if (event.type === 'error') {
              setError(event.message)
              setStatus('error')
            }
          } catch { /* skip malformed */ }
        }
      }
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        setError(err instanceof Error ? err.message : 'Request failed')
        setStatus('error')
      } else {
        setStatus('idle')
      }
    }
  }

  function handleStop() {
    abortRef.current?.abort()
    setStatus('idle')
  }

  function exportCsv() {
    const header = ['Location', 'Address', 'Phone', 'Website', 'Category', 'Status', 'Score', 'Issues']
    const rows = locations.map((l) => [
      l.title,
      l.addressFormatted,
      l.primaryPhone ?? '',
      l.websiteUri ?? '',
      l.primaryCategory ?? '',
      l.openStatus,
      String(l.score),
      l.issues.join(' | '),
    ])
    const csv = [header, ...rows].map((r) => r.map((c) => `"${c.replace(/"/g, '""')}"`).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `gbp-audit-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const accountLabel = accounts.find((a) => a.name === selectedAccount)?.accountName ?? selectedAccount

  return (
    <div className="max-w-5xl mx-auto px-4 py-8 space-y-6">
      {/* Tabs */}
      <div className="flex gap-1 border-b border-surface-700">
        {(['run', 'history'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium capitalize transition-colors ${
              tab === t
                ? 'text-surface-100 border-b-2 border-brand-400 -mb-px'
                : 'text-surface-400 hover:text-surface-300'
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === 'history' && (
        <RunHistory runs={recentRuns} />
      )}

      {tab === 'run' && (
        <div className="space-y-6">
          {accountsError && (
            <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-4 text-sm text-red-400">
              <strong>Could not load GBP accounts:</strong> {accountsError}
              {accountsError.includes('OAuth') && (
                <span> — Go to <a href="/admin" className="underline">Admin</a> and reconnect your Google account to grant GBP access.</span>
              )}
            </div>
          )}

          {!accountsError && accounts.length === 0 && (
            <div className="bg-surface-900 border border-surface-700 rounded-xl p-6 text-center text-surface-400 text-sm">
              No GBP accounts found. Make sure your Google account has access to Google Business Profile,
              then <a href="/admin" className="text-brand-400 hover:underline">reconnect</a> with the updated permissions.
            </div>
          )}

          {accounts.length > 0 && (
            <div className="bg-surface-900 border border-surface-700 rounded-xl p-6 space-y-5">
              <div className="space-y-2">
                <label className="block text-sm font-medium text-surface-300">GBP Account</label>
                <select
                  value={selectedAccount}
                  onChange={(e) => setSelectedAccount(e.target.value)}
                  disabled={status === 'running'}
                  className="w-full bg-surface-800 border border-surface-700 rounded-lg px-3 py-2 text-sm text-surface-100 focus:outline-none focus:border-brand-500 disabled:opacity-50"
                >
                  {accounts.map((a) => (
                    <option key={a.name} value={a.name}>{a.accountName || a.name}</option>
                  ))}
                </select>
                {clientName && (
                  <p className="text-xs text-surface-500">Auditing for: {clientName}</p>
                )}
              </div>

              {status === 'idle' || status === 'error' ? (
                <button
                  onClick={handleRun}
                  disabled={!selectedAccount}
                  className="px-5 py-2 bg-brand-500 hover:bg-brand-600 text-white text-sm font-medium rounded-lg disabled:opacity-40 transition-colors"
                >
                  Run Audit
                </button>
              ) : (
                <button
                  onClick={handleStop}
                  className="px-5 py-2 bg-surface-700 hover:bg-surface-600 text-surface-100 text-sm font-medium rounded-lg transition-colors"
                >
                  Stop
                </button>
              )}
            </div>
          )}

          {/* Progress */}
          {status === 'running' && (
            <div className="bg-surface-900 border border-surface-700 rounded-xl p-5 space-y-3">
              <div className="flex items-center justify-between text-xs text-surface-400">
                <span>Running audit on {accountLabel}…</span>
                <span>{progress}%</span>
              </div>
              <div className="h-1.5 bg-surface-800 rounded-full overflow-hidden">
                <div
                  className="h-full bg-brand-500 rounded-full transition-all duration-300"
                  style={{ width: `${progress}%` }}
                />
              </div>
              <div className="max-h-28 overflow-y-auto space-y-0.5">
                {logs.slice(-6).map((l, i) => (
                  <p key={i} className="text-xs text-surface-400">{l}</p>
                ))}
              </div>
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-4 text-sm text-red-400">
              {error}
            </div>
          )}

          {/* Results */}
          {locations.length > 0 && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <h2 className="text-base font-semibold text-surface-100">
                    {locations.length} Location{locations.length !== 1 ? 's' : ''}
                  </h2>
                  {avgScore !== null && (
                    <span className="text-xs text-surface-400">
                      Avg score: <ScoreBadge score={avgScore} />
                    </span>
                  )}
                </div>
                {status === 'complete' && (
                  <button
                    onClick={exportCsv}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-surface-800 hover:bg-surface-700 text-surface-300 text-xs font-medium rounded-lg transition-colors"
                  >
                    <Download className="w-3.5 h-3.5" />
                    Export CSV
                  </button>
                )}
              </div>

              <div className="bg-surface-900 border border-surface-700 rounded-xl overflow-hidden">
                <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-surface-700">
                      <th className="text-left px-4 py-3 text-xs font-medium text-surface-400 uppercase tracking-wide">Location</th>
                      <th className="text-left px-4 py-3 text-xs font-medium text-surface-400 uppercase tracking-wide hidden md:table-cell">Phone</th>
                      <th className="text-left px-4 py-3 text-xs font-medium text-surface-400 uppercase tracking-wide hidden lg:table-cell">Category</th>
                      <th className="text-center px-4 py-3 text-xs font-medium text-surface-400 uppercase tracking-wide">Score</th>
                      <th className="text-right px-4 py-3 text-xs font-medium text-surface-400 uppercase tracking-wide">Links</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-surface-800">
                    {locations.map((loc) => (
                      <>
                        <tr
                          key={loc.name}
                          className="hover:bg-surface-850 cursor-pointer"
                          onClick={() => setExpandedSlug(expandedSlug === loc.name ? null : loc.name)}
                        >
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2">
                              <StatusIcon status={loc.openStatus} />
                              <div>
                                <p className="font-medium text-surface-100 text-sm">{loc.title}</p>
                                {loc.addressFormatted && (
                                  <p className="text-xs text-surface-500 mt-0.5">{loc.addressFormatted}</p>
                                )}
                              </div>
                            </div>
                          </td>
                          <td className="px-4 py-3 text-surface-300 text-xs hidden md:table-cell">
                            {loc.primaryPhone ?? <span className="text-surface-600">—</span>}
                          </td>
                          <td className="px-4 py-3 text-surface-300 text-xs hidden lg:table-cell">
                            {loc.primaryCategory ?? <span className="text-surface-600">—</span>}
                          </td>
                          <td className="px-4 py-3 text-center">
                            <ScoreBadge score={loc.score} />
                          </td>
                          <td className="px-4 py-3 text-right">
                            <div className="flex items-center justify-end gap-2">
                              {loc.mapsUri && (
                                <a
                                  href={loc.mapsUri}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  onClick={(e) => e.stopPropagation()}
                                  className="text-brand-400 hover:text-brand-300"
                                >
                                  <ExternalLink className="w-3.5 h-3.5" />
                                </a>
                              )}
                            </div>
                          </td>
                        </tr>
                        {expandedSlug === loc.name && (
                          <tr key={`${loc.name}-expanded`}>
                            <td colSpan={5} className="px-4 pb-4 bg-surface-850">
                              {loc.issues.length === 0 ? (
                                <p className="text-xs text-success flex items-center gap-1.5 pt-2">
                                  <CheckCircle className="w-3.5 h-3.5" /> No issues found — this listing looks complete.
                                </p>
                              ) : (
                                <ul className="pt-2 space-y-1">
                                  {loc.issues.map((issue, i) => (
                                    <li key={i} className="text-xs text-warning flex items-center gap-1.5">
                                      <AlertCircle className="w-3 h-3 shrink-0" />
                                      {issue}
                                    </li>
                                  ))}
                                </ul>
                              )}
                              {loc.websiteUri && (
                                <a
                                  href={loc.websiteUri}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="mt-2 inline-flex items-center gap-1 text-xs text-brand-400 hover:underline"
                                >
                                  <ExternalLink className="w-3 h-3" /> {loc.websiteUri}
                                </a>
                              )}
                            </td>
                          </tr>
                        )}
                      </>
                    ))}
                  </tbody>
                </table>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
