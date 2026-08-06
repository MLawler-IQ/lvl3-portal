// The audit run, rendered as fixed-width terminal text.
//
// PURE, and aggressively so: no node:fs, no process, no Date.now, no colour. The dry-run
// script owns IO; this module owns layout. That split is what lets a unit test assert the
// exact bytes of a rendered run without a filesystem, an env file or a network.
//
// COLOUR IS DELIBERATELY ABSENT, and not only because ANSI in a captured log is noise.
// AUTOMATION-PLAN.md's coverage-honesty rule says a `not_run` row gets the SAME visual
// weight as a `fail` — never dimmed, never collapsed, never a footnote. A terminal's
// cheapest way to break that rule is to dim one status, so the palette here is one colour.
// The equal-weight guarantee is therefore structural: every finding goes through the same
// row renderer with the same column widths, and there is no branch on status anywhere in
// the layout code. tests/unit/audit-report-text.test.ts asserts the column boundaries of a
// not_run row against those of a fail row, so restoring a status branch turns the gate red.
//
// The 100-column budget has exactly one deliberate exception: ScoreInputs.formula, which is
// printed verbatim on its own line and never wrapped, prettified or truncated. A reviewer
// comparing a snapshot diff needs the formula string as it was persisted; a formula that has
// been re-flowed to fit is a different string, and the whole point of storing it is that it
// is quotable on a client call. Today's longest formula is ~57 characters, so the exception
// costs nothing in practice.

import type { Finding } from '@/lib/findings/types'
import type { ScoredRecommendation } from '@/lib/scoring/types'
import type { AuditRunResult, StationReport, StationSlot } from '@/lib/orchestrator/types'
import type { RecordedComparisonRow } from '@/lib/audit/recorded'

const MAX_WIDTH = 100
const RULE_WIDTH = 80
const GUTTER = '  '
const LABEL_WIDTH = 15
const EMPTY = '-'

/**
 * All four slots, in a fixed order, as a literal.
 *
 * Hand-listed rather than derived from the run's keys: deriving them would let a run that
 * forgot a station render a strip that simply omits it, which is the exact silence
 * StationSlot's doc comment exists to prevent.
 */
const STATION_ORDER: readonly StationSlot[] = ['crawl', 'gsc', 'gbp', 'robots']

/** Extra context the run result does not carry. See the note on `ReportMeta` below. */
export interface ReportMeta {
  /**
   * `AuditRunResult` has no export label, client name or mode: `AuditRunOptions.crawl` is a
   * source object with no name, `clientId` is not echoed into the result, and "mode" is a
   * property of the caller, not the run. Rather than fabricate them from what is present,
   * the caller passes what it knows and the header prints `-` for the rest.
   */
  exportLabel?: string | null
  client?: string | null
  mode?: string | null
  comparison?: readonly RecordedComparisonRow[]
}

export function formatAuditRun(result: AuditRunResult, meta: ReportMeta = {}): string {
  const blocks = [
    formatHeader(result, meta),
    formatStations(result),
    formatCoverage(result),
    formatFindings(result),
    formatScoreTrace(result),
  ]

  // The comparison block is absent, not empty, when no record was supplied — an empty
  // "RECORDED COMPARISON" heading reads as "compared and found nothing wrong".
  if (meta.comparison && meta.comparison.length > 0) {
    blocks.push(formatRecordedComparison(meta.comparison))
  }

  return blocks.join('\n\n') + '\n'
}

export function formatHeader(result: AuditRunResult, meta: ReportMeta = {}): string {
  const lines = ['='.repeat(RULE_WIDTH), 'AUDIT RUN', '='.repeat(RULE_WIDTH)]

  lines.push(...kv('started', result.startedAt))
  lines.push(...kv('completed', result.completedAt))
  lines.push(...kv('duration', `${numStr(result.durationMs)}ms`))
  lines.push(...kv('status', result.status))
  lines.push(...kv('configVersion', result.configVersion))
  lines.push(...kv('export', meta.exportLabel ?? EMPTY))
  lines.push(...kv('client', meta.client ?? EMPTY))
  lines.push(...kv('mode', meta.mode ?? EMPTY))
  lines.push(...kv('recording', describeRecording(result)))

  for (const note of result.notes) lines.push(...kv('note', note))

  return lines.join('\n')
}

