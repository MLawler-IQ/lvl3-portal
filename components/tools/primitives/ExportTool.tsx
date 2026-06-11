'use client'

import { useEffect, useRef, useState } from 'react'
import { Check, FileDown, FileSpreadsheet, FileText, Loader2 } from 'lucide-react'
import { buildCsv, downloadCsv } from '@/lib/csv-builder'
import { persistRun } from '@/app/actions/tool-runs'

export interface ExportData {
  headers: string[]
  rows: unknown[][]
}

export type ExportFormat = 'csv' | 'xlsx' | 'docx'

interface Props {
  toolSlug: string
  clientId?: string | null
  /** Inputs that produced this result — stored with the run for context. */
  input: Record<string, unknown>
  /** Full result payload — stored with the run so history can reload it. */
  output: Record<string, unknown>
  /** Base filename without extension. */
  filename: string
  /** Tabular projection of the result for CSV/XLSX/DOCX. */
  data: ExportData
  formats?: ExportFormat[]
  /** Heading used in the DOCX export. Defaults to the filename. */
  title?: string
  /** Save the run to tool_runs on export (default true). Pass false for
      download-only surfaces that shouldn't write history — note onSaved
      never fires in that mode. */
  persist?: boolean
  /** Notify the parent when the run is saved (e.g. to refresh RunHistory). */
  onSaved?: (runId: string) => void
}

/**
 * Download + persistence bar for read-only tools. Exporting in any format
 * also saves the run to tool_runs (once per result) so it shows up in the
 * tool's history. Matches the style of the other primitives in this folder.
 */
export default function ExportTool({
  toolSlug,
  clientId,
  input,
  output,
  filename,
  data,
  formats = ['csv', 'xlsx'],
  title,
  persist = true,
  onSaved,
}: Props) {
  const [savedRunId, setSavedRunId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [exporting, setExporting] = useState<ExportFormat | null>(null)
  const persistedFor = useRef<Record<string, unknown> | null>(null)

  // New result → new run; allow saving again
  useEffect(() => {
    if (persistedFor.current !== output) {
      persistedFor.current = null
      setSavedRunId(null)
    }
  }, [output])

  async function ensurePersisted() {
    if (!persist || persistedFor.current === output || saving) return
    setSaving(true)
    try {
      const result = await persistRun({ toolSlug, clientId, input, output })
      if (result.runId) {
        persistedFor.current = output
        setSavedRunId(result.runId)
        onSaved?.(result.runId)
      }
    } finally {
      setSaving(false)
    }
  }

  async function handleExport(format: ExportFormat) {
    setExporting(format)
    try {
      if (format === 'csv') {
        downloadCsv(`${filename}.csv`, buildCsv(data.headers, data.rows))
      } else if (format === 'xlsx') {
        const XLSX = await import('xlsx')
        const ws = XLSX.utils.aoa_to_sheet([
          data.headers,
          ...data.rows.map((r) => r.map((c) => (c === null || c === undefined ? '' : c))),
        ])
        ws['!cols'] = data.headers.map((h) => ({ wch: Math.max(h.length + 2, 12) }))
        const wb = XLSX.utils.book_new()
        XLSX.utils.book_append_sheet(wb, ws, 'Export')
        XLSX.writeFile(wb, `${filename}.xlsx`)
      } else {
        const docx = await import('docx')
        const headerRow = new docx.TableRow({
          children: data.headers.map(
            (h) =>
              new docx.TableCell({
                children: [new docx.Paragraph({ children: [new docx.TextRun({ text: h, bold: true })] })],
              }),
          ),
        })
        const bodyRows = data.rows.map(
          (row) =>
            new docx.TableRow({
              children: row.map(
                (cell) =>
                  new docx.TableCell({
                    children: [new docx.Paragraph(String(cell ?? ''))],
                  }),
              ),
            }),
        )
        const doc = new docx.Document({
          sections: [
            {
              children: [
                new docx.Paragraph({ text: title ?? filename, heading: docx.HeadingLevel.HEADING_1 }),
                new docx.Table({ rows: [headerRow, ...bodyRows] }),
              ],
            },
          ],
        })
        const blob = await docx.Packer.toBlob(doc)
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = `${filename}.docx`
        a.click()
        URL.revokeObjectURL(url)
      }
      await ensurePersisted()
    } finally {
      setExporting(null)
    }
  }

  const buttonClass =
    'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-surface-700 bg-surface-800 text-surface-300 hover:text-surface-100 hover:border-surface-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed'

  const FORMAT_META: Record<ExportFormat, { label: string; icon: typeof FileDown }> = {
    csv: { label: 'CSV', icon: FileDown },
    xlsx: { label: 'XLSX', icon: FileSpreadsheet },
    docx: { label: 'DOCX', icon: FileText },
  }

  return (
    <div className="flex flex-wrap items-center gap-2 print:hidden">
      <span className="text-xs text-surface-500 mr-1">Export</span>
      {formats.map((format) => {
        const meta = FORMAT_META[format]
        const Icon = meta.icon
        return (
          <button
            key={format}
            type="button"
            onClick={() => handleExport(format)}
            disabled={exporting !== null || data.rows.length === 0}
            className={buttonClass}
            aria-label={`Export as ${meta.label}`}
          >
            {exporting === format ? <Loader2 size={13} className="animate-spin" /> : <Icon size={13} />}
            {meta.label}
          </button>
        )
      })}
      {saving && (
        <span className="flex items-center gap-1 text-xs text-surface-500">
          <Loader2 size={12} className="animate-spin" /> Saving…
        </span>
      )}
      {!saving && savedRunId && (
        <span className="flex items-center gap-1 text-xs" style={{ color: 'var(--color-success)' }}>
          <Check size={12} /> Saved to history
        </span>
      )}
    </div>
  )
}
