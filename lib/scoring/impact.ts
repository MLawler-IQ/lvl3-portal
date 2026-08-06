// The five impact bases from §11, as pure functions over explicit numbers.
//
// They are separated from the scorer on purpose. The scorer's job is the messy
// one — deciding which basis a finding belongs to and digging its inputs out of
// station data. These functions are the arithmetic, and being pure they can be
// unit-tested against hand-computed numbers without building a station bundle.
//
// NO LLM APPEARS ANYWHERE IN THIS FILE OR ANY FILE IT IMPORTS. Impact is computed
// from data; effort is a rubric lookup. That is the whole contract, and it is the
// reason a scoring change is reviewable at all.

import { ctrAt, type ScoringConfig, SCORING_CONFIG } from './config'

/** What every basis returns: the §11 formula's output plus its derivation. */
export interface BasisComputation {
  /** The formula's own output, in the formula's own units. */
  rawImpact: number
  formula: string
  terms: Record<string, number>
  notes: string[]
}

/** Guard every arithmetic result: a NaN impact would rank unpredictably and
 *  compare false in both directions against any tolerance band. */
function finite(value: number): number {
  return Number.isFinite(value) ? value : 0
}

/**
 * A keyword or page stuck below its reachable position.
 *
 * §11: impressions x CTR delta. The delta is between the CTR the configured
 * curve gives at the current position and the CTR at the target position, so the
 * output is already estimated incremental clicks per month. Negative deltas
 * clamp to zero — a page already above target is not an opportunity.
 */
export function stuckKeywordImpact(
  input: { impressions: number; currentPosition: number; targetPosition?: number },
  config: ScoringConfig = SCORING_CONFIG,
): BasisComputation {
  const target = input.targetPosition ?? config.stuckKeywordTargetPosition
  const currentCtr = ctrAt(input.currentPosition, config)
  const targetCtr = ctrAt(target, config)
  const delta = Math.max(0, targetCtr - currentCtr)
  const impressions = finite(input.impressions)
  return {
    rawImpact: finite(impressions * delta),
    formula: 'impressions x (ctr(targetPosition) - ctr(currentPosition))',
    terms: {
      impressions,
      currentPosition: finite(input.currentPosition),
      targetPosition: target,
      currentCtr,
      targetCtr,
      ctrDelta: delta,
    },
    notes:
      delta === 0
        ? ['already at or above the target position; no CTR headroom on the configured curve']
        : [],
  }
}

/**
 * A defect that lives in a template and therefore repeats across URLs.
 *
 * §11: affected_url_count x severity_weight, with a bonus when any affected URL
 * earns impressions. The bonus is multiplicative and part of the formula, not a
 * post-hoc adjustment: the same missing H1 across 191 pages nobody visits and
 * 191 pages with visibility are not the same recommendation.
 */
export function templateFixImpact(
  input: {
    affectedUrlCount: number
    severityWeight: number
    anyAffectedUrlEarnsImpressions: boolean
  },
  config: ScoringConfig = SCORING_CONFIG,
): BasisComputation {
  const affected = finite(input.affectedUrlCount)
  const severityWeight = finite(input.severityWeight)
  const bonus = input.anyAffectedUrlEarnsImpressions ? config.earningUrlBonus : 1
  return {
    rawImpact: finite(affected * severityWeight * bonus),
    formula: 'affected_url_count x severity_weight x earning_url_bonus',
    terms: { affectedUrlCount: affected, severityWeight, earningUrlBonus: bonus },
    notes: input.anyAffectedUrlEarnsImpressions
      ? ['bonus applied: at least one affected URL earns impressions']
      : ['no bonus: no affected URL was observed earning impressions'],
  }
}

/** One set of URLs competing for a single query. */
export interface CompetingCluster {
  query: string
  /** Impressions summed across every URL in the cluster. */
  summedImpressions: number
  competingUrlCount: number
}

/**
 * Several URLs splitting one query's intent.
 *
 * §11: summed impressions across the competing set x the number of competing
 * URLs. Per cluster, then summed — the URL count is the multiplier because a
 * four-way split wastes more of the same impressions than a two-way one.
 */
export function consolidationImpact(clusters: CompetingCluster[]): BasisComputation {
  let raw = 0
  const terms: Record<string, number> = {
    clusterCount: clusters.length,
    totalImpressions: 0,
    maxCompetingUrls: 0,
  }
  for (const cluster of clusters) {
    const impressions = finite(cluster.summedImpressions)
    const urls = finite(cluster.competingUrlCount)
    raw += impressions * urls
    terms.totalImpressions += impressions
    terms.maxCompetingUrls = Math.max(terms.maxCompetingUrls, urls)
    // Per-cluster terms are persisted so the client-facing sentence can name the
    // query that contributed most of the number.
    terms[`cluster:${cluster.query}:impressions`] = impressions
    terms[`cluster:${cluster.query}:urls`] = urls
  }
  return {
    rawImpact: finite(raw),
    formula: 'sum over clusters of (summed_impressions x competing_url_count)',
    terms,
    notes:
      clusters.length === 0
        ? ['no competing clusters could be reconstructed from GSC data; raw impact is a floor of 0']
        : [],
  }
}

/**
 * A measurement gap.
 *
 * §11: a fixed high weight, because it gates all other measurement. Deliberately
 * NOT proportional to how many pages are untagged: with attribution broken, every
 * other recommendation on the plan becomes unverifiable, and that cost does not
 * shrink because only 60% of pages are affected instead of 100%. The affected
 * count is still persisted, so the recommendation text can be specific even
 * though the score is not derived from it.
 */
export function measurementGapImpact(
  input: { affectedUrlCount?: number } = {},
  config: ScoringConfig = SCORING_CONFIG,
): BasisComputation {
  return {
    rawImpact: config.measurementGapWeight,
    formula: 'fixed measurement_gap_weight (gates all other measurement)',
    terms: {
      measurementGapWeight: config.measurementGapWeight,
      affectedUrlCount: finite(input.affectedUrlCount ?? 0),
    },
    notes: [
      'fixed weight by design: a measurement gap invalidates every other number, so it does not scale with page count',
    ],
  }
}

/**
 * A local or GBP defect.
 *
 * §11: weighted by category weight. The magnitude is whatever the finding's
 * evidence carries (affected location pages, missing profile fields), multiplied
 * by the category weight — which is how a local defect outranks an equivalently
 * sized on-page one for a business whose revenue arrives through the map pack.
 */
export function localVisibilityImpact(input: {
  magnitude: number
  categoryWeight: number
  category: string
}): BasisComputation {
  const magnitude = finite(input.magnitude)
  const categoryWeight = finite(input.categoryWeight)
  return {
    rawImpact: finite(magnitude * categoryWeight),
    formula: 'magnitude x category_weight',
    terms: { magnitude, categoryWeight },
    notes: [`category weight for '${input.category}'`],
  }
}
