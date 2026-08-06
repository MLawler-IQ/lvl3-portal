// What the scoring stage produces, and what it persists.
//
// The persisted part is `ScoreInputs`, and it is not optional decoration. §11
// requires the score inputs to be stored so any number in a client-facing
// recommendation can be explained on the call: "this is 191 pages times the
// rubric's weight for a high-severity defect, times 1.5 because some of those
// pages already earn impressions, converted at 0.05 clicks per raw point." Every
// term in that sentence is a key in `terms`.
//
// It is also the substrate for the calibration loop: once outcomes come back,
// fitting BASIS_WEIGHTS means regressing observed clicks against stored terms.
// You cannot fit what you did not record.

import type { FindingStatus } from '@/lib/findings/types'
import type { GSCRow } from '@/lib/tools-gsc'
import type { CrawlStationData } from '@/lib/tools/crawl-record'
import type { EffortTier, ImpactBasis, PriorityBand, Severity } from './config'

export type { ImpactBasis, PriorityBand } from './config'

/**
 * The full derivation of one impact number. Persisted verbatim.
 *
 * `formula` is the human-readable shape; `terms` are the numbers that went into
 * it, named. A reviewer reading a snapshot diff should be able to see WHICH term
 * moved, not merely that the total did.
 */
export interface ScoreInputs {
  basis: ImpactBasis
  formula: string
  terms: Record<string, number>
  /** The §11 formula's own output, before cross-basis conversion. */
  rawImpact: number
  /** BASIS_WEIGHTS[basis] — the one calibration constant per basis. */
  basisWeight: number
  /** Anything that qualifies the number: a floor, a sampled input, a cap. */
  notes: string[]
}

export interface ScoredRecommendation {
  checkId: string
  /** Always 'fail' today — only defects are scored. Carried so a future
   *  degraded-but-actionable policy is visible in the output rather than
   *  inferred. */
  status: FindingStatus
  severity: Severity
  category: string
  effort: EffortTier
  effortWeight: number
  severityWeight: number
  /** Estimated incremental monthly clicks (click-equivalents). */
  impact: number
  /** impact / effortWeight. The ranking key. */
  priorityScore: number
  band: PriorityBand
  /** 1-based. Ties broken on checkId so equal scores order stably. */
  rank: number
  basis: ImpactBasis
  inputs: ScoreInputs
  /** The evidence one-liner, so a recommendation is readable without a join. */
  evidenceDetail: string
}

/** Findings the scorer deliberately did not score, and why. Counted into the
 *  snapshot so a regression that turns fails into not_run cannot hide. */
export interface UnscoredFinding {
  checkId: string
  status: FindingStatus
  reason: string
}

export interface ScoringResult {
  items: ScoredRecommendation[]
  unscored: UnscoredFinding[]
  configVersion: string
}

/**
 * The data the impact bases read, beyond the finding itself.
 *
 * Impact is computed FROM DATA (§11), which means the scorer needs the station
 * data the detectors saw — not a summary of it. Both fields are optional: a
 * missing station degrades an impact basis to its data-free floor and says so in
 * `inputs.notes`, rather than silently scoring zero.
 */
export interface ScoringContext {
  gsc?: GSCRow[]
  crawl?: CrawlStationData
}
