// What an audit run becomes on the way into Postgres, and on the way back out.
//
// Everything asserted here is pure. `lib/audit/store.ts` holds no IO precisely so that
// these rules can be pinned without a database, an export, or a network — an audit run is
// not producible inside a unit test, so a mapping that lived in the server action would be
// a mapping nothing ever checked.
//
// THE ASSERTIONS THAT CARRY WEIGHT ARE THE HONESTY ONES:
//
//   - An unreadable stored envelope yields `findingCounts: null` WITH a reason, never
//     zeros. "0 fail" and "we could not read this run" render identically in a list, and
//     only one of them is good news. This is the c36a9a3 failure in a new place.
//   - `describeExport` returns `unknown`, never `match`, when either side of the
//     comparison is missing. A `match` produced from two absent values is a fabricated
//     pass about which client's site was audited.
//   - The mapper is TOTAL over all three run statuses. A `failed` run maps to a row like
//     any other, because a failed run is the record that an export was unusable and
//     dropping it is how the same export gets uploaded again next week.

import { describe, expect, it } from 'vitest'
import {
  AUDIT_RUN_STATUSES,
  auditReportTitle,
  buildExportFiles,
  countFindings,
  describeExport,
  describeMissingBackbone,
  findBackboneFile,
  forReport,
  readStoredResult,
  toAuditRunInsert,
  toAuditRunSummary,
  toStoredAuditRun,
  type AuditRunRow,
  type AuditRunStatus,
} from '@/lib/audit/store'
import { toolErr, toolOk } from '@/lib/tools/contract'
import type { Finding, FindingStatus, StationBundle } from '@/lib/findings/types'
import type { AuditRunResult, StationReport, StationSlot } from '@/lib/orchestrator/types'
import type { CrawlPageRecord, CrawlStationData } from '@/lib/tools/crawl-record'

const CLIENT = '11111111-1111-1111-1111-111111111111'
const USER = '22222222-2222-2222-2222-222222222222'

function page(url: string): CrawlPageRecord {
  return {
    url,
    status: 200,
    title: 'Home',
    metaDescription: '',
    h1s: ['Home'],
    canonical: url,
    robotsMeta: '',
    hasViewportMeta: null,
    tapTargetsOk: null,
    analytics: { ga4: null, gtm: null },
    internalLinksOut: null,
    internalLinksIn: 3,
    wordCount: 400,
    uniqueWordCount: 200,
  } as CrawlPageRecord
}

function crawlStation(urls: string[]): StationBundle['crawl'] {
  const data = {
    site: { origin: urls[0] ? new URL(urls[0]).origin : '', robotsTxtStatus: 'not-fetched' },
    pages: urls.map(page),
  } as unknown as CrawlStationData
  return toolOk(data, { sources: ['crawl'] })
}

function finding(checkId: string, status: FindingStatus): Finding {
  return { checkId, status, source: 'crawl', evidence: { detail: `${checkId} ${status}` } }
}

function station(name: StationSlot, over: Partial<StationReport> = {}): StationReport {
  return { name, state: 'ok', sources: [], notes: [], durationMs: 1, runId: null, ...over }
}

function result(over: Partial<AuditRunResult> = {}): AuditRunResult {
  return {
    stations: { crawl: crawlStation(['https://tornadohvacca.com/', 'https://tornadohvacca.com/ac-repair']) },
    stationStatus: {
      crawl: station('crawl'),
      gsc: station('gsc', { state: 'unconfigured', reason: 'no GSC property is configured for this client' }),
      gbp: station('gbp', { state: 'unavailable', reason: 'no GBP station exists in this pipeline' }),
      robots: station('robots'),
    },
    coverage: null,
    findings: [
      finding('ONPAGE-003', 'fail'),
      finding('TECH-011', 'degraded'),
      finding('TECH-001', 'pass'),
      finding('LOCAL-016', 'not_run'),
      finding('LOCAL-003', 'not_run'),
    ],
    scoring: { items: [], unscored: [], configVersion: 'rubric-v1' },
    configVersion: 'rubric-v1',
    status: 'partial',
    recording: { attempted: false, recorded: [] },
    startedAt: '2026-08-07T10:00:00.000Z',
    completedAt: '2026-08-07T10:00:12.000Z',
    durationMs: 12_000,
    notes: [],
    ...over,
  }
}

