'use client'

import { useState, useTransition, useMemo, useEffect, useCallback } from 'react'
import { Loader2, Plus, X, Search, ArrowUpDown, Download, History, Trash2 } from 'lucide-react'
import { runSemrushAnalysis, type MatrixKeyword, type PreFilters, type SemrushReportMeta } from '@/app/actions/tools'
import { normalizeDomain } from '@/lib/normalize-domain'
import { buildCsv, downloadCsv } from '@/lib/csv-builder'
import { statusColor, statusTint } from '@/lib/status-color'
import { useSemrushSort, type SortDir } from '@/hooks/useSemrushSort'
import { listSemrushReports, loadSemrushReport, deleteSemrushReport } from '@/app/actions/semrush-reports'

const PAGE_SECTIONS = [
  { value: 'all', label: 'All Pages' },
  { value: 'blog', label: 'Blog / Articles' },
  { value: 'product', label: 'Product Pages' },
  { value: 'service', label: 'Service Pages' },
  { value: 'location', label: 'Location Pages' },
]

const DATABASES = [
  { value: 'us', label: 'US' },
  { value: 'uk', label: 'UK' },
  { value: 'ca', label: 'CA' },
  { value: 'au', label: 'AU' },
]


const RELEVANCE_OPTIONS = [
  { value: 0, label: 'All' },
  { value: 3, label: '3+' },
  { value: 4, label: '4+' },
  { value: 5, label: '5 only' },
]

