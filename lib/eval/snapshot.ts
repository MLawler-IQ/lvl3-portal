// The scoring snapshot gate.
//
// WHY THIS EXISTS. The adversarial critique of slice 1 landed a hit: the harness
// "does not actually gate scoring changes". Fixtures assert that a finding is
// PRESENT. Validators assert that it is TRACEABLE. Nothing asserted a score or a
// rank — so a change that halved every impact number, or inverted the priority
// order, would have passed every existing layer green.
//
// WHAT IT GATES, and the reasoning behind each rule:
//
//   1. TOP-K SET MEMBERSHIP, severity-weighted and ORDER-FREE. Exact-order
//      matching would fail a genuinely better scoring model for swapping two
//      adjacent items — and a gate that punishes improvement gets deleted. So the
//      set is the assertion; the severity weighting is how the failure message
//      conveys whether what fell out was a critical or a nice-to-have.
//   2. EVERY CRITICAL-SEVERITY FINDING IN STATE `fail` MUST BE IN THE TOP-K SET.
//      Twelve of the rubric's 70 active checks are critical, but only THREE of the
//      twelve have a detector, so at most three can ever be scored against a topK
//      of 5. That — not the count — is what makes this cheap to hold, and the day a
//      fourth critical detector is registered the rule needs re-checking rather than
//      re-baselining (tests/unit/scoring.test.ts pins the reachable set for exactly
//      that reason). It is the rule that catches "the model reordered everything and
//      buried the emergency" — the failure the set gate alone would miss.
//      and it is the rule that catches "the model reordered everything and buried
//      the emergency" — the failure the set gate alone would miss.
//   3. IMPACT AND PRIORITY VALUE STABILITY inside a tolerance band, so halving
//      every number is caught even when the ordering survives untouched.
//   4. NO SILENT SELF-HEALING. The comparator never writes. Re-baselining a
//      snapshot is a separate, explicit call, gated on EVAL_SNAPSHOT_UPDATE=1.
//
// A DIFF TO A SNAPSHOT FILE IS A REVIEWABLE EVENT, NEVER AN AUTOMATIC OVERWRITE.
// If a scoring change is an improvement, the right sequence is: make the change,
// watch this gate go red, run the updater deliberately, and put the snapshot diff
// in front of a human alongside the code diff. The numbers in that diff are the
// numbers a client will be told. If this file ever grows a code path that
// regenerates a snapshot during an ordinary test run, the gate is gone and only
// the ceremony is left.

import { readFileSync, writeFileSync } from 'node:fs'
import type { Finding } from '@/lib/findings/types'
import {
  SCORING_CONFIG,
  type EffortTier,
  type ImpactBasis,
  type PriorityBand,
  type ScoringConfig,
  type Severity,
} from '@/lib/scoring/config'
import type { ScoringResult } from '@/lib/scoring/types'

/**
 * One row of the snapshotted plan.
 *
 * `terms` is the persisted score input, carried into the snapshot and asserted
 * EXACTLY. That is deliberate: it is what makes a snapshot diff self-explaining —
 * a reviewer sees which input moved, not merely that a total did — and it catches
 * semantic drift that leaves the total intact (the earning-URL bonus flipping off
 * while a basis weight moves to compensate, say).
 *
 * `formula`, `notes` and `detail` are prose and are NOT asserted. Gating on
 * wording is the brittleness that gets a gate deleted; they are here so the diff
 * reads like an explanation.
 */
export interface SnapshotItem {
  rank: number
  checkId: string
  severity: Severity
  category: string
  effort: EffortTier
  effortWeight: number
  basis: ImpactBasis
  rawImpact: number
  impact: number
  priorityScore: number
  band: PriorityBand
  formula: string
  terms: Record<string, number>
  notes: string[]
  detail: string
}

export interface SnapshotTail {
  checkId: string
  rank: number
  priorityScore: number
}