const ATTRIBUTION = {
  label: 'uploaded export tornadohvacca_com_internal.csv · 4 files',
  fileCount: 4,
  backboneFile: 'tornadohvacca_com_internal.csv',
  clientWebsiteUrl: 'https://tornadohvacca.com',
}

// ---------------------------------------------------------------------------

describe('the backbone rule at intake', () => {
  it('accepts an export carrying a host-prefixed *_internal.csv', () => {
    const names = ['tornadohvacca_com_internal.csv', 'tornadohvacca_com_indexability.csv']
    expect(findBackboneFile(names)).toBe('tornadohvacca_com_internal.csv')
    expect(describeMissingBackbone(names)).toBeNull()
  })

  it('finds the backbone inside a nested export directory', () => {
    // A zip normally carries the export folder as a top-level entry prefix, and
    // lib/ingest/sitebulb/crawl.ts locates every report by SUFFIX for exactly this reason.
    expect(findBackboneFile(['Export 2026-08-07/tornadohvacca_com_internal.csv'])).toBe(
      'Export 2026-08-07/tornadohvacca_com_internal.csv',
    )
  })

  it('rejects an upload with no *_internal.csv and names what arrived', () => {
    const message = describeMissingBackbone([
      'tornadohvacca_com_indexability.csv',
      'hints/url_contains_no_google_analytics_code.csv',
    ])
    expect(message).not.toBeNull()
    expect(message).toContain('*_internal.csv')
    // Naming the uploaded files is the whole point: "invalid export" sends an operator
    // back to Sitebulb with nothing to change.
    expect(message).toContain('tornadohvacca_com_indexability.csv')
    expect(message).toContain('hints/url_contains_no_google_analytics_code.csv')
    // And it says why the file is required, so the rule is not folklore.
    expect(message).toContain('indistinguishable from a check that never ran')
  })

  it('rejects an empty upload', () => {
    expect(describeMissingBackbone([])).toContain('No files were uploaded')
  })

  it('does not accept a bare internal.csv', () => {
    // The ingester matches `_internal.csv`, so an unprefixed file would not be found there
    // either. Accepting it here would produce a run whose crawl station fails for a reason
    // the operator was already told did not apply.
    expect(findBackboneFile(['internal.csv'])).toBeNull()
    expect(describeMissingBackbone(['internal.csv'])).not.toBeNull()
  })
})

describe('building the in-memory export', () => {
  const bytes = new Uint8Array([1, 2, 3])

  it('forward-slashes backslashed entry names', () => {
    const { files } = buildExportFiles([{ name: 'hints\\no_ga.csv', bytes }])
    // A backslashed entry would match no report suffix, so the export would read as empty
    // rather than as mis-named.
    expect(Array.from(files.keys())).toEqual(['hints/no_ga.csv'])
  })

  it('reports duplicate entry names rather than collapsing them silently', () => {
    const { files, duplicates } = buildExportFiles([
      { name: 'a_internal.csv', bytes },
      { name: './a_internal.csv', bytes: new Uint8Array([9]) },
    ])
    expect(files.size).toBe(1)
    // Last write wins, and nobody can tell which of the two was audited — so it is a note.
    expect(duplicates).toEqual(['a_internal.csv'])
  })
})

// ---------------------------------------------------------------------------

