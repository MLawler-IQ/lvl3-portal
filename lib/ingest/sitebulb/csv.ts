// Sitebulb CSV reading. Two Sitebulb-specific facts drive every line here.
//
// 1. THE FILES ARE UTF-8 WITH A BOM. Left in place, the BOM becomes part of the
//    first header name, so `row['URL']` is undefined for every row of every file
//    and the whole ingest silently produces empty pages. Stripped once, here.
//
// 2. SITEBULB WRITES `--` FOR A MISSING VALUE, NOT AN EMPTY STRING. This is the
//    single most dangerous thing about the format: `--` is a two-character string,
//    so a title of `--` reads as a present two-character title, an H1 of `--`
//    reads as a real heading, and `Number('--')` is NaN which `|| 0` quietly turns
//    into a legitimate-looking zero. Every read goes through `text()`/`num()`,
//    which return null for it. Nothing in this module returns a raw cell.
//
// A note on `-1`: it is NOT a missing value. `max-snippet: -1` is a real robots
// directive, and Sitebulb writes the absent case as `--`. The two are different
// and `num()` keeps them different.
//
// THIS MODULE DOES NO IO. It parses text handed to it. Reading is
// ./source.ts's job, so an export can be a directory, a zip's buffers or a map
// built by a test — see the header there. A readCsvTable(path) used to live here;
// it is gone, because leaving a filesystem reader in this file is how the next
// caller bypasses the seam and gets code that works locally and fails on Vercel.

/** Sitebulb's missing-value sentinel. */
export const SITEBULB_MISSING = '--'

export type CsvRow = Record<string, string>

export interface CsvTable {
  /** Column names, in file order, with the trailing-comma phantom removed. */
  header: string[]
  rows: CsvRow[]
  /**
   * Sitebulb's own "this report has nothing in it" body, e.g. "No images
   * available" — a single quoted cell where a header row should be.
   *
   * Kept rather than collapsed to an empty table because the two mean different
   * things: an empty report the crawler WROTE is evidence, while a report that
   * is simply absent from the export is a gap. The summary workbook can disagree
   * with this (it claims 7 images with missing alt text while the per-URL export
   * says "No images available"), and that disagreement is worth reporting.
   */
  emptyReason: string | null
}

/**
 * RFC 4180 parse: quoted fields, doubled quotes, embedded newlines and commas.
 *
 * Written out rather than pulled from a package because the repo rule is no new
 * dependencies, and because Sitebulb's meta descriptions contain both commas and
 * curly quotes — a `split(',')` ingest mangles roughly half the rows of
 * internal.csv while looking like it worked.
 */
export function parseCsv(raw: string): string[][] {
  // The BOM, removed exactly once and only at position 0.
  const text = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw

  const grid: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i += 1
        } else {
          quoted = false
        }
      } else {
        field += ch
      }
      continue
    }
    if (ch === '"') {
      quoted = true
    } else if (ch === ',') {
      row.push(field)
      field = ''
    } else if (ch === '\n') {
      row.push(field)
      grid.push(row)
      row = []
      field = ''
    } else if (ch !== '\r') {
      field += ch
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field)
    grid.push(row)
  }
  return grid
}

const EMPTY_REPORT = /^no .+available$/i

/** Grid → named rows. Blank lines and Sitebulb's trailing comma are dropped. */
export function toTable(grid: string[][]): CsvTable {
  const first = grid[0]
  if (!first) return { header: [], rows: [], emptyReason: null }

  // Every Sitebulb line ends with a comma, so a one-cell report body arrives as
  // ['No images available', ''].
  const firstMeaningful = first.filter((c) => c.trim().length > 0)
  if (firstMeaningful.length === 1 && EMPTY_REPORT.test(firstMeaningful[0].trim())) {
    return { header: [], rows: [], emptyReason: firstMeaningful[0].trim() }
  }

  const header = first.map((h) => h.trim())
  const rows: CsvRow[] = []
  for (const line of grid.slice(1)) {
    if (line.length <= 1 && (line[0] ?? '').trim().length === 0) continue
    const out: CsvRow = {}
    for (let i = 0; i < header.length; i += 1) {
      if (header[i].length === 0) continue
      out[header[i]] = line[i] ?? ''
    }
    rows.push(out)
  }
  return { header: header.filter((h) => h.length > 0), rows, emptyReason: null }
}

/**
 * A cell's text, or null when Sitebulb says there is nothing there.
 *
 * Null covers three cases that all mean absent: the column does not exist in
 * this report, the cell is blank, and the cell is `--`.
 */
export function text(row: CsvRow, column: string): string | null {
  const raw = row[column]
  if (raw === undefined) return null
  const trimmed = raw.trim()
  if (trimmed.length === 0 || trimmed === SITEBULB_MISSING) return null
  return trimmed
}

/**
 * A cell's number, or null when absent or unparseable.
 *
 * Never 0 for `--`. Whether a missing count should become 0 downstream is a
 * judgement the caller has to make per field and say out loud — `No. Words: --`
 * defaulted to 0 makes a page read as 0% unique content, which is a fabricated
 * defect, whereas a 404's genuine `0` is a fact.
 */
export function num(row: CsvRow, column: string): number | null {
  const value = text(row, column)
  if (value === null) return null
  // Sitebulb writes thousands separators in some numeric columns.
  const parsed = Number(value.replace(/,/g, ''))
  return Number.isFinite(parsed) ? parsed : null
}

/** Sitebulb's Yes/No columns. Null when absent or anything else. */
export function yesNo(row: CsvRow, column: string): boolean | null {
  const value = text(row, column)
  if (value === null) return null
  const lower = value.toLowerCase()
  if (lower === 'yes') return true
  if (lower === 'no') return false
  return null
}

/** Index a table by one column, keeping the first row per key. */
export function indexBy(table: CsvTable, column: string): Map<string, CsvRow> {
  const out = new Map<string, CsvRow>()
  for (const row of table.rows) {
    const key = text(row, column)
    if (key === null || out.has(key)) continue
    out.set(key, row)
  }
  return out
}
