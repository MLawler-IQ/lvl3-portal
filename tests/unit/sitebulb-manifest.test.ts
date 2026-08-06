// The export manifest, over the source seam.
//
// manifest.ts had zero importers and zero tests until slice 2 wired it into the crawl
// station, so this file exists to cover the port itself: the two-level listing that used to
// be a stat() call, the prefix derivation, the XLSX read that had to change from
// type:'buffer' to type:'array' for a Uint8Array, and the `problems` strings that become the
// station's ToolOk notes.
//
// The workbook is built in-test with XLSX.write rather than committed as a binary fixture,
// so the sheet shape the reader depends on (row 0 is the header, 'Hint' in column 4, 'URLs'
// in column 3) is visible in the test rather than hidden inside a file nobody can diff.

import { describe, expect, it } from 'vitest'
import { join } from 'node:path'
import * as XLSX from 'xlsx'
import {
  findHint,
  hintSlug,
  readHint,
  readReport,
  readSitebulbManifest,
} from '@/lib/ingest/sitebulb/manifest'
import { BufferSource, LocalDirSource } from '@/lib/ingest/sitebulb/source'

const DIR = join(__dirname, '..', '..', 'fixtures', 'ingest', 'sitebulb-mini')

/** A summary workbook in Sitebulb's own sheet shape. */
function summaryWorkbook(rows: (string | number)[][]): Uint8Array {
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet([
      ['Type', 'Importance', 'Status', 'URLs', 'Hint', 'Description', 'Learn More'],
      ...rows,
    ]),
    'On Page',
  )
  return new Uint8Array(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }))
}

async function miniBuffers(): Promise<Map<string, Uint8Array>> {
  const dir = LocalDirSource(DIR)
  const out = new Map<string, Uint8Array>()
  for (const name of await dir.list()) out.set(name, await dir.read(name))
  return out
}

describe('reading the manifest from a directory', () => {
  it('derives the prefix from internal.csv when there is no summary workbook', async () => {
    const manifest = await readSitebulbManifest(LocalDirSource(DIR))
    expect(manifest.prefix).toBe('mini')
  })

  it('separates top-level reports from hint exports', async () => {
    const manifest = await readSitebulbManifest(LocalDirSource(DIR))
    // Stems have the prefix stripped, so a check can ask for 'internal' on any crawl.
    expect(Array.from(manifest.reports.keys()).sort()).toEqual([
      'indexability',
      'internal',
      'mobile_friendly',
    ])
    // A hint CSV must NOT land in reports — it is not a crawl-wide report.
    expect(manifest.reports.has('url_contains_no_google_analytics_code')).toBe(false)
    expect(manifest.hintFiles.get('url_contains_no_google_analytics_code')).toBe(
      'hints/mini_url_contains_no_google_analytics_code.csv',
    )
  })

  it('holds source-relative entry names, never absolute paths', async () => {
    const manifest = await readSitebulbManifest(LocalDirSource(DIR))
    const names = Array.from(manifest.reports.values()).concat(
      Array.from(manifest.hintFiles.values()),
    )
    for (const name of names) {
      expect(name.startsWith('/')).toBe(false)
      expect(name).not.toContain(DIR)
    }
  })

  it('reads a report and a hint back through the source', async () => {
    const manifest = await readSitebulbManifest(LocalDirSource(DIR))
    const internal = await readReport(manifest, 'internal')
    expect(internal?.rows).toHaveLength(6)
    const hint = await readHint(manifest, 'url_contains_no_google_analytics_code')
    expect(hint?.rows.length).toBeGreaterThan(0)
    expect(await readReport(manifest, 'nonexistent_report')).toBeNull()
    expect(await readHint(manifest, 'nonexistent_hint')).toBeNull()
  })

  it('reports the absent summary workbook as a problem, in client-readable words', async () => {
    const manifest = await readSitebulbManifest(LocalDirSource(DIR))
    expect(manifest.summaryFile).toBeNull()
    expect(manifest.hints).toEqual([])
    expect(manifest.problems.join(' ')).toMatch(/summary\.xlsx is absent/)
    // The tie it cannot break, named: an untriggered hint vs an unexported one.
    expect(manifest.problems.join(' ')).toMatch(/not_run/)
  })
})

