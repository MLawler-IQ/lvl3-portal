'use client'

// Find this client's calls in Zoom, pick the relevant ones, import them.
//
// The primary way context gets in. It searches on the client's own domain by
// default — already on the row from when the client was created — because a
// domain matches participant email addresses, which is an identity rather than a
// guess about how someone titled a meeting.
//
// Every call shows WHY it matched. A call found by "attendee Matt Lawler" is a
// weaker claim than one found by "participant bridget@airworks.com", and an
// AI Companion summary is weaker evidence than a verbatim transcript. Both are
// on screen because the person picking is the one who can tell.

import { useState, useTransition } from 'react'
import { Search, Video, FileText, Loader2, Check } from 'lucide-react'

export interface ZoomCallRow {
  uuid: string
  topic: string
  start: string
  host: string
  durationMin: number | null
  kind: 'recording' | 'summary'
  hasContent: boolean
  transcriptUrl: string | null
  matchedBy?: string
}

export interface ZoomSearchResponse {
  error?: string
  query?: string
  calls?: ZoomCallRow[]
  notConfigured?: boolean
}

export interface ZoomImportResponse {
  error?: string
  imported?: number
  skipped?: number
  suggestedSlotIds?: string[]
  nothingExtracted?: boolean
  noActiveSession?: boolean
  /** Rendered by lib/onboarding/extract.ts so both intake paths word it alike. */
  extraction?: {
    outcome: string
    summary: string
    proposed: number
    accepted: number
    rejectedByReason: { reason: string; count: number; slotIds: string[]; phrase: string }[]
  }
}

interface Props {
  clientId: string
  /** Shown as the default search term so it is obvious what will be searched. */
  defaultQuery: string
  slotLabels: Record<string, string>
  onSearch: (clientId: string, query?: string) => Promise<ZoomSearchResponse>
  onImport: (clientId: string, calls: ZoomCallRow[]) => Promise<ZoomImportResponse>
}

function when(iso: string): string {
  if (!iso) return ''
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString()
}