export interface ScoringSnapshot {
  case: string
  /** SCORING_CONFIG.version at the time the snapshot was taken. A change here
   *  fails the gate by design — see requirement 4 above. */
  configVersion: string
  topK: number
  tolerancePct: number
  /** Status counts across ALL findings, so a regression that turns fails into
   *  not_run produces a shorter plan AND a visibly different set of totals. */
  totals: {
    findings: number
    scored: number
    pass: number
    degraded: number
    notRun: number
  }
  /** Critical-severity findings in state `fail`. Sorted. Rule 2's input. */
  criticalFails: string[]
  /** The top-K plan, in rank order for readability. Compared order-free. */
  topKItems: SnapshotItem[]
  /** Scored items beyond the top-K: set membership only, so a better model is
   *  free to reshuffle the tail without a re-baseline. */
  beyondTopK: SnapshotTail[]
}

export type SnapshotFailureKind =
  | 'config-version-changed'
  | 'topk-membership-lost'
  | 'topk-membership-added'
  | 'topk-size-changed'
  | 'critical-not-in-topk'
  | 'critical-fail-set-changed'
  | 'impact-drift'
  | 'priority-drift'
  | 'band-changed'
  | 'basis-changed'
  | 'terms-changed'
  | 'rubric-attribute-changed'
  | 'tail-membership-changed'
  | 'totals-changed'

export interface SnapshotFailure {
  kind: SnapshotFailureKind
  checkId: string
  detail: string
}

export interface SnapshotComparison {
  pass: boolean
  failures: SnapshotFailure[]
  /** Sum of severity weights for expected top-K items that went missing. Zero on
   *  a pass. Reported so the failure text can say how bad the loss was. */
  severityWeightedLoss: number
}

function round4(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.round(value * 1e4) / 1e4
}

function sortIds(ids: Iterable<string>): string[] {
  return Array.from(ids).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
}

/** Rebuild a record with its keys in sorted order, for byte-stable output. */
function sortKeys(terms: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {}
  for (const key of sortIds(Object.keys(terms))) out[key] = terms[key]
  return out
}

/**
 * Build the snapshot for one case.
 *
 * Pure and deterministic: identical `findings` + `scored` in produce a
 * byte-identical `serializeSnapshot` out. No clock, no randomness, and every
 * collection is emitted in a sorted or rank order rather than an insertion one.
 */
export function buildSnapshot(
  caseName: string,
  findings: Finding[],
  scored: ScoringResult,
  config: ScoringConfig = SCORING_CONFIG,
): ScoringSnapshot {
  const criticalFails = sortIds(
    scored.items.filter((i) => i.severity === 'critical').map((i) => i.checkId),
  )

  const topKItems: SnapshotItem[] = scored.items.slice(0, config.topK).map((item) => ({
    rank: item.rank,
    checkId: item.checkId,
    severity: item.severity,
    category: item.category,
    effort: item.effort,
    effortWeight: item.effortWeight,
    basis: item.basis,
    rawImpact: round4(item.inputs.rawImpact),
    impact: round4(item.impact),
    priorityScore: round4(item.priorityScore),
    band: item.band,
    formula: item.inputs.formula,
    // Sorted keys: `terms` is compared as JSON, so its key order must not depend
    // on the order the scorer happened to insert them in.
    terms: sortKeys(item.inputs.terms),
    notes: item.inputs.notes,
    detail: item.evidenceDetail,
  }))

  const beyondTopK: SnapshotTail[] = scored.items.slice(config.topK).map((item) => ({
    checkId: item.checkId,
    rank: item.rank,
    priorityScore: round4(item.priorityScore),
  }))

  return {
    case: caseName,
    configVersion: scored.configVersion,
    topK: config.topK,
    tolerancePct: config.snapshotTolerancePct,
    totals: {
      findings: findings.length,
      scored: scored.items.length,
      pass: findings.filter((f) => f.status === 'pass').length,
      degraded: findings.filter((f) => f.status === 'degraded').length,
      notRun: findings.filter((f) => f.status === 'not_run').length,
    },
    criticalFails,
    topKItems,
    beyondTopK,
  }
}

/** Canonical JSON for a snapshot file: 2-space indent, trailing newline. Key
 *  order is the construction order in buildSnapshot, which is fixed. */
export function serializeSnapshot(snapshot: ScoringSnapshot): string {
  return `${JSON.stringify(snapshot, null, 2)}\n`
}

