// The terminal report, and the two honesty rules it is the surface for.
//
// Fixtures are built BY HAND rather than by running the orchestrator. Two reasons: run.ts
// reaches the whole check registry and the scoring config, so a real run cannot be pinned to
// a layout assertion without pinning the registry too; and the interesting inputs here are
// the ones a real run rarely produces — a station with no report at all, a scored item whose
// formula is long, a coverage report with files missing.
//
// The load-bearing assertion in this file is the equal-visual-weight one. It is STRUCTURAL:
// it derives the column boundaries from the rendered header and asserts a not_run row lands
// on them exactly as a fail row does. A snapshot would also notice the change, but it would
// notice every change, so nobody would read the diff as "the honesty rule broke".

import { describe, expect, it } from 'vitest'
import {
  formatAuditRun,
  formatCoverage,
  formatFindings,
  formatScoreTrace,
  formatStations,
} from '@/lib/orchestrator/report-text'
import { compareRecorded, comparisonExitCode, type RecordedExport } from '@/lib/audit/recorded'
import type { AuditRunResult, StationReport, StationSlot } from '@/lib/orchestrator/types'
import type { Finding } from '@/lib/findings/types'
import type { ScoredRecommendation, ScoringResult } from '@/lib/scoring/types'

const MAX_WIDTH = 100

function station(name: StationSlot, over: Partial<StationReport> = {}): StationReport {
  return {
    name,
    state: 'ok',
    sources: ['crawl'],
    notes: [],
    durationMs: 12,
    runId: null,
    ...over,
  }
}

function finding(over: Partial<Finding> & Pick<Finding, 'checkId' | 'status'>): Finding {
  return {
    source: 'crawl',
    evidence: { detail: 'detail' },
    ...over,
  }
}

function scored(over: Partial<ScoredRecommendation> & Pick<ScoredRecommendation, 'checkId'>): ScoredRecommendation {
  return {
    status: 'fail',
    severity: 'high',
    category: 'onpage',
    effort: 'medium',
    effortWeight: 2,
    severityWeight: 3,
    impact: 28.65,
    priorityScore: 14.325,
    band: 'P1',
    rank: 1,
    basis: 'template_fix',
    inputs: {
      basis: 'template_fix',
      formula: 'affected_url_count x severity_weight x earning_url_bonus',
      terms: { affected_url_count: 194, severity_weight: 3, earning_url_bonus: 1.5 },
      rawImpact: 873,
      basisWeight: 0.05,
      notes: ['9 of the affected URLs already earn impressions, so the earning-url bonus applied.'],
    },
    evidenceDetail: '194 pages have no single H1',
    ...over,
  }
}

const SCORING: ScoringResult = {
  items: [
    scored({ checkId: 'ONPAGE-003' }),
    scored({
      checkId: 'MEAS-001',
      rank: 2,
      band: 'P2',
      basis: 'measurement_gap',
      severity: 'critical',
      effort: 'low',
      effortWeight: 1,
      impact: 12,
      priorityScore: 12,
      inputs: {
        basis: 'measurement_gap',
        formula: 'fixed measurement_gap_weight (gates all other measurement)',
        terms: { measurement_gap_weight: 240 },
        rawImpact: 240,
        basisWeight: 0.05,
        notes: [],
      },
      evidenceDetail: '202 of 206 pages carry no GA4 or GTM tag',
    }),
  ],
  unscored: [
    { checkId: 'TECH-001', status: 'not_run', reason: 'robots.txt was never fetched' },
    { checkId: 'ONPAGE-012', status: 'pass', reason: 'only fails are scored' },
  ],
  configVersion: 'scoring-v1',
}

