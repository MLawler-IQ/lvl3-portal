import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { CHECKS, CHECK_IDS } from '@/lib/findings/checks'
import { runChecks } from '@/lib/findings/engine'
import type { Finding } from '@/lib/findings/types'
import {
  BASIS_WEIGHTS,
  EFFORT_WEIGHTS,
  SCORING_CONFIG,
  SEVERITY_WEIGHTS,
  bandFor,
  ctrAt,
} from '@/lib/scoring/config'
import {
  consolidationImpact,
  localVisibilityImpact,
  measurementGapImpact,
  stuckKeywordImpact,
  templateFixImpact,
} from '@/lib/scoring/impact'
import { criticalCheckIds, rubricEntry, rubricIndex } from '@/lib/scoring/rubric'
import {
  basisRuleFor,
  checksWithBasisRules,
  competingClustersFromGsc,
  contextFromStations,
  scoreFindings,
  stuckKeywordInputsFromGsc,
} from '@/lib/scoring/score'
import { tornadoStations } from '../../fixtures/eval/tornado/stations'
import { healthyStations } from '../../fixtures/eval/healthy/stations'

// The deterministic scoring stage. IMPACT from data, EFFORT from the rubric, rank
// on impact / effort_weight, and no LLM anywhere in the dependency cone.

const ROOT = join(__dirname, '..', '..')

function tornadoPlan() {
  const stations = tornadoStations()
  const findings = runChecks(CHECKS, stations)
  return scoreFindings(findings, contextFromStations(stations))
}

describe('scoring config — the CTR curve is config, and deliberately conservative', () => {
  // The real invariant: positions 1-10 are docs/AUTOMATION-CONTEXT.md §11 VERBATIM.
  // This pins the curve to an EXTERNAL source of truth rather than to whatever the
  // code happens to say — which matters, because this module was first written
  // while that spec file was missing from the repo and shipped 0.18 at position 1
  // where §11 says 0.22, under-forecasting every opportunity.
  it('matches §11 exactly for positions 1-10', () => {
    const spec: Record<number, number> = {
      1: 0.22, 2: 0.13, 3: 0.09, 4: 0.07, 5: 0.055,
      6: 0.045, 7: 0.037, 8: 0.03, 9: 0.026, 10: 0.022,
    }
    for (const [position, ctr] of Object.entries(spec)) {
      expect(ctrAt(Number(position))).toBe(ctr)
    }
  })

  it('stays at or below published averages, per §11 intent', () => {
    // §11 pitches the curve below published averages because local packs and AI
    // Overviews sit above the organic result. At/below, not strictly below: the
    // spec's own position-6 and position-10 values sit exactly on the published
    // figures, so a strict inequality would contradict the spec it encodes.
    const publishedFloor: Record<number, number> = {
      1: 0.27, 2: 0.15, 3: 0.11, 4: 0.08, 5: 0.06,
      6: 0.045, 7: 0.037, 8: 0.03, 9: 0.026, 10: 0.022,
    }
    for (const [position, published] of Object.entries(publishedFloor)) {
      expect(ctrAt(Number(position))).toBeLessThanOrEqual(published)
    }
  })

  it('is monotonically non-increasing down the SERP', () => {
    let previous = Infinity
    for (const point of SCORING_CONFIG.ctrCurve) {
      expect(point.ctr).toBeLessThanOrEqual(previous)
      previous = point.ctr
    }
  })

  it('reads stepwise and rounds DOWN inside a band', () => {
    expect(ctrAt(10)).toBe(0.022) // §11's position-10 value
    // 10.5 belongs to the next band, not the position-10 one — the conservative
    // direction, and the boundary the content-gap tool historically fell through.
    expect(ctrAt(10.5)).toBe(0.006)
    expect(ctrAt(17.9)).toBe(0.006)
    expect(ctrAt(20)).toBe(0.006)
    expect(ctrAt(21)).toBe(0.002)
  })

  it('clamps rather than extrapolating, and never returns NaN', () => {
    expect(ctrAt(0)).toBe(SCORING_CONFIG.ctrCurve[0].ctr)
    expect(ctrAt(-4)).toBe(SCORING_CONFIG.ctrCurve[0].ctr)
    expect(ctrAt(5000)).toBe(0.0005)
    expect(ctrAt(Number.NaN)).toBe(0)
    expect(ctrAt(Number.POSITIVE_INFINITY)).toBe(0)
  })

  it('effort weights are low 1 / medium 2.5 / high 5', () => {
    expect(EFFORT_WEIGHTS).toEqual({ low: 1, medium: 2.5, high: 5 })
  })

  it('bands are ordered and cover the whole range', () => {
    expect(SCORING_CONFIG.bandThresholds.p1).toBeGreaterThan(SCORING_CONFIG.bandThresholds.p2)
    expect(bandFor(SCORING_CONFIG.bandThresholds.p1)).toBe('P1')
    expect(bandFor(SCORING_CONFIG.bandThresholds.p2)).toBe('P2')
    expect(bandFor(0)).toBe('P3')
  })
})

