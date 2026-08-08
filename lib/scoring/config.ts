// Scoring configuration. EVERY number the scorer uses that is not read from data
// or from docs/rubric/rubric.json lives here, in one reviewable place.
//
// Why config and not constants inlined at the call site: the CTR curve and the
// cross-basis weights are the things a calibration loop will fit against real
// outcomes later. If they are scattered through the scorer, "recalibrate" becomes
// a refactor instead of a diff. And because lib/eval/snapshot.ts records
// SCORING_CONFIG.version into every snapshot, a change here is a reviewable event
// rather than a silent shift in every client's priority order.
//
// PROVENANCE NOTE, read this before trusting the magic numbers.
//
// This module was written while docs/AUTOMATION-CONTEXT.md was missing from the
// repo — it had only ever existed as a chat attachment, which is itself the bug
// that let a substituted CTR curve reach a commit. The spec is now committed, and
// these numbers were reconciled against it on 2026-08-06:
//
//   CTR curve       positions 1-10 are now §11 VERBATIM (0.22 at position 1; the
//                   substitute had 0.18, which under-forecast every opportunity).
//                   Positions 20/50/100 extend past §11's table and are ours.
//   Effort weights  §11 verbatim: low 1, medium 2.5, high 5.
//   Severity weights §11 names the term, states no values. Ours.
//   Basis weights   Not in §11 at all. Ours, and the calibration loop's job.
//
// Every remaining number that is ours says so at its definition. Because
// lib/eval/snapshot.ts records SCORING_CONFIG.version into every snapshot, a
// change here is a reviewable event rather than a silent shift in every client's
// priority order.

/** One point on the CTR curve: the expected CTR at or above this position. */
export interface CtrCurvePoint {
  /** Upper bound of the band, inclusive. */
  position: number
  /** Expected click-through rate as a fraction, not a percentage. */
  ctr: number
}

/**
 * RECONCILED against docs/AUTOMATION-CONTEXT.md §11 (2026-08-06).
 *
 * These are now §11's stated values verbatim for positions 1-10. The file was
 * missing from the repo when this module was written, so positions 1-10 held
 * conservative substitutes (0.18 at position 1 where the spec says 0.22). The
 * spec has since been committed to docs/ and the curve corrected.
 *
 * Positions 20/50/100 are NOT in §11 — the spec's table stops at 10. They remain
 * a documented tail extension, needed because GSC average position is routinely
 * in the 20s (Tornado's site-wide average was 25.8).
 *
 * Deliberately BELOW published position-CTR averages (which put position 1 near
 * 27-32%). Two reasons, both structural to the accounts this pipeline serves:
 *
 *   1. Local SERPs put a map pack, and often a paid block, above the first
 *      organic result. "Position 1 organic" is frequently the fourth thing on
 *      the page.
 *   2. AI Overviews now trigger on roughly half of tracked queries and cut
 *      position-1 CTR substantially where they appear.
 *
 * Being low is the safe direction: impact numbers go into client-facing
 * recommendations, and a forecast that under-promises and over-delivers is
 * survivable. The reverse is not.
 *
 * Read with `ctrAt()`: STEPWISE, no interpolation, and a fractional position
 * resolves to the FIRST band whose upper bound is >= it — so 10.5 gets the
 * position-20 band's CTR, not the position-10 one. Rounding down inside a band
 * keeps the conservative bias.
 */
export const LOCAL_CTR_CURVE: readonly CtrCurvePoint[] = Object.freeze([
  // §11 verbatim, positions 1-10.
  { position: 1, ctr: 0.22 },
  { position: 2, ctr: 0.13 },
  { position: 3, ctr: 0.09 },
  { position: 4, ctr: 0.07 },
  { position: 5, ctr: 0.055 },
  { position: 6, ctr: 0.045 },
  { position: 7, ctr: 0.037 },
  { position: 8, ctr: 0.03 },
  { position: 9, ctr: 0.026 },
  { position: 10, ctr: 0.022 },
  // Tail extension — beyond §11's table. See the note above.
  { position: 20, ctr: 0.006 },
  { position: 50, ctr: 0.002 },
  { position: 100, ctr: 0.0005 },
])

export type Severity = 'critical' | 'high' | 'medium' | 'low'
export type EffortTier = 'low' | 'medium' | 'high'

