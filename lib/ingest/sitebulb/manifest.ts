// The export manifest: what this Sitebulb export directory actually contains.
//
// WHY THIS EXISTS AT ALL — the load-bearing rule from AUTOMATION-CONTEXT.md §11.
// Sitebulb writes a per-URL CSV into hints/ ONLY for a hint that TRIGGERED. So an
// ingester that reads hints/ alone cannot tell these two apart:
//
//   · the hint was evaluated against 206 URLs and none of them tripped it  → pass
//   · the hint was never evaluated, or the export omitted it               → not_run
//
// Both look like "no file". The summary workbook is what breaks the tie: it
// enumerates EVERY hint Sitebulb knows about, triggered or not, with a URL count
// and a status ("Pass" when 0). With it, absence of a hint against a URL that IS
// in the crawl is a real pass. Without it, this ingester must say so out loud —
// which is what `problems` is for.
//
// A MISSING summary.xlsx IS A NOTE, NOT A DEGRADATION. This comment used to say
// it "degrades the result", and that is wrong for a mechanical reason worth
// keeping written down: ToolOk.degraded feeds lib/findings/engine.ts, which caps
// every crawl-backed check at `degraded`, and lib/eval/score.ts requires a strict
// `pass` for the healthy fixture's must_pass list. The committed mini fixture has
// no summary workbook, so degrading on its absence would make that fixture
// permanently degraded and turn the eval gate red. Degradation keys off
// SitebulbCoverage.filesMissing and nothing else — see lib/stations/degradation.ts.
//
// It also catches export gaps the CSVs cannot report on their own. On the pilot
// crawl the summary claims 7 URLs for "Images with missing alt text" while the
// per-URL export is the string "No images available" — a real disagreement that
// would otherwise pass as "no images have alt-text problems".

import * as XLSX from 'xlsx'
import { type CsvTable } from './csv'
import { readCsv, type CrawlExportSource } from './source'

/** One row of the summary workbook: a hint Sitebulb evaluated. */
export interface SitebulbHint {
  /** Workbook sheet it came from: 'On Page', 'Mobile Friendly', … */
  section: string
  name: string
  /** Filename stem Sitebulb uses for this hint's per-URL CSV. */
  slug: string
  /** 'Issue' | 'Potential Issue' | 'Opportunity' | 'Insight' | 'Diagnostic' */
  type: string
  importance: string
  /** 'Fix' | 'Optimize' | 'Investigate' | 'Understand' | 'Diagnose' | 'Pass' */
  status: string
  /** URLs the hint fired on. 0 means evaluated and clean. */
  urls: number
  /**
   * Source-relative entry name for the per-URL export, e.g. `hints/x_no_h1.csv`, or
   * null when the hint did not trigger. NOT an absolute path — feed it to
   * `readCsv(manifest.source, …)`, never to readFile.
   */
  file: string | null
}

export interface SitebulbManifest {
  /** Where the bytes come from. Held so readHint/readReport keep their arity. */
  source: CrawlExportSource
  /** Shared filename prefix, e.g. 'tornadohvacca_com'. Derived, never assumed. */
  prefix: string
  /** Report stem ('internal', 'on_page', …) → source-relative entry name. */
  reports: Map<string, string>
  /** Hint slug → source-relative entry name, for everything under hints/. */
  hintFiles: Map<string, string>
  /** Every hint the summary enumerates. Empty when summary.xlsx is absent. */
  hints: SitebulbHint[]
  summaryFile: string | null
  /**
   * Integrity problems found while reading the manifest, in client-readable
   * words. These become the ToolOk notes, so each one names the exact thing that
   * was unavailable.
   */
  problems: string[]
}

/**
 * Sitebulb's hint-name → filename transform, reproduced.
 *
 * Punctuation is DELETED, not replaced: '<h1> tag is missing' →
 * 'h1_tag_is_missing', 'Content-Security-Policy HTTP header…' →
 * 'contentsecuritypolicy_http_header…', 'Reduce server response times (TTFB)' →
 * 'reduce_server_response_times_ttfb'. Replacing punctuation with '_' instead
 * produces a near-miss filename for about a quarter of the hints, which reads as
 * "that hint's export is missing" — the exact false signal this module exists to
 * prevent. Verified against all 44 hint files in the pilot export.
 */
export function hintSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, '')
    .trim()
    .replace(/\s+/g, '_')
}

/** A CSV entry's stem with the export-wide prefix removed. */
function stemOf(basename: string, prefix: string): string {
  return prefix && basename.startsWith(`${prefix}_`)
    ? basename.slice(prefix.length + 1, -4)
    : basename.slice(0, -4)
}

/**
 * Read the export's shape. Throws only when the source cannot be listed — every
 * other problem lands in `problems` so the caller can note it instead of failing.
 */
