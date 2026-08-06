// The check engine: station gating in ONE place, so no individual check can get
// the not_run rules wrong.
//
// Rules, in order:
//   1. A required station that is absent or failed → not_run, naming the station.
//   2. A required station that is ok but EMPTY → not_run for EVERY check. Zero
//      rows can no more prove "no missing H1s" than "no cannibalisation" — an
//      empty input never supports any verdict, only "we couldn't look". (An
//      earlier design distinguished absence-type checks here; the verifiers
//      rightly pointed out the uniform rule is both stricter and simpler, and a
//      comment promising a laxer rule invites someone to implement it.)
//   3. A required station that is ok but degraded → the check runs, and its
//      finding is capped at degraded — partial data can support "we found X"
//      but never a clean bill of health.
//   4. Only then does the check's own evaluate() run.

import type {
  CheckDefinition,
  Finding,
  StationBundle,
  StationName,
} from './types'

/** How the engine sees one station's usability. */
type StationState =
  | { kind: 'missing' }
  | { kind: 'failed'; error: string }
  | { kind: 'empty' }
  | { kind: 'degraded' }
  | { kind: 'ok' }

function stationState(bundle: StationBundle, name: StationName): StationState {
  const result = bundle[name]
  if (!result) return { kind: 'missing' }
  if (!result.ok) return { kind: 'failed', error: result.error }
  const data = result.data as unknown
  const empty =
    data == null ||
    (Array.isArray(data) && data.length === 0) ||
    (name === 'crawl' &&
      typeof data === 'object' &&
      Array.isArray((data as { pages?: unknown[] }).pages) &&
      (data as { pages: unknown[] }).pages.length === 0)
  if (empty) return { kind: 'empty' }
  if (result.degraded) return { kind: 'degraded' }
  return { kind: 'ok' }
}

/** Run every registered check against a station bundle. Never throws. */
export function runChecks(checks: CheckDefinition[], stations: StationBundle): Finding[] {
  return checks.map((check) => runOne(check, stations))
}

function runOne(check: CheckDefinition, stations: StationBundle): Finding {
  let sawDegraded = false

  for (const name of check.requires) {
    const state = stationState(stations, name)
    switch (state.kind) {
      case 'missing':
        return notRun(check, `${name} station not provided`)
      case 'failed':
        return notRun(check, `${name} station failed: ${state.error}`)
      case 'empty':
        // The single most important line in the engine. An empty station must
        // never green-light an absence-type check (§17 failure mode #1).
        return notRun(check, `${name} station returned no data — cannot distinguish "clean" from "unseen"`)
      case 'degraded':
        sawDegraded = true
        break
      case 'ok':
        break
    }
  }

  let finding: Finding
  try {
    finding = check.evaluate(stations)
  } catch (err) {
    // A crashing check is a not_run with a reason, never a silent gap and never
    // a run-aborting throw.
    return notRun(check, `check crashed: ${err instanceof Error ? err.message : String(err)}`)
  }

  // Partial input caps the ceiling: a pass on degraded data is only ever
  // "degraded" — the defect may be in the part we didn't see.
  if (sawDegraded && finding.status === 'pass') {
    return {
      ...finding,
      status: 'degraded',
      reason: 'evaluated on partial station data; a clean result is not conclusive',
    }
  }

  return finding
}

function notRun(check: CheckDefinition, reason: string): Finding {
  return {
    checkId: check.id,
    status: 'not_run',
    evidence: { detail: reason },
    source: 'derived',
    reason,
  }
}
