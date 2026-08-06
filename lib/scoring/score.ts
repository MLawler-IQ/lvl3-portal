// The deterministic scoring stage.
//
// Findings state facts with magnitudes. This turns them into a ranked plan, and
// it does so with arithmetic only:
//
//   IMPACT  computed from data, via the §11 basis for the recommendation's type.
//   EFFORT  looked up in docs/rubric/rubric.json. Never inferred, never invented.
//   RANK    impact / effort_weight, descending, ties broken on checkId.
//
// There is no LLM in this file and none in anything it imports. That is what makes
// a scoring change reviewable — and it is what lib/eval/snapshot.ts can gate.
//
// Determinism rules held here, because the snapshot gate depends on them:
//   - no Date.now(), no Math.random(), nothing environment-derived;
//   - every Map is iterated in a SORTED order, never insertion order;
//   - equal scores sort by checkId, so two items that tie never swap between runs;
//   - all emitted numbers are rounded to 4 decimals, so float noise from a
//     re-ordered multiplication cannot change a byte of the snapshot.

import type { Finding, StationBundle } from '@/lib/findings/types'
import type { GSCRow } from '@/lib/tools-gsc'
import {
  SCORING_CONFIG,
  bandFor,
  type ImpactBasis,
  type ScoringConfig,
} from './config'
import {
  consolidationImpact,
  localVisibilityImpact,
  measurementGapImpact,
  stuckKeywordImpact,
  templateFixImpact,
  type BasisComputation,
  type CompetingCluster,
} from './impact'
import { rubricEntry } from './rubric'
import type {
  ScoredRecommendation,
  ScoreInputs,
  ScoringContext,
  ScoringResult,
  UnscoredFinding,
} from './types'

/** 4 decimals everywhere. See the determinism rules above. */
function round4(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.round(value * 1e4) / 1e4
}

function roundTerms(terms: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {}
  for (const key of Object.keys(terms)) out[key] = round4(terms[key])
  return out
}

/**
 * Mirrors the ONPAGE-006 detector's noise floor (lib/findings/checks.ts,
 * CANNIBAL_MIN_IMPRESSIONS). It is duplicated rather than imported because that
 * constant is private to the detector and this file may not modify it — so the
 * duplication is made SELF-CHECKING instead: the reconstructed cluster count is
 * persisted alongside the detector's own count, and a mismatch shows up as a note
 * on the recommendation rather than as a silently different number.
 */
const CONSOLIDATION_MIN_CLUSTER_IMPRESSIONS = 50

/** Where a basis takes its magnitude from, when it needs one. */
type MagnitudeSource = 'affectedUrls' | 'value' | 'sitePageCount'

interface BasisRule {
  basis: ImpactBasis
  magnitude: MagnitudeSource
}

/**
 * Which §11 impact basis each detector-backed check uses.
 *
 * Explicit per check, not inferred, because the basis is a judgement about what
 * kind of recommendation this is — and a wrong one is invisible in the output
 * while changing every number. tests/unit/scoring.test.ts asserts that every
 * check registered in lib/findings/checks.ts appears here, so a new detector
 * cannot land without someone deciding its basis.
 *
 * TECH-001 takes its magnitude from the site's page count: a root-level
 * Disallow does not affect "one thing", it affects every URL crawled. Scoring it
 * off the count of matching robots.txt lines (which is what the evidence carries)
 * would rank the site's most catastrophic possible defect near zero.
 *
 * ONPAGE-012 carries an explicit rule so it cannot fall through to the
 * category-derived fallback. It was landed ahead of the detector's registration; both
 * the registration and the snapshot re-baselining have since happened.
 */
