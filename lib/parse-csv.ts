/**
 * RFC-4180-aware CSV/TSV parsing, shared by the Blog Image Generator client
 * and route (previously two diverging copies). Correctly handles quoted
 * fields containing delimiters, escaped double quotes (""), and newlines
 * inside quoted fields — the old line-split parser broke on all three.
 */

export interface ParsedPromptRow {
  filename: string
  prompt: string
}

/** Parse delimited text into rows of cells per RFC 4180. */
export function parseDelimited(text: string, delimiter: ',' | '\t'): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cur = ''
  let inQuote = false

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (inQuote) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cur += '"'
          i++
        } else {
          inQuote = false
        }
      } else {
        cur += ch
      }
    } else if (ch === '"' && cur === '') {
      inQuote = true
    } else if (ch === delimiter) {
      row.push(cur.trim())
      cur = ''
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++
      row.push(cur.trim())
      if (row.some((c) => c !== '')) rows.push(row)
      row = []
      cur = ''
    } else {
      cur += ch
    }
  }
  row.push(cur.trim())
  if (row.some((c) => c !== '')) rows.push(row)
  return rows
}

function slugifyFilename(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/**
 * Parse a Blog Image Generator upload (CSV or TSV of post titles + prompts)
 * into filename/prompt rows. Auto-detects the delimiter and an optional
 * header row (title/filename/name + prompt/description columns).
 */
export function parsePromptRows(text: string): ParsedPromptRow[] {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? ''
  const delimiter: ',' | '\t' = firstLine.includes('\t') ? '\t' : ','
  const table = parseDelimited(text, delimiter)
  if (table.length === 0) return []

  let titleColIdx = 0
  let promptColIdx = 1
  let startRow = 0

  const header = table[0].map((h) => h.toLowerCase().replace(/[^a-z ]/g, ''))
  const titleHeaders = ['title', 'post title', 'filename', 'name']
  const promptHeaders = ['prompt', 'description', 'image prompt']

  const foundTitle = header.findIndex((h) => titleHeaders.some((t) => h.includes(t)))
  const foundPrompt = header.findIndex((h) => promptHeaders.some((t) => h.includes(t)))

  if (foundTitle !== -1 || foundPrompt !== -1) {
    if (foundTitle !== -1) titleColIdx = foundTitle
    if (foundPrompt !== -1) promptColIdx = foundPrompt
    startRow = 1
  }

  const rows: ParsedPromptRow[] = []
  for (let i = startRow; i < table.length; i++) {
    const cols = table[i]
    const title = cols[titleColIdx]?.replace(/^["']|["']$/g, '') ?? ''
    const prompt = cols[promptColIdx]?.replace(/^["']|["']$/g, '') ?? ''
    if (!title || !prompt) continue
    rows.push({ filename: slugifyFilename(title) || `image-${i}`, prompt })
  }
  return rows
}