describe('effort and severity come from the rubric, never from the scorer', () => {
  it('reads every check from docs/rubric/rubric.json', () => {
    const raw = JSON.parse(readFileSync(join(ROOT, 'docs/rubric/rubric.json'), 'utf8')) as unknown[]
    expect(rubricIndex().size).toBe(raw.length)
  })

  it('exposes the rubric effort tier verbatim for each detector-backed check', () => {
    // Spot-checked against the rubric file, not against the scorer's opinion.
    expect(rubricEntry('ONPAGE-003').effort).toBe('low')
    expect(rubricEntry('TECH-011').effort).toBe('medium')
    expect(rubricEntry('MEAS-001').effort).toBe('medium')
    expect(rubricEntry('TECH-011').severity).toBe('critical')
    expect(rubricEntry('ONPAGE-006').severity).toBe('medium')
  })

  it('every effort value in the rubric is one of the three weighted tiers', () => {
    for (const entry of Array.from(rubricIndex().values())) {
      expect(EFFORT_WEIGHTS[entry.effort]).toBeGreaterThan(0)
      expect(SEVERITY_WEIGHTS[entry.severity]).toBeGreaterThan(0)
    }
  })

  it('refuses to invent effort for an unknown check id', () => {
    expect(() => rubricEntry('NOPE-999')).toThrow(/never invents/)
  })

  it('the rubric has 12 critical checks, and only 3 can ever reach a plan', () => {
    // Was 9. The 2026-08-07 rubric re-cut raised LOCAL-007/008/010 (review volume,
    // velocity, rating) to critical, because Whitespark 2026 puts review signals at ~20%
    // of local-pack weight and reading them absolutely rather than against the businesses
    // in the pack is what made them look mid-tier.
    expect(criticalCheckIds().size).toBe(12)

    // The count is not what makes the top-K rule cheap — this is. Nine of the twelve have
    // no detector, so they can never produce a finding, never be scored, and never compete
    // for a top-K slot. Asserting the derived property rather than the count means
    // registering a critical detector is what turns this red, which is exactly the moment
    // someone should re-check that every critical fail still fits inside topK.
    const registered = new Set(CHECKS.map((c) => c.id))
    const reachable = Array.from(criticalCheckIds()).filter((id) => registered.has(id))
    expect(reachable.sort()).toEqual(['MEAS-001', 'TECH-001', 'TECH-011'])
    expect(reachable.length).toBeLessThanOrEqual(SCORING_CONFIG.topK)
  })
})