const BASIS_RULES: Readonly<Record<string, BasisRule>> = Object.freeze({
  'TECH-001': { basis: 'template_fix', magnitude: 'sitePageCount' },
  'ONPAGE-003': { basis: 'template_fix', magnitude: 'affectedUrls' },
  'ONPAGE-012': { basis: 'template_fix', magnitude: 'affectedUrls' },
  'TECH-011': { basis: 'template_fix', magnitude: 'affectedUrls' },
  'MEAS-001': { basis: 'measurement_gap', magnitude: 'affectedUrls' },
  'ONPAGE-006': { basis: 'consolidation', magnitude: 'value' },
  'LOCAL-016': { basis: 'local_visibility', magnitude: 'affectedUrls' },
  'LOCAL-003': { basis: 'local_visibility', magnitude: 'value' },
})

export function basisRuleFor(checkId: string): BasisRule | undefined {
  return BASIS_RULES[checkId]
}

/** Every check id with an explicit basis decision. */
export function checksWithBasisRules(): Set<string> {
  return new Set(Object.keys(BASIS_RULES))
}

/**
 * The fallback for a check with no explicit rule.
 *
 * It does not throw: a detector landing without a scoring decision must not take
 * a whole client run down. But it does not hide either — the derived basis is
 * recorded in `inputs.notes`, and the unit test above makes the gap a red build
 * for anything actually registered.
 */
function derivedRule(category: string): BasisRule {
  if (category === 'measurement') return { basis: 'measurement_gap', magnitude: 'affectedUrls' }
  if (category === 'local' || category === 'geo') {
    return { basis: 'local_visibility', magnitude: 'affectedUrls' }
  }
  return { basis: 'template_fix', magnitude: 'affectedUrls' }
}

/** Pull the ScoringContext out of a station bundle, ignoring failed stations. */
export function contextFromStations(stations: StationBundle): ScoringContext {
  const context: ScoringContext = {}
  if (stations.gsc?.ok) context.gsc = stations.gsc.data
  if (stations.crawl?.ok) context.crawl = stations.crawl.data
  return context
}

/**
 * URLs out of an evidence example list.
 *
 * Examples are free-form one-liners — LOCAL-016 emits `url → geo`, ONPAGE-006
 * emits `"query" → n URLs` — so take the leading token and keep only what looks
 * like a URL. Anything else is not a URL and must not be treated as one.
 */
function urlsFromExamples(examples: string[] | undefined): string[] {
  if (!examples) return []
  const urls: string[] = []
  for (const example of examples) {
    const head = example.split(/\s/)[0]
    if (head.startsWith('http://') || head.startsWith('https://')) urls.push(head)
  }
  return urls
}

function anyUrlEarnsImpressions(urls: string[], gsc: GSCRow[] | undefined): boolean {
  if (!gsc || urls.length === 0) return false
  const earning = new Set<string>()
  for (const row of gsc) {
    if (row.impressions > 0) earning.add(row.page)
  }
  return urls.some((url) => earning.has(url))
}

/**
 * Rebuild the competing-query clusters from GSC.
 *
 * Grouping is redone from the data rather than read off the finding, because §11's
 * consolidation basis needs summed impressions PER cluster and the finding only
 * carries the cluster count. Sorted by query so the output is independent of row
 * order in the station data.
 */
export function competingClustersFromGsc(gsc: GSCRow[] | undefined): CompetingCluster[] {
  if (!gsc) return []
  const byQuery = new Map<string, { pages: Set<string>; summed: number; max: number }>()
  for (const row of gsc) {
    const query = row.query.trim().toLowerCase()
    const entry = byQuery.get(query) ?? { pages: new Set<string>(), summed: 0, max: 0 }
    entry.pages.add(row.page)
    entry.summed += row.impressions
    entry.max = Math.max(entry.max, row.impressions)
    byQuery.set(query, entry)
  }
  return Array.from(byQuery.entries())
    .filter(([, e]) => e.pages.size >= 2 && e.max >= CONSOLIDATION_MIN_CLUSTER_IMPRESSIONS)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([query, e]) => ({
      query,
      summedImpressions: e.summed,
      competingUrlCount: e.pages.size,
    }))
}