export function readSnapshot(path: string): ScoringSnapshot {
  return JSON.parse(readFileSync(path, 'utf8')) as ScoringSnapshot
}

/**
 * THE ONLY function in this module that writes. Call it from a deliberate
 * re-baseline step, never from a comparison path.
 */
export function writeSnapshot(path: string, snapshot: ScoringSnapshot): void {
  writeFileSync(path, serializeSnapshot(snapshot), 'utf8')
}

/** Just enough of the environment for the one variable this module reads, so a
 *  test can pass a literal without constructing a whole NodeJS.ProcessEnv. */
export type SnapshotEnv = Record<string, string | undefined>

/** True only when the operator asked for a re-baseline: EVAL_SNAPSHOT_UPDATE=1. */
export function snapshotUpdateRequested(env: SnapshotEnv = process.env): boolean {
  return env.EVAL_SNAPSHOT_UPDATE === '1'
}

/**
 * The re-baseline entry point.
 *
 * Writes ONLY when EVAL_SNAPSHOT_UPDATE=1. Returns what it did so a caller can
 * report it rather than guess. Deliberately not called by `compareSnapshot`:
 * keeping the write behind a second, explicitly-named function is what stops a
 * future "just make the test green" edit from turning the gate into a rubber
 * stamp with one extra argument.
 */
export function updateSnapshotIfRequested(
  path: string,
  snapshot: ScoringSnapshot,
  env: SnapshotEnv = process.env,
): 'written' | 'not-requested' {
  if (!snapshotUpdateRequested(env)) return 'not-requested'
  writeSnapshot(path, snapshot)
  return 'written'
}

function withinTolerance(expected: number, actual: number, tolerancePct: number): boolean {
  if (!Number.isFinite(actual)) return false
  const band = Math.abs((expected * tolerancePct) / 100)
  // A zero expectation gets an absolute epsilon rather than a zero-width band,
  // so float noise on a genuinely-zero impact is not a failure while a real move
  // off zero still is.
  const floor = expected === 0 ? 1e-6 : 0
  return actual >= expected - band - floor && actual <= expected + band + floor
}

/**
 * Compare a stored snapshot against a freshly computed one.
 *
 * NEVER writes, never mutates its inputs, and returns every failure it finds
 * rather than the first — a scoring change usually breaks several rules at once
 * and seeing all of them is what makes the diff reviewable.
 */
