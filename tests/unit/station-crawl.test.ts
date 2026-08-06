// The crawl and GSC stations: the envelope, not the ingest.
//
// sitebulb-ingest.test.ts already pins what the CSVs mean. What is tested here is the layer
// that turns an ingest into something runChecks can consume, where three distinct failures
// must come out as three distinct envelopes rather than as a throw:
//
//   no *_internal.csv        ToolErr, coverage null      — a page list cannot be invented
//   no *_mobile_friendly.csv ToolOk degraded, file named — part of the site was measured
//   unreadable summary.xlsx  ToolOk, one note            — a spreadsheet is not a station
//
// Collapsing any pair of those is how an incomplete audit comes to read as a complete one.
//
// Every degraded fixture is an in-test BufferSource. Copying the mini fixture to os.tmpdir
// and deleting a file from the copy is the obvious alternative and is wrong twice: parallel
// vitest workers collide on the path, and a test that dies mid-run leaves the directory
// behind for the next one to find.

import { describe, expect, it } from 'vitest'
import { join } from 'node:path'
import {
  BufferSource,
  LocalDirSource,
  type CrawlExportSource,
} from '@/lib/ingest/sitebulb/source'
import { SOURCES } from '@/lib/ingest/sitebulb/crawl'
import { runCrawlStation } from '@/lib/stations/crawl'
import { runGscStation } from '@/lib/stations/gsc'
import { CHECKS } from '@/lib/findings/checks'
import { runChecks } from '@/lib/findings/engine'
import type { Finding } from '@/lib/findings/types'

const MINI = join(__dirname, '..', '..', 'fixtures', 'ingest', 'sitebulb-mini')

/** The mini fixture's bytes, so a test can hand back a copy with one entry removed. */
async function miniBuffers(omit?: string): Promise<Map<string, Uint8Array>> {
  const dir = LocalDirSource(MINI)
  const out = new Map<string, Uint8Array>()
  for (const name of await dir.list()) {
    if (omit !== undefined && name.endsWith(omit)) continue
    out.set(name, await dir.read(name))
  }
  return out
}

/** Sitebulb's on-disk shape: every cell quoted, every line ending in a comma. */
function csv(rows: readonly string[][]): Uint8Array {
  const body = rows.map((row) => `${row.map((cell) => `"${cell}"`).join(',')},`).join('\n')
  return new TextEncoder().encode(`${body}\n`)
}

const HINT_NO_GA4 = 'hints/mini_url_contains_no_google_analytics_code.csv'

function findingFor(findings: Finding[], id: string): Finding {
  const found = findings.find((f) => f.checkId === id)
  if (!found) throw new Error(`no finding for ${id}`)
  return found
}

// ── the backbone ──────────────────────────────────────────────────────────────

describe('a missing backbone is an envelope, not a throw', () => {
  // A hint file and nothing else: exactly the export shape the backbone rule exists to
  // reject, because a page list built from triggered hints alone makes a `pass`
  // indistinguishable from a check that never ran.
  const hintsOnly = () =>
    BufferSource(new Map([[HINT_NO_GA4, new Uint8Array()]]), 'hints-only export')

  it('returns a ToolErr naming the backbone', async () => {
    const { result } = await runCrawlStation(hintsOnly())
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toMatch(/backbone/)
    expect(result.sources).toEqual(['crawl'])
  })

  it('does not reject — runGuarded absorbs the ingest throw', async () => {
    // An orchestrator composing several stations cannot be taken down by one bad export.
    await expect(runCrawlStation(hintsOnly())).resolves.toBeDefined()
  })

  it('reports coverage as null rather than as a zero-page export', async () => {
    // Null is the only honest value: no coverage record was ever computed. A
    // `{urls: 0, …}` here would persist to audit_runs.coverage as a measurement.
    const { coverage } = await runCrawlStation(hintsOnly())
    expect(coverage).toBeNull()
  })

  it('carries no partial, so no caller can reach the hint-only page list', async () => {
    const { result } = await runCrawlStation(hintsOnly())
    if (result.ok) throw new Error('expected a ToolErr')
    expect(result.partial).toBeUndefined()
  })
})

// ── the complete export ───────────────────────────────────────────────────────