describe('export attribution', () => {
  it('matches when every crawled URL is on the client website', () => {
    const attribution = describeExport(result(), ATTRIBUTION)
    expect(attribution.verdict).toBe('match')
    expect(attribution.origins).toEqual(['https://tornadohvacca.com'])
  })

  it('ignores a www difference, which is a redirect and not another client', () => {
    const run = result({ stations: { crawl: crawlStation(['https://www.tornadohvacca.com/']) } })
    expect(describeExport(run, ATTRIBUTION).verdict).toBe('match')
  })

  it('flags a mismatch and says the findings are about the other site', () => {
    const run = result({ stations: { crawl: crawlStation(['https://someoneelse.com/']) } })
    const attribution = describeExport(run, ATTRIBUTION)
    expect(attribution.verdict).toBe('mismatch')
    expect(attribution.reason).toContain('someoneelse.com')
    expect(attribution.reason).toContain('tornadohvacca.com')
  })

  it('is unknown, not match, when the crawl produced no pages', () => {
    // The honesty case. With nothing to compare, a `match` would be a fabricated claim
    // about whose site was audited — worse than admitting the question is open.
    const run = result({ stations: { crawl: toolErr('no backbone', { sources: ['crawl'] }) } })
    const attribution = describeExport(run, ATTRIBUTION)
    expect(attribution.verdict).toBe('unknown')
    expect(attribution.origins).toEqual([])
    // The backbone filename survives as the one remaining origin signal.
    expect(attribution.backboneFile).toBe('tornadohvacca_com_internal.csv')
  })

  it('is unknown when the client row has no website_url', () => {
    const attribution = describeExport(result(), { ...ATTRIBUTION, clientWebsiteUrl: null })
    expect(attribution.verdict).toBe('unknown')
    expect(attribution.reason).toContain('no website_url')
  })

  it('marks a truncated origin list rather than presenting it as exhaustive', () => {
    const urls = Array.from({ length: 8 }, (_, i) => `https://host${i}.com/`)
    const attribution = describeExport(result({ stations: { crawl: crawlStation(urls) } }), ATTRIBUTION)
    expect(attribution.originsTruncated).toBe(true)
    expect(attribution.origins.length).toBeLessThan(urls.length)
  })
})

// ---------------------------------------------------------------------------

