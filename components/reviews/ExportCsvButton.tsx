'use client'

import { Download } from 'lucide-react'
import { buildCsv, downloadCsv } from '@/lib/csv-builder'
import { buildResponsesCsvRows } from '@/lib/review/helpers'
import type { ReviewItem, ReviewResponse } from '@/lib/review/types'

export default function ExportCsvButton({
  client,
  items,
  responses,
}: {
  client: string
  items: ReviewItem[]
  responses: ReviewResponse[]
}) {
  function handleExport() {
    const { headers, rows } = buildResponsesCsvRows(items, responses)
    const filename = `review-${client.toLowerCase().replace(/\s+/g, '-')}-${new Date()
      .toISOString()
      .slice(0, 10)}.csv`
    downloadCsv(filename, buildCsv(headers, rows))
  }

  return (
    <button
      type="button"
      onClick={handleExport}
      disabled={items.length === 0}
      className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-lg border border-surface-600 bg-surface-800 text-surface-300 hover:text-surface-100 hover:border-surface-500 transition-colors disabled:opacity-50"
    >
      <Download size={12} />
      Export CSV
    </button>
  )
}