export default function SemrushGapClient({
  clientName,
  clientId,
  defaultClientDomain,
}: {
  clientName: string
  clientId: string
  defaultClientDomain: string
}) {
  const [clientDomain, setClientDomain] = useState(defaultClientDomain)
  const [competitors, setCompetitors] = useState<string[]>([''])
  const [pageSection, setPageSection] = useState('all')
  const [database, setDatabase] = useState('us')
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [hasRun, setHasRun] = useState(false)
  const [clientKeywordCount, setClientKeywordCount] = useState(0)
  const [search, setSearch] = useState('')
  const [minRelevance, setMinRelevance] = useState(3)
  const { sortKey, sortDir, toggleSort, setSort } = useSemrushSort('relevance')

  // New state
  const [matrix, setMatrix] = useState<MatrixKeyword[]>([])
  const [relevanceScores, setRelevanceScores] = useState<Record<string, number>>({})
  const [activeTab, setActiveTab] = useState<'matrix' | 'gaps' | 'urls'>('gaps')
  const [activeReportId, setActiveReportId] = useState<string | null>(null)
  const [minVolumeInput, setMinVolumeInput] = useState('')
  const [includeTermsInput, setIncludeTermsInput] = useState('')
  const [excludeTermsInput, setExcludeTermsInput] = useState('')
  const [reports, setReports] = useState<SemrushReportMeta[]>([])
  const [showHistory, setShowHistory] = useState(false)
  const [resolvedClientDomain, setResolvedClientDomain] = useState('')

  const fetchReports = useCallback(async () => {
    const list = await listSemrushReports(clientId)
    setReports(list)
  }, [clientId])

  useEffect(() => {
    fetchReports()
  }, [fetchReports])

  const allDomains = useMemo(() => {
    const set = new Set<string>()
    for (const m of matrix) {
      for (const d of Object.keys(m.positions)) {
        set.add(d)
      }
    }
    return Array.from(set)
  }, [matrix])

  const competitorDomains = useMemo(() => {
    return allDomains.filter((d) => d !== resolvedClientDomain)
  }, [allDomains, resolvedClientDomain])

  const gapKeywords = useMemo(() => {
    return matrix
      .filter((m) => {
        const cp = m.positions[resolvedClientDomain]
        return !cp || cp.position > 20
      })
      .map((m) => ({
        keyword: m.keyword,
        volume: m.volume,
        competition: m.competition,
        relevance: relevanceScores[m.keyword] ?? 0,
        clientPosition: m.positions[resolvedClientDomain]?.position ?? null,
        clientUrl: m.positions[resolvedClientDomain]?.url ?? null,
        positions: m.positions,
      }))
  }, [matrix, relevanceScores, resolvedClientDomain])

  const filteredMatrix = useMemo(() => {
    let result = matrix
    if (search) {
      const q = search.toLowerCase()
      result = result.filter((m) => m.keyword.toLowerCase().includes(q))
    }
    return [...result].sort((a, b) => {
      const dir = sortDir === 'asc' ? 1 : -1
      if (sortKey === 'keyword') return dir * a.keyword.localeCompare(b.keyword)
      if (sortKey === 'volume') return dir * (a.volume - b.volume)
      if (sortKey === 'competition') return dir * (a.competition - b.competition)
      // Domain column sort
      const getPos = (m: MatrixKeyword) => m.positions[sortKey]?.position ?? 999
      return dir * (getPos(a) - getPos(b))
    })
  }, [matrix, search, sortKey, sortDir])

  const filteredGaps = useMemo(() => {
    let result = gapKeywords
    if (minRelevance > 0) {
      result = result.filter((g) => g.relevance >= minRelevance)
    }
    if (search) {
      const q = search.toLowerCase()
      result = result.filter((g) => g.keyword.toLowerCase().includes(q))
    }
    return [...result].sort((a, b) => {
      const dir = sortDir === 'asc' ? 1 : -1
      if (sortKey === 'keyword') return dir * a.keyword.localeCompare(b.keyword)
      if (sortKey === 'relevance') {
        const diff = a.relevance - b.relevance
        if (diff !== 0) return dir * diff
        return b.volume - a.volume
      }
      if (sortKey === 'volume') return dir * (a.volume - b.volume)
      if (sortKey === 'competition') return dir * (a.competition - b.competition)
      if (sortKey === 'clientPosition') {
        const aPos = a.clientPosition ?? 999
        const bPos = b.clientPosition ?? 999
        return dir * (aPos - bPos)
      }
      const getPos = (g: typeof gapKeywords[0]) => g.positions[sortKey]?.position ?? 999
      return dir * (getPos(a) - getPos(b))
    })
  }, [gapKeywords, search, minRelevance, sortKey, sortDir])

  type UrlCoverageRow = {
    url: string
    domain: string
    totalKeywords: number
    top10Keywords: number
    domainOverlap: Record<string, number>
    clientOverlap: number
    gapScore: number
  }

  const urlCoverage = useMemo((): UrlCoverageRow[] => {
    if (!resolvedClientDomain) return []

    // Group keywords by competitor URL
    const urlKeywords = new Map<string, { domain: string; keywords: Set<string> }>()

    for (const m of matrix) {
      for (const [domain, pos] of Object.entries(m.positions)) {
        if (domain === resolvedClientDomain || !pos.url) continue
        const existing = urlKeywords.get(pos.url)
        if (existing) {
          existing.keywords.add(m.keyword)
        } else {
          urlKeywords.set(pos.url, { domain, keywords: new Set([m.keyword]) })
        }
      }
    }

    // Build keyword → domains lookup
    const keywordDomains = new Map<string, Record<string, number>>()
    for (const m of matrix) {
      const domainPositions: Record<string, number> = {}
      for (const [domain, pos] of Object.entries(m.positions)) {
        domainPositions[domain] = pos.position
      }
      keywordDomains.set(m.keyword, domainPositions)
    }

    const rows: UrlCoverageRow[] = []
    for (const [url, { domain, keywords }] of Array.from(urlKeywords.entries())) {
      if (keywords.size < 5) continue

      const keywordArr = Array.from(keywords)
      let top10 = 0
      const domainOverlap: Record<string, number> = {}

      for (const d of allDomains) domainOverlap[d] = 0

      for (const kw of keywordArr) {
        const positions = keywordDomains.get(kw)
        if (!positions) continue
        // Count top 10 for this URL's domain
        const thisPos = positions[domain]
        if (thisPos !== undefined && thisPos <= 10) top10++
        // Count overlap per domain
        for (const d of allDomains) {
          if (positions[d] !== undefined) domainOverlap[d]++
        }
      }

      const clientOverlap = domainOverlap[resolvedClientDomain] ?? 0

      rows.push({
        url,
        domain,
        totalKeywords: keywordArr.length,
        top10Keywords: top10,
        domainOverlap,
        clientOverlap,
        gapScore: keywordArr.length - clientOverlap,
      })
    }

    rows.sort((a, b) => b.gapScore - a.gapScore)
    return rows
  }, [matrix, resolvedClientDomain, allDomains])

  const filteredUrls = useMemo(() => {
    let result = urlCoverage
    if (search) {
      const q = search.toLowerCase()
      result = result.filter((r) => r.url.toLowerCase().includes(q))
    }
    return [...result].sort((a, b) => {
      const dir = sortDir === 'asc' ? 1 : -1
      if (sortKey === 'url') return dir * a.url.localeCompare(b.url)
      if (sortKey === 'domain') return dir * a.domain.localeCompare(b.domain)
      if (sortKey === 'totalKeywords') return dir * (a.totalKeywords - b.totalKeywords)
      if (sortKey === 'top10Keywords') return dir * (a.top10Keywords - b.top10Keywords)
      if (sortKey === 'clientOverlap') return dir * (a.clientOverlap - b.clientOverlap)
      if (sortKey === 'gapScore') return dir * (a.gapScore - b.gapScore)
      // Competitor domain overlap column
      const aVal = a.domainOverlap[sortKey] ?? 0
      const bVal = b.domainOverlap[sortKey] ?? 0
      return dir * (aVal - bVal)
    })
  }, [urlCoverage, search, sortKey, sortDir])

  function handleSubmit() {
    const filtered = competitors.map((c) => c.trim()).filter(Boolean)
    if (!filtered.length) {
      setError('Add at least one competitor domain.')
      return
    }
    if (!clientDomain.trim()) {
      setError('Client domain is required.')
      return
    }

    const filters: PreFilters = {
      minVolume: minVolumeInput ? parseInt(minVolumeInput, 10) : null,
      includeTerms: includeTermsInput ? includeTermsInput.split(',').map((t) => t.trim()).filter(Boolean) : [],
      excludeTerms: excludeTermsInput ? excludeTermsInput.split(',').map((t) => t.trim()).filter(Boolean) : [],
    }

    setError(null)
    startTransition(async () => {
      const result = await runSemrushAnalysis({
        clientId,
        clientDomain: clientDomain.trim(),
        competitors: filtered,
        pageSection,
        database,
        filters,
      })
      if (result.error) {
        setError(result.error)
      } else {
        setMatrix(result.matrix ?? [])
        setRelevanceScores(result.relevanceScores ?? {})
        setClientKeywordCount(result.clientKeywordCount ?? 0)
        setResolvedClientDomain(result.clientDomain ?? normalizeDomain(clientDomain))
        setActiveReportId(result.reportId ?? null)
        setHasRun(true)
        setSearch('')
        setMinRelevance(3)
        setSort('relevance')
        await fetchReports()
      }
    })
  }

  async function handleLoadReport(reportId: string) {
    const report = await loadSemrushReport(reportId)
    if (!report) {
      setError('Failed to load report.')
      return
    }
    setMatrix(report.matrix_data)
    setRelevanceScores(report.relevance_scores ?? {})
    setClientKeywordCount(report.client_keyword_count)
    setResolvedClientDomain(report.client_domain)
    setClientDomain(report.client_domain)
    setCompetitors(report.competitors.length > 0 ? report.competitors : [''])
    setPageSection(report.page_section)
    setDatabase(report.database)
    setMinVolumeInput(report.filters.minVolume ? String(report.filters.minVolume) : '')
    setIncludeTermsInput(report.filters.includeTerms?.join(', ') ?? '')
    setExcludeTermsInput(report.filters.excludeTerms?.join(', ') ?? '')
    setActiveReportId(report.id)
    setHasRun(true)
    setError(null)
    setSearch('')
    setMinRelevance(3)
    setSort('relevance')
    setShowHistory(false)
  }

  async function handleDeleteReport(reportId: string) {
    await deleteSemrushReport(reportId)
    setReports((prev) => prev.filter((r) => r.id !== reportId))
    if (activeReportId === reportId) {
      setActiveReportId(null)
    }
  }

  function downloadCSV() {
    const dateStr = new Date().toISOString().slice(0, 10)

    if (activeTab === 'urls') {
      const headers = ['URL', 'Domain', 'Keywords', 'Top 10', `${clientName || resolvedClientDomain} Overlap`]
      for (const d of competitorDomains) headers.push(`${d} Overlap`)
      headers.push('Gap Score')

      const rows = filteredUrls.map((row) => [
        row.url,
        row.domain,
        row.totalKeywords,
        row.top10Keywords,
        row.clientOverlap,
        ...competitorDomains.map((d) => row.domainOverlap[d] ?? 0),
        row.gapScore,
      ])

      downloadCsv(`${resolvedClientDomain}-url-coverage-${dateStr}.csv`, buildCsv(headers, rows))
      return
    }

    const isGaps = activeTab === 'gaps'
    const domains = isGaps ? [resolvedClientDomain, ...competitorDomains] : allDomains
    const dataRows = isGaps ? filteredGaps : filteredMatrix

    const headers = ['Keyword', 'Volume', 'Competition']
    if (isGaps) headers.push('Relevance')
    for (const d of domains) {
      headers.push(`${d} Pos`, `${d} URL`)
    }

    const rows = dataRows.map((row) => {
      const cells: unknown[] = [row.keyword, row.volume, row.competition.toFixed(2)]
      if (isGaps) {
        cells.push((row as typeof filteredGaps[0]).relevance)
      }
      for (const d of domains) {
        const pos = ('positions' in row ? row.positions : (row as typeof filteredGaps[0]).positions)[d]
        cells.push(pos ? pos.position : '')
        cells.push(pos?.url ?? '')
      }
      return cells
    })

    downloadCsv(`${resolvedClientDomain}-${activeTab}-${dateStr}.csv`, buildCsv(headers, rows))
  }

  const inputClass =
    'bg-surface-800 border border-surface-600 text-surface-100 rounded-lg px-3 py-2 text-sm w-full focus:outline-none focus:border-brand-400 placeholder:text-surface-500'
  const selectClass =
    'bg-surface-800 border border-surface-600 text-surface-100 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-brand-400'

  return (
    <div className="space-y-6">
      {/* Form */}
      <div className="bg-surface-900 border border-surface-700 rounded-xl p-5 space-y-4">
        <div>
          <label className="block text-xs font-medium text-surface-400 mb-1.5">Client Domain</label>
          <input
            type="text"
            value={clientDomain}
            onChange={(e) => setClientDomain(e.target.value)}
            placeholder="example.com"
            className={inputClass}
            style={{ maxWidth: 400 }}
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-surface-400 mb-1.5">Competitor Domains</label>
          <div className="space-y-2">
            {competitors.map((comp, i) => (
              <div key={i} className="flex items-center gap-2" style={{ maxWidth: 400 }}>
                <input
                  type="text"
                  value={comp}
                  onChange={(e) => {
                    const next = [...competitors]
                    next[i] = e.target.value
                    setCompetitors(next)
                  }}
                  placeholder={`competitor${i + 1}.com`}
                  className={inputClass}
                />
                {competitors.length > 1 && (
                  <button
                    type="button"
                    onClick={() => setCompetitors(competitors.filter((_, j) => j !== i))}
                    className="text-surface-500 hover:text-surface-300 shrink-0"
                  >
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>
            ))}
          </div>
          {competitors.length < 4 && (
            <button
              type="button"
              onClick={() => setCompetitors([...competitors, ''])}
              className="mt-2 text-xs font-medium flex items-center gap-1 hover:opacity-80"
              style={{ color: 'var(--color-accent)' }}
            >
              <Plus className="w-3 h-3" /> Add competitor
            </button>
          )}
        </div>

        <div className="flex flex-wrap gap-4">
          <div>
            <label className="block text-xs font-medium text-surface-400 mb-1.5">Page Section</label>
            <select
              value={pageSection}
              onChange={(e) => setPageSection(e.target.value)}
              className={selectClass}
            >
              {PAGE_SECTIONS.map((s) => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-surface-400 mb-1.5">Database</label>
            <select
              value={database}
              onChange={(e) => setDatabase(e.target.value)}
              className={selectClass}
            >
              {DATABASES.map((d) => (
                <option key={d.value} value={d.value}>{d.label}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Pre-filters */}
        <div>
          <p className="text-xs font-medium text-surface-400 mb-2 uppercase tracking-wide">Pre-Filters</p>
          <div className="flex flex-wrap gap-4">
            <div style={{ maxWidth: 160 }}>
              <label className="block text-xs text-surface-500 mb-1">Min Volume</label>
              <input
                type="number"
                value={minVolumeInput}
                onChange={(e) => setMinVolumeInput(e.target.value)}
                placeholder="e.g. 100"
                className={inputClass}
              />
            </div>
            <div style={{ maxWidth: 260 }}>
              <label className="block text-xs text-surface-500 mb-1">Include Terms (comma-sep)</label>
              <input
                type="text"
                value={includeTermsInput}
                onChange={(e) => setIncludeTermsInput(e.target.value)}
                placeholder="seo, marketing"
                className={inputClass}
              />
            </div>
            <div style={{ maxWidth: 260 }}>
              <label className="block text-xs text-surface-500 mb-1">Exclude Terms (comma-sep)</label>
              <input
                type="text"
                value={excludeTermsInput}
                onChange={(e) => setExcludeTermsInput(e.target.value)}
                placeholder="free, cheap"
                className={inputClass}
              />
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={handleSubmit}
            disabled={isPending}
            className="bg-brand-500 hover:bg-brand-400 disabled:opacity-50 text-surface-100 text-sm font-medium px-5 py-2.5 rounded-lg transition-colors flex items-center gap-2"
          >
            {isPending ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Analyzing…
              </>
            ) : (
              'Run Analysis'
            )}
          </button>
          {reports.length > 0 && (
            <button
              type="button"
              onClick={() => setShowHistory(!showHistory)}
              className="text-surface-400 hover:text-surface-200 text-sm flex items-center gap-1.5 transition-colors"
            >
              <History className="w-4 h-4" />
              Report History ({reports.length})
            </button>
          )}
        </div>
      </div>

      {/* Report History */}
      {showHistory && reports.length > 0 && (
        <div className="bg-surface-900 border border-surface-700 rounded-xl p-5 space-y-2">
          <h3 className="text-xs font-medium text-surface-400 uppercase tracking-wide mb-3">Saved Reports</h3>
          {reports.map((r) => (
            <div
              key={r.id}
              className={`flex items-center justify-between px-3 py-2 rounded-lg text-sm ${
                activeReportId === r.id ? 'bg-surface-800 border border-surface-600' : 'hover:bg-surface-850'
              }`}
            >
              <div className="text-surface-300">
                <span className="text-surface-100 font-medium">
                  {new Date(r.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                  {', '}
                  {new Date(r.created_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
                </span>
                <span className="text-surface-500 mx-2">·</span>
                {r.competitors.length} competitor{r.competitors.length !== 1 ? 's' : ''}
                <span className="text-surface-500 mx-2">·</span>
                {r.keyword_count.toLocaleString()} keywords
                {r.page_section !== 'all' && (
                  <>
                    <span className="text-surface-500 mx-2">·</span>
                    <span className="text-surface-500">{PAGE_SECTIONS.find((s) => s.value === r.page_section)?.label}</span>
                  </>
                )}
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => handleLoadReport(r.id)}
                  className="text-xs font-medium px-2.5 py-1 rounded bg-surface-800 text-surface-300 hover:text-surface-100 border border-surface-600 hover:border-surface-500 transition-colors"
                >
                  Load
                </button>
                <button
                  type="button"
                  onClick={() => handleDeleteReport(r.id)}
                  className="text-surface-500 hover:text-red-400 transition-colors"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="bg-surface-900 border border-surface-700 rounded-xl px-5 py-4">
          <p className="text-sm text-red-400">{error}</p>
        </div>
      )}

      {/* Empty state */}
      {hasRun && !error && matrix.length === 0 && (
        <div className="bg-surface-900 border border-surface-700 rounded-xl px-5 py-4">
          <p className="text-sm text-surface-400">
            No keywords found. Try selecting a different page section or adding different competitors.
          </p>
        </div>
      )}

      {/* Results */}
      {hasRun && matrix.length > 0 && (
        <div className="bg-surface-900 border border-surface-700 rounded-xl p-5 space-y-4">
          {/* Tabs */}
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-1 bg-surface-800 rounded-lg p-1">
              <button
                type="button"
                onClick={() => { setActiveTab('matrix'); setSort('volume'); setSearch('') }}
                className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                  activeTab === 'matrix'
                    ? 'bg-surface-700 text-surface-100'
                    : 'text-surface-400 hover:text-surface-200'
                }`}
              >
                All Keywords ({matrix.length.toLocaleString()})
              </button>
              <button
                type="button"
                onClick={() => { setActiveTab('gaps'); setSort('relevance'); setSearch('') }}
                className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                  activeTab === 'gaps'
                    ? 'bg-surface-700 text-surface-100'
                    : 'text-surface-400 hover:text-surface-200'
                }`}
              >
                Gap Keywords ({gapKeywords.length.toLocaleString()})
              </button>
              <button
                type="button"
                onClick={() => { setActiveTab('urls'); setSort('gapScore'); setSearch('') }}
                className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                  activeTab === 'urls'
                    ? 'bg-surface-700 text-surface-100'
                    : 'text-surface-400 hover:text-surface-200'
                }`}
              >
                URL Coverage ({urlCoverage.length.toLocaleString()})
              </button>
            </div>

            <div className="flex items-center gap-3">
              {activeTab === 'gaps' && (
                <div className="flex items-center gap-1.5">
                  <label className="text-xs text-surface-400 whitespace-nowrap">Min Relevance</label>
                  <select
                    value={minRelevance}
                    onChange={(e) => setMinRelevance(Number(e.target.value))}
                    className={selectClass}
                  >
                    {RELEVANCE_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                </div>
              )}
              <div className="relative" style={{ maxWidth: 260 }}>
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-surface-500" />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder={activeTab === 'urls' ? 'Filter URLs…' : 'Filter keywords…'}
                  className={`${inputClass} pl-8`}
                />
              </div>
              <button
                type="button"
                onClick={downloadCSV}
                className="text-surface-400 hover:text-surface-200 transition-colors flex items-center gap-1.5 text-xs font-medium"
                title="Download CSV"
              >
                <Download className="w-4 h-4" />
                CSV
              </button>
            </div>
          </div>

          <div className="text-xs text-surface-500">
            {clientKeywordCount.toLocaleString()} client keywords indexed
            {pageSection !== 'all' && (
              <span className="ml-2 text-[10px] font-medium uppercase tracking-wide px-2 py-0.5 rounded-full bg-surface-800 text-surface-400 border border-surface-600">
                {PAGE_SECTIONS.find((s) => s.value === pageSection)?.label}
              </span>
            )}
          </div>

          {/* Matrix Table */}
          {activeTab === 'matrix' && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-surface-700">
                    <SortHeader label="Keyword" sortKey="keyword" current={sortKey} dir={sortDir} onSort={toggleSort} align="left" />
                    <SortHeader label="Volume" sortKey="volume" current={sortKey} dir={sortDir} onSort={toggleSort} />
                    <SortHeader label="Comp" sortKey="competition" current={sortKey} dir={sortDir} onSort={toggleSort} />
                    {allDomains.map((d) => (
                      <SortHeader
                        key={d}
                        label={d === resolvedClientDomain ? (clientName || d) : d}
                        sortKey={d}
                        current={sortKey}
                        dir={sortDir}
                        onSort={toggleSort}
                        isClient={d === resolvedClientDomain}
                      />
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filteredMatrix.map((m) => (
                    <tr key={m.keyword} className="border-b border-surface-800 hover:bg-surface-850">
                      <td className="py-2 pr-4 text-surface-200 font-medium whitespace-nowrap">{m.keyword}</td>
                      <td className="py-2 px-3 text-right tabular-nums" style={{ color: 'var(--color-accent)' }}>
                        {m.volume.toLocaleString()}
                      </td>
                      <td className="py-2 px-3 text-right tabular-nums text-surface-400">
                        {m.competition.toFixed(2)}
                      </td>
                      {allDomains.map((d) => {
                        const pos = m.positions[d]
                        const isClient = d === resolvedClientDomain
                        return (
                          <td key={d} className="py-2 px-3 text-right">
                            {pos ? (
                              <div className="flex flex-col items-end">
                                <span className={`tabular-nums ${
                                  isClient
                                    ? pos.position <= 10
                                      ? 'text-success'
                                      : pos.position <= 20
                                        ? 'text-warning'
                                        : 'text-surface-500'
                                    : 'text-surface-300'
                                }`}>
                                  {pos.position}
                                </span>
                                {pos.url && <UrlLink url={pos.url} />}
                              </div>
                            ) : (
                              <span className={isClient ? 'text-amber-400' : 'text-surface-600'}>–</span>
                            )}
                          </td>
                        )
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
              {filteredMatrix.length === 0 && search && (
                <p className="text-xs text-surface-500 text-center py-4">No keywords match the filter.</p>
              )}
            </div>
          )}

          {/* Gap Table */}
          {activeTab === 'gaps' && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-surface-700">
                    <SortHeader label="Keyword" sortKey="keyword" current={sortKey} dir={sortDir} onSort={toggleSort} align="left" />
                    <SortHeader label="Volume" sortKey="volume" current={sortKey} dir={sortDir} onSort={toggleSort} />
                    <SortHeader label="Comp" sortKey="competition" current={sortKey} dir={sortDir} onSort={toggleSort} />
                    <SortHeader label="Relevance" sortKey="relevance" current={sortKey} dir={sortDir} onSort={toggleSort} />
                    <SortHeader label={clientName || 'Client'} sortKey="clientPosition" current={sortKey} dir={sortDir} onSort={toggleSort} isClient />
                    {competitorDomains.map((d) => (
                      <SortHeader key={d} label={d} sortKey={d} current={sortKey} dir={sortDir} onSort={toggleSort} />
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filteredGaps.map((g) => (
                    <tr key={g.keyword} className="border-b border-surface-800 hover:bg-surface-850">
                      <td className="py-2 pr-4 text-surface-200 font-medium whitespace-nowrap">{g.keyword}</td>
                      <td className="py-2 px-3 text-right tabular-nums" style={{ color: 'var(--color-accent)' }}>
                        {g.volume.toLocaleString()}
                      </td>
                      <td className="py-2 px-3 text-right tabular-nums text-surface-400">
                        {g.competition.toFixed(2)}
                      </td>
                      <td className="py-2 px-3 text-right">
                        <RelevanceBadge score={g.relevance} />
                      </td>
                      <td className="py-2 px-3 text-right">
                        {g.clientPosition === null ? (
                          <span className="text-amber-400">–</span>
                        ) : (
                          <div className="flex flex-col items-end">
                            <span className="text-surface-500 tabular-nums">{g.clientPosition}</span>
                            {g.clientUrl && <UrlLink url={g.clientUrl} />}
                          </div>
                        )}
                      </td>
                      {competitorDomains.map((d) => {
                        const pos = g.positions[d]
                        return (
                          <td key={d} className="py-2 px-3 text-right text-surface-300">
                            {pos ? (
                              <div className="flex flex-col items-end">
                                <span className="tabular-nums">{pos.position}</span>
                                {pos.url && <UrlLink url={pos.url} />}
                              </div>
                            ) : (
                              <span className="text-surface-600">–</span>
                            )}
                          </td>
                        )
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>

              {filteredGaps.length === 0 && (search || minRelevance > 0) && (
                <p className="text-xs text-surface-500 text-center py-4">
                  No keywords match the current filters.{' '}
                  {minRelevance > 0 && (
                    <button className="underline hover:text-surface-300" onClick={() => setMinRelevance(0)}>Show all relevance levels</button>
                  )}
                </p>
              )}
            </div>
          )}

          {/* URL Coverage Table */}
          {activeTab === 'urls' && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-surface-700">
                    <SortHeader label="Competitor URL" sortKey="url" current={sortKey} dir={sortDir} onSort={toggleSort} align="left" />
                    <SortHeader label="Domain" sortKey="domain" current={sortKey} dir={sortDir} onSort={toggleSort} align="left" />
                    <SortHeader label="Keywords" sortKey="totalKeywords" current={sortKey} dir={sortDir} onSort={toggleSort} />
                    <SortHeader label="Top 10" sortKey="top10Keywords" current={sortKey} dir={sortDir} onSort={toggleSort} />
                    <SortHeader label={clientName || 'Client'} sortKey="clientOverlap" current={sortKey} dir={sortDir} onSort={toggleSort} isClient />
                    {competitorDomains.map((d) => (
                      <SortHeader key={d} label={d} sortKey={d} current={sortKey} dir={sortDir} onSort={toggleSort} />
                    ))}
                    <SortHeader label="Gap" sortKey="gapScore" current={sortKey} dir={sortDir} onSort={toggleSort} />
                  </tr>
                </thead>
                <tbody>
                  {filteredUrls.map((row) => {
                    const pct = row.totalKeywords > 0 ? row.clientOverlap / row.totalKeywords : 0
                    const pctColor = pct >= 0.5 ? 'text-success' : pct >= 0.25 ? 'text-warning' : 'text-error'
                    return (
                      <tr key={row.url} className="border-b border-surface-800 hover:bg-surface-850">
                        <td className="py-2 pr-4 max-w-[300px]">
                          <a
                            href={row.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-surface-300 hover:text-brand-400 text-xs truncate block"
                            title={row.url}
                          >
                            {row.url.replace(/^https?:\/\/[^/]+/, '') || '/'}
                          </a>
                        </td>
                        <td className="py-2 pr-4 text-surface-400 text-xs whitespace-nowrap">{row.domain}</td>
                        <td className="py-2 px-3 text-right tabular-nums" style={{ color: 'var(--color-accent)' }}>
                          {row.totalKeywords}
                        </td>
                        <td className="py-2 px-3 text-right tabular-nums text-surface-300">{row.top10Keywords}</td>
                        <td className={`py-2 px-3 text-right tabular-nums ${pctColor}`}>
                          {row.clientOverlap} / {row.totalKeywords}
                          <span className="text-[10px] ml-1">({Math.round(pct * 100)}%)</span>
                        </td>
                        {competitorDomains.map((d) => (
                          <td key={d} className="py-2 px-3 text-right tabular-nums text-surface-400">
                            {row.domainOverlap[d] ?? 0}
                          </td>
                        ))}
                        <td className="py-2 px-3 text-right tabular-nums font-medium" style={{ color: 'var(--color-accent)' }}>
                          {row.gapScore}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
              {filteredUrls.length === 0 && search && (
                <p className="text-xs text-surface-500 text-center py-4">No URLs match the filter.</p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function UrlLink({ url }: { url: string }) {
  const path = url.replace(/^https?:\/\/[^/]+/, '')
  const display = path.length > 35 ? path.slice(0, 32) + '…' : path
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="text-[10px] text-surface-500 hover:text-brand-400 truncate max-w-[180px] block"
      title={url}
    >
      {display || '/'}
    </a>
  )
}

function RelevanceBadge({ score }: { score: number }) {
  if (score === 0) return <span className="text-surface-600 text-xs">&ndash;</span>
  const level = score >= 4 ? 'success' : score === 3 ? 'warning' : 'error'
  return (
    <span
      className="inline-block text-xs font-medium tabular-nums px-1.5 py-0.5 rounded border"
      style={{
        color: statusColor(level),
        backgroundColor: statusTint(level, 14),
        borderColor: statusTint(level, 40),
      }}
    >
      {score}
    </span>
  )
}

function SortHeader({
  label,
  sortKey,
  current,
  dir,
  onSort,
  align = 'right',
  isClient = false,
}: {
  label: string
  sortKey: string
  current: string
  dir: SortDir
  onSort: (key: string) => void
  align?: 'left' | 'right'
  isClient?: boolean
}) {
  const active = current === sortKey
  return (
    <th
      className={`py-2 ${align === 'left' ? 'pr-4 text-left' : 'px-3 text-right'} text-xs font-medium ${isClient ? 'text-brand-400' : 'text-surface-400'} cursor-pointer select-none hover:text-surface-200 whitespace-nowrap`}
      onClick={() => onSort(sortKey)}
    >
      <span className="inline-flex items-center gap-1">
        {label}
        <ArrowUpDown className={`w-3 h-3 ${active ? 'text-surface-200' : 'text-surface-600'}`} />
        {active && <span className="text-[9px]">{dir === 'asc' ? '↑' : '↓'}</span>}
      </span>
    </th>
  )
}