describe('impact bases — the arithmetic, hand-checked', () => {
  it('stuck keyword: impressions x CTR delta', () => {
    // The tornado fixture's biggest single opportunity: "air duct cleaning",
    // 22,596 impressions at position 17.9 (§9's real number — 13.5% of all site
    // impressions on one term).
    //
    // Hand-checked against §11's curve: ctr(5) 0.055 - ctr(17.9) 0.006 = 0.049,
    // so ~1,107 incremental clicks/month. The earlier substituted curve gave 0.034
    // and ~768, so correcting the curve made the single largest opportunity on the
    // site 44% bigger — which is exactly why a substituted constant in a
    // client-facing forecast is not a cosmetic problem.
    const computed = stuckKeywordImpact({ impressions: 22596, currentPosition: 17.9 })
    expect(computed.terms.ctrDelta).toBeCloseTo(0.049, 10)
    expect(computed.rawImpact).toBeCloseTo(22596 * 0.049, 6)
    expect(computed.terms.targetPosition).toBe(5)
  })

  it('stuck keyword: a page already above target has no headroom, not negative impact', () => {
    const computed = stuckKeywordImpact({ impressions: 5000, currentPosition: 1 })
    expect(computed.rawImpact).toBe(0)
    expect(computed.notes.join(' ')).toContain('no CTR headroom')
  })

  it('template fix: affected_url_count x severity_weight, with the earning bonus', () => {
    const withBonus = templateFixImpact({
      affectedUrlCount: 191,
      severityWeight: SEVERITY_WEIGHTS.high,
      anyAffectedUrlEarnsImpressions: true,
    })
    expect(withBonus.rawImpact).toBe(191 * 6 * 1.5)
    const without = templateFixImpact({
      affectedUrlCount: 191,
      severityWeight: SEVERITY_WEIGHTS.high,
      anyAffectedUrlEarnsImpressions: false,
    })
    expect(without.rawImpact).toBe(191 * 6)
    expect(withBonus.rawImpact / without.rawImpact).toBe(SCORING_CONFIG.earningUrlBonus)
  })

  it('consolidation: summed impressions x competing URL count, per cluster then summed', () => {
    const computed = consolidationImpact([
      { query: 'a', summedImpressions: 860, competingUrlCount: 4 },
      { query: 'b', summedImpressions: 680, competingUrlCount: 3 },
    ])
    expect(computed.rawImpact).toBe(860 * 4 + 680 * 3)
    expect(computed.terms.totalImpressions).toBe(1540)
    expect(computed.terms.maxCompetingUrls).toBe(4)
  })

  it('measurement gap: a fixed weight that does not scale with page count', () => {
    const few = measurementGapImpact({ affectedUrlCount: 3 })
    const many = measurementGapImpact({ affectedUrlCount: 187 })
    expect(few.rawImpact).toBe(many.rawImpact)
    expect(many.rawImpact).toBe(SCORING_CONFIG.measurementGapWeight)
    // The count is still persisted, so the recommendation text can be specific.
    expect(many.terms.affectedUrlCount).toBe(187)
  })

  it('local/GBP: magnitude x category weight', () => {
    const computed = localVisibilityImpact({ magnitude: 8, categoryWeight: 1.4, category: 'local' })
    expect(computed.rawImpact).toBeCloseTo(11.2, 10)
  })

  it('no basis can produce NaN or Infinity', () => {
    expect(stuckKeywordImpact({ impressions: Number.NaN, currentPosition: 12 }).rawImpact).toBe(0)
    expect(
      templateFixImpact({
        affectedUrlCount: Number.POSITIVE_INFINITY,
        severityWeight: 6,
        anyAffectedUrlEarnsImpressions: false,
      }).rawImpact,
    ).toBe(0)
    expect(
      localVisibilityImpact({ magnitude: Number.NaN, categoryWeight: 1.4, category: 'local' })
        .rawImpact,
    ).toBe(0)
  })
})

