/**
 * CSV building + browser download helpers. RFC-4180 escaping: fields
 * containing commas, quotes, or newlines are quoted, embedded quotes doubled.
 * Safe to import from client components; downloadCsv is browser-only.
 */

export function csvEscape(value: unknown): string {
  const s = value === null || value === undefined ? '' : String(value)
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function buildCsv(headers: string[], rows: unknown[][]): string {
  return [headers, ...rows].map((row) => row.map(csvEscape).join(',')).join('\n')
}

/** Trigger a client-side download of a CSV string. */
export function downloadCsv(filename: string, csv: string): void {
  const blob = new Blob([csv], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