export function formatStations(result: AuditRunResult): string {
  const cols = [
    { header: 'station', width: 7 },
    { header: 'state', width: 12 },
    { header: 'duration', width: 9 },
    { header: 'sources', width: 16 },
    { header: 'tool_runs', width: 10 },
    { header: 'detail', width: 0 },
  ]

  const rows = STATION_ORDER.map((slot) => {
    const report: StationReport | undefined = result.stationStatus?.[slot]
    if (!report) {
      return [slot, 'unavailable', EMPTY, EMPTY, EMPTY, 'No station report was recorded for this slot.']
    }
    return [
      report.name,
      report.state,
      `${numStr(report.durationMs)}ms`,
      report.sources.length > 0 ? report.sources.join(',') : EMPTY,
      report.runId ?? EMPTY,
      [report.reason, ...report.notes].filter(Boolean).join(' · ') || EMPTY,
    ]
  })

  return ['STATIONS', '-'.repeat(RULE_WIDTH), ...renderTable(cols, rows)].join('\n')
}

/**
 * The readable proof of the degradation rule.
 *
 * The rule is STATED here rather than implied by a `degraded` flag, because the flag is
 * exactly the thing a reader cannot verify: the two candidate signals (`filesMissing` and
 * `unmeasured`) are both printed directly above it, so a reader can check the arithmetic.
 * Wording follows lib/stations/degradation.ts and names that file, so a future change to
 * the rule has one obvious place to look and one obvious place to update.
 */