export function compareSnapshot(
  expected: ScoringSnapshot,
  actual: ScoringSnapshot,
  config: ScoringConfig = SCORING_CONFIG,
): SnapshotComparison {
  const failures: SnapshotFailure[] = []
  const tolerancePct = expected.tolerancePct ?? config.snapshotTolerancePct

  if (expected.configVersion !== actual.configVersion) {
    failures.push({
      kind: 'config-version-changed',
      checkId: '-',
      detail: `scoring config version moved ${expected.configVersion} -> ${actual.configVersion}; re-baseline the snapshot deliberately and review the numbers in the diff`,
    })
  }

  if (expected.topK !== actual.topK) {
    failures.push({
      kind: 'topk-size-changed',
      checkId: '-',
      detail: `topK moved ${expected.topK} -> ${actual.topK}; the gate's own scope changed`,
    })
  }

  // ── Rule 1: order-free, severity-weighted top-K set membership ──────────────
  const expectedById = new Map(expected.topKItems.map((i) => [i.checkId, i]))
  const actualById = new Map(actual.topKItems.map((i) => [i.checkId, i]))
  let severityWeightedLoss = 0

  for (const item of expected.topKItems) {
    if (!actualById.has(item.checkId)) {
      const weight = config.severityWeights[item.severity] ?? 0
      severityWeightedLoss += weight
      failures.push({
        kind: 'topk-membership-lost',
        checkId: item.checkId,
        detail: `was rank ${item.rank} in the top-${expected.topK} (${item.severity}, severity weight ${weight}) and is no longer in it`,
      })
    }
  }
  for (const item of actual.topKItems) {
    if (!expectedById.has(item.checkId)) {
      failures.push({
        kind: 'topk-membership-added',
        checkId: item.checkId,
        detail: `entered the top-${actual.topK} at rank ${item.rank} (priority ${item.priorityScore}) and was not in the snapshot`,
      })
    }
  }

  // ── Rule 2: no critical fail may sit outside the top-K ──────────────────────
  const actualTopKIds = new Set(actual.topKItems.map((i) => i.checkId))
  for (const checkId of actual.criticalFails) {
    if (!actualTopKIds.has(checkId)) {
      failures.push({
        kind: 'critical-not-in-topk',
        checkId,
        detail: `is a critical-severity finding in state fail but ranks outside the top-${actual.topK} — the emergency got buried`,
      })
    }
  }
  const expectedCritical = sortIds(expected.criticalFails).join(',')
  const actualCritical = sortIds(actual.criticalFails).join(',')
  if (expectedCritical !== actualCritical) {
    failures.push({
      kind: 'critical-fail-set-changed',
      checkId: '-',
      detail: `critical fails changed: [${expectedCritical}] -> [${actualCritical}]`,
    })
  }

  // ── Rule 3: value stability, plus the categorical attributes ────────────────
  for (const item of expected.topKItems) {
    const found = actualById.get(item.checkId)
    if (!found) continue // already reported as a membership loss
    if (!withinTolerance(item.impact, found.impact, tolerancePct)) {
      failures.push({
        kind: 'impact-drift',
        checkId: item.checkId,
        detail: `impact ${found.impact}, snapshot ${item.impact} (±${tolerancePct}%)`,
      })
    }
    if (!withinTolerance(item.priorityScore, found.priorityScore, tolerancePct)) {
      failures.push({
        kind: 'priority-drift',
        checkId: item.checkId,
        detail: `priorityScore ${found.priorityScore}, snapshot ${item.priorityScore} (±${tolerancePct}%)`,
      })
    }
    if (item.band !== found.band) {
      failures.push({
        kind: 'band-changed',
        checkId: item.checkId,
        detail: `priority band ${item.band} -> ${found.band}`,
      })
    }
    const expectedTerms = JSON.stringify(sortKeys(item.terms ?? {}))
    const actualTerms = JSON.stringify(sortKeys(found.terms ?? {}))
    if (expectedTerms !== actualTerms) {
      failures.push({
        kind: 'terms-changed',
        checkId: item.checkId,
        detail: `persisted score inputs changed: ${expectedTerms} -> ${actualTerms}`,
      })
    }
    if (item.basis !== found.basis) {
      failures.push({
        kind: 'basis-changed',
        checkId: item.checkId,
        detail: `impact basis ${item.basis} -> ${found.basis}; the recommendation type itself was reclassified`,
      })
    }
    if (
      item.severity !== found.severity ||
      item.effort !== found.effort ||
      item.effortWeight !== found.effortWeight
    ) {
      failures.push({
        kind: 'rubric-attribute-changed',
        checkId: item.checkId,
        detail: `severity/effort moved ${item.severity}/${item.effort}(${item.effortWeight}) -> ${found.severity}/${found.effort}(${found.effortWeight}); the rubric or the effort lookup changed`,
      })
    }
  }

  // ── The tail: set membership only ───────────────────────────────────────────
  const expectedTail = sortIds(expected.beyondTopK.map((t) => t.checkId)).join(',')
  const actualTail = sortIds(actual.beyondTopK.map((t) => t.checkId)).join(',')
  if (expectedTail !== actualTail) {
    failures.push({
      kind: 'tail-membership-changed',
      checkId: '-',
      detail: `scored items beyond the top-${actual.topK} changed: [${expectedTail}] -> [${actualTail}]`,
    })
  }

  // ── Totals: integers, no tolerance. A plan that shrank because checks stopped
  //    running must not read as a plan that got shorter because the site improved.
  const totalKeys = ['findings', 'scored', 'pass', 'degraded', 'notRun'] as const
  for (const key of totalKeys) {
    if (expected.totals[key] !== actual.totals[key]) {
      failures.push({
        kind: 'totals-changed',
        checkId: '-',
        detail: `totals.${key} moved ${expected.totals[key]} -> ${actual.totals[key]}`,
      })
    }
  }

  return { pass: failures.length === 0, failures, severityWeightedLoss }
}