function runResult(over: Partial<AuditRunResult> = {}): AuditRunResult {
  return {
    stations: {},
    stationStatus: {
      crawl: station('crawl', { state: 'degraded', reason: 'mobile_friendly export missing' }),
      gsc: station('gsc', { sources: ['gsc'], runId: 'a1b2c3d4', durationMs: 940 }),
      gbp: station('gbp', {
        state: 'unavailable',
        sources: [],
        reason: 'No GBP station exists in this pipeline.',
      }),
      robots: station('robots', { sources: ['crawl'], notes: ['/llms.txt returned 404.'] }),
    },
    coverage: {
      urls: 206,
      filesRead: ['internal', 'indexability'],
      filesMissing: ['mobile_friendly'],
      unmeasured: { internalLinksOut: 206, hasViewportMeta: 4, tapTargetsOk: 4, canonical: 4 },
    },
    findings: [
      finding({
        checkId: 'ONPAGE-003',
        status: 'fail',
        evidence: { detail: '194 pages have no single H1', affectedUrls: 194 },
      }),
      finding({
        checkId: 'MEAS-001',
        status: 'fail',
        evidence: { detail: '202 of 206 pages carry no GA4 or GTM tag', affectedUrls: 202 },
      }),
      finding({
        checkId: 'TECH-001',
        status: 'not_run',
        evidence: { detail: 'robots.txt body was not available' },
        reason: 'a CSV export carries no robots.txt body',
      }),
      finding({
        checkId: 'TECH-011',
        status: 'degraded',
        evidence: { detail: '101 of 202 measured pages fail a mobile condition', affectedUrls: 101 },
        reason: '4 pages absent from mobile_friendly.csv were excluded',
      }),
      finding({ checkId: 'ONPAGE-012', status: 'pass', source: 'derived' }),
    ],
    scoring: SCORING,
    configVersion: 'scoring-v1',
    status: 'partial',
    recording: { attempted: true, recorded: ['sitebulb-crawl', 'gsc-rows'] },
    startedAt: '2026-08-06T12:00:00.000Z',
    completedAt: '2026-08-06T12:00:03.400Z',
    durationMs: 3400,
    notes: ['The GBP station is not part of this pipeline; LOCAL-003 and LOCAL-016 are not_run.'],
    ...over,
  }
}

/** The first line of each rendered row — continuation lines are indented. */
function rowLines(block: string): string[] {
  return block.split('\n').filter((line) => line.length > 0 && !line.startsWith(' '))
}

describe('the station strip', () => {
  it('renders all four slots, gbp included, and names its state', () => {
    const block = formatStations(runResult())
    for (const slot of ['crawl', 'gsc', 'gbp', 'robots']) {
      expect(block).toContain(slot)
    }
    const gbp = block.split('\n').find((l) => l.startsWith('gbp'))
    expect(gbp).toBeDefined()
    expect(gbp).toContain('unavailable')
  })

  it('renders a slot with no report rather than omitting it', () => {
    // A run that forgot a station must produce a visible row, not a shorter strip. The
    // Record<StationSlot, …> type says this cannot happen; persisted or hand-built data
    // routinely proves such types wrong, and a missing row is exactly the silence the
    // four-slot rule exists to stop.
    const partial = runResult()
    delete (partial.stationStatus as Partial<Record<StationSlot, StationReport>>).robots
    const block = formatStations(partial)
    const robots = block.split('\n').find((l) => l.startsWith('robots'))
    expect(robots).toBeDefined()
    expect(robots).toContain('unavailable')
  })
})

