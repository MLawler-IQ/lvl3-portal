// Score one eval case: findings vs the manifest's answer key.
//
// The anti-rot rules live HERE, not in the test, so no future test rewrite can
// soften them by accident:
//
//   - A must_find whose check is not_run or degraded is a FAILURE, never an
//     exclusion. Recall computed over "checks that happened to run" reads 100%
//     with a third of the pipeline dead — the denominator must not shrink.
//   - A must_not_find must have RUN and not fired (pass or degraded). A not_run
//     silently satisfies "didn't fire", which would let a broken false-positive
//     guard look safe without ever being exercised.
//   - Magnitudes are asserted, not just IDs. An ingester truncating the crawl to
//     10 URLs still "finds" the H1 check; only the magnitude band catches it.

import type { Finding } from '@/lib/findings/types'
import type { EvalManifest, MustFindEntry } from './manifest'

export type FailureKind =
  | 'must-find-missed' // check ran and did not fire
  | 'must-find-not-run' // check could not run — distinct on purpose
  | 'must-find-degraded'
  | 'magnitude' // fired, but the wrong size
  | 'forbidden-finding' // a must_not_find fired
  | 'must-not-find-not-run' // the FP guard was never exercised
  | 'must-pass-failed'
  | 'finding-absent' // no finding at all for a referenced check
  | 'duplicate-finding' // two findings share a checkId; byId would keep the last

export interface CaseFailure {
  kind: FailureKind
  checkId: string
  detail: string
}

export interface CaseResult {
  caseName: string
  pass: boolean
  failures: CaseFailure[]
  /** must_find entries fully satisfied / total. The gate requires all. */
  recall: { satisfied: number; total: number }
}

function magnitudeFailure(entry: MustFindEntry, finding: Finding): CaseFailure | null {
  if (!entry.magnitude) return null
  const { metric, expected, tolerancePct } = entry.magnitude
  const actual = finding.evidence[metric]
  if (actual === undefined) {
    return {
      kind: 'magnitude',
      checkId: entry.id,
      detail: `expected evidence.${metric} ≈ ${expected}, but the finding carries no ${metric}`,
    }
  }
  // Positive assertion, so NaN/Infinity fail closed — `NaN < x` is false in both
  // directions, and the negative form scored a NaN magnitude as satisfied.
  const band = Math.abs((expected * tolerancePct) / 100)
  const within = Number.isFinite(actual) && actual >= expected - band && actual <= expected + band
  if (!within) {
    return {
      kind: 'magnitude',
      checkId: entry.id,
      detail: `evidence.${metric} = ${actual}, expected ${expected} ±${tolerancePct}%`,
    }
  }
  return null
}

export function scoreCase(manifest: EvalManifest, findings: Finding[]): CaseResult {
  const byId = new Map(findings.map((f) => [f.checkId, f]))
  const failures: CaseFailure[] = []
  let satisfied = 0

  // byId keeps the LAST finding per id, so a duplicated id could let a benign
  // duplicate shadow a real fail. Duplicates are a scored failure, not a silent
  // last-wins.
  const seen = new Set<string>()
  for (const f of findings) {
    if (seen.has(f.checkId)) {
      failures.push({
        kind: 'duplicate-finding',
        checkId: f.checkId,
        detail: 'two findings share this checkId; the run is ambiguous',
      })
    }
    seen.add(f.checkId)
  }

  for (const entry of manifest.must_find) {
    const finding = byId.get(entry.id)
    if (!finding) {
      failures.push({
        kind: 'finding-absent',
        checkId: entry.id,
        detail: 'no finding produced at all',
      })
      continue
    }
    if (finding.status === 'not_run') {
      failures.push({
        kind: 'must-find-not-run',
        checkId: entry.id,
        detail: `could not run: ${finding.reason ?? 'no reason recorded'} — not_run is a failure, never an exclusion`,
      })
      continue
    }
    if (finding.status === 'degraded') {
      failures.push({
        kind: 'must-find-degraded',
        checkId: entry.id,
        detail: 'ran on partial data; the eval requires a clean run',
      })
      continue
    }
    if (finding.status !== 'fail') {
      failures.push({
        kind: 'must-find-missed',
        checkId: entry.id,
        detail: `expected the defect to be found; check reported ${finding.status}`,
      })
      continue
    }
    const mag = magnitudeFailure(entry, finding)
    if (mag) {
      failures.push(mag)
      continue
    }
    satisfied += 1
  }

  for (const id of manifest.must_not_find) {
    const finding = byId.get(id)
    if (!finding) {
      failures.push({ kind: 'finding-absent', checkId: id, detail: 'no finding produced at all' })
      continue
    }
    if (finding.status === 'fail') {
      failures.push({
        kind: 'forbidden-finding',
        checkId: id,
        detail: `fired on data where it must not: ${finding.evidence.detail}`,
      })
    } else if (finding.status === 'not_run') {
      failures.push({
        kind: 'must-not-find-not-run',
        checkId: id,
        detail: 'the false-positive guard was never exercised — not_run does not count as "did not fire"',
      })
    }
  }

  for (const id of manifest.must_pass) {
    const finding = byId.get(id)
    if (!finding) {
      failures.push({ kind: 'finding-absent', checkId: id, detail: 'no finding produced at all' })
      continue
    }
    if (finding.status !== 'pass') {
      failures.push({
        kind: 'must-pass-failed',
        checkId: id,
        detail: `expected pass, got ${finding.status}${finding.reason ? ` (${finding.reason})` : ''}`,
      })
    }
  }

  return {
    caseName: manifest.case,
    pass: failures.length === 0,
    failures,
    recall: { satisfied, total: manifest.must_find.length },
  }
}