/**
 * Inputs for the stuck-keyword basis, from GSC rows for a set of queries.
 *
 * Position is impression-weighted, not a plain mean: averaging a 22,000-
 * impression row at position 18 with a 90-impression row at position 90 must not
 * produce position 54.
 *
 * NOTE: no check in lib/findings/checks.ts currently maps to this basis — the
 * stuck-keyword/opportunity detector is not built yet. The basis is implemented
 * and tested because §11 specifies it and because the tornado fixture contains
 * the exact opportunity it is for ("air duct cleaning": 22,596 impressions at
 * position 17.9, §9's fifth P1). See the report accompanying this slice.
 */
export function stuckKeywordInputsFromGsc(
  queries: string[],
  gsc: GSCRow[] | undefined,
): { impressions: number; currentPosition: number; matchedRows: number } {
  const wanted = new Set(queries.map((q) => q.trim().toLowerCase()))
  let impressions = 0
  let weightedPosition = 0
  let matchedRows = 0
  for (const row of gsc ?? []) {
    if (!wanted.has(row.query.trim().toLowerCase())) continue
    impressions += row.impressions
    weightedPosition += row.impressions * row.position
    matchedRows += 1
  }
  return {
    impressions,
    currentPosition: impressions > 0 ? weightedPosition / impressions : 0,
    matchedRows,
  }
}

function magnitudeOf(
  finding: Finding,
  source: MagnitudeSource,
  context: ScoringContext,
): { magnitude: number; note?: string } {
  if (source === 'sitePageCount') {
    const pages = context.crawl?.pages.length
    if (pages === undefined) {
      return {
        magnitude: finding.evidence.affectedUrls ?? finding.evidence.value ?? 0,
        note: 'crawl station unavailable; site-wide magnitude fell back to the evidence magnitude (a floor)',
      }
    }
    return { magnitude: pages }
  }
  const value = finding.evidence[source]
  if (value === undefined) {
    const fallback = finding.evidence.affectedUrls ?? finding.evidence.value
    if (fallback === undefined) {
      return { magnitude: 0, note: `evidence carries no ${source}; magnitude is 0` }
    }
    return { magnitude: fallback, note: `evidence carries no ${source}; used the other magnitude field` }
  }
  return { magnitude: value }
}

function computeBasis(
  finding: Finding,
  rule: BasisRule,
  context: ScoringContext,
  severityWeight: number,
  category: string,
  categoryWeight: number,
  config: ScoringConfig,
): BasisComputation {
  switch (rule.basis) {
    case 'measurement_gap':
      return measurementGapImpact({ affectedUrlCount: finding.evidence.affectedUrls }, config)

    case 'consolidation': {
      const clusters = competingClustersFromGsc(context.gsc)
      const computed = consolidationImpact(clusters)
      const fromEvidence = finding.evidence.value
      const notes = [...computed.notes]
      if (fromEvidence !== undefined) {
        computed.terms.clusterCountFromEvidence = fromEvidence
        if (fromEvidence !== clusters.length) {
          // The self-check on the duplicated noise floor. Visible, not silent.
          notes.push(
            `reconstructed ${clusters.length} clusters but the detector reported ${fromEvidence} — the scorer's cluster floor and the detector's have diverged`,
          )
        }
      }
      if (!context.gsc) notes.push('GSC station unavailable; consolidation impact could not be computed from data')
      return { ...computed, notes }
    }

    case 'template_fix': {
      const { magnitude, note } = magnitudeOf(finding, rule.magnitude, context)
      const urls = urlsFromExamples(finding.evidence.examples)
      const earns = anyUrlEarnsImpressions(urls, context.gsc)
      const computed = templateFixImpact(
        { affectedUrlCount: magnitude, severityWeight, anyAffectedUrlEarnsImpressions: earns },
        config,
      )
      const notes = [...computed.notes]
      if (note) notes.push(note)
      notes.push(
        `earning-URL test used the ${urls.length} example URL(s) on the finding, not the full affected set — the bonus is a floor, not a ceiling`,
      )
      return { ...computed, notes }
    }

    case 'local_visibility': {
      const { magnitude, note } = magnitudeOf(finding, rule.magnitude, context)
      const computed = localVisibilityImpact({ magnitude, categoryWeight, category })
      return { ...computed, notes: note ? [...computed.notes, note] : computed.notes }
    }

    case 'stuck_keyword': {
      // Reached only if a future check declares this basis. Queries come from the
      // evidence examples, which for such a check are query strings.
      const queries = (finding.evidence.examples ?? []).filter(
        (e) => !e.startsWith('http://') && !e.startsWith('https://'),
      )
      const inputs = stuckKeywordInputsFromGsc(queries, context.gsc)
      const computed = stuckKeywordImpact(
        { impressions: inputs.impressions, currentPosition: inputs.currentPosition },
        config,
      )
      const notes = [...computed.notes]
      if (inputs.matchedRows === 0) {
        notes.push('no GSC rows matched the finding\'s example queries; impact is a floor of 0')
      }
      return { ...computed, notes }
    }
  }
}