describe('basis resolution', () => {
  it('carries an explicit rule for ONPAGE-012 rather than the category fallback', () => {
    // Landed ahead of the detector's registration so registration could not silently
    // fall through to the category-derived fallback. Both the registration and the
    // snapshot re-baselining have since happened.
    expect(basisRuleFor('ONPAGE-012')).toEqual({ basis: 'template_fix', magnitude: 'affectedUrls' })
  })

  it('every registered detector has an explicit basis decision', () => {
    const decided = checksWithBasisRules()
    const missing = Array.from(CHECK_IDS).filter((id) => !decided.has(id))
    expect(
      missing,
      `these detectors have no explicit impact basis in lib/scoring/score.ts, so they would be scored by a category-derived fallback: ${missing.join(', ')}`,
    ).toEqual([])
  })

  it('every basis a rule can name has a positive calibration weight', () => {
    const bases = Array.from(checksWithBasisRules()).map((id) => basisRuleFor(id)!.basis)
    expect(bases.length).toBeGreaterThan(0)
    for (const basis of bases) {
      expect(BASIS_WEIGHTS[basis], `no calibration weight for basis '${basis}'`).toBeGreaterThan(0)
    }
    // And no basis is left without a weight, including ones nothing maps to yet.
    for (const weight of Object.values(BASIS_WEIGHTS)) expect(weight).toBeGreaterThan(0)
  })

  it('the stuck-keyword basis is implemented but unmapped — no detector produces it yet', () => {
    // Recorded as a fact, not an accident: §11 specifies the basis, the tornado
    // fixture contains the opportunity it is for ("air duct cleaning", 22,596
    // impressions at position 17.9 — §9's fifth P1), and no detector raises it.
    // When that detector lands, this expectation flips and the top-5 changes.
    const bases = Array.from(checksWithBasisRules()).map((id) => basisRuleFor(id)!.basis)
    expect(bases).not.toContain('stuck_keyword')
  })
})

describe('data extraction from stations', () => {
  it('rebuilds the tornado competing clusters from GSC rows', () => {
    const clusters = competingClustersFromGsc(contextFromStations(tornadoStations()).gsc)
    expect(clusters).toHaveLength(7)
    const dustless = clusters.find((c) => c.query === 'dustless duct cleaning')
    expect(dustless).toEqual({
      query: 'dustless duct cleaning',
      summedImpressions: 860,
      competingUrlCount: 4,
    })
    // Sorted by query, so row order in the station data cannot change the output.
    expect(clusters.map((c) => c.query)).toEqual([...clusters.map((c) => c.query)].sort())
  })

  it('finds no competing clusters on the healthy fixture', () => {
    expect(competingClustersFromGsc(contextFromStations(healthyStations()).gsc)).toEqual([])
  })

  it('weights stuck-keyword position by impressions, not by row count', () => {
    const inputs = stuckKeywordInputsFromGsc(['dustless duct cleaning'], [
      { query: 'dustless duct cleaning', page: '/a', clicks: 2, impressions: 400, ctr: 0.5, position: 35 },
      { query: 'dustless duct cleaning', page: '/b', clicks: 0, impressions: 100, ctr: 0, position: 90 },
    ])
    expect(inputs.impressions).toBe(500)
    // (400*35 + 100*90) / 500 = 46, not the unweighted mean of 62.5.
    expect(inputs.currentPosition).toBeCloseTo(46, 10)
    expect(inputs.matchedRows).toBe(2)
  })

  it('a failed station is not a station — context omits it rather than reading .data', () => {
    const stations = tornadoStations()
    stations.gsc = { ok: false, error: 'auth expired', sources: ['gsc'], durationMs: 0 }
    const context = contextFromStations(stations)
    expect(context.gsc).toBeUndefined()
    expect(context.crawl).toBeDefined()
  })
})