export function formatCoverage(result: AuditRunResult): string {
  const lines = ['COVERAGE', '-'.repeat(RULE_WIDTH)]
  const cov = result.coverage

  if (!cov) {
    lines.push('No coverage report: the crawl ingest failed before any coverage existed.')
    lines.push(`degraded = filesMissing.length > 0  ->  UNKNOWN (no coverage to read)`)
    lines.push(
      ...wrapAt(
        0,
        'A missing coverage report is not a clean one. `unmeasured` never degrades a station — see lib/stations/degradation.ts.',
      ),
    )
    return lines.join('\n')
  }

  lines.push(...kv('urls', numStr(cov.urls)))
  lines.push(...kv('filesRead', cov.filesRead.length > 0 ? cov.filesRead.join(', ') : '(none)'))
  lines.push(
    ...kv('filesMissing', cov.filesMissing.length > 0 ? cov.filesMissing.join(', ') : '(none)'),
  )

  const unmeasured = Object.entries(cov.unmeasured).sort(
    (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
  )
  if (unmeasured.length === 0) {
    lines.push(...kv('unmeasured', '(none)'))
  } else {
    const keyWidth = Math.max(...unmeasured.map(([k]) => k.length))
    unmeasured.forEach(([signal, n], i) => {
      const label = i === 0 ? 'unmeasured' : ''
      lines.push(label.padEnd(LABEL_WIDTH) + `${signal.padEnd(keyWidth)} = ${numStr(n)} of ${cov.urls}`)
    })
  }

  lines.push('')
  lines.push(
    `degraded = filesMissing.length > 0  ->  ${cov.filesMissing.length > 0 ? 'TRUE' : 'FALSE'}`,
  )
  lines.push(
    ...wrapAt(
      2,
      '`unmeasured` deliberately does NOT degrade the crawl station. The rule lives in one place, lib/stations/degradation.ts, and reads only filesMissing.',
    ),
  )
  lines.push(
    ...wrapAt(
      2,
      'internalLinksOut is bumped for every page on every export, so degrading on unmeasured would leave the crawl station permanently degraded and no crawl-backed check could ever return pass.',
    ),
  )

  return lines.join('\n')
}

/**
 * Every finding, in one table.
 *
 * ORDER is by rank, because the ranked plan is the deliverable and an unranked list would
 * bury the P1s. WEIGHT is identical for all four statuses: same columns, same widths, same
 * renderer, no prefix marker, no dimming, no second table. Those are different properties,
 * and only the second one is what the coverage-honesty rule is about.
 */
export function formatFindings(result: AuditRunResult): string {
  const cols = [
    { header: 'rank', width: 4 },
    { header: 'check', width: 11 },
    { header: 'status', width: 8 },
    { header: 'source', width: 7 },
    { header: 'impact', width: 8 },
    { header: 'priority', width: 8 },
    { header: 'band', width: 4 },
    { header: 'detail', width: 0 },
  ]

  const scored = new Map<string, ScoredRecommendation>()
  for (const item of result.scoring?.items ?? []) scored.set(item.checkId, item)

  const ordered = [...result.findings].sort((a, b) => {
    const ra = scored.get(a.checkId)?.rank ?? Number.MAX_SAFE_INTEGER
    const rb = scored.get(b.checkId)?.rank ?? Number.MAX_SAFE_INTEGER
    return ra - rb || a.checkId.localeCompare(b.checkId)
  })

  const rows = ordered.map((finding) => {
    const item = scored.get(finding.checkId)
    return [
      item ? String(item.rank) : EMPTY,
      finding.checkId,
      finding.status,
      finding.source,
      item ? numStr(item.impact) : EMPTY,
      item ? numStr(item.priorityScore) : EMPTY,
      item ? item.band : EMPTY,
      detailFor(finding),
    ]
  })

  return [
    'FINDINGS',
    '-'.repeat(RULE_WIDTH),
    countLine(result.findings),
    '',
    ...renderTable(cols, rows),
  ].join('\n')
}

export function formatScoreTrace(result: AuditRunResult): string {
  const lines = ['SCORE TRACE', '-'.repeat(RULE_WIDTH)]
  const items = result.scoring?.items ?? []

  if (items.length === 0) {
    lines.push('No scored items.')
  }

  items.forEach((item, i) => {
    if (i > 0) lines.push('')
    lines.push(
      `${item.checkId}  basis=${item.basis}  band=${item.band}  rank=${item.rank}  ` +
        `severity=${item.severity}  effort=${item.effort}`,
    )
    // Verbatim, unwrapped, unprettified. See the width-budget note at the top of the file.
    lines.push(`    formula   ${item.inputs.formula}`)

    const terms = Object.entries(item.inputs.terms).map(([k, v]) => `${k}=${numStr(v)}`)
    lines.push(...wrapAt(4, `terms     ${terms.length > 0 ? terms.join(', ') : '(none)'}`, 14))

    lines.push(
      `    impact    rawImpact ${numStr(item.inputs.rawImpact)} x basisWeight ` +
        `${numStr(item.inputs.basisWeight)}  ->  ${numStr(item.impact)}`,
    )
    lines.push(
      `    priority  impact ${numStr(item.impact)} / effortWeight ` +
        `${numStr(item.effortWeight)}  ->  ${numStr(item.priorityScore)}  (${item.band})`,
    )

    if (item.inputs.notes.length === 0) {
      lines.push('    notes     (none)')
    } else {
      item.inputs.notes.forEach((note, n) => {
        lines.push(...wrapAt(4, `${n === 0 ? 'notes    ' : '         '} ${note}`, 14))
      })
    }
  })

  for (const un of result.scoring?.unscored ?? []) {
    lines.push('')
    lines.push(...wrapAt(0, `${un.checkId}  not scored (${un.status}): ${un.reason}`))
  }

  return lines.join('\n')
}

export function formatRecordedComparison(rows: readonly RecordedComparisonRow[]): string {
  const cols = [
    // 38 fits the longest figure name the comparison can emit,
    // `coverage.unmeasured.internalLinksOut` (36) — a truncated figure name in a gate table
    // is exactly the wrong place to save four columns.
    { header: 'figure', width: 38 },
    { header: 'recorded', width: 12 },
    { header: 'actual', width: 12 },
    { header: 'verdict', width: 0 },
  ]

  const failures = rows.filter((r) => !r.pass).length
  const body = rows.map((r) => [
    r.figure,
    String(r.recorded),
    r.actual === null ? 'null' : String(r.actual),
    r.pass ? 'MATCH' : 'MISMATCH',
  ])

  return [
    'RECORDED COMPARISON',
    '-'.repeat(RULE_WIDTH),
    `${rows.length} figures compared · ${failures} mismatched`,
    '',
    ...renderTable(cols, body),
  ].join('\n')
}

// ---------------------------------------------------------------------------
// Layout primitives
// ---------------------------------------------------------------------------

interface Column {
  header: string
  /** 0 means "the rest of the line", and only the last column may use it. */
  width: number
}

/**
 * One table, header plus rule plus rows.
 *
 * Every row — regardless of what is in it — goes through this function with the same
 * `cols`, which is how the equal-weight guarantee is enforced rather than merely intended.
 */
function renderTable(cols: readonly Column[], rows: readonly string[][]): string[] {
  const prefixWidth = cols
    .slice(0, -1)
    .reduce((sum, c) => sum + c.width + GUTTER.length, 0)
  const lastWidth = MAX_WIDTH - prefixWidth

  const out = [renderRow(cols, cols.map((c) => c.header), prefixWidth, lastWidth)[0]]
  out.push('-'.repeat(Math.min(MAX_WIDTH, prefixWidth + lastWidth)))
  for (const row of rows) out.push(...renderRow(cols, row, prefixWidth, lastWidth))
  return out
}

function renderRow(
  cols: readonly Column[],
  cells: readonly string[],
  prefixWidth: number,
  lastWidth: number,
): string[] {
  const prefix = cols
    .slice(0, -1)
    .map((c, i) => fit(cells[i] ?? '', c.width).padEnd(c.width))
    .join(GUTTER)

  const tail = cells[cols.length - 1] ?? ''
  const chunks = wrapText(tail, lastWidth)
  if (chunks.length === 0) return [prefix]

  return chunks.map((chunk, i) =>
    (i === 0 ? prefix + GUTTER : ' '.repeat(prefixWidth)) + chunk,
  )
}

/** `label  value`, wrapped onto continuation lines aligned under the value. */
function kv(label: string, value: string): string[] {
  return wrapAt(0, label.padEnd(LABEL_WIDTH) + value, LABEL_WIDTH)
}

/**
 * Wrap `text` to the width budget, indenting continuation lines.
 *
 * `hangingIndent` is added to `indent` for every line after the first, so a wrapped label
 * block stays visually one field instead of turning into two.
 */
function wrapAt(indent: number, text: string, hangingIndent = 0): string[] {
  const pad = ' '.repeat(indent)
  const contPad = ' '.repeat(indent + hangingIndent)

  // Returned UNCHANGED when it fits, because wrapText collapses runs of whitespace and the
  // padEnd column alignment in a `label   value` line is made of exactly that whitespace.
  if (text.length <= MAX_WIDTH - indent) return [pad + text]

  const [head, ...rest] = wrapText(text, MAX_WIDTH - indent)
  // Re-wrap the remainder at the narrower continuation width so no line overruns.
  const tail = wrapText(rest.join(' '), MAX_WIDTH - indent - hangingIndent)
  return [pad + head, ...tail.map((line) => contPad + line)]
}

/** Greedy word wrap. A single word longer than the budget is hard-split, never dropped. */
function wrapText(text: string, width: number): string[] {
  if (text.length === 0) return []
  if (width <= 0) return [text]

  const out: string[] = []
  let line = ''

  for (const word of text.split(/\s+/).filter((w) => w.length > 0)) {
    if (line.length === 0) {
      line = word
    } else if (line.length + 1 + word.length <= width) {
      line += ' ' + word
    } else {
      out.push(line)
      line = word
    }
    while (line.length > width) {
      out.push(line.slice(0, width))
      line = line.slice(width)
    }
  }

  if (line.length > 0) out.push(line)
  return out
}

/** Truncate to a fixed column. Only fixed columns truncate; the tail column wraps. */
function fit(value: string, width: number): string {
  if (width <= 0 || value.length <= width) return value
  return width === 1 ? '…' : value.slice(0, width - 1) + '…'
}

function detailFor(finding: Finding): string {
  const parts = [finding.evidence.detail]
  // The engine's notRun helper sets `evidence.detail` and `reason` to the SAME string, so
  // printing both unconditionally renders "gbp station not provided (gbp station not
  // provided)" on every not_run row — which reads as a formatting bug and pushes the real
  // text out of the column.
  if (finding.reason && finding.reason !== finding.evidence.detail) {
    parts.push(`(${finding.reason})`)
  }
  if (typeof finding.evidence.affectedUrls === 'number') {
    parts.push(`[affectedUrls=${finding.evidence.affectedUrls}]`)
  } else if (typeof finding.evidence.value === 'number') {
    parts.push(`[value=${finding.evidence.value}]`)
  }
  return parts.filter(Boolean).join(' ') || EMPTY
}

/**
 * The count line, broken down by status.
 *
 * All four statuses are printed even at zero. "0 not_run" is information; an omitted
 * not_run count is indistinguishable from a report that does not track them.
 */
function countLine(findings: readonly Finding[]): string {
  const order = ['fail', 'degraded', 'pass', 'not_run'] as const
  const counts = order.map((s) => `${findings.filter((f) => f.status === s).length} ${s}`)
  return `${findings.length} findings · ${counts.join(' · ')}`
}

function describeRecording(result: AuditRunResult): string {
  const rec = result.recording
  if (!rec) return EMPTY
  if (!rec.attempted) return `not attempted${rec.skippedReason ? ` (${rec.skippedReason})` : ''}`
  const recorded = rec.recorded.length > 0 ? rec.recorded.join(', ') : '(none)'
  return `attempted · recorded ${recorded}${rec.skippedReason ? ` · ${rec.skippedReason}` : ''}`
}

/** Fixed-precision without trailing zeros, so 4 renders as `4` and not `4.0000`. */
function numStr(n: number): string {
  if (!Number.isFinite(n)) return String(n)
  return String(Number(n.toFixed(4)))
}
