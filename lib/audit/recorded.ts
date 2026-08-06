// Diff a real run against fixtures/ingest/recorded-real-export.json.
//
// WHY THIS EXISTS. The real 206-URL tornadohvacca.com export is client data and is not
// committed, so CI can never reproduce its figures. The one thing that CAN be mechanised is
// Matt's own run against it: `scripts/audit-dry-run.ts --compare` feeds the parsed record
// and the run result in here and exits on the verdict, so the slice-2 numeric gate is
// machine-checked instead of eyeballed off a terminal. Eyeballing 12 figures is how one of
// them stays wrong.
//
// PURE, and no IO: the caller reads and parses the file. That is what lets a unit test build
// a synthetic record with a deliberate mismatch and assert the row-level verdict, which is
// the only way to know the comparison can fail at all.
//
// THE RULE THAT MATTERS. A figure the run could not produce is `actual: null, pass: false`
// — never dropped from the rows. If unproducible figures were skipped, a run that measured
// NOTHING would compare clean: zero rows, zero mismatches, exit 0. That inversion is
// AUTOMATION-CONTEXT.md §17's silently-incomplete audit wearing a test harness's clothes.

import type { AuditRunResult } from '@/lib/orchestrator/types'
import type { Finding, FindingStatus } from '@/lib/findings/types'

/**
 * The record's shape, written out rather than inferred from `typeof import(json)`.
 *
 * TWO REASONS. (1) The JSON's `checks` entries are heterogeneous — TECH-001 has no
 * `affected` because it is `not_run` — so the inferred type is a per-key literal object that
 * cannot be indexed by an arbitrary check id, and `Object.entries` over it yields a union
 * this code would have to narrow field by field. (2) The dry-run script reads the file at
 * runtime through `JSON.parse`, where the compile-time literal type does not apply anyway.
 * An explicit interface serves both callers with one shape.
 */
export interface RecordedCheck {
  status: FindingStatus | string
  /** Present only where a magnitude was recorded; TECH-001's not_run has none. */
  affected?: number
  measured?: number
  why?: string
}

export interface RecordedExport {
  urls: number
  zeroH1Pages?: number
  untaggedPages?: number
  pagesWithMeasuredWords?: number
  unmeasured: Record<string, number>
  checks: Record<string, RecordedCheck>
}

export interface RecordedComparisonRow {
  figure: string
  recorded: number | string
  actual: number | string | null
  pass: boolean
}

/**
 * The unmeasured signals compared by name, in a fixed order.
 *
 * Hand-listed so the comparison is stable and so a run that stopped emitting a signal
 * produces `actual: null` for it rather than one fewer row. Iterating the record's own keys
 * would do the same thing here, but this list also fixes the ORDER of the report table,
 * which matters because two runs of the same export must render byte-identically.
 */
const UNMEASURED_FIGURES = [
  'internalLinksOut',
  'hasViewportMeta',
  'tapTargetsOk',
  'canonical',
] as const

export function compareRecorded(
  result: AuditRunResult,
  record: RecordedExport,
): RecordedComparisonRow[] {
  const rows: RecordedComparisonRow[] = []

  rows.push(numRow('coverage.urls', record.urls, result.coverage?.urls ?? null))

  for (const signal of UNMEASURED_FIGURES) {
    const recorded = record.unmeasured?.[signal]
    // A signal absent from the RECORD is not a figure at all — there is nothing to compare
    // against. A signal absent from the RUN is a failure, handled by numRow's null branch.
    if (typeof recorded !== 'number') continue
    rows.push(
      numRow(
        `coverage.unmeasured.${signal}`,
        recorded,
        result.coverage?.unmeasured?.[signal] ?? null,
      ),
    )
  }

  const findings = new Map<string, Finding>()
  for (const finding of result.findings ?? []) findings.set(finding.checkId, finding)

  // Driven by the record's keys, sorted, so adding a check to the JSON adds a compared
  // figure with no code change — and so a check REMOVED from the record cannot silently
  // keep passing against a stale literal in here.
  for (const checkId of Object.keys(record.checks ?? {}).sort()) {
    const entry = record.checks[checkId]
    const finding = findings.get(checkId)

    rows.push(strRow(`${checkId}.status`, entry.status, finding?.status ?? null))

    if (typeof entry.affected === 'number') {
      rows.push(
        numRow(`${checkId}.affected`, entry.affected, finding?.evidence?.affectedUrls ?? null),
      )
    }
  }

  return rows
}

/**
 * 0 when every figure matched, 2 otherwise.
 *
 * 2 rather than 1 so a mismatch is distinguishable from the script throwing, and so a shell
 * `if` cannot conflate "the pipeline is broken" with "the pipeline disagrees with the
 * record". An EMPTY row list exits 2: no figures compared means the comparison did not run,
 * and reporting that as success is the same inversion the null rule above prevents.
 */
export function comparisonExitCode(rows: readonly RecordedComparisonRow[]): 0 | 2 {
  if (rows.length === 0) return 2
  return rows.every((row) => row.pass) ? 0 : 2
}

function numRow(figure: string, recorded: number, actual: number | null): RecordedComparisonRow {
  return { figure, recorded, actual, pass: actual !== null && actual === recorded }
}

function strRow(figure: string, recorded: string, actual: string | null): RecordedComparisonRow {
  return { figure, recorded, actual, pass: actual !== null && actual === recorded }
}