describe('scoring the tornado fixture', () => {
  it('scores exactly the failing checks and nothing else', () => {
    const plan = tornadoPlan()
    // ONPAGE-012 joined when its detector was registered; passes are never scored.
    expect(plan.items.map((i) => i.checkId).sort()).toEqual([
      'LOCAL-016', 'MEAS-001', 'ONPAGE-003', 'ONPAGE-006', 'ONPAGE-012', 'TECH-011',
    ])
    expect(plan.unscored.map((u) => u.checkId)).toEqual(['LOCAL-003', 'TECH-001'])
    for (const skipped of plan.unscored) expect(skipped.status).toBe('pass')
  })

  it('produces this exact ranked plan, on these exact numbers', () => {
    const plan = tornadoPlan()
    expect(
      plan.items.map((i) => [i.rank, i.checkId, i.impact, i.priorityScore, i.band]),
    ).toEqual([
      [1, 'MEAS-001', 100, 40, 'P1'],
      [2, 'ONPAGE-006', 85.5, 34.2, 'P1'],
      [3, 'TECH-011', 46, 18.4, 'P1'],
      // RE-BASELINED 2026-08-07 by the rubric re-cut, and this row is the whole diff.
      // ONPAGE-003 went severity high -> low (Google accepts multiple H1s), so its
      // severityWeight went 6 -> 1 and every number derived from it divided by exactly six:
      // 191 x 1 x 1.5 = 286.5 raw, x 0.05 basisWeight = 14.325 impact, and low effort
      // (weight 1) leaves priorityScore equal to impact. It stays P1 because 14.325 still
      // clears the p1 floor of 10. Rank 1 -> 4 is the only ordering consequence, and
      // MEAS-001/ONPAGE-006/TECH-011 each moved up one slot with no number of their own
      // changing. Nothing else in either fixture moved: the other five severity edits
      // (LOCAL-005/007/008/010, TECH-010) are on checks with no detector, so they produce
      // no finding and no scored item.
      [4, 'ONPAGE-003', 14.325, 14.325, 'P1'],
      [5, 'LOCAL-016', 33.6, 13.44, 'P1'],
      // ONPAGE-012 lands P2 on its own merits: real impact (44.4, 148 template-dominated
      // pages) divided by the rubric's `high` effort tier. Rewriting 148 pages of content
      // is genuinely not a P1 next action, and §9's human plan does not list it among its
      // five P1s either.
      [6, 'ONPAGE-012', 44.4, 8.88, 'P2'],
    ])
  })

  it('ranks on impact / effort_weight, which is why the biggest impact is not always first', () => {
    const plan = tornadoPlan()
    // The pair that demonstrates this changed with the 2026-08-07 re-cut, and the new one is
    // a sharper demonstration than the old MEAS-001-over-ONPAGE-003 pair (100 vs 85.95, a
    // 1.16x spread). ONPAGE-012 carries THREE TIMES the impact of ONPAGE-003 and still ranks
    // two slots below it, because rewriting 148 pages of content is `high` effort (weight 5)
    // against a one-line template change at `low` (weight 1).
    const template = plan.items.find((i) => i.checkId === 'ONPAGE-012')!
    const h1 = plan.items.find((i) => i.checkId === 'ONPAGE-003')!
    expect(template.impact).toBeGreaterThan(h1.impact)
    expect(template.rank).toBeGreaterThan(h1.rank)
    expect(template.effortWeight).toBeGreaterThan(h1.effortWeight)
    for (const item of plan.items) {
      expect(item.priorityScore).toBeCloseTo(item.impact / item.effortWeight, 3)
    }
  })

  it('puts both critical fails inside the top-K', () => {
    const plan = tornadoPlan()
    const topK = plan.items.slice(0, SCORING_CONFIG.topK).map((i) => i.checkId)
    const criticals = plan.items.filter((i) => i.severity === 'critical').map((i) => i.checkId)
    expect(criticals.sort()).toEqual(['MEAS-001', 'TECH-011'])
    for (const id of criticals) expect(topK).toContain(id)
  })

  it('agrees with §9\'s human plan on the BAND for every check §9 listed', () => {
    // §9's P1 list, restricted to the checks that have detectors. The assertion is
    // deliberately scoped to those rather than "every item is P1": ONPAGE-012 is
    // NOT in §9's plan, and demanding it be P1 would have forced the band
    // thresholds to fit a check the human never prioritised.
    const NINE_P1_WITH_DETECTORS = ['ONPAGE-003', 'MEAS-001', 'ONPAGE-006', 'TECH-011', 'LOCAL-016']
    const plan = tornadoPlan()
    for (const checkId of NINE_P1_WITH_DETECTORS) {
      const item = plan.items.find((i) => i.checkId === checkId)
      expect(item, `${checkId} missing from the plan`).toBeDefined()
      expect(item!.band, checkId).toBe('P1')
    }
  })

  it('persists the score inputs for every recommendation', () => {
    for (const item of tornadoPlan().items) {
      expect(item.inputs.formula.length).toBeGreaterThan(0)
      expect(Object.keys(item.inputs.terms).length).toBeGreaterThan(0)
      expect(Number.isFinite(item.inputs.rawImpact)).toBe(true)
      expect(item.inputs.basisWeight).toBeGreaterThan(0)
      // The number a client is quoted must reconstruct from the stored terms.
      expect(item.impact).toBeCloseTo(item.inputs.rawImpact * item.inputs.basisWeight, 3)
      expect(item.evidenceDetail.length).toBeGreaterThan(0)
    }
  })

  it('the H1 recommendation can be explained term by term', () => {
    const h1 = tornadoPlan().items.find((i) => i.checkId === 'ONPAGE-003')!
    expect(h1.inputs.terms).toEqual({
      affectedUrlCount: 191,
      // 6 until the 2026-08-07 re-cut moved ONPAGE-003 to `low`. This term is the entire
      // mechanism by which a rubric severity edit reaches a client-facing number, which is
      // why the version string now covers rubric-sourced severity as well as this file.
      severityWeight: 1,
      earningUrlBonus: 1.5,
    })
    expect(h1.inputs.notes.join(' ')).toContain('at least one affected URL earns impressions')
  })

  it('the consolidation recommendation cross-checks its cluster count against the detector', () => {
    const item = tornadoPlan().items.find((i) => i.checkId === 'ONPAGE-006')!
    expect(item.inputs.terms.clusterCount).toBe(7)
    expect(item.inputs.terms.clusterCountFromEvidence).toBe(7)
    expect(item.inputs.terms.totalImpressions).toBe(3075)
    // No divergence note when the scorer's floor and the detector's agree.
    expect(item.inputs.notes.join(' ')).not.toContain('diverged')
  })

  it('scores the whole plan to zero impact when GSC is gone, and says why', () => {
    const stations = tornadoStations()
    stations.gsc = { ok: false, error: 'auth expired', sources: ['gsc'], durationMs: 0 }
    const findings = runChecks(CHECKS, stations)
    const plan = scoreFindings(findings, contextFromStations(stations))
    // ONPAGE-006 cannot even run without GSC — it is not_run, hence unscored.
    expect(plan.items.map((i) => i.checkId)).not.toContain('ONPAGE-006')
    const notRun = plan.unscored.find((u) => u.checkId === 'ONPAGE-006')
    expect(notRun?.status).toBe('not_run')
    expect(notRun?.reason).toContain('absence of knowledge')
    // And the H1 recommendation loses its earning-URL bonus, visibly.
    const h1 = plan.items.find((i) => i.checkId === 'ONPAGE-003')!
    expect(h1.inputs.terms.earningUrlBonus).toBe(1)

    // NEW SINCE THE 2026-08-07 RE-CUT, and worth pinning because it is a real behaviour
    // change nobody asked for: at severity `high` this check was P1 with the bonus (85.95)
    // and P1 without it (57.3). At `low` it is P1 with (14.325) and **P2 without**
    // (191 x 1 x 1 x 0.05 = 9.55, against a p1 floor of 10). So the H1 template fix now
    // changes band depending on whether GSC answered — a 0.45-point margin. That is not
    // wrong, but it is fragile, and a future tweak to earningUrlBonus or bandThresholds
    // that silently demotes the site-wide H1 gap should turn this red.
    expect(h1.impact).toBeCloseTo(9.55, 6)
    expect(h1.band).toBe('P2')
  })
})