/**
 * Effort weights. From the brief (§11): low 1, medium 2.5, high 5.
 *
 * These are DIVISORS — ranking is impact / effortWeight — so the ladder encodes
 * "a high-effort fix has to be five times the impact of a low-effort one to be
 * worked first". Which tier a check sits in is never decided here: it is read
 * from `effort` in docs/rubric/rubric.json.
 */
export const EFFORT_WEIGHTS: Readonly<Record<EffortTier, number>> = Object.freeze({
  low: 1,
  medium: 2.5,
  high: 5,
})

/**
 * OURS BY NECESSITY — §11 names `severity_weight` in the template-fix formula but
 * states no values for it, so there is nothing to reconcile against. Checked
 * against the committed spec on 2026-08-06.
 *
 * A four-rung ladder matching the rubric's four severity values, spaced so that
 * one critical outweighs three mediums rather than merely edging them out.
 * Severity comes from the rubric (§7: "weighted by revenue impact for a local
 * service business, not by audit convention"); only the weight attached to it is
 * ours, and it is a calibration-loop target like BASIS_WEIGHTS.
 */
export const SEVERITY_WEIGHTS: Readonly<Record<Severity, number>> = Object.freeze({
  critical: 10,
  high: 6,
  medium: 3,
  low: 1,
})

/**
 * Category weights, used by the local/GBP impact basis (§11: "local/GBP
 * weighted by category weight").
 *
 * Ordered by proximity to a booked job for a home-services business: a local
 * defect costs map-pack calls today, an authority defect costs rankings in a
 * quarter.
 */
export const CATEGORY_WEIGHTS: Readonly<Record<string, number>> = Object.freeze({
  local: 1.4,
  cro: 1.3,
  measurement: 1.3,
  technical: 1.2,
  geo: 1.1,
  onpage: 1.0,
  authority: 0.8,
})

/** Fallback for a rubric category not listed above — never silently 0. */
export const DEFAULT_CATEGORY_WEIGHT = 1.0

export type ImpactBasis =
  | 'stuck_keyword'
  | 'template_fix'
  | 'consolidation'
  | 'measurement_gap'
  | 'local_visibility'

/**
 * Cross-basis calibration: raw-formula units -> estimated incremental monthly
 * clicks ("click-equivalents").
 *
 * This exists because §11's impact bases do not share a unit. `impressions x CTR
 * delta` is already clicks; `affected_url_count x severity_weight` is not;
 * `summed impressions x competing URL count` is impressions-times-URLs. Ranking
 * across bases therefore needs exactly one conversion constant per basis, and it
 * belongs in config where it can be fitted, not buried in the formula.
 *
 * The §11 formulas are preserved verbatim as `rawImpact` and persisted with
 * their terms; these weights are applied afterwards and persisted too. THE
 * CALIBRATION LOOP'S JOB IS THIS OBJECT. Current values are reasoned estimates,
 * not fitted ones:
 *
 *   stuck_keyword     1      already clicks; no conversion needed.
 *   consolidation     0.01   a 4-URL / 860-impression cluster -> ~34 clicks,
 *                            i.e. assumes consolidation buys ~4 points of CTR.
 *   template_fix      0.05   191 pages x high(6) -> ~57 clicks, ~0.3/page/month.
 *   measurement_gap   0.1    with the fixed weight below, 100 click-equivalents.
 *   local_visibility  3      8 mis-targeted location pages x local(1.4) -> ~34.
 */
export const BASIS_WEIGHTS: Readonly<Record<ImpactBasis, number>> = Object.freeze({
  stuck_keyword: 1,
  consolidation: 0.01,
  template_fix: 0.05,
  measurement_gap: 0.1,
  local_visibility: 3,
})