describe('result to row', () => {
  it('maps the columns the contract names', () => {
    const run = result()
    const row = toAuditRunInsert({
      result: run,
      clientId: CLIENT,
      createdBy: USER,
      attribution: describeExport(run, ATTRIBUTION),
    })

    expect(row.client_id).toBe(CLIENT)
    expect(row.status).toBe('partial')
    expect(row.config_version).toBe('rubric-v1')
    expect(row.started_at).toBe('2026-08-07T10:00:00.000Z')
    expect(row.completed_at).toBe('2026-08-07T10:00:12.000Z')
    expect(row.duration_ms).toBe(12_000)
    expect(row.created_by).toBe(USER)
  })

  it('drops the station bundle but keeps the station strip', () => {
    const run = result()
    const row = toAuditRunInsert({
      result: run,
      clientId: CLIENT,
      createdBy: USER,
      attribution: describeExport(run, ATTRIBUTION),
    })

    // The bundle is the raw substrate and is already in tool_runs; copying the whole
    // crawled page set into a second table buys no reader.
    expect('stations' in row.result.run).toBe(false)
    // The strip is what explains a not_run row, so it is stored in full — all four slots.
    expect(Object.keys(row.result.run.stationStatus).sort()).toEqual(['crawl', 'gbp', 'gsc', 'robots'])
    expect(row.result.run.stationStatus.gsc.state).toBe('unconfigured')
    expect(row.result.run.findings).toHaveLength(5)
  })

  it('lifts a non-matching attribution into the row notes', () => {
    const run = result({ stations: { crawl: crawlStation(['https://someoneelse.com/']) } })
    const row = toAuditRunInsert({
      result: run,
      clientId: CLIENT,
      createdBy: USER,
      attribution: describeExport(run, ATTRIBUTION),
      intakeNotes: ['two entries called a_internal.csv'],
    })

    // A list view reads `notes` and never opens the stored document, so a mismatch has to
    // be legible there.
    expect(row.notes.some((n) => n.includes('Export attribution'))).toBe(true)
    expect(row.notes).toContain('two entries called a_internal.csv')
  })

  it('leaves the notes clean when the attribution matches', () => {
    const run = result()
    const row = toAuditRunInsert({
      result: run,
      clientId: CLIENT,
      createdBy: USER,
      attribution: describeExport(run, ATTRIBUTION),
    })
    expect(row.notes).toEqual([])
  })

  it('maps a FAILED run rather than discarding it', () => {
    // The rule this test exists for: a failed run is the record that an export was
    // unusable on this day. Dropping it is how the same broken export is uploaded again
    // next week and fails the same way with nobody the wiser. The mapper is total, so
    // there is no path through it that can refuse one.
    const run = result({
      stations: { crawl: toolErr('no *_internal.csv', { sources: ['crawl'] }) },
      status: 'failed',
      configVersion: 'unavailable',
      findings: [finding('ONPAGE-003', 'not_run')],
      notes: ['Scoring failed, so the findings are unranked.'],
      stationStatus: {
        crawl: station('crawl', { state: 'failed', reason: 'no *_internal.csv' }),
        gsc: station('gsc', { state: 'skipped' }),
        gbp: station('gbp', { state: 'unavailable' }),
        robots: station('robots', { state: 'unconfigured' }),
      },
    })

    const row = toAuditRunInsert({
      result: run,
      clientId: CLIENT,
      createdBy: USER,
      attribution: describeExport(run, ATTRIBUTION),
    })

    expect(row.status).toBe('failed')
    expect(row.config_version).toBe('unavailable')
    expect(row.result.run.stationStatus.crawl.reason).toBe('no *_internal.csv')
    expect(row.notes).toContain('Scoring failed, so the findings are unranked.')
  })

  it('is total over every status the column permits', () => {
    for (const status of AUDIT_RUN_STATUSES) {
      const row = toAuditRunInsert({
        result: result({ status }),
        clientId: CLIENT,
        createdBy: USER,
        attribution: describeExport(result(), ATTRIBUTION),
      })
      expect(row.status).toBe(status)
    }
  })

  it('accepts a null author, because created_by is nullable', () => {
    const row = toAuditRunInsert({
      result: result(),
      clientId: CLIENT,
      createdBy: null,
      attribution: describeExport(result(), ATTRIBUTION),
    })
    expect(row.created_by).toBeNull()
  })
})

// ---------------------------------------------------------------------------

function storedRow(over: Partial<AuditRunRow> = {}): AuditRunRow {
  const run = result()
  const insert = toAuditRunInsert({
    result: run,
    clientId: CLIENT,
    createdBy: USER,
    attribution: describeExport(run, ATTRIBUTION),
  })
  return {
    id: '33333333-3333-3333-3333-333333333333',
    client_id: CLIENT,
    status: insert.status,
    config_version: insert.config_version,
    started_at: insert.started_at,
    completed_at: insert.completed_at,
    duration_ms: insert.duration_ms,
    // Round-tripped through JSON, because that is what jsonb does to it.
    result: JSON.parse(JSON.stringify(insert.result)),
    notes: insert.notes,
    created_by: USER,
    created_at: '2026-08-07T10:00:13.000Z',
    ...over,
  }
}