describe('a complete export', () => {
  it('runs undegraded over the mini fixture', async () => {
    const { result, coverage } = await runCrawlStation(LocalDirSource(MINI))
    if (!result.ok) throw new Error(result.error)
    expect(result.degraded).toBe(false)
    expect(result.sources).toEqual(['crawl'])
    expect(result.data.pages).toHaveLength(6)
    expect(coverage?.urls).toBe(6)
    expect(coverage?.filesMissing).toEqual([])
  })

  it('reports manifest problems as notes while staying undegraded', async () => {
    // The mini fixture has no summary.xlsx, so it always produces at least one problem.
    // That must never reach `degraded`: the engine caps a pass on a degraded station, so
    // degrading on a missing workbook would deny every crawl-backed check a clean state
    // on the very fixture the eval gate requires a strict pass from.
    const { result } = await runCrawlStation(LocalDirSource(MINI))
    if (!result.ok) throw new Error(result.error)
    expect(result.notes?.some((n) => n.includes('summary.xlsx is absent'))).toBe(true)
    expect(result.degraded).toBe(false)
  })
})

// ── a missing per-check export ────────────────────────────────────────────────

describe('a missing mobile_friendly export', () => {
  const withoutMobile = async () =>
    BufferSource(await miniBuffers('_mobile_friendly.csv'), 'mini minus mobile_friendly')

  it('degrades the station and names the export that is gone', async () => {
    const { result, coverage } = await runCrawlStation(await withoutMobile())
    if (!result.ok) throw new Error(result.error)
    expect(result.degraded).toBe(true)
    expect(coverage?.filesMissing).toEqual([SOURCES.mobile])
    // The note says which export in the words a client reads, and what it cost.
    expect(
      result.notes?.some((n) => /mobile-friendly export is missing/.test(n) && /viewport/.test(n)),
    ).toBe(true)
  })

  it('denies TECH-011 a pass', async () => {
    const { result } = await runCrawlStation(await withoutMobile())
    const tech011 = findingFor(runChecks(CHECKS, { crawl: result }), 'TECH-011')
    expect(tech011.status).not.toBe('pass')
  })
})

// ── proving the ceiling actually fires ────────────────────────────────────────

// The mini fixture fails TECH-011 on its own merits (one page missing a viewport, one with
// small tap targets), so "not a pass" above would hold with the degradation rule deleted
// entirely. These three cases use a hand-built export with NO mobile defects, so a pass is
// the outcome unless something stops it — which is the only way to tell a working ceiling
// from a masking defect.

const CLEAN_INTERNAL = [
  [
    'URL',
    'HTTP Status Code',
    'Title',
    'Meta Description',
    'H1',
    'No. H1s',
    'No. Content Words',
    'No. Template Words',
    'No. Internal Linking URLs',
  ],
  ['https://clean.test/', '200', 'Home', 'Welcome', 'Home', '1', '400', '600', '5'],
  ['https://clean.test/a/', '200', 'A', 'About A', 'A', '1', '450', '600', '5'],
]

/** Both pages clean on both mobile signals, so nothing is excluded and nothing fails. */
const CLEAN_MOBILE = [
  ['URL', 'Missing Viewport', 'Small Tap Targets'],
  ['https://clean.test/', 'No', 'No'],
  ['https://clean.test/a/', 'No', 'No'],
]

const CLEAN_INDEXABILITY = [
  ['URL', 'Noindex', 'Nofollow', 'Canonical URL'],
  ['https://clean.test/', 'No', 'No', 'https://clean.test/'],
  ['https://clean.test/a/', 'No', 'No', 'https://clean.test/a/'],
]

function cleanExport(omit?: 'mobile' | 'indexability'): CrawlExportSource {
  const files = new Map<string, Uint8Array>([['clean_internal.csv', csv(CLEAN_INTERNAL)]])
  if (omit !== 'mobile') files.set('clean_mobile_friendly.csv', csv(CLEAN_MOBILE))
  if (omit !== 'indexability') files.set('clean_indexability.csv', csv(CLEAN_INDEXABILITY))
  return BufferSource(files, `clean export${omit ? ` minus ${omit}` : ''}`)
}