export default function ZoomCallFinder({
  clientId,
  defaultQuery,
  slotLabels,
  onSearch,
  onImport,
}: Props) {
  const [query, setQuery] = useState(defaultQuery)
  const [pending, startTransition] = useTransition()
  const [searched, setSearched] = useState(false)
  const [res, setRes] = useState<ZoomSearchResponse | null>(null)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [imported, setImported] = useState<ZoomImportResponse | null>(null)

  const toggle = (uuid: string) => {
    setPicked((prev) => {
      const next = new Set(prev)
      if (next.has(uuid)) next.delete(uuid)
      else next.add(uuid)
      return next
    })
  }

  const runSearch = () => {
    setImported(null)
    startTransition(async () => {
      const r = await onSearch(clientId, query.trim() || undefined)
      setRes(r)
      setSearched(true)
      // Pre-tick verbatim transcripts: they are the strongest evidence and are
      // what someone almost always wants. Summaries stay unticked on purpose.
      setPicked(new Set((r.calls ?? []).filter((c) => c.kind === 'recording').map((c) => c.uuid)))
    })
  }

  const runImport = () => {
    const calls = (res?.calls ?? []).filter((c) => picked.has(c.uuid))
    if (!calls.length) return
    startTransition(async () => {
      setImported(await onImport(clientId, calls))
    })
  }

  return (
    <div>
      <h3 className="text-surface-100 text-sm font-medium mb-1">Find calls in Zoom</h3>
      <p className="text-surface-400 text-xs mb-4 max-w-2xl leading-relaxed">
        Searches the last 180 days of recorded calls and AI Companion summaries. A domain
        matches on attendee email; a name matches the meeting title, then who was on the call.
        Anything read out of a call is a suggestion to confirm, never an answer.
      </p>

      <div className="flex gap-2 mb-3">
        <div className="relative flex-1">
          <Search
            size={13}
            className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-surface-500"
          />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                runSearch()
              }
            }}
            placeholder="acme.com, or a company name"
            className="w-full rounded-sm border border-surface-800 bg-surface-950 py-2 pl-8 pr-3 text-sm text-surface-100 placeholder-surface-500 transition-colors hover:border-surface-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
          />
        </div>
        <button
          type="button"
          onClick={runSearch}
          disabled={pending}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-sm border border-surface-800 px-3 py-2 text-xs font-medium text-surface-100 transition-colors hover:bg-surface-850 hover:border-surface-600 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
        >
          {pending && !imported ? <Loader2 size={13} className="animate-spin" /> : <Search size={13} />}
          Search
        </button>
      </div>

      {res?.error && (
        <p
          className="mb-3 text-[11px] leading-relaxed"
          style={{ color: res.notConfigured ? 'var(--color-warning)' : 'var(--color-danger, #f87171)' }}
        >
          {res.error}
        </p>
      )}

      {searched && !res?.error && (res?.calls?.length ?? 0) === 0 && (
        <p className="mb-3 text-[11px] leading-relaxed text-surface-400">
          No calls matched “{res?.query}”. Zoom only keeps content for cloud-recorded calls and
          meetings with an AI Companion summary — try the company name instead of the domain, or
          paste a transcript below.
        </p>
      )}

      {(res?.calls?.length ?? 0) > 0 && (
        <>
          <ul className="divide-y divide-surface-800 rounded-sm border border-surface-800 bg-surface-950">
            {res!.calls!.map((call) => (
              <li key={call.uuid}>
                <label className="flex cursor-pointer items-start gap-3 px-3 py-2.5 transition-colors hover:bg-surface-900">
                  <input
                    type="checkbox"
                    checked={picked.has(call.uuid)}
                    onChange={() => toggle(call.uuid)}
                    className="mt-0.5 accent-brand-400"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="inline-flex items-center gap-1 rounded-sm bg-surface-800 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-surface-300">
                        {call.kind === 'recording' ? <Video size={10} /> : <FileText size={10} />}
                        {call.kind === 'recording' ? 'Transcript' : 'AI summary'}
                      </span>
                      <span className="truncate text-xs text-surface-100">{call.topic}</span>
                    </div>
                    <p className="mt-0.5 text-[11px] text-surface-400">
                      {when(call.start)}
                      {call.durationMin ? ` · ${call.durationMin} min` : ''}
                      {call.matchedBy ? ` · matched by ${call.matchedBy}` : ''}
                    </p>
                  </div>
                </label>
              </li>
            ))}
          </ul>

          <div className="mt-3 flex items-center gap-3">
            <button
              type="button"
              onClick={runImport}
              disabled={pending || picked.size === 0}
              className="inline-flex items-center gap-1.5 rounded-sm bg-brand-500 px-3 py-2 text-xs font-medium text-white transition-colors hover:bg-brand-600 disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
            >
              {pending && <Loader2 size={13} className="animate-spin" />}
              Import {picked.size} {picked.size === 1 ? 'call' : 'calls'}
            </button>
            <span className="text-[11px] text-surface-400">
              Imported calls are stored as context and read for suggestions.
            </span>
          </div>
        </>
      )}

      {imported && (
        <div className="mt-3 rounded-sm border border-surface-800 bg-surface-950 px-3 py-2.5">
          {imported.error ? (
            <p className="text-[11px]" style={{ color: 'var(--color-danger, #f87171)' }}>
              {imported.error}
            </p>
          ) : (
            <>
              <p className="flex items-center gap-1.5 text-[11px] text-surface-300">
                <Check size={12} className="text-brand-400" />
                Imported {imported.imported ?? 0}
                {imported.skipped ? `, skipped ${imported.skipped} already stored` : ''}.
              </p>
              {imported.suggestedSlotIds?.length ? (
                <>
                  <p className="mt-1.5 text-[11px] leading-relaxed text-surface-400">
                    Suggested answers for these — confirm each one in the review pane above before
                    it counts:
                  </p>
                  <ul className="mt-1 flex flex-wrap gap-1">
                    {imported.suggestedSlotIds.map((id) => (
                      <li
                        key={id}
                        className="rounded-sm bg-surface-800 px-1.5 py-0.5 text-[10px] text-surface-200"
                      >
                        {slotLabels[id] ?? id}
                      </li>
                    ))}
                  </ul>
                </>
              ) : (
                <p className="mt-1 text-[11px] leading-relaxed text-surface-400">
                  {imported.noActiveSession
                    ? 'There is no setup session open, so nothing was read from them yet — start one above and they will be used.'
                    : (imported.extraction?.summary ??
                      'No suggestions were made from them.')}
                </p>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}