export async function readSitebulbManifest(
  source: CrawlExportSource,
): Promise<SitebulbManifest> {
  const all = await source.list()
  const problems: string[] = []

  // The listing is flat and forward-slashed, so the two levels the export actually
  // has are a name test rather than a stat. That is also the only form a zip can
  // report, which is why isDirectory is gone: one condition serves both source kinds.
  const entries = all.filter((f) => !f.includes('/'))
  const hintEntries = all.filter((f) => f.startsWith('hints/'))

  const summaryName = entries.find((f) => f.endsWith('_summary.xlsx'))
  // The prefix comes from whichever file announces it, so the ingester works on
  // any crawl without being told the site name. internal.csv is the fallback
  // because it is the one report this ingester cannot do without.
  const prefix =
    summaryName?.slice(0, -'_summary.xlsx'.length) ??
    entries.find((f) => f.endsWith('_internal.csv'))?.slice(0, -'_internal.csv'.length) ??
    ''

  const reports = new Map<string, string>()
  for (const file of entries) {
    if (!file.endsWith('.csv')) continue
    reports.set(stemOf(file, prefix), file)
  }

  const hintFiles = new Map<string, string>()
  if (hintEntries.length > 0) {
    for (const file of hintEntries) {
      if (!file.endsWith('.csv')) continue
      hintFiles.set(stemOf(file.slice('hints/'.length), prefix), file)
    }
  } else {
    problems.push(
      'No hints/ subdirectory in the export: per-URL issue lists are unavailable, so no hint can be attributed to specific URLs.',
    )
  }

  const summaryFile = summaryName ?? null
  const hints: SitebulbHint[] = []
  if (summaryFile === null) {
    problems.push(
      'summary.xlsx is absent: Sitebulb only exports a per-URL CSV for a hint that triggered, so without the summary an untriggered hint (a genuine pass) cannot be told apart from an unexported one (not_run).',
    )
  } else {
    try {
      hints.push(...(await readSummaryHints(source, summaryFile, hintFiles)))
      if (hints.length === 0) {
        problems.push('summary.xlsx contains no hint rows: the crawl-wide hint enumeration is unusable.')
      }
    } catch (err) {
      problems.push(
        `summary.xlsx could not be read (${err instanceof Error ? err.message : String(err)}): hint enumeration unavailable, so an untriggered hint cannot be told apart from an unexported one.`,
      )
    }
  }

  problems.push(...crossCheck(hints, hintFiles))

  return { source, prefix, reports, hintFiles, hints, summaryFile, problems }
}

/** Every sheet of the summary workbook, flattened into hint rows. */
async function readSummaryHints(
  source: CrawlExportSource,
  file: string,
  hintFiles: Map<string, string>,
): Promise<SitebulbHint[]> {
  // `type: 'array'` for a Uint8Array; `'buffer'` is only correct for a Node Buffer,
  // which an in-memory source cannot promise. Verified against xlsx 0.18.5.
  const workbook = XLSX.read(await source.read(file), { type: 'array' })
  const out: SitebulbHint[] = []
  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName]
    if (!sheet) continue
    const grid = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: null })
    // Row 0 is ['Type','Importance','Status','URLs','Hint','Description','Learn More'].
    for (const row of grid.slice(1)) {
      const name = row[4]
      if (typeof name !== 'string' || name.trim().length === 0) continue
      const urls = Number(row[3])
      const slug = hintSlug(name)
      out.push({
        section: sheetName,
        name: name.trim(),
        slug,
        type: String(row[0] ?? ''),
        importance: String(row[1] ?? ''),
        status: String(row[2] ?? ''),
        urls: Number.isFinite(urls) ? urls : 0,
        file: hintFiles.get(slug) ?? null,
      })
    }
  }
  return out
}

/**
 * Where the summary and the hints/ directory disagree.
 *
 * Only genuine gaps are reported. A triggered hint whose CSV lists PAIRS rather
 * than URLs (the three duplicate-content hints list `URL` + `Duplicate URL`, so 6
 * rows cover 8 URLs) is not a gap, so row counts are deliberately not compared —
 * only "the file is missing" and "the file is empty while the summary says it
 * fired", which are the two cases that silently turn a defect into a pass.
 */
function crossCheck(hints: SitebulbHint[], hintFiles: Map<string, string>): string[] {
  const problems: string[] = []
  const missing = hints.filter((h) => h.urls > 0 && h.file === null)
  if (missing.length > 0) {
    problems.push(
      `${missing.length} hint(s) fired in the summary but have no per-URL export, so their URLs cannot be identified: ${missing
        .map((h) => `${h.name} (${h.urls} URLs)`)
        .join('; ')}.`,
    )
  }
  const enumerated = new Set(hints.map((h) => h.slug))
  const orphans = Array.from(hintFiles.keys()).filter((slug) => !enumerated.has(slug))
  if (hints.length > 0 && orphans.length > 0) {
    problems.push(
      `${orphans.length} per-URL hint export(s) have no row in summary.xlsx, so their pass/fail universe is unknown: ${orphans.join(', ')}.`,
    )
  }
  return problems
}

/** Load one hint's per-URL CSV. Null when the hint has no export. */
export async function readHint(
  manifest: SitebulbManifest,
  slug: string,
): Promise<CsvTable | null> {
  const file = manifest.hintFiles.get(slug)
  if (!file) return null
  return readCsv(manifest.source, file)
}

/** Load one top-level report by stem ('internal', 'on_page', …). */
export async function readReport(
  manifest: SitebulbManifest,
  stem: string,
): Promise<CsvTable | null> {
  const file = manifest.reports.get(stem)
  if (!file) return null
  return readCsv(manifest.source, file)
}

/** The summary's row for one hint, by slug. */
export function findHint(manifest: SitebulbManifest, slug: string): SitebulbHint | null {
  return manifest.hints.find((h) => h.slug === slug) ?? null
}
