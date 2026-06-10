'use client'

import { useState, useRef } from 'react'
import * as XLSX from 'xlsx'
import {
  Upload, FileSpreadsheet, CheckCircle2, AlertCircle,
  Loader2, Circle, Download, ChevronDown
} from 'lucide-react'
import { buildPreviewHtml } from '@/lib/tfk/preview'
import type { TfkLocation } from '@/lib/tfk/types'

type Step = 'enriching' | 'generating' | 'done' | 'error'

interface LocationStatus {
  store: string
  city: string
  state: string
  step: Step
  validation: string
  hours_match: string
  index: number
}

interface SummaryStats {
  enrichWarnings: string[]
  generationFailures: string[]
  hoursWarnings: string[]
  validationIssues: string[]
  total: number
}

const TABS = ['Generate', 'Preview', 'Validation'] as const
type Tab = (typeof TABS)[number]

function StepIcon({ step }: { step: Step }) {
  if (step === 'done') return <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />
  if (step === 'error') return <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0" />
  if (step === 'enriching' || step === 'generating')
    return <Loader2 className="w-4 h-4 text-brand-400 animate-spin flex-shrink-0" style={{ color: 'var(--color-accent)' }} />
  return <Circle className="w-4 h-4 text-surface-600 flex-shrink-0" />
}

function stepLabel(step: Step): string {
  if (step === 'enriching') return 'Enriching via Google Places…'
  if (step === 'generating') return 'Generating copy…'
  if (step === 'done') return 'Done'
  if (step === 'error') return 'Error'
  return ''
}