describe('scoring the healthy fixture', () => {
  it('recommends nothing at all', () => {
    const stations = healthyStations()
    const plan = scoreFindings(runChecks(CHECKS, stations), contextFromStations(stations))
    expect(plan.items).toEqual([])
    expect(plan.unscored).toHaveLength(CHECKS.length)
  })
})

describe('unscored findings are never given a priority', () => {
  const base: Finding = {
    checkId: 'ONPAGE-003',
    status: 'fail',
    evidence: { affectedUrls: 10, detail: 'ten pages' },
    source: 'crawl',
  }

  it('a not_run finding is skipped with its reason, not scored as zero', () => {
    const plan = scoreFindings([
      { ...base, status: 'not_run', reason: 'crawl station not provided' },
    ])
    expect(plan.items).toEqual([])
    expect(plan.unscored[0].reason).toContain('crawl station not provided')
  })

  it('a degraded finding is skipped — partial data supports no priority', () => {
    const plan = scoreFindings([{ ...base, status: 'degraded' }])
    expect(plan.items).toEqual([])
    expect(plan.unscored[0].status).toBe('degraded')
  })

  it('a pass is skipped', () => {
    const plan = scoreFindings([{ ...base, status: 'pass' }])
    expect(plan.items).toEqual([])
  })
})