describe('the degraded ceiling on a crawl TECH-011 would otherwise pass', () => {
  it('passes when every page is measured and clean', async () => {
    const { result } = await runCrawlStation(cleanExport())
    if (!result.ok) throw new Error(result.error)
    expect(result.degraded).toBe(false)
    const tech011 = findingFor(runChecks(CHECKS, { crawl: result }), 'TECH-011')
    expect(tech011.status).toBe('pass')
  })

  it('loses that pass to not_run when the mobile export is absent', async () => {
    // Note the exact mechanism, because it is NOT the engine's ceiling: with no
    // mobile_friendly.csv there is no measured page left, so lib/findings/coverage.ts
    // returns not_run before the station's `degraded` flag is ever consulted. The
    // station is degraded as well, and the ceiling would have applied had a pass survived.
    const { result } = await runCrawlStation(cleanExport('mobile'))
    if (!result.ok) throw new Error(result.error)
    expect(result.degraded).toBe(true)
    const tech011 = findingFor(runChecks(CHECKS, { crawl: result }), 'TECH-011')
    expect(tech011.status).toBe('not_run')
  })

  it('caps the surviving pass at degraded when an unrelated export is absent', async () => {
    // The case that exercises the engine's ceiling itself: indexability backs canonicals,
    // not mobile signals, so TECH-011 still measures both pages and still finds nothing.
    // A `pass` on a station that admits it read part of the export is the claim the
    // ceiling exists to refuse.
    const { result } = await runCrawlStation(cleanExport('indexability'))
    if (!result.ok) throw new Error(result.error)
    expect(result.degraded).toBe(true)
    const tech011 = findingFor(runChecks(CHECKS, { crawl: result }), 'TECH-011')
    expect(tech011.status).toBe('degraded')
    expect(tech011.reason).toMatch(/partial station data/)
  })
})

// ── the manifest is not a station ─────────────────────────────────────────────

describe('a manifest read that fails does not fail the station', () => {
  /**
   * A source whose second `list()` throws.
   *
   * The crawl ingest lists once and the manifest lists again, so this breaks the manifest
   * read and nothing else — which is the seam under test. A source that always threw would
   * fail the ingest first and prove nothing about the manifest.
   */
  function listOnce(files: Map<string, Uint8Array>): CrawlExportSource {
    const inner = BufferSource(files, 'export whose listing dies')
    let calls = 0
    return {
      label: inner.label,
      async list() {
        calls += 1
        if (calls > 1) throw new Error('the export listing became unreadable')
        return inner.list()
      },
      read: inner.read,
    }
  }

  it('stays ok, undegraded, and says what was lost', async () => {
    const { result, coverage } = await runCrawlStation(listOnce(await miniBuffers()))
    if (!result.ok) throw new Error(result.error)
    // A ToolErr here would send all eight checks to not_run because a spreadsheet failed.
    expect(result.degraded).toBe(false)
    expect(coverage?.urls).toBe(6)
    expect(result.data.pages).toHaveLength(6)
    expect(
      result.notes?.some((n) => /manifest could not be read/.test(n) && /unreadable/.test(n)),
    ).toBe(true)
  })
})

// ── the GSC station ───────────────────────────────────────────────────────────

// Only the unconfigured path is exercised. The configured path calls fetchGSCRows, which
// needs Supabase for its cache and a live Google token for the query; stubbing either here
// would test the stub. It is covered by the dry-run against a real client instead.

describe('an unconfigured GSC station', () => {
  it.each([
    ['null', null],
    ['an empty string', ''],
    ['whitespace', '   '],
  ])('returns a ToolErr for %s', async (_label, siteUrl) => {
    const result = await runGscStation(siteUrl)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toBe('client has no gsc_site_url configured')
    expect(result.sources).toEqual(['gsc'])
  })

  it('never returns an empty ToolOk', async () => {
    // `{ok:true, data:[]}` would reach the engine's empty branch and every gsc-backed
    // check would read "returned no data — cannot distinguish clean from unseen". Nothing
    // was queried, so there is no clean-versus-unseen question to be undecided about.
    const result = await runGscStation(null)
    expect(result.ok).toBe(false)
  })

  it('reaches ONPAGE-006 as a not_run naming the gsc station', async () => {
    const gsc = await runGscStation(null)
    const onpage006 = findingFor(runChecks(CHECKS, { gsc }), 'ONPAGE-006')
    expect(onpage006.status).toBe('not_run')
    expect(onpage006.reason).toContain('gsc station failed')
    expect(onpage006.reason).toContain('no gsc_site_url configured')
  })
})