export default function TfkGeneratorClient() {
  const [activeTab, setActiveTab] = useState<Tab>('Generate')
  const [storeDnaFile, setStoreDnaFile] = useState<File | null>(null)
  const [generating, setGenerating] = useState(false)
  const [done, setDone] = useState(false)
  const [locations, setLocations] = useState<LocationStatus[]>([])
  const [total, setTotal] = useState(0)
  const [outputBase64, setOutputBase64] = useState<string | null>(null)
  const [outputRows, setOutputRows] = useState<TfkLocation[]>([])
  const [selectedRowIndex, setSelectedRowIndex] = useState(0)
  const [summary, setSummary] = useState<SummaryStats | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [loadedFromFile, setLoadedFromFile] = useState<string | null>(null)
  const storeDnaRef = useRef<HTMLInputElement>(null)
  const outputXlsxRef = useRef<HTMLInputElement>(null)

  const completedCount = locations.filter(l => l.step === 'done' || l.step === 'error').length
  const progress = total > 0 ? Math.round((completedCount / total) * 100) : 0

  function parseOutputXlsx(base64: string): TfkLocation[] {
    try {
      const binary = atob(base64)
      const bytes = new Uint8Array(binary.length)
      for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i)
      }
      const wb = XLSX.read(bytes, { type: 'array' })
      const ws = wb.Sheets[wb.SheetNames[0]]
      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws)
      return rows as unknown as TfkLocation[]
    } catch {
      return []
    }
  }

  async function handleLoadExistingOutput(file: File) {
    setLoadError(null)
    setLoadedFromFile(null)
    try {
      const arrayBuffer = await file.arrayBuffer()
      const wb = XLSX.read(arrayBuffer, { type: 'array' })
      const ws = wb.Sheets[wb.SheetNames[0]]
      if (!ws) throw new Error('No worksheet found in xlsx')

      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws) as unknown as TfkLocation[]
      if (!rows || rows.length === 0) throw new Error('No rows found in xlsx')

      // Build a base64 string so the Download button still works
      const bytes = new Uint8Array(arrayBuffer)
      let binary = ''
      const chunkSize = 0x8000
      for (let i = 0; i < bytes.length; i += chunkSize) {
        binary += String.fromCharCode.apply(
          null,
          Array.from(bytes.subarray(i, i + chunkSize))
        )
      }
      const base64 = btoa(binary)

      setOutputRows(rows)
      setOutputBase64(base64)
      setSelectedRowIndex(0)
      setLoadedFromFile(file.name)
      setDone(true)
      // Switch to preview so they see the result immediately
      setActiveTab('Preview')
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Failed to parse xlsx')
    }
  }

  async function handleGenerate() {
    if (!storeDnaFile) return
    setGenerating(true)
    setDone(false)
    setLocations([])
    setTotal(0)
    setOutputBase64(null)
    setOutputRows([])
    setSummary(null)
    setError(null)

    const formData = new FormData()
    formData.append('storeDnaFile', storeDnaFile)

    try {
      const res = await fetch('/api/tfk-generator', { method: 'POST', body: formData })
      if (!res.ok || !res.body) {
        const json = await res.json().catch(() => ({}))
        throw new Error(json.error ?? `HTTP ${res.status}`)
      }

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buf = ''

      while (true) {
        const { done: streamDone, value } = await reader.read()
        if (streamDone) break
        buf += decoder.decode(value, { stream: true })
        const lines = buf.split('\n')
        buf = lines.pop() ?? ''
        for (const line of lines) {
          if (!line.trim()) continue
          try {
            const evt = JSON.parse(line)
            handleEvent(evt)
          } catch { /* bad line */ }
        }
      }
      if (buf.trim()) {
        try { handleEvent(JSON.parse(buf)) } catch { /* */ }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Generation failed')
    } finally {
      setGenerating(false)
      setDone(true)
    }
  }

  function handleEvent(evt: Record<string, unknown>) {
    switch (evt.type) {
      case 'start':
        setTotal(Number(evt.total) || 0)
        break

      case 'progress':
        setLocations(prev => {
          const idx = Number(evt.index)
          const existing = prev.findIndex(l => l.index === idx)
          const entry: LocationStatus = {
            store: String(evt.store ?? ''),
            city: String(evt.city ?? ''),
            state: String(evt.state ?? ''),
            step: String(evt.step ?? '') as Step,
            validation: '',
            hours_match: '',
            index: idx,
          }
          if (existing >= 0) {
            const next = [...prev]
            next[existing] = { ...next[existing], step: entry.step }
            return next
          }
          return [...prev, entry]
        })
        break

      case 'location_done':
        setLocations(prev => {
          const idx = Number(evt.index)
          const existing = prev.findIndex(l => l.index === idx)
          if (existing >= 0) {
            const next = [...prev]
            next[existing] = {
              ...next[existing],
              step: 'done',
              validation: String(evt.validation ?? ''),
              hours_match: String(evt.hours_match ?? ''),
            }
            return next
          }
          return prev
        })
        break

      case 'output': {
        const base64 = String(evt.xlsxBase64 ?? '')
        setOutputBase64(base64)
        const rows = parseOutputXlsx(base64)
        setOutputRows(rows)
        setSelectedRowIndex(0)
        break
      }

      case 'summary':
        setSummary({
          enrichWarnings: (evt.enrichWarnings as string[]) ?? [],
          generationFailures: (evt.generationFailures as string[]) ?? [],
          hoursWarnings: (evt.hoursWarnings as string[]) ?? [],
          validationIssues: (evt.validationIssues as string[]) ?? [],
          total: Number(evt.total) || 0,
        })
        break

      case 'error':
        setError(String(evt.message ?? 'Unknown error'))
        break
    }
  }

  const selectedRow = outputRows[selectedRowIndex] ?? null

  // ── TAB: GENERATE ──────────────────────────────────────────────────────────
  function renderGenerate() {
    return (
      <div className="space-y-6">
        {/* File upload */}
        <div className="bg-surface-900 border border-surface-700 rounded-xl p-6 space-y-4">
          <div>
            <p className="text-xs font-medium uppercase tracking-widest mb-1" style={{ color: 'var(--color-accent)' }}>
              Store DNA File
            </p>
            <p className="text-xs text-surface-400 mb-3">
              Upload the <strong className="text-surface-300">Store DNA.xlsx</strong> from your TFK location database.
            </p>
            <button
              onClick={() => storeDnaRef.current?.click()}
              className="flex items-center gap-2 px-4 py-2.5 rounded-lg border border-surface-700 bg-surface-800 text-sm text-surface-300 hover:border-surface-600 hover:bg-surface-700 transition-all"
            >
              <Upload className="w-4 h-4" />
              {storeDnaFile ? storeDnaFile.name : 'Choose .xlsx file'}
            </button>
            <input
              ref={storeDnaRef}
              type="file"
              accept=".xlsx"
              className="hidden"
              onChange={e => setStoreDnaFile(e.target.files?.[0] ?? null)}
            />
          </div>
        </div>

        {/* Generate button */}
        <button
          onClick={handleGenerate}
          disabled={!storeDnaFile || generating}
          className="w-full py-3 rounded-xl font-semibold text-sm text-white transition-all disabled:opacity-40 disabled:cursor-not-allowed"
          style={{ background: generating || !storeDnaFile ? undefined : 'var(--color-interactive)' }}
        >
          {generating ? (
            <span className="flex items-center justify-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin" /> Generating…
            </span>
          ) : (
            'Generate All Locations'
          )}
        </button>

        {/* Divider */}
        <div className="flex items-center gap-3">
          <div className="flex-1 h-px bg-surface-700" />
          <span className="text-xs uppercase tracking-widest text-surface-500">Or</span>
          <div className="flex-1 h-px bg-surface-700" />
        </div>

        {/* Load Existing Output */}
        <div className="bg-surface-900 border border-surface-700 rounded-xl p-6 space-y-4">
          <div>
            <p className="text-xs font-medium uppercase tracking-widest mb-1" style={{ color: 'var(--color-accent)' }}>
              Load Existing Output
            </p>
            <p className="text-xs text-surface-400 mb-3">
              Already have a generated <strong className="text-surface-300">tfk-locations-draft.xlsx</strong>? Upload it to skip generation and jump straight to preview and validation.
            </p>
            <button
              onClick={() => outputXlsxRef.current?.click()}
              className="flex items-center gap-2 px-4 py-2.5 rounded-lg border border-surface-700 bg-surface-800 text-sm text-surface-300 hover:border-surface-600 hover:bg-surface-700 transition-all"
            >
              <Upload className="w-4 h-4" />
              {loadedFromFile ? `Loaded: ${loadedFromFile}` : 'Choose output .xlsx file'}
            </button>
            <input
              ref={outputXlsxRef}
              type="file"
              accept=".xlsx"
              className="hidden"
              onChange={e => {
                const f = e.target.files?.[0]
                if (f) handleLoadExistingOutput(f)
                // Reset input so re-selecting same file fires onChange again
                if (outputXlsxRef.current) outputXlsxRef.current.value = ''
              }}
            />
            {loadError && (
              <div className="mt-3 flex items-start gap-2 bg-red-950/30 border border-red-900/40 rounded-lg p-3">
                <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
                <p className="text-xs text-red-300">{loadError}</p>
              </div>
            )}
            {loadedFromFile && !loadError && (
              <div className="mt-3 flex items-start gap-2 bg-emerald-950/30 border border-emerald-900/40 rounded-lg p-3">
                <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0 mt-0.5" />
                <p className="text-xs text-emerald-300">
                  Loaded {outputRows.length} location{outputRows.length === 1 ? '' : 's'}. Switch to the Preview or Validation tab.
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Progress bar */}
        {(generating || done) && total > 0 && (
          <div className="space-y-2">
            <div className="flex justify-between text-xs text-surface-400">
              <span>{completedCount} / {total} locations</span>
              <span>{progress}%</span>
            </div>
            <div className="h-1.5 rounded-full bg-surface-800 overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-500"
                style={{ width: `${progress}%`, background: 'var(--color-accent)' }}
              />
            </div>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="flex items-start gap-3 bg-red-950/30 border border-red-900/40 rounded-xl p-4">
            <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
            <p className="text-sm text-red-300">{error}</p>
          </div>
        )}

        {/* Download */}
        {outputBase64 && (
          <div className="flex items-center justify-between bg-emerald-950/30 border border-emerald-900/40 rounded-xl p-4">
            <div className="flex items-center gap-3">
              <CheckCircle2 className="w-5 h-5 text-emerald-400" />
              <div>
                <p className="text-sm font-medium text-surface-100">Output ready</p>
                <p className="text-xs text-surface-400">{outputRows.length} locations · {(outputBase64.length * 0.75 / 1024).toFixed(0)} KB xlsx</p>
              </div>
            </div>
            <a
              href={`data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64,${outputBase64}`}
              download="tfk-locations-draft.xlsx"
              className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold text-white transition-all"
              style={{ background: 'var(--color-interactive)' }}
            >
              <Download className="w-4 h-4" />
              Download XLSX
            </a>
          </div>
        )}

        {/* Summary */}
        {summary && (
          <div className="bg-surface-900 border border-surface-700 rounded-xl p-5 space-y-3">
            <p className="text-xs font-semibold text-surface-400 uppercase tracking-widest">Run Summary</p>
            <div className="grid grid-cols-2 gap-3">
              {[
                { label: 'Total Locations', value: summary.total, ok: true },
                { label: 'Hours Mismatches', value: summary.hoursWarnings.length, ok: summary.hoursWarnings.length === 0 },
                { label: 'Generation Failures', value: summary.generationFailures.length, ok: summary.generationFailures.length === 0 },
                { label: 'Validation Issues', value: summary.validationIssues.length, ok: summary.validationIssues.length === 0 },
              ].map(({ label, value, ok }) => (
                <div key={label} className="bg-surface-800 rounded-lg p-3">
                  <p className="text-xs text-surface-400 mb-1">{label}</p>
                  <p className={`text-xl font-bold font-mono ${ok ? 'text-emerald-400' : 'text-amber-400'}`}>{value}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Location log */}
        {locations.length > 0 && (
          <div className="bg-surface-900 border border-surface-700 rounded-xl overflow-hidden">
            <div className="px-5 py-3 border-b border-surface-800">
              <p className="text-xs font-semibold text-surface-400 uppercase tracking-widest">Location Log</p>
            </div>
            <div className="divide-y divide-surface-800 max-h-[480px] overflow-y-auto">
              {locations.map((loc) => (
                <div key={loc.index} className="flex items-center gap-3 px-5 py-3">
                  <StepIcon step={loc.step} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-surface-200 truncate">{loc.store} · {loc.city}, {loc.state}</p>
                    <p className="text-xs text-surface-500">{stepLabel(loc.step)}</p>
                  </div>
                  {loc.step === 'done' && (
                    <div className="flex items-center gap-2 flex-shrink-0">
                      {loc.validation !== '✓' && loc.validation && (
                        <span className="text-xs text-amber-400">{loc.validation}</span>
                      )}
                      {loc.hours_match === '⚠ Mismatch' && (
                        <span className="text-xs text-amber-400">⚠ hours</span>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    )
  }

  // ── TAB: PREVIEW ───────────────────────────────────────────────────────────
  function renderPreview() {
    if (outputRows.length === 0) {
      return (
        <div className="bg-surface-900 border border-surface-700 rounded-xl p-8 text-center text-surface-400 text-sm">
          Run a generation first to preview pages.
        </div>
      )
    }

    return (
      <div className="space-y-4">
        {/* Location selector */}
        <div className="bg-surface-900 border border-surface-700 rounded-xl p-4 flex items-center gap-4">
          <div className="flex-1 relative">
            <select
              value={selectedRowIndex}
              onChange={e => setSelectedRowIndex(Number(e.target.value))}
              className="w-full bg-surface-800 border border-surface-700 rounded-lg px-3 py-2 text-sm text-surface-100 appearance-none pr-8 focus:outline-none focus:border-surface-500"
            >
              {outputRows.map((row, i) => (
                <option key={i} value={i}>
                  {row.store_name} — {row.city}, {row.state}
                </option>
              ))}
            </select>
            <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-surface-400 pointer-events-none" />
          </div>
        </div>

        {/* Metadata card */}
        {selectedRow && (
          <div className="bg-surface-900 border border-surface-700 rounded-xl p-4 grid grid-cols-2 gap-3">
            {[
              { label: 'Page Title', value: `${selectedRow.page_title ?? ''} (${(selectedRow.page_title ?? '').length} chars)` },
              { label: 'Meta Description', value: `${(selectedRow.meta_description ?? '').length} chars` },
              { label: 'Hours Match', value: selectedRow.hours_match ?? '—' },
              { label: 'Validation', value: selectedRow.validation_notes ?? '—' },
            ].map(({ label, value }) => (
              <div key={label}>
                <p className="text-xs text-surface-500 mb-0.5">{label}</p>
                <p className="text-xs text-surface-200 truncate">{String(value)}</p>
              </div>
            ))}
          </div>
        )}

        {/* iframe preview */}
        {selectedRow && (
          <iframe
            srcDoc={buildPreviewHtml(selectedRow)}
            sandbox="allow-scripts"
            className="w-full rounded-lg border border-surface-700"
            style={{ height: '1800px' }}
            title={`Preview: ${selectedRow.store_name}`}
          />
        )}
      </div>
    )
  }

  // ── TAB: VALIDATION ────────────────────────────────────────────────────────
  function renderValidation() {
    if (outputRows.length === 0) {
      return (
        <div className="bg-surface-900 border border-surface-700 rounded-xl p-8 text-center text-surface-400 text-sm">
          Run a generation first to see validation results.
        </div>
      )
    }

    const noCoords = outputRows.filter(r => !r.latitude || !r.longitude).length
    const issues   = outputRows.filter(r => r.validation_notes && r.validation_notes !== '✓').length
    const hoursMismatch = outputRows.filter(r => r.hours_match === '⚠ Mismatch').length

    return (
      <div className="space-y-4">
        {/* Stat chips */}
        <div className="grid grid-cols-4 gap-3">
          {[
            { label: 'Total', value: outputRows.length, color: 'text-surface-200' },
            { label: 'Issues', value: issues, color: issues > 0 ? 'text-amber-400' : 'text-emerald-400' },
            { label: 'Hours ⚠', value: hoursMismatch, color: hoursMismatch > 0 ? 'text-amber-400' : 'text-emerald-400' },
            { label: 'No Coords', value: noCoords, color: noCoords > 0 ? 'text-red-400' : 'text-emerald-400' },
          ].map(({ label, value, color }) => (
            <div key={label} className="bg-surface-900 border border-surface-700 rounded-xl p-4 text-center">
              <p className={`text-2xl font-bold font-mono ${color}`}>{value}</p>
              <p className="text-xs text-surface-500 mt-1">{label}</p>
            </div>
          ))}
        </div>

        {/* Table */}
        <div className="bg-surface-900 border border-surface-700 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-surface-800">
                  {['Store', 'City', 'Validation Notes', 'Hours Match', 'Title Len', 'Meta Len'].map(h => (
                    <th key={h} className="px-4 py-3 text-left font-semibold text-surface-400 uppercase tracking-wider whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-800">
                {outputRows.map((row, i) => {
                  const hasIssue = row.validation_notes && row.validation_notes !== '✓'
                  const titleLen = (row.page_title ?? '').length
                  const metaLen  = (row.meta_description ?? '').length
                  const titleOk  = titleLen >= 50 && titleLen <= 65
                  const metaOk   = metaLen  >= 130 && metaLen  <= 165
                  return (
                    <tr key={i} className={hasIssue ? 'bg-amber-950/10' : ''}>
                      <td className="px-4 py-3 text-surface-200 whitespace-nowrap">{row.store_name}</td>
                      <td className="px-4 py-3 text-surface-400 whitespace-nowrap">{row.city}, {row.state}</td>
                      <td className="px-4 py-3 max-w-xs">
                        <span className={hasIssue ? 'text-amber-400' : 'text-emerald-400'}>
                          {row.validation_notes ?? '—'}
                        </span>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span className={row.hours_match === '✓ Match' ? 'text-emerald-400' : row.hours_match === '⚠ Mismatch' ? 'text-amber-400' : 'text-surface-400'}>
                          {row.hours_match ?? '—'}
                        </span>
                      </td>
                      <td className={`px-4 py-3 font-mono ${titleOk ? 'text-emerald-400' : 'text-amber-400'}`}>{titleLen}</td>
                      <td className={`px-4 py-3 font-mono ${metaOk  ? 'text-emerald-400' : 'text-amber-400'}`}>{metaLen}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-5xl mx-auto p-6 pb-8 space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <FileSpreadsheet className="w-5 h-5 text-surface-400" />
        <div>
          <h1 className="text-xl font-semibold text-surface-100">TFK Page Generator</h1>
          <p className="mt-0.5 text-sm text-surface-400">
            Generate ACF-ready location page copy for all True Food Kitchen stores via Google Places + Claude.
          </p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-surface-900 border border-surface-700 rounded-xl p-1 w-fit">
        {TABS.map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
              activeTab === tab
                ? 'bg-surface-800 text-surface-100'
                : 'text-surface-500 hover:text-surface-300'
            }`}
          >
            {tab}
            {tab === 'Preview' && outputRows.length > 0 && (
              <span className="ml-1.5 text-xs px-1.5 py-0.5 rounded-full bg-surface-700 text-surface-400">{outputRows.length}</span>
            )}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {activeTab === 'Generate'  && renderGenerate()}
      {activeTab === 'Preview'   && renderPreview()}
      {activeTab === 'Validation' && renderValidation()}
    </div>
  )
}