/**
 * Score one findings list into a ranked plan.
 *
 * Only `fail` findings are scored. A `pass` has nothing to recommend; a
 * `not_run` or `degraded` finding is an absence of knowledge, and inventing a
 * priority for it would be exactly the silent-incomplete-audit failure the
 * findings model exists to prevent. Everything skipped is returned in
 * `unscored`, with counts the snapshot gate asserts — so a regression that turns
 * fails into not_run cannot pass by producing a shorter plan.
 */
export function scoreFindings(
  findings: Finding[],
  context: ScoringContext = {},
  config: ScoringConfig = SCORING_CONFIG,
): ScoringResult {
  const items: ScoredRecommendation[] = []
  const unscored: UnscoredFinding[] = []

  for (const finding of findings) {
    if (finding.status !== 'fail') {
      unscored.push({
        checkId: finding.checkId,
        status: finding.status,
        reason:
          finding.status === 'pass'
            ? 'no defect to recommend'
            : `status ${finding.status}: ${finding.reason ?? 'no reason recorded'} — an absence of knowledge is never given a priority`,
      })
      continue
    }

    const rubric = rubricEntry(finding.checkId)
    const explicit = BASIS_RULES[finding.checkId]
    const rule = explicit ?? derivedRule(rubric.category)
    const severityWeight = config.severityWeights[rubric.severity]
    const effortWeight = config.effortWeights[rubric.effort]
    const categoryWeight = config.categoryWeights[rubric.category] ?? config.defaultCategoryWeight

    const computed = computeBasis(
      finding,
      rule,
      context,
      severityWeight,
      rubric.category,
      categoryWeight,
      config,
    )
    const basisWeight = config.basisWeights[rule.basis]
    const impact = round4(computed.rawImpact * basisWeight)
    const priorityScore = round4(impact / effortWeight)

    const notes = [...computed.notes]
    if (!explicit) {
      notes.push(
        `no explicit basis rule for ${finding.checkId}; basis derived from rubric category '${rubric.category}'`,
      )
    }

    const inputs: ScoreInputs = {
      basis: rule.basis,
      formula: computed.formula,
      terms: roundTerms(computed.terms),
      rawImpact: round4(computed.rawImpact),
      basisWeight,
      notes,
    }

    items.push({
      checkId: finding.checkId,
      status: finding.status,
      severity: rubric.severity,
      category: rubric.category,
      effort: rubric.effort,
      effortWeight,
      severityWeight,
      impact,
      priorityScore,
      band: bandFor(priorityScore, config),
      rank: 0, // assigned after the sort
      basis: rule.basis,
      inputs,
      evidenceDetail: finding.evidence.detail,
    })
  }

  // Descending priority; ties on checkId so equal scores never swap between runs.
  items.sort((a, b) =>
    b.priorityScore !== a.priorityScore
      ? b.priorityScore - a.priorityScore
      : a.checkId < b.checkId
        ? -1
        : a.checkId > b.checkId
          ? 1
          : 0,
  )
  items.forEach((item, i) => {
    item.rank = i + 1
  })
  unscored.sort((a, b) => (a.checkId < b.checkId ? -1 : a.checkId > b.checkId ? 1 : 0))

  return { items, unscored, configVersion: config.version }
}