describe('determinism', () => {
  it('two independent runs produce identical output', () => {
    expect(JSON.stringify(tornadoPlan())).toBe(JSON.stringify(tornadoPlan()))
  })

  it('equal scores break the tie on checkId, in either input order', () => {
    // LOCAL-003 (local, effort low) and LOCAL-016 (local, effort medium) tie when
    // LOCAL-016's magnitude is 2.5x LOCAL-003's: 4.2*2 == 4.2*5/2.5.
    const a: Finding = {
      checkId: 'LOCAL-003',
      status: 'fail',
      evidence: { value: 2, detail: 'two fields missing' },
      source: 'gbp',
    }
    const b: Finding = {
      checkId: 'LOCAL-016',
      status: 'fail',
      evidence: { affectedUrls: 5, detail: 'five pages out of area' },
      source: 'derived',
    }
    const forward = scoreFindings([a, b])
    const reverse = scoreFindings([b, a])
    expect(forward.items[0].priorityScore).toBe(forward.items[1].priorityScore)
    expect(forward.items.map((i) => i.checkId)).toEqual(['LOCAL-003', 'LOCAL-016'])
    expect(reverse.items.map((i) => i.checkId)).toEqual(forward.items.map((i) => i.checkId))
  })

  it('cluster term order does not depend on GSC row order', () => {
    const stations = tornadoStations()
    const gsc = stations.gsc!
    if (!gsc.ok) throw new Error('fixture gsc must be ok')
    const reversed = { ...gsc, data: [...gsc.data].reverse() }
    const forwardPlan = scoreFindings(runChecks(CHECKS, stations), contextFromStations(stations))
    const reversedPlan = scoreFindings(
      runChecks(CHECKS, { ...stations, gsc: reversed }),
      contextFromStations({ ...stations, gsc: reversed }),
    )
    const pick = (p: typeof forwardPlan) =>
      JSON.stringify(p.items.find((i) => i.checkId === 'ONPAGE-006')!.inputs.terms)
    expect(pick(reversedPlan)).toBe(pick(forwardPlan))
  })
})

describe('the scoring stage contains no LLM', () => {
  it('nothing in lib/scoring reaches for a model', () => {
    const dir = join(ROOT, 'lib', 'scoring')
    const files = readdirSync(dir).filter((f) => f.endsWith('.ts'))
    expect(files.length).toBeGreaterThan(0)
    for (const file of files) {
      const source = readFileSync(join(dir, file), 'utf8')
      // Comments legitimately discuss the rule ("no LLM here"), so match the
      // shapes an actual call would take, not the acronym.
      expect(source).not.toMatch(/@anthropic-ai|from 'openai'|messages\.create|messages\.stream/)
    }
  })
})