describe('equal visual weight for not_run', () => {
  const block = formatFindings(runResult())
  const lines = block.split('\n')
  const header = lines.find((l) => l.startsWith('rank'))!
  const rows = rowLines(block)

  /** Column start offsets, derived from the rendered header rather than from the source. */
  const offsets = (() => {
    const out: number[] = []
    let cursor = 0
    for (const name of ['rank', 'check', 'status', 'source', 'impact', 'priority', 'band', 'detail']) {
      const at = header.indexOf(name, cursor)
      expect(at, `header column ${name}`).toBeGreaterThanOrEqual(0)
      out.push(at)
      cursor = at + name.length
    }
    return out
  })()

  const notRunRow = rows.find((l) => l.includes('TECH-001'))!
  const failRow = rows.find((l) => l.includes('ONPAGE-003'))!

  it('puts the not_run row in the same table as the fail row', () => {
    expect(notRunRow).toBeDefined()
    expect(failRow).toBeDefined()
    // One table means one header. A second header line would mean a second section.
    expect(lines.filter((l) => l.startsWith('rank'))).toHaveLength(1)
  })

  it('lands both rows on the same column boundaries', () => {
    const cellStarts = (line: string) =>
      offsets.map((at) => (line.slice(at).match(/^\S/) ? at : null))

    // Every column of the fail row begins exactly on its header offset...
    expect(cellStarts(failRow)).toEqual(offsets)
    // ...and so does every column of the not_run row. Same widths, same positions.
    expect(cellStarts(notRunRow)).toEqual(offsets)
  })

  it('adds no dim, marker or collapse decoration to the not_run row', () => {
    expect(block).not.toMatch(/\x1b\[/)
    for (const row of [failRow, notRunRow]) {
      expect(row[0]).not.toBe(' ')
      expect(row).not.toMatch(/^[*#>(\[]/)
    }
    // No footnote treatment: the status word is in the row, not deferred to a legend.
    expect(notRunRow).toContain('not_run')
  })

  it('counts every status in the header line, including zeroes', () => {
    const count = lines.find((l) => l.includes('findings ·'))!
    expect(count).toContain('5 findings')
    expect(count).toContain('2 fail')
    expect(count).toContain('1 degraded')
    expect(count).toContain('1 pass')
    expect(count).toContain('1 not_run')
  })
})

describe('the score trace', () => {
  const block = formatScoreTrace(runResult())

  it('prints every ScoreInputs.formula verbatim', () => {
    for (const item of SCORING.items) {
      expect(block, item.checkId).toContain(item.inputs.formula)
    }
  })

  it('shows the terms, the impact arithmetic and the priority arithmetic', () => {
    expect(block).toContain('affected_url_count=194')
    expect(block).toContain('rawImpact 873 x basisWeight 0.05')
    expect(block).toContain('impact 28.65 / effortWeight 2')
    expect(block).toContain('14.325')
  })

  it('carries the notes, and says so when there are none', () => {
    expect(block).toContain('already earn impressions')
    expect(block).toContain('notes     (none)')
  })

  it('names the unscored findings and why', () => {
    expect(block).toContain('TECH-001  not scored (not_run): robots.txt was never fetched')
  })
})

describe('the coverage block', () => {
  it('states the filesMissing rule and its verdict', () => {
    const block = formatCoverage(runResult())
    expect(block).toContain('degraded = filesMissing.length > 0  ->  TRUE')
    expect(block).toContain('filesMissing')
    expect(block).toContain('mobile_friendly')
  })

  it('flips the verdict when nothing is missing', () => {
    const clean = runResult()
    clean.coverage = { ...clean.coverage!, filesMissing: [] }
    expect(formatCoverage(clean)).toContain('degraded = filesMissing.length > 0  ->  FALSE')
  })

  it('states the unmeasured caveat and names the module that owns the rule', () => {
    const block = formatCoverage(runResult())
    expect(block).toContain('does NOT degrade')
    expect(block).toContain('lib/stations/degradation.ts')
    expect(block).toContain('internalLinksOut')
  })

  it('does not report a missing coverage report as a clean one', () => {
    const block = formatCoverage(runResult({ coverage: null }))
    expect(block).not.toContain('->  FALSE')
    expect(block).toContain('UNKNOWN')
  })
})

describe('the whole report', () => {
  const out = formatAuditRun(runResult(), {
    exportLabel: 'tornadohvacca_com_all_exports',
    client: 'Tornado HVAC',
    mode: 'dry-run',
  })

  it('emits no line wider than 100 characters', () => {
    const overlong = out.split('\n').filter((line) => line.length > MAX_WIDTH)
    expect(overlong, overlong.join('\n')).toEqual([])
  })

  it('leads with the header facts', () => {
    expect(out).toContain('2026-08-06T12:00:00.000Z')
    expect(out).toContain('scoring-v1')
    expect(out).toContain('tornadohvacca_com_all_exports')
    expect(out).toContain('Tornado HVAC')
    expect(out).toContain('dry-run')
    expect(out).toContain('partial')
  })

  it('renders all six blocks, and omits the comparison when none was supplied', () => {
    for (const heading of ['AUDIT RUN', 'STATIONS', 'COVERAGE', 'FINDINGS', 'SCORE TRACE']) {
      expect(out).toContain(heading)
    }
    expect(out).not.toContain('RECORDED COMPARISON')
  })

  it('renders the comparison table when comparison rows are supplied', () => {
    const withComparison = formatAuditRun(runResult(), {
      comparison: [
        { figure: 'coverage.urls', recorded: 206, actual: 206, pass: true },
        { figure: 'ONPAGE-003.affected', recorded: 194, actual: null, pass: false },
      ],
    })
    expect(withComparison).toContain('RECORDED COMPARISON')
    expect(withComparison).toContain('1 mismatched')
    expect(withComparison).toContain('MISMATCH')
    expect(withComparison.split('\n').filter((l) => l.length > MAX_WIDTH)).toEqual([])
  })

  it('is deterministic — the same result renders the same bytes', () => {
    expect(formatAuditRun(runResult(), { mode: 'dry-run' })).toBe(
      formatAuditRun(runResult(), { mode: 'dry-run' }),
    )
  })
})

// ---------------------------------------------------------------------------
// compareRecorded
// ---------------------------------------------------------------------------

const RECORD: RecordedExport = {
  urls: 206,
  unmeasured: { internalLinksOut: 206, hasViewportMeta: 4, tapTargetsOk: 4, canonical: 4 },
  checks: {
    'TECH-001': { status: 'not_run' },
    'ONPAGE-003': { status: 'fail', affected: 194 },
    'TECH-011': { status: 'degraded', affected: 101, measured: 202 },
    'MEAS-001': { status: 'fail', affected: 202 },
  },
}

describe('compareRecorded', () => {
  it('passes every figure when the run reproduces the record', () => {
    const rows = compareRecorded(runResult(), RECORD)
    expect(rows.filter((r) => !r.pass)).toEqual([])
    expect(comparisonExitCode(rows)).toBe(0)
  })

  it('compares urls, all four unmeasured signals, and each check status plus affected', () => {
    const figures = compareRecorded(runResult(), RECORD).map((r) => r.figure)
    expect(figures).toContain('coverage.urls')
    for (const signal of ['internalLinksOut', 'hasViewportMeta', 'tapTargetsOk', 'canonical']) {
      expect(figures).toContain(`coverage.unmeasured.${signal}`)
    }
    for (const id of ['TECH-001', 'ONPAGE-003', 'TECH-011', 'MEAS-001']) {
      expect(figures).toContain(`${id}.status`)
    }
    for (const id of ['ONPAGE-003', 'TECH-011', 'MEAS-001']) {
      expect(figures).toContain(`${id}.affected`)
    }
    // TECH-001 is not_run and records no magnitude, so there is no affected figure to compare.
    expect(figures).not.toContain('TECH-001.affected')
  })

  it('reports exactly the mismatched figures and exits 2', () => {
    const drifted = runResult()
    drifted.coverage = { ...drifted.coverage!, urls: 205 }
    drifted.findings = drifted.findings.map((f) =>
      f.checkId === 'ONPAGE-003'
        ? { ...f, evidence: { ...f.evidence, affectedUrls: 193 } }
        : f,
    )

    const rows = compareRecorded(drifted, RECORD)
    const failures = rows.filter((r) => !r.pass)
    expect(failures).toHaveLength(2)
    expect(failures.map((r) => r.figure).sort()).toEqual([
      'ONPAGE-003.affected',
      'coverage.urls',
    ])
    expect(failures.find((r) => r.figure === 'coverage.urls')).toEqual({
      figure: 'coverage.urls',
      recorded: 206,
      actual: 205,
      pass: false,
    })
    expect(comparisonExitCode(rows)).toBe(2)
  })

  it('reports a figure the run could not produce as actual null and pass false', () => {
    // THE INVERSION THIS PREVENTS: if unproducible figures were dropped instead, a run that
    // measured nothing would compare clean — zero rows, zero mismatches, exit 0.
    const blind = runResult({ coverage: null, findings: [] })
    const rows = compareRecorded(blind, RECORD)

    expect(rows).toHaveLength(compareRecorded(runResult(), RECORD).length)
    for (const row of rows) {
      expect(row.actual, row.figure).toBeNull()
      expect(row.pass, row.figure).toBe(false)
    }
    expect(comparisonExitCode(rows)).toBe(2)
  })

  it('exits 2 on an empty comparison rather than calling it a pass', () => {
    expect(comparisonExitCode([])).toBe(2)
  })
})