describe('row to summary', () => {
  it('counts every finding status, including the zeros', () => {
    const summary = toAuditRunSummary(storedRow())
    expect(summary.findingCounts).toEqual({ total: 5, fail: 1, degraded: 1, pass: 1, not_run: 2 })
    expect(summary.status).toBe('partial')
    expect(summary.exportAttribution?.verdict).toBe('match')
    expect(summary.unreadableReason).toBeUndefined()
  })

  it('survives a jsonb round trip with the strip intact', () => {
    const run = toStoredAuditRun(storedRow())
    expect(run.run?.stationStatus.gbp.state).toBe('unavailable')
    expect(run.run?.findings.map((f) => f.checkId)).toContain('LOCAL-016')
  })

  it('reports null counts and a reason for an envelope it cannot read', () => {
    // THE ONE THAT MATTERS. Zeros here would render as a clean audit in a list view.
    const summary = toAuditRunSummary(storedRow({ result: { version: 99, run: {} } }))
    expect(summary.findingCounts).toBeNull()
    expect(summary.exportAttribution).toBeNull()
    expect(summary.unreadableReason).toContain('version 99')
    // The columns are still true, so they are still reported.
    expect(summary.status).toBe('partial')
    expect(summary.startedAt).toBe('2026-08-07T10:00:00.000Z')
  })

  it('reports null counts for an envelope with no findings array', () => {
    const summary = toAuditRunSummary(storedRow({ result: { version: 1, run: { findings: 'lots' } } }))
    expect(summary.findingCounts).toBeNull()
    expect(summary.unreadableReason).toContain('findings array')
  })

  it('hands back a null run rather than an empty one when the envelope is unreadable', () => {
    const run = toStoredAuditRun(storedRow({ result: null }))
    // Null is "we could not read it". An empty AuditRunResult would render as a run that
    // found nothing, which is the same fabrication one level up.
    expect(run.run).toBeNull()
    expect(run.findingCounts).toBeNull()
  })

  it('never throws on a row it does not recognise', () => {
    expect(() => toAuditRunSummary(storedRow({ result: 'not json at all', notes: null }))).not.toThrow()
    expect(toAuditRunSummary(storedRow({ notes: null })).notes).toEqual([])
  })

  it('does not invent a verdict for a status the constraint should have prevented', () => {
    // `partial` is the honest reading of "something here is not fully known"; `failed`
    // would be a verdict this row never carried.
    const summary = toAuditRunSummary(storedRow({ status: 'running' }))
    expect(summary.status).toBe('partial')
  })
})

describe('counting', () => {
  it('counts an unknown status toward the total and toward no bucket', () => {
    // The buckets then visibly fail to sum, which is the point: a default branch filing an
    // unknown status under `pass` would report a clean check nobody evaluated.
    const counts = countFindings([
      finding('A', 'fail'),
      { ...finding('B', 'pass'), status: 'invented' as unknown as FindingStatus },
    ])
    expect(counts.total).toBe(2)
    expect(counts.fail + counts.degraded + counts.pass + counts.not_run).toBe(1)
  })
})

describe('rendering a stored run', () => {
  it('adapts a stored run back to the formatter without claiming a station bundle', () => {
    const run = toStoredAuditRun(storedRow())
    const adapted = forReport(run.run!)
    // Empty is the TYPE adapter. `stationStatus` — stored complete — is what says what
    // each station actually did, and it is unchanged.
    expect(adapted.stations).toEqual({})
    expect(adapted.stationStatus.gsc.state).toBe('unconfigured')
  })

  it('titles a library item so a list of them is navigable', () => {
    const summary = toAuditRunSummary(storedRow())
    const title = auditReportTitle(summary)
    expect(title).toContain('2026-08-07')
    expect(title).toContain('partial')
    expect(title).toContain('1 fail')
  })

  it('omits the counts from the title when they could not be read', () => {
    const title = auditReportTitle({
      status: 'failed' as AuditRunStatus,
      startedAt: '2026-08-07T10:00:00.000Z',
      findingCounts: null,
    })
    expect(title).toBe('Audit run 2026-08-07 · failed')
  })
})

describe('readStoredResult', () => {
  it('rejects a non-object', () => {
    expect(readStoredResult(42)).toEqual({ ok: false, reason: 'the stored result is not an object' })
  })
})