export interface ScoringConfig {
  /**
   * Bumped by hand whenever any value in this file changes. Snapshots record it,
   * and the snapshot comparator treats a version change as a failure — which is
   * the point: it forces the deliberate re-baseline instead of letting numbers
   * drift under an unchanged snapshot.
   *
   * WIDENED 2026-08-07: it also covers the scoring inputs that live OUTSIDE this
   * file — all of them, enumerated, because an enumeration is what people read and
   * a short one invites the next author to assume their input is exempt:
   *
   *   - `severity` and `effort` per row in docs/rubric/rubric.json. The re-cut moved
   *     ONPAGE-003 from `high` to `low` and divided its impact by six.
   *   - `category` in the same file, which is the strongest of the three: it selects
   *     the categoryWeight AND, with no explicit BASIS_RULES entry, `derivedRule()`
   *     picks the impact BASIS from it — a different formula, not a different weight.
   *   - `BASIS_RULES` in lib/scoring/score.ts, which maps check id to basis.
   *
   * `audit_runs.config_version` exists so a stored number can be explained later; if
   * one version string can describe two different rubrics, it cannot do that. The
   * rule is "any input to a score", and the list above is what that currently means.
   */
  version: string
  ctrCurve: readonly CtrCurvePoint[]
  effortWeights: Readonly<Record<EffortTier, number>>
  severityWeights: Readonly<Record<Severity, number>>
  categoryWeights: Readonly<Record<string, number>>
  defaultCategoryWeight: number
  basisWeights: Readonly<Record<ImpactBasis, number>>
  /**
   * The position a stuck keyword is assumed to reach once fixed. Mid-page-one,
   * not position 1 — promising position 1 is how a forecast becomes a liability.
   */
  stuckKeywordTargetPosition: number
  /**
   * Raw impact for the measurement-gap basis. Fixed, not derived, because a
   * measurement gap gates every other number the pipeline could report: with
   * analytics off, no other recommendation can be verified. At basisWeight 0.1
   * this is 100 click-equivalents, which keeps it in the top band on any site
   * regardless of how few pages are untagged.
   */
  measurementGapWeight: number
  /**
   * Multiplier applied to a template-level fix when at least one affected URL is
   * known to earn impressions (§11's bonus). A template defect on pages that
   * already have visibility is a live loss; on pages nobody sees it is latent.
   */
  earningUrlBonus: number
  /** How many recommendations the snapshot gate holds to. */
  topK: number
  /** Priority-score floors for the P1/P2/P3 bands. */
  bandThresholds: { p1: number; p2: number }
  /** Percentage band the snapshot comparator allows on impact/priority values. */
  snapshotTolerancePct: number
}

export const SCORING_CONFIG: ScoringConfig = Object.freeze({
  version: 'scoring-2026-08-07.1',
  ctrCurve: LOCAL_CTR_CURVE,
  effortWeights: EFFORT_WEIGHTS,
  severityWeights: SEVERITY_WEIGHTS,
  categoryWeights: CATEGORY_WEIGHTS,
  defaultCategoryWeight: DEFAULT_CATEGORY_WEIGHT,
  basisWeights: BASIS_WEIGHTS,
  stuckKeywordTargetPosition: 5,
  measurementGapWeight: 1000,
  earningUrlBonus: 1.5,
  topK: 5,
  // Anchored so the tornado case reproduces §9's five P1s as one band. Disclosed
  // as calibration against the single documented human plan we have — two
  // thresholds fitted to one audit, which is why they live in config and are
  // labelled as an anchor rather than a finding.
  bandThresholds: { p1: 10, p2: 3 },
  snapshotTolerancePct: 5,
})

export type PriorityBand = 'P1' | 'P2' | 'P3'

export function bandFor(priorityScore: number, config: ScoringConfig = SCORING_CONFIG): PriorityBand {
  if (priorityScore >= config.bandThresholds.p1) return 'P1'
  if (priorityScore >= config.bandThresholds.p2) return 'P2'
  return 'P3'
}

/**
 * Expected CTR at a SERP position, from the configured curve.
 *
 * Stepwise and conservative: the first band whose upper bound is >= position
 * wins, positions below 1 clamp to the first band, and anything past the last
 * band clamps to the last. A non-finite position returns 0 rather than NaN — a
 * NaN would propagate into a client-facing impact number and compare falsely in
 * both directions.
 */
export function ctrAt(position: number, config: ScoringConfig = SCORING_CONFIG): number {
  if (!Number.isFinite(position)) return 0
  const curve = config.ctrCurve
  if (position <= curve[0].position) return curve[0].ctr
  for (const point of curve) {
    if (position <= point.position) return point.ctr
  }
  return curve[curve.length - 1].ctr
}