describe('reading the manifest from in-memory buffers', () => {
  it('produces the same shape as the directory, which is what the zip path needs', async () => {
    const fromDir = await readSitebulbManifest(LocalDirSource(DIR))
    const fromBuffers = await readSitebulbManifest(BufferSource(await miniBuffers()))
    expect(fromBuffers.prefix).toBe(fromDir.prefix)
    expect(Array.from(fromBuffers.reports.entries()).sort()).toEqual(
      Array.from(fromDir.reports.entries()).sort(),
    )
    expect(fromBuffers.problems).toEqual(fromDir.problems)
  })

  it('reads the summary workbook out of bytes, not a file path', async () => {
    // The line tsc could not check: XLSX.read(Uint8Array, { type: 'array' }).
    const files = await miniBuffers()
    files.set(
      'mini_summary.xlsx',
      summaryWorkbook([['Issue', 'High', 'Fix', 3, '<h1> tag is missing']]),
    )
    const manifest = await readSitebulbManifest(BufferSource(files))
    expect(manifest.summaryFile).toBe('mini_summary.xlsx')
    expect(manifest.hints).toHaveLength(1)
    const hint = findHint(manifest, hintSlug('<h1> tag is missing'))
    expect(hint?.name).toBe('<h1> tag is missing')
    expect(hint?.urls).toBe(3)
    expect(hint?.section).toBe('On Page')
    // It fired but has no per-URL export, so its URLs cannot be identified.
    expect(hint?.file).toBeNull()
    expect(manifest.problems.join(' ')).toMatch(/no per-URL export/)
  })

  it('links a summary row to its per-URL export when both are present', async () => {
    const files = await miniBuffers()
    files.set(
      'mini_summary.xlsx',
      summaryWorkbook([
        ['Issue', 'High', 'Fix', 2, 'URL contains no Google Analytics code'],
      ]),
    )
    const manifest = await readSitebulbManifest(BufferSource(files))
    expect(findHint(manifest, 'url_contains_no_google_analytics_code')?.file).toBe(
      'hints/mini_url_contains_no_google_analytics_code.csv',
    )
    expect(manifest.problems.join(' ')).not.toMatch(/no per-URL export/)
  })

  it('reports a hints-free export as a problem rather than as silence', async () => {
    const files = await miniBuffers()
    files.delete('hints/mini_url_contains_no_google_analytics_code.csv')
    const manifest = await readSitebulbManifest(BufferSource(files))
    expect(manifest.problems.join(' ')).toMatch(/No hints\/ subdirectory/)
  })

  it('turns a garbage workbook into a problem, not a throw', async () => {
    const files = await miniBuffers()
    files.set('mini_summary.xlsx', new TextEncoder().encode('not a workbook'))
    const manifest = await readSitebulbManifest(BufferSource(files))
    // Measured, not assumed: xlsx 0.18.5 is lenient and parses this into a workbook
    // with no usable rows rather than throwing, so the reader lands on the
    // "no hint rows" problem rather than the catch. Either way the contract that
    // matters holds — no hints, a problem naming the workbook, and no rejection.
    expect(manifest.hints).toEqual([])
    expect(manifest.problems.join(' ')).toMatch(/summary\.xlsx/)
    expect(manifest.problems.join(' ')).toMatch(/unusable|could not be read/)
  })

  it('turns an empty workbook into a problem, not a throw', async () => {
    const files = await miniBuffers()
    files.set('mini_summary.xlsx', new Uint8Array())
    const manifest = await readSitebulbManifest(BufferSource(files))
    expect(manifest.hints).toEqual([])
    expect(manifest.problems.join(' ')).toMatch(/summary\.xlsx/)
  })
})

describe('hintSlug', () => {
  // Punctuation is DELETED, not replaced. Replacing it with '_' produces a near-miss
  // filename for about a quarter of the hints, which reads as "that hint's export is
  // missing" — the exact false signal this module exists to prevent.
  it.each([
    ['<h1> tag is missing', 'h1_tag_is_missing'],
    ['Content-Security-Policy HTTP header not found', 'contentsecuritypolicy_http_header_not_found'],
    ['Reduce server response times (TTFB)', 'reduce_server_response_times_ttfb'],
  ])('maps %j to %j', (name, slug) => {
    expect(hintSlug(name)).toBe(slug)
  })
})
